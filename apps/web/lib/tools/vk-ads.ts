// Tool Integration §1 — PPC Agent's "настройка кампаний в VK Ads", backed
// by the real VK Ads API (ads.vk.ru, v2). Every campaign this creates is
// left in a stopped/blocked state on purpose: this integration can read
// and create real campaign (AdPlan) objects, but nothing here ever
// enables spend.
//
// Real, hard-won finding (2026-08-15): unlike Google Ads/Meta/Yandex
// Direct, VK Ads has no concept of an "empty campaign container" — an
// AdPlan must be created with at least one AdGroup referencing a valid
// Package (VK's ad-format template), and most site-traffic Packages
// additionally require the target URL to already be registered via
// POST /urls.json first (an unregistered/unverified URL is rejected
// with `url_not_checked`). Package availability is also account-
// specific: most `site_conversions` Packages returned `invalid_package`
// for this account; `branding_universal_banner` (id 3509, CPM, generic
// site branding, no conversion-goal tracking required) is the one that
// actually validated — plus an explicit `budget_limit_day` is mandatory
// even though the campaign is immediately blocked and will never spend.
const API_VERSION = "v2";
const API_BASE = `https://ads.vk.ru/api/${API_VERSION}`;

// Account-specific — confirmed available on this agency's own VK Ads
// account (id 25874968) by trial against the real API; a different
// client account may need a different package_id (see README).
const DEFAULT_PACKAGE_ID = 3509;
const DEFAULT_BUDGET_LIMIT_DAY = "100";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function isVkAdsConfigured(): boolean {
  return Boolean(process.env.VK_ADS_CLIENT_ID && process.env.VK_ADS_CLIENT_SECRET);
}

// Client Credentials Grant — this manages the agency's own account, not a
// delegated client's, so there's no user-authorization step (unlike
// Google/Yandex). Tokens are short-lived (~1 day per VK's docs) with a
// hard cap of 5 concurrent tokens per client_id, so this is cached
// in-process and re-fetched only on expiry, same shape as
// google-oauth.ts — re-requesting on every call would exhaust the cap.
let cachedAccessToken: { token: string; expiresAt: number } | undefined;

async function getVkAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.token;
  }
  const response = await fetch(`${API_BASE}/oauth2/token.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: requiredEnv("VK_ADS_CLIENT_ID"),
      client_secret: requiredEnv("VK_ADS_CLIENT_SECRET"),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`VK Ads OAuth token request failed: ${response.status} ${JSON.stringify(data)}`);
  }
  const { access_token, expires_in } = data as { access_token: string; expires_in: number };
  cachedAccessToken = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

async function callVkAds(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const accessToken = await getVkAccessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`VK Ads API call failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

interface VkAdPlan {
  readonly id: number;
  readonly name: string;
  readonly status: string;
}

export async function listCampaigns(): Promise<readonly VkAdPlan[]> {
  const data = (await callVkAds("GET", "/ad_plans.json?fields=id,name,status&limit=50")) as {
    items?: VkAdPlan[];
  };
  return data.items ?? [];
}

// Registering the same URL twice returns the same id (confirmed against
// the real API) — no need to search first, VK dedupes server-side.
async function getOrCreateUrlObject(url: string): Promise<number> {
  const data = (await callVkAds("POST", "/urls.json", { url })) as { id: number };
  return data.id;
}

// Creates a real AdPlan with one minimal AdGroup, status "blocked" — VK's
// pause/stop state (defaults to "active" if omitted, so this must be
// passed explicitly). Idempotent per call: if a plan with the same name
// already exists, it's reused rather than duplicated.
export async function createOrReusePausedCampaign(
  name: string,
  siteUrl: string,
): Promise<{ readonly campaignId: number; readonly reused: boolean }> {
  const existing = await listCampaigns();
  const match = existing.find((plan) => plan.name === name);
  if (match) {
    return { campaignId: match.id, reused: true };
  }

  const urlObjectId = await getOrCreateUrlObject(siteUrl);

  const created = (await callVkAds("POST", "/ad_plans.json", {
    name,
    status: "blocked",
    objective: "branding_universal_banner",
    ad_object_id: urlObjectId,
    ad_object_type: "url",
    budget_limit_day: DEFAULT_BUDGET_LIMIT_DAY,
    ad_groups: [
      {
        name: `${name} — Group`,
        package_id: DEFAULT_PACKAGE_ID,
        banners: [],
      },
    ],
  })) as { id: number };

  return { campaignId: created.id, reused: false };
}
