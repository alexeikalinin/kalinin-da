// Tool Integration — OpenAI Ads (ChatGPT Ads) adapter, backed by the real
// public Advertiser API (developers.openai.com/ads, REST, v1). Mirrors the
// shape of google-ads.ts/yandex-direct.ts (isXConfigured/listCampaigns/
// getCampaignReport/setCampaignStatus), but the two platforms differ in
// ways this file does NOT paper over:
//
// - Auth is a single static per-ad-account API key (openai-ads-auth.ts),
//   not an OAuth refresh flow — no "identity serves many accounts" MCC
//   concept exists on OpenAI's side (docs/openai-ads-integration-research.md
//   Phase 2). Every call here takes an explicit apiKeyEnv naming that
//   account's key.
// - Campaigns have NO keyword targeting — `targeting` is locations +
//   custom_audiences only (see CampaignTargeting below). There is no
//   equivalent of buildMultiGroupSearchCampaign's keyword/ad-group
//   structure; PPC agent's keyword-driven campaign builder does not extend
//   to this platform as-is (see research doc Phase 4/6).
// - Every campaign this creates is left in "paused" status on purpose, same
//   guarantee as google-ads.ts/yandex-direct.ts: this integration can read
//   and create real campaign objects, but nothing here ever calls
//   activateCampaign — turning a campaign on is a separate, human action.
// - NOT yet exercised against a real ad account (no live API key available
//   at implementation time) — built and unit-tested against a mocked fetch
//   only, same disclosed status as yandex-direct.ts's
//   getWeeklySpendLimit/adjustWeeklySpendLimit before their first real run.
import { getOpenAiAdsApiKey, isOpenAiAdsConfigured } from "./openai-ads-auth.ts";

const API_BASE = "https://api.ads.openai.com/v1";
const CONVERSIONS_API_BASE = "https://bzr.openai.com/v1/events";
const MIN_LIFETIME_SPEND_LIMIT_MICROS = 1_000_000; // API-documented floor

export { isOpenAiAdsConfigured };

async function callOpenAiAds(
  path: string,
  init: { readonly method?: string; readonly body?: unknown } = {},
  apiKeyEnv?: string,
): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${getOpenAiAdsApiKey(apiKeyEnv)}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`OpenAI Ads API call failed: ${response.status} ${text || "(empty body)"}`);
  }
  return data;
}

export type OpenAiAdsCampaignStatus = "active" | "paused" | "archived";
export type OpenAiAdsBiddingType = "impressions" | "clicks" | "conversions";

export interface OpenAiAdsCampaignTargeting {
  readonly locations?: { readonly include: readonly string[] };
  readonly customAudiences?: { readonly ids: readonly string[] };
  readonly excludedCustomAudiences?: { readonly ids: readonly string[] };
}

export interface OpenAiAdsCampaign {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly status: OpenAiAdsCampaignStatus;
  readonly biddingType: OpenAiAdsBiddingType;
  readonly lifetimeSpendLimitMicros: number;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly targeting?: OpenAiAdsCampaignTargeting;
  readonly conversionEventSettingIds?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RawCampaign {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly status: OpenAiAdsCampaignStatus;
  readonly bidding_type: OpenAiAdsBiddingType;
  readonly budget?: { readonly lifetime_spend_limit_micros?: number };
  readonly start_time?: string;
  readonly end_time?: string;
  readonly targeting?: {
    readonly locations?: { readonly include: readonly string[] };
    readonly custom_audiences?: { readonly ids: readonly string[] };
    readonly excluded_custom_audiences?: { readonly ids: readonly string[] };
  };
  readonly conversion_event_setting_ids?: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
}

function fromRawCampaign(raw: RawCampaign): OpenAiAdsCampaign {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    status: raw.status,
    biddingType: raw.bidding_type,
    lifetimeSpendLimitMicros: raw.budget?.lifetime_spend_limit_micros ?? 0,
    startTime: raw.start_time,
    endTime: raw.end_time,
    targeting: raw.targeting
      ? {
          locations: raw.targeting.locations,
          customAudiences: raw.targeting.custom_audiences,
          excludedCustomAudiences: raw.targeting.excluded_custom_audiences,
        }
      : undefined,
    conversionEventSettingIds: raw.conversion_event_setting_ids,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

// GET /ad_account — the documented "confirm the bearer token works" check
// (api-quickstart step 1), reused here as the live equivalent of
// isOpenAiAdsConfigured() (which only checks the env var is set, not that
// OpenAI actually accepts it).
export async function verifyAdAccountAccess(apiKeyEnv?: string): Promise<{ readonly id: string }> {
  const data = (await callOpenAiAds("/ad_account", {}, apiKeyEnv)) as { id: string };
  return { id: data.id };
}

export async function listCampaigns(apiKeyEnv?: string): Promise<readonly OpenAiAdsCampaign[]> {
  const data = (await callOpenAiAds("/campaigns", {}, apiKeyEnv)) as { data?: readonly RawCampaign[] };
  return (data.data ?? []).map(fromRawCampaign);
}

export async function getCampaign(campaignId: string, apiKeyEnv?: string): Promise<OpenAiAdsCampaign> {
  const raw = (await callOpenAiAds(`/campaigns/${campaignId}`, {}, apiKeyEnv)) as RawCampaign;
  return fromRawCampaign(raw);
}

export interface CreateCampaignInput {
  readonly name: string;
  readonly description?: string;
  readonly biddingType: OpenAiAdsBiddingType;
  readonly lifetimeSpendLimitMicros: number;
  readonly targeting?: OpenAiAdsCampaignTargeting;
  readonly conversionEventSettingIds?: readonly string[];
}

// Creates a real campaign, always "paused" — same non-negotiable safety
// guarantee as google-ads.ts/yandex-direct.ts (see module comment above).
// Idempotent by name: a repeated call for the same name reuses the existing
// campaign rather than duplicating it, matching
// createOrReusePausedCampaign's convention in the other two adapters.
export async function createOrReusePausedCampaign(
  input: CreateCampaignInput,
  apiKeyEnv?: string,
): Promise<{ readonly campaign: OpenAiAdsCampaign; readonly reused: boolean }> {
  const existing = await listCampaigns(apiKeyEnv);
  const match = existing.find((c) => c.name === input.name);
  if (match) return { campaign: match, reused: true };

  if (input.lifetimeSpendLimitMicros < MIN_LIFETIME_SPEND_LIMIT_MICROS) {
    throw new Error(
      `OpenAI Ads lifetime_spend_limit_micros must be at least ${MIN_LIFETIME_SPEND_LIMIT_MICROS}, got ${input.lifetimeSpendLimitMicros}`,
    );
  }

  const raw = (await callOpenAiAds(
    "/campaigns",
    {
      body: {
        name: input.name,
        description: input.description,
        status: "paused",
        bidding_type: input.biddingType,
        budget: { lifetime_spend_limit_micros: input.lifetimeSpendLimitMicros },
        targeting: input.targeting
          ? {
              locations: input.targeting.locations,
              custom_audiences: input.targeting.customAudiences,
              excluded_custom_audiences: input.targeting.excludedCustomAudiences,
            }
          : undefined,
        conversion_event_setting_ids: input.conversionEventSettingIds,
      },
    },
    apiKeyEnv,
  )) as RawCampaign;
  return { campaign: fromRawCampaign(raw), reused: false };
}

// Existing-campaign optimization writes — activate/pause/archive map
// directly onto the API's own action endpoints rather than a generic
// status-update mutate call (unlike google-ads.ts/yandex-direct.ts, which
// both PATCH a status field; this API exposes activate/pause/archive as
// distinct POST actions instead). archive is irreversible per the API docs
// — no un-archive path exists.
export async function setCampaignStatus(
  campaignId: string,
  action: "activate" | "pause" | "archive",
  apiKeyEnv?: string,
): Promise<OpenAiAdsCampaign> {
  const raw = (await callOpenAiAds(`/campaigns/${campaignId}/${action}`, { method: "POST" }, apiKeyEnv)) as RawCampaign;
  return fromRawCampaign(raw);
}

export async function adjustCampaignBudget(
  campaignId: string,
  newLifetimeSpendLimitMicros: number,
  apiKeyEnv?: string,
): Promise<OpenAiAdsCampaign> {
  if (newLifetimeSpendLimitMicros < MIN_LIFETIME_SPEND_LIMIT_MICROS) {
    throw new Error(
      `OpenAI Ads lifetime_spend_limit_micros must be at least ${MIN_LIFETIME_SPEND_LIMIT_MICROS}, got ${newLifetimeSpendLimitMicros}`,
    );
  }
  const raw = (await callOpenAiAds(
    `/campaigns/${campaignId}`,
    { body: { budget: { lifetime_spend_limit_micros: newLifetimeSpendLimitMicros } } },
    apiKeyEnv,
  )) as RawCampaign;
  return fromRawCampaign(raw);
}

export interface OpenAiAdsInsights {
  readonly impressions: number;
  readonly clicks: number;
  readonly spendMicros: number;
  readonly conversions: number;
}

interface RawInsights {
  readonly impressions?: number;
  readonly clicks?: number;
  readonly spend_micros?: number;
  readonly conversions?: number;
}

// GET /ads/{id}/insights — the only documented reporting granularity is
// per-ad, not per-campaign (api-quickstart step 6). Callers needing a
// campaign total must list its ads first and sum; this file does not do
// that summation itself since the ad-listing endpoint's exact filter shape
// isn't documented in the sources this adapter was built against (see
// docs/openai-ads-integration-research.md Phase 2) — left as a TODO for
// whoever wires this against a real account and can confirm the shape live,
// same "don't guess an unverified request shape" stance as
// yandex-direct.ts's campaignTypeFields passthrough.
export async function getAdInsights(adId: string, apiKeyEnv?: string): Promise<OpenAiAdsInsights> {
  const raw = (await callOpenAiAds(`/ads/${adId}/insights`, {}, apiKeyEnv)) as RawInsights;
  return {
    impressions: raw.impressions ?? 0,
    clicks: raw.clicks ?? 0,
    spendMicros: raw.spend_micros ?? 0,
    conversions: raw.conversions ?? 0,
  };
}

export type OpenAiAdsConversionEventType =
  | "appointment_scheduled"
  | "checkout_started"
  | "contents_viewed"
  | "custom"
  | "items_added"
  | "lead_created"
  | "order_created"
  | "page_viewed"
  | "registration_completed"
  | "subscription_created"
  | "trial_started"
  | "app_installed"
  | "app_opened";

export interface OpenAiAdsConversionEvent {
  readonly id: string; // reused across pixel + server calls for the same event to dedupe (OpenAI keeps only the first)
  readonly type: OpenAiAdsConversionEventType;
  readonly timestampMs: number; // must be within the last 7 days
  readonly sourceUrl?: string; // required for web events
  readonly actionSource?: string; // required for web events
  readonly data?: Record<string, unknown>; // amount/currency/contents — shape varies by event type
}

// Conversions API — a separate host (bzr.openai.com) and its own Pixel ID,
// not the Advertiser API's bearer key (docs/openai-ads-integration-research.md
// Phase 2). Batches up to 1000 events; OpenAI rejects the WHOLE batch if any
// one event fails, so this deliberately does not silently drop bad events —
// a caller must fix and resend the full batch, same as the API's own
// documented behavior.
export async function sendConversionEvents(
  pixelId: string,
  events: readonly OpenAiAdsConversionEvent[],
  apiKeyEnv?: string,
): Promise<void> {
  if (events.length === 0) return;
  if (events.length > 1000) {
    throw new Error(`OpenAI Ads Conversions API accepts at most 1000 events per batch, got ${events.length}`);
  }
  const response = await fetch(`${CONVERSIONS_API_BASE}?pid=${encodeURIComponent(pixelId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAiAdsApiKey(apiKeyEnv)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        timestamp_ms: e.timestampMs,
        source_url: e.sourceUrl,
        action_source: e.actionSource,
        data: e.data,
      })),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI Ads Conversions API call failed: ${response.status} ${text || "(empty body)"}`);
  }
}
