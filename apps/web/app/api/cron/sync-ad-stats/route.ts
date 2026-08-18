import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../lib/supabase.ts";
import { syncAdStats } from "../../../../lib/sync-ad-stats.ts";

// Vercel Cron target (see vercel.json) — not runnable end-to-end until a
// real Vercel deployment exists (Backlog #23), but the code is ready in
// advance so it starts working the moment that deployment lands. Vercel
// sends `Authorization: Bearer $CRON_SECRET` on cron-triggered requests
// when CRON_SECRET is set as a project env var — reject anything else so
// this can't be hit as an open endpoint.
function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

// Re-pulls a short trailing window (not just "yesterday") on every run —
// ad platforms keep attributing conversions/spend to recent past days for
// a while after they end (observed for real 2026-08-18: a re-sync of the
// same Aug 1-16 Медавеню range a few hours later returned different,
// higher totals for recent days). 3 days back plus today catches most of
// that drift without re-pulling the whole history daily.
const TRAILING_WINDOW_DAYS = 3;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const startDate = isoDate(new Date(today.getTime() - TRAILING_WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const endDate = isoDate(today);

  const { data: accounts, error } = await getSupabase()
    .from("client_ad_account")
    .select("id, client_id, platform, external_account_id")
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .eq("status", "active");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = await Promise.all(
    (accounts ?? []).map(async (account) => {
      try {
        const result = await syncAdStats(account.id, { startDate, endDate });
        return { adAccountId: account.id, platform: account.platform, ok: true, rowsWritten: result.rowsWritten };
      } catch (syncError) {
        return {
          adAccountId: account.id,
          platform: account.platform,
          ok: false,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        };
      }
    }),
  );

  return NextResponse.json({ startDate, endDate, accountsSynced: results.length, results });
}
