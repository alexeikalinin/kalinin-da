// Tool Integration §1 — PPC Agent's "настройка кампаний в Google Ads",
// backed by the real Google Ads API (REST interface, v25). Every campaign
// this creates is left in PAUSED status on purpose: this integration can
// read and create real campaign objects, but nothing here ever enables
// spend — turning a campaign on is a separate, human action outside this
// system for now.
const API_VERSION = "v25";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const DEFAULT_TOTAL_DAILY_BUDGET_MICROS = 10_000_000; // 10 currency units/day, placeholder default
const MIN_DAILY_BUDGET_MICROS = 1_000_000; // 1 currency unit/day floor

import { getGoogleAccessToken } from "./google-oauth.ts";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Only checks the agency-wide app credentials — the target customerId is
// now per-Project (falls back to GOOGLE_ADS_CUSTOMER_ID if a Project
// doesn't supply its own, checked lazily by resolveCustomerId).
export function isGoogleAdsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_ADS_CLIENT_ID &&
      process.env.GOOGLE_ADS_CLIENT_SECRET &&
      process.env.GOOGLE_ADS_REFRESH_TOKEN &&
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  );
}

function resolveCustomerId(customerId: string | undefined): string {
  return customerId ?? requiredEnv("GOOGLE_ADS_CUSTOMER_ID");
}

// Client ad-account reporting foundation (2026-08-18): a real client account
// may be reached either via the agency's own MCC (needs `login-customer-id`)
// or via direct/representative access granted straight to the calling
// identity (no manager header at all — confirmed for real against a
// StarMedia-agency client account: sending no login-customer-id header
// worked, since that Google login has direct per-account access, not an
// MCC hierarchy). `refreshTokenEnv` lets a call use a specific identity's
// credential instead of the single-tenant default (see google-oauth.ts).
export interface GoogleAdsCallOptions {
  readonly refreshTokenEnv?: string;
  readonly loginCustomerId?: string;
}

async function callGoogleAds(
  customerId: string,
  path: string,
  body: unknown,
  options: GoogleAdsCallOptions = {},
): Promise<unknown> {
  const accessToken = await getGoogleAccessToken(options.refreshTokenEnv);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": requiredEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    "Content-Type": "application/json",
  };
  if (options.loginCustomerId) {
    headers["login-customer-id"] = options.loginCustomerId;
  }
  const response = await fetch(`${API_BASE}/customers/${customerId}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Ads API call failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

interface GaqlSearchResponse {
  readonly results?: ReadonlyArray<{
    readonly campaign?: { readonly id?: string; readonly name?: string; readonly status?: string };
  }>;
}

// customerId — the client's Google Ads account (falls back to
// GOOGLE_ADS_CUSTOMER_ID, the agency's own sandbox, when a Project doesn't
// supply its own). options.loginCustomerId defaults to the agency's own MCC
// (GOOGLE_ADS_LOGIN_CUSTOMER_ID) to preserve existing PPC-agent behavior —
// pass an explicit loginCustomerId (or leave it undefined for a direct-access
// account) via resolveAccessContext() for a real client account.
export async function listCampaigns(
  customerId?: string,
  options: GoogleAdsCallOptions = { loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID },
): Promise<GaqlSearchResponse["results"]> {
  const resolvedCustomerId = resolveCustomerId(customerId);
  const data = (await callGoogleAds(
    resolvedCustomerId,
    "/googleAds:search",
    { query: "SELECT campaign.id, campaign.name, campaign.status FROM campaign LIMIT 50" },
    options,
  )) as GaqlSearchResponse;
  return data.results ?? [];
}

export interface ConversionAction {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly type: string;
  readonly category: string;
  readonly includeInConversionsMetric?: boolean;
  readonly primaryForGoal?: boolean;
}

// Read-only — the "what's available" list a human picks target conversions
// from (conversion-audit skill, step 1). Includes every status (not just
// ENABLED) since REMOVED/HIDDEN actions matter for the audit (a live tag
// can still point at one).
export async function listConversionActions(
  customerId: string,
  options: GoogleAdsCallOptions = {},
): Promise<readonly ConversionAction[]> {
  const data = (await callGoogleAds(
    customerId,
    "/googleAds:search",
    {
      query: `SELECT conversion_action.id, conversion_action.name, conversion_action.status,
                     conversion_action.type, conversion_action.category,
                     conversion_action.include_in_conversions_metric, conversion_action.primary_for_goal
              FROM conversion_action`,
    },
    options,
  )) as { results?: ReadonlyArray<{ conversionAction: Record<string, unknown> }> };
  return (data.results ?? []).map((r) => {
    const ca = r.conversionAction;
    return {
      id: ca.id as string,
      name: ca.name as string,
      status: ca.status as string,
      type: ca.type as string,
      category: ca.category as string,
      includeInConversionsMetric: ca.includeInConversionsMetric as boolean | undefined,
      primaryForGoal: ca.primaryForGoal as boolean | undefined,
    };
  });
}

export interface CampaignReportRow {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly date: string; // YYYY-MM-DD
  readonly costMicros: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly allConversions: number;
  readonly conversionsByAction: Record<string, number>;
}

// Two GAQL queries merged client-side, not one — segmenting by
// segments.conversion_action fans a campaign's cost/impressions/clicks out
// across one row per conversion action, which silently corrupts those
// numbers if read from the same row as the segmented conversions. Confirmed
// by hitting exactly this while building the Медавеню report (2026-08-18).
// Both queries are also segmented by segments.date (one row per
// campaign+day, not one row for the whole range) — needed for real
// day-over-day history in ad_stat (anomaly detection, week-over-week
// comparisons), not just a single collapsed total.
export async function getCampaignReport(
  customerId: string,
  params: { readonly startDate: string; readonly endDate: string; readonly conversionActionIds: readonly string[] },
  options: GoogleAdsCallOptions = {},
): Promise<readonly CampaignReportRow[]> {
  const baseData = (await callGoogleAds(
    customerId,
    "/googleAds:search",
    {
      query: `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.all_conversions
              FROM campaign
              WHERE segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'`,
    },
    options,
  )) as {
    results?: ReadonlyArray<{
      campaign: { id: string; name: string };
      segments: { date: string };
      metrics: Record<string, number>;
    }>;
  };

  const rows = new Map<string, CampaignReportRow>();
  const keyOf = (campaignId: string, date: string) => `${campaignId}:${date}`;
  for (const r of baseData.results ?? []) {
    const key = keyOf(r.campaign.id, r.segments.date);
    rows.set(key, {
      campaignId: r.campaign.id,
      campaignName: r.campaign.name,
      date: r.segments.date,
      costMicros: Number(r.metrics.costMicros ?? 0),
      impressions: Number(r.metrics.impressions ?? 0),
      clicks: Number(r.metrics.clicks ?? 0),
      allConversions: Number(r.metrics.allConversions ?? 0),
      conversionsByAction: {},
    });
  }

  if (params.conversionActionIds.length > 0) {
    const convData = (await callGoogleAds(
      customerId,
      "/googleAds:search",
      {
        query: `SELECT campaign.id, segments.date, segments.conversion_action, metrics.all_conversions
                FROM campaign
                WHERE segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
                AND segments.conversion_action IN (${params.conversionActionIds
                  .map((id) => `'customers/${customerId}/conversionActions/${id}'`)
                  .join(",")})`,
      },
      options,
    )) as {
      results?: ReadonlyArray<{
        campaign: { id: string };
        segments: { date: string; conversionAction: string };
        metrics: { allConversions?: number };
      }>;
    };
    for (const r of convData.results ?? []) {
      const row = rows.get(keyOf(r.campaign.id, r.segments.date));
      if (!row) continue;
      const conversionActionId = r.segments.conversionAction.split("/").pop() ?? r.segments.conversionAction;
      (row.conversionsByAction as Record<string, number>)[conversionActionId] = Number(r.metrics.allConversions ?? 0);
    }
  }

  return [...rows.values()];
}

// Creates a real CampaignBudget + Campaign, PAUSED, SEARCH channel type, no
// ad groups/keywords/ads yet — a real but empty shell. Idempotent per call:
// if a campaign with the same name already exists, it's reused rather than
// duplicated (repeated task runs/tests shouldn't flood the account).
export async function createOrReusePausedCampaign(
  name: string,
  budgetShare: number,
  customerId?: string,
  options: GoogleAdsCallOptions = { loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID },
): Promise<{ readonly campaignResourceName: string; readonly reused: boolean }> {
  const resolvedCustomerId = resolveCustomerId(customerId);
  const existing = await listCampaigns(resolvedCustomerId, options);
  const match = existing?.find((r) => r.campaign?.name === name);
  if (match?.campaign?.id) {
    return { campaignResourceName: `customers/${resolvedCustomerId}/campaigns/${match.campaign.id}`, reused: true };
  }

  const dailyBudgetMicros = Math.max(
    MIN_DAILY_BUDGET_MICROS,
    Math.round(DEFAULT_TOTAL_DAILY_BUDGET_MICROS * budgetShare),
  );

  const budgetData = (await callGoogleAds(
    resolvedCustomerId,
    "/campaignBudgets:mutate",
    {
      operations: [
        {
          create: {
            name: `${name} — Budget — ${Date.now()}`,
            amountMicros: String(dailyBudgetMicros),
            deliveryMethod: "STANDARD",
          },
        },
      ],
    },
    options,
  )) as { results: ReadonlyArray<{ resourceName: string }> };
  const budgetResourceName = budgetData.results[0].resourceName;

  const campaignData = (await callGoogleAds(
    resolvedCustomerId,
    "/campaigns:mutate",
    {
      operations: [
        {
          create: {
            name,
            status: "PAUSED",
            advertisingChannelType: "SEARCH",
            containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
            campaignBudget: budgetResourceName,
            manualCpc: {},
            networkSettings: {
              targetGoogleSearch: true,
              targetSearchNetwork: false,
              targetContentNetwork: false,
              targetPartnerSearchNetwork: false,
            },
          },
        },
      ],
    },
    options,
  )) as { results: ReadonlyArray<{ resourceName: string }> };

  return { campaignResourceName: campaignData.results[0].resourceName, reused: false };
}
