import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../lib/supabase.ts";
import { listUnverifiedAppliedChanges } from "../../../../lib/tools/campaign-changes-store.ts";
import { runVerify } from "../../../../lib/campaign-optimization-orchestrator.ts";

// Vercel Cron target — same auth pattern and "not runnable end-to-end
// until a real Vercel deployment exists" caveat as sync-ad-stats/route.ts
// (Backlog #23). Periodically closes the loop on Track B's
// recommend->approve->apply cycle: for every campaign_changes_log row
// that's been applied for at least VERIFY_AFTER_DAYS, pulls fresh
// performance and records what actually happened against what was
// expected — the self-evaluation step the plan calls for.
function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

// A change needs some real post-apply performance history before "did it
// work" means anything — 7 days matches the weekly cadence campaign
// budgets/bidding strategies are usually judged on, not an arbitrary
// shorter window that would just be measuring noise.
const VERIFY_AFTER_DAYS = 7;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await listUnverifiedAppliedChanges(VERIFY_AFTER_DAYS);
  if (pending.length === 0) {
    return NextResponse.json({ verified: 0, results: [] });
  }

  const accountIds = [...new Set(pending.map((c) => c.clientAdAccountId))];
  const { data: accounts, error } = await getSupabase()
    .from("client_ad_account")
    .select("id, platform, external_account_id")
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .in("id", accountIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const accountById = new Map((accounts ?? []).map((a) => [a.id as string, a]));

  const results = await Promise.all(
    pending.map(async (change) => {
      const account = accountById.get(change.clientAdAccountId);
      if (!account) {
        return { changeLogId: change.id, ok: false, error: `client_ad_account ${change.clientAdAccountId} not found` };
      }
      try {
        const result = await runVerify({
          changeLogId: change.id,
          platform: account.platform as "google-ads" | "yandex-direct",
          externalAccountId: account.external_account_id as string,
        });
        return { changeLogId: change.id, ok: true, actualEffect: result.actualEffect };
      } catch (verifyError) {
        return { changeLogId: change.id, ok: false, error: verifyError instanceof Error ? verifyError.message : String(verifyError) };
      }
    }),
  );

  return NextResponse.json({ verified: results.length, results });
}
