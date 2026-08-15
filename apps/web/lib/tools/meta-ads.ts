// Tool Integration §1 — PPC Agent's "настройка кампаний в Meta Ads",
// backed by the real Meta Marketing API (Graph API v21.0). Every campaign
// this creates is left in PAUSED status on purpose: this integration can
// read and create real campaign objects, but nothing here ever enables
// spend — turning a campaign on is a separate, human action outside this
// system for now.
//
// Auth is a System User access token generated once in Business Manager
// (Business Settings → Users → System Users), not an OAuth refresh flow —
// unlike Google/Yandex, Meta System User tokens can be issued non-expiring,
// so there's no token-refresh logic here (mirrors yandex-oauth.ts's
// simplicity, for the same underlying reason: a long-lived token read
// straight from env).
const API_VERSION = "v21.0";
const API_BASE = `https://graph.facebook.com/${API_VERSION}`;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function isMetaAdsConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

function resolveAdAccountId(adAccountId: string | undefined): string {
  return adAccountId ?? requiredEnv("META_AD_ACCOUNT_ID");
}

async function callMeta(path: string, params: Record<string, string>): Promise<unknown> {
  const accessToken = requiredEnv("META_ACCESS_TOKEN");
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, { method: "GET" });
  const data = await response.json();
  if (!response.ok || (data as { error?: unknown }).error) {
    throw new Error(`Meta Ads API call failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function postMeta(path: string, body: Record<string, string>): Promise<unknown> {
  const accessToken = requiredEnv("META_ACCESS_TOKEN");
  const params = new URLSearchParams({ ...body, access_token: accessToken });
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await response.json();
  if (!response.ok || (data as { error?: unknown }).error) {
    throw new Error(`Meta Ads API call failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

interface MetaCampaign {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

// adAccountId — the client's Meta ad account (format `act_<id>`, falls back
// to META_AD_ACCOUNT_ID, the agency's own account, when a Project doesn't
// supply its own — same per-client-falls-back-to-sandbox pattern as
// google-ads.ts/yandex-direct.ts).
export async function listCampaigns(adAccountId?: string): Promise<readonly MetaCampaign[]> {
  const resolvedAdAccountId = resolveAdAccountId(adAccountId);
  const data = (await callMeta(`/${resolvedAdAccountId}/campaigns`, {
    fields: "id,name,status",
    limit: "50",
  })) as { data?: MetaCampaign[] };
  return data.data ?? [];
}

// Creates a real Campaign, PAUSED, OUTCOME_TRAFFIC objective — a real but
// empty shell (no ad sets/ads yet). Idempotent per call: if a campaign with
// the same name already exists, it's reused rather than duplicated.
export async function createOrReusePausedCampaign(
  name: string,
  adAccountId?: string,
): Promise<{ readonly campaignId: string; readonly reused: boolean }> {
  const resolvedAdAccountId = resolveAdAccountId(adAccountId);
  const existing = await listCampaigns(resolvedAdAccountId);
  const match = existing.find((campaign) => campaign.name === name);
  if (match) {
    return { campaignId: match.id, reused: true };
  }

  const created = (await postMeta(`/${resolvedAdAccountId}/campaigns`, {
    name,
    objective: "OUTCOME_TRAFFIC",
    status: "PAUSED",
    special_ad_categories: "[]",
    // Mandatory whenever the campaign has no campaign-level budget (which
    // this integration doesn't set — see README's known simplification):
    // "false" means ad sets don't share a pooled budget with each other.
    is_adset_budget_sharing_enabled: "false",
  })) as { id: string };

  return { campaignId: created.id, reused: false };
}
