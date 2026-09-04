import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../lib/supabase.ts";
import { syncAdStats } from "../../../../lib/sync-ad-stats.ts";
import { syncCampaignStatus } from "../../../../lib/sync-campaign-status.ts";

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
        // Both writes share the same access-resolution/live-API-call path
        // (see resolveAccessContext) but populate different tables (ad_stat
        // vs campaign_status) — run them independently so a live-status
        // read failing (e.g. a transient API hiccup) doesn't also kill the
        // day's spend/conversion sync, and vice versa.
        const [statsResult, statusResult] = await Promise.allSettled([
          syncAdStats(account.id, { startDate, endDate }),
          syncCampaignStatus(account.id),
        ]);
        return {
          adAccountId: account.id,
          platform: account.platform,
          ok: statsResult.status === "fulfilled",
          rowsWritten: statsResult.status === "fulfilled" ? statsResult.value.rowsWritten : undefined,
          error: statsResult.status === "rejected" ? String(statsResult.reason) : undefined,
          statusSync:
            statusResult.status === "fulfilled"
              ? { ok: true, rowsWritten: statusResult.value.rowsWritten }
              : { ok: false, error: String(statusResult.reason) },
        };
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
