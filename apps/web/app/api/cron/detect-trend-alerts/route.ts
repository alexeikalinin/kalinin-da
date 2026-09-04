import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../lib/supabase.ts";
import { runTrendAlerts } from "../../../../lib/campaign-optimization-orchestrator.ts";

// Vercel Cron target (see vercel.json) — weekly counterpart to
// sync-ad-stats' daily run. Same auth pattern (Bearer CRON_SECRET).
function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: accounts, error } = await getSupabase()
    .from("client_ad_account")
    .select("id, client_id, platform")
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .eq("status", "active");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // One trend-alerts run per (client, platform) client_ad_account row —
  // same grain as recommend/apply/verify. detectSustainedDegradation
  // itself needs ~4-5 weeks of ad_stat history per campaign to say
  // anything (docs/03-architecture/campaign-weekly-trends.md's default
  // minWeeks=3 -> a 4-week window) — a fresh client with less history than
  // that simply gets 0 alerts, not an error.
  const results = await Promise.all(
    (accounts ?? []).map(async (account) => {
      try {
        const result = await runTrendAlerts({
          clientAdAccountId: account.id,
          clientId: account.client_id,
          platform: account.platform,
        });
        return { adAccountId: account.id, platform: account.platform, ok: true, ...result };
      } catch (runError) {
        return {
          adAccountId: account.id,
          platform: account.platform,
          ok: false,
          error: runError instanceof Error ? runError.message : String(runError),
        };
      }
    }),
  );

  return NextResponse.json({ accountsChecked: results.length, results });
}
