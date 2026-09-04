import { getSupabase, getSupabaseOwnerTenantId } from "./supabase.ts";
import { resolveAccessContext } from "./tools/platform-identity.ts";
import { listCampaigns as listGoogleCampaigns } from "./tools/google-ads.ts";
import { listCampaigns as listYandexCampaigns } from "./tools/yandex-direct.ts";
import { listCampaigns as listOpenAiAdsCampaigns } from "./tools/openai-ads.ts";

// Generalized from Astrum Analyzer's Warface-specific campaign_status sync
// (sync/run_sync.py's status step there) — same purpose: record each
// campaign's live running/paused state so the weekly trend-degradation
// detector (campaign-trends.ts) can tell "still live and getting worse"
// apart from "paused two weeks ago, this is just the spend tail draining
// out". One row overwritten in place per (client, platform, campaign),
// mirroring sync-ad-stats.ts's upsert shape but keyed without a date.
export interface SyncStatusResult {
  readonly rowsWritten: number;
}

export async function syncCampaignStatus(clientAdAccountId: string): Promise<SyncStatusResult> {
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

  let rows: ReadonlyArray<{ campaignId: string; campaignName: string; isRunning: boolean; rawStatus: string }>;

  if (access.platform === "google-ads") {
    const options = { refreshTokenEnv: access.credentialRef, loginCustomerId: access.managerId ?? undefined };
    const campaigns = await listGoogleCampaigns(access.externalAccountId, options);
    rows = (campaigns ?? [])
      .filter((c) => c.campaign?.id)
      .map((c) => ({
        campaignId: c.campaign!.id!,
        campaignName: c.campaign!.name ?? "",
        // ENABLED is the only "actually spending" status — PAUSED/REMOVED both
        // mean no new spend, same as Astrum Analyzer's Direct State != "ON" check.
        isRunning: c.campaign!.status === "ENABLED",
        rawStatus: c.campaign!.status ?? "UNKNOWN",
      }));
  } else if (access.platform === "yandex-direct") {
    const yandexClientLogin = access.accessMode === "agency_manager" ? access.externalAccountId : undefined;
    const campaigns = await listYandexCampaigns(yandexClientLogin, access.credentialRef);
    rows = campaigns.map((c) => ({
      campaignId: String(c.Id),
      campaignName: c.Name,
      // Direct's real "is spending" signal is State ("ON"), not Status
      // (Status is moderation/lifecycle — "ACCEPTED" campaigns can still be
      // paused via State) — same distinction Astrum Analyzer's
      // campaign_status sync makes for Warface.
      isRunning: c.State === "ON",
      rawStatus: `${c.Status}/${c.State}`,
    }));
  } else {
    // openai-ads — access.credentialRef names the static per-account API key
    // (openai-ads-auth.ts), not an OAuth env pair; there is no agency_manager
    // mode for this platform (see platform-identity.ts's AccessContext note).
    const campaigns = await listOpenAiAdsCampaigns(access.credentialRef);
    rows = campaigns.map((c) => ({
      campaignId: c.id,
      campaignName: c.name,
      isRunning: c.status === "active",
      rawStatus: c.status,
    }));
  }

  if (rows.length === 0) return { rowsWritten: 0 };

  const upsertRows = rows.map((r) => ({
    tenant_id: tenantId,
    client_id: clientId,
    platform: access.platform,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    is_running: r.isRunning,
    raw_status: r.rawStatus,
    synced_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabase
    .from("campaign_status")
    .upsert(upsertRows, { onConflict: "client_id,platform,campaign_id" });
  if (upsertError) throw new Error(`Failed to upsert campaign_status: ${upsertError.message}`);

  return { rowsWritten: upsertRows.length };
}
