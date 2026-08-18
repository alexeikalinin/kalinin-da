// Translation layer between the Supabase row shapes and the wire format —
// mirrors lib/serialize.ts's role for ProjectRecord.

export function serializeClient(row: Record<string, unknown>) {
  return {
    clientId: row.id,
    displayName: row.display_name,
    agencyName: row.agency_name,
    createdAt: row.created_at,
  };
}

export function serializeClientAdAccount(row: Record<string, unknown>) {
  return {
    id: row.id,
    clientId: row.client_id,
    platform: row.platform,
    externalAccountId: row.external_account_id,
    identityId: row.identity_id,
    accessMode: row.access_mode,
    managerId: row.manager_id,
    status: row.status,
  };
}

export function serializeTargetConversionSet(clientId: string, rows: readonly Record<string, unknown>[]) {
  return {
    clientId,
    conversions: rows.map((r) => ({
      platform: r.platform,
      externalConversionId: r.external_conversion_id,
      name: r.name,
      approvedAt: r.approved_at,
    })),
  };
}

// Deliberately keeps the two platforms separate rather than one blended
// array/total — Google Ads' all_conversions is not 1:1 comparable to
// Yandex Metrika's raw goal-reach counts (confirmed 2026-08-18: 2179.8 vs
// 163 for the same client/period). Summing them would imply a false
// parity between the two systems.
export function serializeReport(
  clientId: string,
  startDate: string,
  endDate: string,
  platforms: {
    readonly "google-ads"?: readonly Record<string, unknown>[];
    readonly "yandex-direct"?: readonly Record<string, unknown>[];
  },
) {
  return {
    clientId,
    startDate,
    endDate,
    platforms: {
      "google-ads": (platforms["google-ads"] ?? []).map((r) => ({
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        impressions: r.impressions,
        clicks: r.clicks,
        cost: r.cost,
        conversions: r.conversions,
      })),
      "yandex-direct": (platforms["yandex-direct"] ?? []).map((r) => ({
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        impressions: r.impressions,
        clicks: r.clicks,
        cost: r.cost,
        conversions: r.conversions,
      })),
    },
  };
}
