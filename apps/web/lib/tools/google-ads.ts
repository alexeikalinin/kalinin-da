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

export function isGoogleAdsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_ADS_CLIENT_ID &&
      process.env.GOOGLE_ADS_CLIENT_SECRET &&
      process.env.GOOGLE_ADS_REFRESH_TOKEN &&
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID &&
      process.env.GOOGLE_ADS_CUSTOMER_ID,
  );
}

async function callGoogleAds(path: string, body: unknown): Promise<unknown> {
  const accessToken = await getGoogleAccessToken();
  const customerId = requiredEnv("GOOGLE_ADS_CUSTOMER_ID");
  const response = await fetch(`${API_BASE}/customers/${customerId}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": requiredEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
      "login-customer-id": requiredEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
      "Content-Type": "application/json",
    },
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

export async function listCampaigns(): Promise<GaqlSearchResponse["results"]> {
  const data = (await callGoogleAds("/googleAds:search", {
    query: "SELECT campaign.id, campaign.name, campaign.status FROM campaign LIMIT 50",
  })) as GaqlSearchResponse;
  return data.results ?? [];
}

// Creates a real CampaignBudget + Campaign, PAUSED, SEARCH channel type, no
// ad groups/keywords/ads yet — a real but empty shell. Idempotent per call:
// if a campaign with the same name already exists, it's reused rather than
// duplicated (repeated task runs/tests shouldn't flood the account).
export async function createOrReusePausedCampaign(
  name: string,
  budgetShare: number,
): Promise<{ readonly campaignResourceName: string; readonly reused: boolean }> {
  const existing = await listCampaigns();
  const match = existing?.find((r) => r.campaign?.name === name);
  if (match?.campaign?.id) {
    const customerId = requiredEnv("GOOGLE_ADS_CUSTOMER_ID");
    return { campaignResourceName: `customers/${customerId}/campaigns/${match.campaign.id}`, reused: true };
  }

  const dailyBudgetMicros = Math.max(
    MIN_DAILY_BUDGET_MICROS,
    Math.round(DEFAULT_TOTAL_DAILY_BUDGET_MICROS * budgetShare),
  );

  const budgetData = (await callGoogleAds("/campaignBudgets:mutate", {
    operations: [
      {
        create: {
          name: `${name} — Budget — ${Date.now()}`,
          amountMicros: String(dailyBudgetMicros),
          deliveryMethod: "STANDARD",
        },
      },
    ],
  })) as { results: ReadonlyArray<{ resourceName: string }> };
  const budgetResourceName = budgetData.results[0].resourceName;

  const campaignData = (await callGoogleAds("/campaigns:mutate", {
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
  })) as { results: ReadonlyArray<{ resourceName: string }> };

  return { campaignResourceName: campaignData.results[0].resourceName, reused: false };
}
