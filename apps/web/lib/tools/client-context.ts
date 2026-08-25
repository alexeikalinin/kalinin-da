import { getSupabase, getSupabaseOwnerTenantId } from "../supabase.ts";

// Closes the gap flagged in the 2026-08-21 agent-framework audit: the
// Analytics Agent called GA/Metrika/DataLens via ToolPort without ever
// seeing which conversions are already approved for this client
// (`target_conversion`) or what's already synced (`ad_stat`) — the two
// systems (packages/agents' reference conveyor and the client ad-account
// reporting foundation, both Supabase-backed) were wired independently.
// Read-only, same pattern as platform-identity.ts (service-role client,
// scoped to the owner tenant).
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_OWNER_TENANT_ID);
}

interface TargetConversionRow {
  readonly platform: "google-ads" | "yandex-metrika";
  readonly external_conversion_id: string;
  readonly name: string;
  readonly approved_at: string;
}

interface AdStatAggRow {
  readonly platform: "google-ads" | "yandex-direct";
  readonly campaign_name: string | null;
  readonly impressions: number;
  readonly clicks: number;
  readonly cost: number;
  readonly currency: string | null;
  readonly conversions_total: number;
}

export interface ClientContext {
  readonly clientDisplayName: string;
  readonly approvedTargetConversions: readonly TargetConversionRow[];
  // Last 30 days, aggregated by campaign — this is what actually synced,
  // as ground truth to compare the model's read of GA/Metrika/DataLens
  // against, not just campaign configuration.
  readonly last30dCampaignStats: readonly AdStatAggRow[];
}

export async function getClientContext(clientId: string): Promise<ClientContext> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();

  const { data: client, error: clientError } = await supabase
    .from("client")
    .select("display_name")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .single();
  if (clientError || !client) {
    throw new Error(`client "${clientId}" not found: ${clientError?.message ?? "no row"}`);
  }

  const { data: targetConversions, error: tcError } = await supabase
    .from("target_conversion")
    .select("platform, external_conversion_id, name, approved_at")
    .eq("client_id", clientId)
    .eq("tenant_id", tenantId);
  if (tcError) throw new Error(`target_conversion read failed: ${tcError.message}`);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: adStat, error: adStatError } = await supabase
    .from("ad_stat")
    .select("platform, campaign_name, impressions, clicks, cost, currency, conversions_total")
    .eq("client_id", clientId)
    .eq("tenant_id", tenantId)
    .gte("date", thirtyDaysAgo);
  if (adStatError) throw new Error(`ad_stat read failed: ${adStatError.message}`);

  // Aggregate per platform+campaign — ad_stat is stored per-day
  // (Repository Structure decision: segment by day, not a collapsed
  // range), a 30-day window is too granular for a report prompt otherwise.
  const agg = new Map<string, AdStatAggRow>();
  for (const row of (adStat ?? []) as AdStatAggRow[]) {
    const key = `${row.platform}:${row.campaign_name ?? ""}`;
    const existing = agg.get(key);
    if (existing) {
      agg.set(key, {
        ...existing,
        impressions: existing.impressions + row.impressions,
        clicks: existing.clicks + row.clicks,
        cost: existing.cost + Number(row.cost),
        conversions_total: existing.conversions_total + Number(row.conversions_total),
      });
    } else {
      agg.set(key, { ...row, cost: Number(row.cost), conversions_total: Number(row.conversions_total) });
    }
  }

  return {
    clientDisplayName: client.display_name as string,
    approvedTargetConversions: (targetConversions ?? []) as TargetConversionRow[],
    last30dCampaignStats: [...agg.values()].sort((a, b) => b.cost - a.cost).slice(0, 50),
  };
}
