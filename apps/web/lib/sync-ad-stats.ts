import { getSupabase, getSupabaseOwnerTenantId } from "./supabase.ts";
import { resolveAccessContext } from "./tools/platform-identity.ts";
import { getCampaignReport as getGoogleCampaignReport, getAccountCurrency as getGoogleAccountCurrency } from "./tools/google-ads.ts";
import { getCampaignReport as getYandexCampaignReport, getAccountCurrency as getYandexAccountCurrency } from "./tools/yandex-direct.ts";

// Client ad-account reporting foundation (2026-08-18) — pulls real
// campaign metrics for one client_ad_account over a date range and
// upserts them into ad_stat, the single fact table DataLens will
// eventually connect to natively and future anomaly-detection queries
// will read history from. No scheduling/cron wrapper here on purpose
// (Backlog: явно не делаем сейчас) — this is a plain callable function,
// invoked manually or from a route for now.
export interface SyncResult {
  readonly rowsWritten: number;
}

export async function syncAdStats(
  clientAdAccountId: string,
  params: { readonly startDate: string; readonly endDate: string },
): Promise<SyncResult> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const access = await resolveAccessContext(clientAdAccountId);

  const { data: accountRow, error: accountError } = await supabase
    .from("client_ad_account")
    .select("client_id")
    .eq("id", clientAdAccountId)
    .single();
  if (accountError || !accountRow) {
    throw new Error(`client_ad_account "${clientAdAccountId}" not found: ${accountError?.message ?? "no row"}`);
  }
  const clientId = accountRow.client_id as string;

  const { data: targetConversions, error: targetError } = await supabase
    .from("target_conversion")
    .select("external_conversion_id")
    .eq("client_id", clientId)
    .eq("platform", access.platform === "google-ads" ? "google-ads" : "yandex-metrika");
  if (targetError) throw new Error(`Failed to read target_conversion: ${targetError.message}`);
  const conversionIds = (targetConversions ?? []).map((row) => row.external_conversion_id as string);

  let rows: ReadonlyArray<{
    campaignId: string;
    campaignName: string;
    date: string;
    cost: number;
    impressions: number;
    clicks: number;
    conversions: Record<string, number>;
  }>;
  let currency: string;

  if (access.platform === "google-ads") {
    const options = { refreshTokenEnv: access.credentialRef, loginCustomerId: access.managerId ?? undefined };
    const [report, accountCurrency] = await Promise.all([
      getGoogleCampaignReport(
        access.externalAccountId,
        { startDate: params.startDate, endDate: params.endDate, conversionActionIds: conversionIds },
        options,
      ),
      getGoogleAccountCurrency(access.externalAccountId, options),
    ]);
    currency = accountCurrency;
    rows = report.map((r) => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      date: r.date,
      cost: r.costMicros / 1_000_000,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversionsByAction,
    }));
  } else {
    const yandexClientLogin = access.accessMode === "agency_manager" ? access.externalAccountId : undefined;
    const [report, accountCurrency] = await Promise.all([
      getYandexCampaignReport(
        yandexClientLogin,
        { startDate: params.startDate, endDate: params.endDate, goalIds: conversionIds },
        access.credentialRef,
      ),
      getYandexAccountCurrency(yandexClientLogin, access.credentialRef),
    ]);
    currency = accountCurrency;
    rows = report.map((r) => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      date: r.date,
      cost: r.cost,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversionsByGoal,
    }));
  }

  // One row per (campaign, date) — both getCampaignReport functions now
  // segment by date (google-ads.ts's segments.date, yandex-direct.ts's
  // "Date" field), so real day-by-day history lands in ad_stat instead of
  // one collapsed row per sync call. This is what week-over-week/anomaly
  // comparisons need.
  const upsertRows = rows.map((r) => ({
    tenant_id: tenantId,
    client_id: clientId,
    platform: access.platform,
    account_id: access.externalAccountId,
    date: r.date,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    impressions: r.impressions,
    clicks: r.clicks,
    cost: r.cost,
    currency,
    conversions: r.conversions,
    conversions_total: Object.values(r.conversions).reduce((sum, v) => sum + v, 0),
  }));

  if (upsertRows.length === 0) return { rowsWritten: 0 };

  const { error: upsertError } = await supabase
    .from("ad_stat")
    .upsert(upsertRows, { onConflict: "client_id,platform,campaign_id,date" });
  if (upsertError) throw new Error(`Failed to upsert ad_stat: ${upsertError.message}`);

  return { rowsWritten: upsertRows.length };
}
