// Tool Integration §1 — PPC Agent's "настройка кампаний в Яндекс.Директ",
// backed by the real Yandex Direct API v5 (JSON). Mirrors google-ads.ts:
// every created campaign is immediately suspended — nothing here ever
// enables real ad spend.
import { getYandexAccessToken, isYandexConfigured } from "./yandex-oauth.ts";
import { parseTsv } from "./tsv.ts";

const API_BASE = "https://api.direct.yandex.com/json/v5";
// RESPONSIVE_AD (combinatorial ads, up to 7 titles / 3 texts) isn't
// supported for writes on v5 — ads.update on that ad type 200s with a
// per-item error buried in the result body ("Объявление данного типа не
// поддерживается в v5, используйте v501"), not a top-level `error`, so a
// naive caller sees "success". Found for real 2026-09-10 testing
// updateResponsiveAdContent. Reads (ads.get) work fine on v5; only writes
// to this ad type need v501.
const API_BASE_V501 = "https://api.direct.yandex.com/json/v501";

// Yandex object IDs (ads, ad groups) can exceed 2^53 (19 digits) — passing
// one through as a JS `number` silently rounds it (found for real
// 2026-09-10: two different ad IDs both rounded to 1917464866284975000,
// and every rawId() call below independently confirmed it by round-
// tripping through the wrong ad). Callers must keep large IDs as strings
// end to end; rawId() splices the digits into the outgoing JSON as an
// unquoted integer literal (never via JSON.stringify(Number(id))) so
// precision survives the request.
function rawId(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error(`rawId: not a plain integer string: ${id}`);
  return `__RAWID_${id}_RAWID__`;
}
function encodeRawIds(body: string): string {
  return body.replace(/"__RAWID_(\d+)_RAWID__"/g, "$1");
}
const DEFAULT_TOTAL_DAILY_BUDGET_MICROS = 20_000_000; // 20 currency units/day, placeholder default
// Direct API v5 rejects DailyBudget below 9 currency units (error code 5005,
// "Значение поля DailyBudget должно быть в диапазоне от 9 до 1000000000") —
// found for real 2026-08-17 while testing the async workflow runner's
// retry/escalate path (a real bug, not an intentional forced failure).
const MIN_DAILY_BUDGET_MICROS = 9_000_000;

export { isYandexConfigured };

// clientLogin — the client's Yandex login, required only in agency mode
// (acting on behalf of a client account under an agency login). Personal
// account use omits it. accessTokenEnv — which identity's token to use
// (client ad-account reporting foundation, 2026-08-18); defaults to the
// original single-tenant YANDEX_ACCESS_TOKEN via yandex-oauth.ts.
async function callDirect(
  resource: string,
  method: string,
  params: unknown,
  clientLogin?: string,
  accessTokenEnv?: string,
  apiBase: string = API_BASE,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getYandexAccessToken(accessTokenEnv)}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;

  const response = await fetch(`${apiBase}/${resource}`, {
    method: "POST",
    headers,
    body: encodeRawIds(JSON.stringify({ method, params })),
  });
  // A non-existent resource (e.g. "forecasts" — confirmed dead 2026-08-30,
  // see getForecastCpc) 404s with an EMPTY body, not a JSON error payload
  // — response.json() would throw a cryptic "Unexpected end of JSON
  // input" instead of a message naming what actually went wrong. Read as
  // text first so that failure mode gets a clear error instead.
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Yandex Direct API call failed: ${response.status} ${text || "(empty body)"}`);
  }
  const data = text ? (JSON.parse(text) as { error?: unknown; result?: unknown }) : {};
  if (data.error) {
    throw new Error(`Yandex Direct API call failed: ${JSON.stringify(data.error)}`);
  }
  return data.result;
}

export interface DirectCampaign {
  readonly Id: number;
  readonly Name: string;
  readonly Status: string;
  readonly State: string;
}

// ---------------------------------------------------------------------
// Campaign types / bidding strategies — Direct API v5's full documented
// range, 2026-09-02. Previously this file hardcoded exactly one shape
// (TextCampaign, Search.HIGHEST_POSITION + Network.SERVING_OFF) — found
// while porting PPC Master Tool's draft_campaigns_setup.py, which
// supported at least "search_only" and "network_only" TextCampaign
// variants (see docs/07-planning's Track B follow-up). This generalizes
// that into every Search/Network strategy type Direct API v5 documents,
// plus a selector for the other real campaign types (Dynamic Text, CPM
// Banner, Smart, Mobile App) — see the campaignType branch below for what
// is/isn't verified for those.
// ---------------------------------------------------------------------

export type YandexSearchStrategyType =
  | "HIGHEST_POSITION"
  | "MAXIMUM_CLICKS"
  | "AVERAGE_CPA"
  | "AVERAGE_CPC"
  | "AVERAGE_ROI"
  // Added 2026-09-02, cross-checked against two independent fetches of
  // yandex.ru/dev/direct/doc/ref-v5/campaigns/add-text-campaign.html: the
  // current API docs list these four alongside AVERAGE_ROI/MAXIMUM_CLICKS,
  // not instead of them — Direct's v5 enum has never dropped an old
  // BiddingStrategyType, only added newer ones, so both generations are
  // kept here rather than one replacing the other.
  | "AVERAGE_CRR"
  | "PAY_FOR_CONVERSION"
  | "PAY_FOR_CONVERSION_CRR"
  | "WEEKLY_CLICK_PACKAGE"
  | "WB_MAXIMUM_CLICKS"
  | "WB_MAXIMUM_CONVERSION_RATE"
  | "SERVING_OFF";

export type YandexNetworkStrategyType =
  | "MAXIMUM_COVERAGE"
  | "AVERAGE_CPA"
  | "AVERAGE_CPC"
  // Added 2026-09-02, same doc fetch as above — Network shares the full
  // strategy-type list with Search except for HIGHEST_POSITION (Search-only)
  // and MAXIMUM_COVERAGE/NETWORK_DEFAULT (Network-only); the original list
  // here only had two of the six shared conversion/auto strategies.
  | "AVERAGE_CRR"
  | "PAY_FOR_CONVERSION"
  | "PAY_FOR_CONVERSION_CRR"
  | "WEEKLY_CLICK_PACKAGE"
  | "WB_MAXIMUM_CLICKS"
  | "WB_MAXIMUM_CONVERSION_RATE"
  | "NETWORK_DEFAULT"
  | "SERVING_OFF";

export interface YandexSearchBiddingStrategy {
  readonly type: YandexSearchStrategyType;
  readonly weeklySpendLimitMicros?: number; // required by every type below except HIGHEST_POSITION/SERVING_OFF
  readonly bidCeilingMicros?: number; // optional cap, MAXIMUM_CLICKS/WB_*/WEEKLY_CLICK_PACKAGE variants
  readonly averageCpaMicros?: number; // AVERAGE_CPA target
  readonly averageCpcMicros?: number; // AVERAGE_CPC target; also WEEKLY_CLICK_PACKAGE's optional cap
  readonly averageRoiCoef?: number; // AVERAGE_ROI's RoiCoef, e.g. 1.2 = 120%
  readonly reserveReturnPercent?: number; // AVERAGE_ROI's ReserveReturn, 0-100
  readonly goalId?: number; // required by AVERAGE_CPA/AVERAGE_CRR/PAY_FOR_CONVERSION/PAY_FOR_CONVERSION_CRR/WB_MAXIMUM_CONVERSION_RATE
  readonly payForConversionEnabled?: boolean; // AVERAGE_CPA's pay-for-performance toggle
  readonly crr?: number; // AVERAGE_CRR/PAY_FOR_CONVERSION_CRR's target Crr (доля рекламных расходов)
  readonly cpaMicros?: number; // PAY_FOR_CONVERSION's Cpa — distinct field from AVERAGE_CPA's AverageCpa
  readonly clicksPerWeek?: number; // WEEKLY_CLICK_PACKAGE's required ClicksPerWeek
}

export interface YandexNetworkBiddingStrategy {
  readonly type: YandexNetworkStrategyType;
  readonly weeklySpendLimitMicros?: number;
  readonly bidCeilingMicros?: number;
  readonly averageCpaMicros?: number;
  readonly averageCpcMicros?: number;
  readonly goalId?: number; // required by AVERAGE_CPA/AVERAGE_CRR/PAY_FOR_CONVERSION/PAY_FOR_CONVERSION_CRR/WB_MAXIMUM_CONVERSION_RATE
  readonly crr?: number;
  readonly cpaMicros?: number;
  readonly clicksPerWeek?: number;
  readonly limitPercent?: number; // NETWORK_DEFAULT's LimitPercent, multiples of 10, API default 100
}

// BiddingStrategyType -> the nested object key that carries its params —
// same "the strategy's settings live under a key matching its own type
// name" convention getWeeklySpendLimit already reads (see below).
// undefined means the type carries no nested params at all (Direct
// rejects a nested object for HIGHEST_POSITION/SERVING_OFF/
// MAXIMUM_COVERAGE).
const SEARCH_STRATEGY_FIELD: Record<YandexSearchStrategyType, string | undefined> = {
  HIGHEST_POSITION: undefined,
  SERVING_OFF: undefined,
  MAXIMUM_CLICKS: "MaximumClicks",
  AVERAGE_CPA: "AverageCpa",
  AVERAGE_CPC: "AverageCpc",
  AVERAGE_ROI: "AverageRoi",
  AVERAGE_CRR: "AverageCrr",
  PAY_FOR_CONVERSION: "PayForConversion",
  PAY_FOR_CONVERSION_CRR: "PayForConversionCrr",
  WEEKLY_CLICK_PACKAGE: "WeeklyClickPackage",
  WB_MAXIMUM_CLICKS: "WbMaximumClicks",
  WB_MAXIMUM_CONVERSION_RATE: "WbMaximumConversionRate",
};

const NETWORK_STRATEGY_FIELD: Record<YandexNetworkStrategyType, string | undefined> = {
  MAXIMUM_COVERAGE: undefined,
  NETWORK_DEFAULT: "NetworkDefault",
  SERVING_OFF: undefined,
  AVERAGE_CPA: "AverageCpa",
  AVERAGE_CPC: "AverageCpc",
  AVERAGE_CRR: "AverageCrr",
  PAY_FOR_CONVERSION: "PayForConversion",
  PAY_FOR_CONVERSION_CRR: "PayForConversionCrr",
  WEEKLY_CLICK_PACKAGE: "WeeklyClickPackage",
  WB_MAXIMUM_CLICKS: "WbMaximumClicks",
  WB_MAXIMUM_CONVERSION_RATE: "WbMaximumConversionRate",
};

function buildSearchStrategyPayload(strategy: YandexSearchBiddingStrategy): Record<string, unknown> {
  const payload: Record<string, unknown> = { BiddingStrategyType: strategy.type };
  const field = SEARCH_STRATEGY_FIELD[strategy.type];
  if (!field) return payload;

  const nested: Record<string, unknown> = {};
  if (strategy.weeklySpendLimitMicros !== undefined) nested.WeeklySpendLimit = strategy.weeklySpendLimitMicros;
  if (strategy.bidCeilingMicros !== undefined) nested.BidCeiling = strategy.bidCeilingMicros;
  if (strategy.goalId !== undefined) nested.GoalId = strategy.goalId;
  if (strategy.type === "AVERAGE_CPA") {
    if (strategy.averageCpaMicros !== undefined) nested.AverageCpa = strategy.averageCpaMicros;
    if (strategy.payForConversionEnabled !== undefined) nested.PayForConversionEnabled = strategy.payForConversionEnabled;
  }
  if (strategy.type === "AVERAGE_CPC" && strategy.averageCpcMicros !== undefined) nested.AverageCpc = strategy.averageCpcMicros;
  if (strategy.type === "AVERAGE_ROI") {
    if (strategy.averageRoiCoef !== undefined) nested.RoiCoef = strategy.averageRoiCoef;
    if (strategy.reserveReturnPercent !== undefined) nested.ReserveReturn = strategy.reserveReturnPercent;
  }
  if ((strategy.type === "AVERAGE_CRR" || strategy.type === "PAY_FOR_CONVERSION_CRR") && strategy.crr !== undefined) {
    nested.Crr = strategy.crr;
  }
  if (strategy.type === "PAY_FOR_CONVERSION" && strategy.cpaMicros !== undefined) nested.Cpa = strategy.cpaMicros;
  if (strategy.type === "WEEKLY_CLICK_PACKAGE") {
    if (strategy.clicksPerWeek !== undefined) nested.ClicksPerWeek = strategy.clicksPerWeek;
    if (strategy.averageCpcMicros !== undefined) nested.AverageCpc = strategy.averageCpcMicros;
  }

  payload[field] = nested;
  return payload;
}

function buildNetworkStrategyPayload(strategy: YandexNetworkBiddingStrategy): Record<string, unknown> {
  const payload: Record<string, unknown> = { BiddingStrategyType: strategy.type };
  const field = NETWORK_STRATEGY_FIELD[strategy.type];
  if (!field) return payload;

  if (strategy.type === "NETWORK_DEFAULT") {
    if (strategy.limitPercent !== undefined) payload[field] = { LimitPercent: strategy.limitPercent };
    return payload;
  }

  const nested: Record<string, unknown> = {};
  if (strategy.weeklySpendLimitMicros !== undefined) nested.WeeklySpendLimit = strategy.weeklySpendLimitMicros;
  if (strategy.bidCeilingMicros !== undefined) nested.BidCeiling = strategy.bidCeilingMicros;
  if (strategy.goalId !== undefined) nested.GoalId = strategy.goalId;
  if (strategy.type === "AVERAGE_CPA" && strategy.averageCpaMicros !== undefined) nested.AverageCpa = strategy.averageCpaMicros;
  if (strategy.type === "AVERAGE_CPC" && strategy.averageCpcMicros !== undefined) nested.AverageCpc = strategy.averageCpcMicros;
  if ((strategy.type === "AVERAGE_CRR" || strategy.type === "PAY_FOR_CONVERSION_CRR") && strategy.crr !== undefined) {
    nested.Crr = strategy.crr;
  }
  if (strategy.type === "PAY_FOR_CONVERSION" && strategy.cpaMicros !== undefined) nested.Cpa = strategy.cpaMicros;
  if (strategy.type === "WEEKLY_CLICK_PACKAGE") {
    if (strategy.clicksPerWeek !== undefined) nested.ClicksPerWeek = strategy.clicksPerWeek;
    if (strategy.averageCpcMicros !== undefined) nested.AverageCpc = strategy.averageCpcMicros;
  }

  payload[field] = nested;
  return payload;
}

export type YandexCampaignType = "TEXT_CAMPAIGN" | "DYNAMIC_TEXT_CAMPAIGN" | "MOBILE_APP_CAMPAIGN" | "CPM_BANNER_CAMPAIGN" | "SMART_CAMPAIGN";

const CAMPAIGN_TYPE_FIELD: Record<YandexCampaignType, string> = {
  TEXT_CAMPAIGN: "TextCampaign",
  DYNAMIC_TEXT_CAMPAIGN: "DynamicTextCampaign",
  MOBILE_APP_CAMPAIGN: "MobileAppCampaign",
  CPM_BANNER_CAMPAIGN: "CpmBannerCampaign",
  SMART_CAMPAIGN: "SmartCampaign",
};

// These three use TextCampaign's {BiddingStrategy:{Search,Network}} split
// per Direct API v5's docs (all three are keyword/search-triggered types —
// this file just doesn't build their ad-group payload yet for the latter
// two: DynamicTextCampaign ad groups target a feed/webpage, MobileAppCampaign
// ad groups target an app store id, neither of which anything upstream of
// this file (PPC agent) produces today). CpmBannerCampaign and SmartCampaign
// use a different, NOT-yet-verified BiddingStrategy shape — callers must
// supply it themselves via campaignTypeFields rather than this file
// guessing field names it has no live confirmation for (same
// disclosed-but-unverified stance as getWeeklySpendLimit/getKeywordBids).
const SEARCH_NETWORK_SPLIT_TYPES = new Set<YandexCampaignType>(["TEXT_CAMPAIGN", "DYNAMIC_TEXT_CAMPAIGN", "MOBILE_APP_CAMPAIGN"]);

export interface YandexCampaignTypeOptions {
  readonly campaignType?: YandexCampaignType; // defaults to TEXT_CAMPAIGN, the only type this file's ad-group builders populate end-to-end
  readonly searchStrategy?: YandexSearchBiddingStrategy; // TEXT_CAMPAIGN/DYNAMIC_TEXT_CAMPAIGN/MOBILE_APP_CAMPAIGN only; defaults to HIGHEST_POSITION
  readonly networkStrategy?: YandexNetworkBiddingStrategy; // same three types; defaults to SERVING_OFF
  // Raw passthrough merged into the type's own container object. Mandatory
  // for CPM_BANNER_CAMPAIGN/SMART_CAMPAIGN (their BiddingStrategy shape
  // isn't modeled above); optional extra fields (e.g. Settings) for the
  // three split types.
  readonly campaignTypeFields?: Record<string, unknown>;
}

// Was a landmine comment here until 2026-08-30: DailyBudget is null on any
// campaign using an autostrategy (AVERAGE_CPA, AVERAGE_CPC,
// WB_MAXIMUM_CONVERSION_RATE — "Средняя цена конверсии"/"Максимум
// конверсий" in the UI), which real client campaigns commonly do — their
// real budget lives in getWeeklySpendLimit (below) instead. Closed as part
// of Track B / campaign-optimization; see
// docs/05-operations/yandex-direct-api-known-issues.md #3.

// Real finding (2026-08-19, auditing the Медавеню dashboard): Yandex
// Direct accounts report cost in their own local currency (this one:
// BYN) while Google Ads accounts report in whatever the account was set
// up with (Медавеню's: USD) — ad_stat rows previously had no currency
// field at all, and a dashboard summed/stacked both platforms' "cost" as
// if they were the same unit. clientLogin required in agency mode (same
// as callDirect); direct/personal mode uses the plain "clients" resource
// instead (no SelectionCriteria — it returns the authorized account's own
// info).
export async function getAccountCurrency(clientLogin: string | undefined, accessTokenEnv?: string): Promise<string> {
  if (clientLogin) {
    const result = (await callDirect(
      "agencyclients",
      "get",
      { SelectionCriteria: { Logins: [clientLogin] }, FieldNames: ["Login", "Currency"] },
      undefined,
      accessTokenEnv,
    )) as { Clients: ReadonlyArray<{ Currency: string }> };
    return result.Clients[0].Currency;
  }
  const result = (await callDirect("clients", "get", { FieldNames: ["Currency"] }, undefined, accessTokenEnv)) as {
    Currency: string;
  };
  return result.Currency;
}

export async function listCampaigns(clientLogin?: string, accessTokenEnv?: string): Promise<readonly DirectCampaign[]> {
  const result = (await callDirect(
    "campaigns",
    "get",
    { SelectionCriteria: {}, FieldNames: ["Id", "Name", "Status", "State"] },
    clientLogin,
    accessTokenEnv,
  )) as { Campaigns: DirectCampaign[] };
  return result.Campaigns ?? [];
}

// Creates a real campaign (TextCampaign by default; see
// YandexCampaignTypeOptions for the other four Direct API v5 types), then
// immediately suspends it. Idempotent by name — a repeated call for the
// same project reuses the existing campaign instead of duplicating it.
export async function createOrReusePausedCampaign(
  name: string,
  budgetShare: number,
  clientLogin?: string,
  options?: YandexCampaignTypeOptions,
): Promise<{ readonly campaignId: number; readonly reused: boolean }> {
  const existing = await listCampaigns(clientLogin);
  const match = existing.find((c) => c.Name === name);
  if (match) return { campaignId: match.Id, reused: true };

  const dailyBudgetMicros = Math.max(
    MIN_DAILY_BUDGET_MICROS,
    Math.round(DEFAULT_TOTAL_DAILY_BUDGET_MICROS * budgetShare),
  );

  const campaignType = options?.campaignType ?? "TEXT_CAMPAIGN";
  const typeFieldName = CAMPAIGN_TYPE_FIELD[campaignType];

  let typeContainer: Record<string, unknown>;
  if (SEARCH_NETWORK_SPLIT_TYPES.has(campaignType)) {
    typeContainer = {
      BiddingStrategy: {
        Search: buildSearchStrategyPayload(options?.searchStrategy ?? { type: "HIGHEST_POSITION" }),
        Network: buildNetworkStrategyPayload(options?.networkStrategy ?? { type: "SERVING_OFF" }),
      },
      ...options?.campaignTypeFields,
    };
  } else {
    if (!options?.campaignTypeFields) {
      throw new Error(
        `Yandex Direct campaignType "${campaignType}" needs campaignTypeFields — its BiddingStrategy shape ` +
          `differs from TextCampaign's Search/Network split and this file has not verified it against a real ` +
          `account (see the SEARCH_NETWORK_SPLIT_TYPES comment above). Pass the type's required fields explicitly.`,
      );
    }
    typeContainer = options.campaignTypeFields;
  }

  const addResult = (await callDirect(
    "campaigns",
    "add",
    {
      Campaigns: [
        {
          Name: name,
          StartDate: new Date().toISOString().slice(0, 10),
          DailyBudget: { Amount: dailyBudgetMicros, Mode: "STANDARD" },
          [typeFieldName]: typeContainer,
        },
      ],
    },
    clientLogin,
  )) as { AddResults: ReadonlyArray<{ Id?: number; Errors?: unknown[] }> };

  const added = addResult.AddResults[0];
  if (!added?.Id) {
    throw new Error(`Yandex Direct campaign creation failed: ${JSON.stringify(added?.Errors)}`);
  }

  await callDirect("campaigns", "suspend", { SelectionCriteria: { Ids: [added.Id] } }, clientLogin);

  return { campaignId: added.Id, reused: false };
}

// ---------------------------------------------------------------------
// Ad groups / keywords / text ads — ported from PPC Master Tool's real,
// live-tested campaign-creation scripts (scripts/draft_campaigns_setup.py,
// used for real Warface campaigns; the multi-group structure itself —
// Campaign → several AdGroups by search intent → Keywords + Ad each — is
// the same pattern create_google_gastro.py used for a real МедАвеню
// Google Ads campaign). Previously missing entirely on the Yandex side
// (see docs/07-planning/backlog.md #30): createOrReusePausedCampaign
// above only ever built an empty campaign container — nothing wrote an
// ad group, a keyword, or an ad. This closes that gap using the same
// callDirect JSON-RPC helper the rest of this file already relies on.
// ---------------------------------------------------------------------

export interface DirectAdGroup {
  readonly Id: number;
  readonly Name: string;
}

// Idempotent by name within the campaign, same convention as
// createOrReusePausedCampaign — a repeated call reuses the existing group
// instead of duplicating it.
export async function findAdGroupByName(
  campaignId: number,
  name: string,
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<DirectAdGroup | undefined> {
  const result = (await callDirect(
    "adgroups",
    "get",
    { SelectionCriteria: { CampaignIds: [campaignId] }, FieldNames: ["Id", "Name"] },
    clientLogin,
    accessTokenEnv,
  )) as { AdGroups: readonly DirectAdGroup[] };
  return (result.AdGroups ?? []).find((g) => g.Name === name);
}

// RegionIds is how Яндекс.Директ scopes geo — at the AD GROUP level, not
// the campaign level (unlike Google Ads, where geo is a campaign
// criterion — see addGeoAndLanguageTargeting in google-ads.ts). Confirmed
// by draft_campaigns_setup.py's create_groups, which is the only place in
// PPC Master Tool that actually sets RegionIds for a real campaign.
export async function createAdGroup(
  campaignId: number,
  name: string,
  regionIds: readonly number[],
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<number> {
  const result = (await callDirect(
    "adgroups",
    "add",
    { AdGroups: [{ Name: name, CampaignId: campaignId, RegionIds: regionIds }] },
    clientLogin,
    accessTokenEnv,
  )) as { AddResults: ReadonlyArray<{ Id?: number; Errors?: unknown[] }> };
  const added = result.AddResults[0];
  if (!added?.Id) {
    throw new Error(`Yandex Direct ad group creation failed: ${JSON.stringify(added?.Errors)}`);
  }
  return added.Id;
}

// Batched by 200 — Direct API v5's documented per-call limit for
// keywords.add, same batching draft_campaigns_setup.py used for real
// Warface keyword sets. Best-effort per batch (mirrors google-ads.ts's
// addKeywords partialFailure behavior): one rejected keyword doesn't
// abort the whole group, its text comes back in rejectedKeywords instead.
export async function addKeywordsToGroup(
  adGroupId: number,
  keywords: readonly string[],
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<{ readonly addedCount: number; readonly rejectedKeywords: readonly string[] }> {
  let addedCount = 0;
  const rejectedKeywords: string[] = [];
  for (let i = 0; i < keywords.length; i += 200) {
    const batch = keywords.slice(i, i + 200);
    const result = (await callDirect(
      "keywords",
      "add",
      { Keywords: batch.map((Keyword) => ({ Keyword, AdGroupId: adGroupId })) },
      clientLogin,
      accessTokenEnv,
    )) as { AddResults: ReadonlyArray<{ Id?: number; Errors?: ReadonlyArray<{ Message?: string }> }> };
    result.AddResults.forEach((r, idx) => {
      if (r.Id) addedCount += 1;
      else rejectedKeywords.push(batch[idx]);
    });
  }
  return { addedCount, rejectedKeywords };
}

export interface DirectTextAdCopy {
  readonly title: string; // ≤56 chars
  readonly title2?: string; // ≤30 chars, optional second title
  readonly text: string; // ≤81 chars
}

// Validated up front for the same reason google-ads.ts's
// createResponsiveSearchAd validates headline/description counts before
// calling — Direct rejects an out-of-bounds ad either way, this just
// gives a caller a clear reason instead of a buried API error. Limits per
// docs/07-planning/backlog.md #30 (56/30/81), Direct API v5's documented
// TextAd field limits.
export async function createTextAd(
  adGroupId: number,
  copy: DirectTextAdCopy,
  finalUrl: string,
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<number> {
  if (copy.title.length > 56) throw new Error(`Yandex Direct TextAd title exceeds 56 chars: "${copy.title}"`);
  if (copy.title2 && copy.title2.length > 30) throw new Error(`Yandex Direct TextAd title2 exceeds 30 chars: "${copy.title2}"`);
  if (copy.text.length > 81) throw new Error(`Yandex Direct TextAd text exceeds 81 chars: "${copy.text}"`);

  const result = (await callDirect(
    "ads",
    "add",
    {
      Ads: [
        {
          AdGroupId: adGroupId,
          TextAd: {
            Title: copy.title,
            ...(copy.title2 ? { Title2: copy.title2 } : {}),
            Text: copy.text,
            Href: finalUrl,
          },
        },
      ],
    },
    clientLogin,
    accessTokenEnv,
  )) as { AddResults: ReadonlyArray<{ Id?: number; Errors?: unknown[] }> };
  const added = result.AddResults[0];
  if (!added?.Id) {
    throw new Error(`Yandex Direct ad creation failed: ${JSON.stringify(added?.Errors)}`);
  }
  return added.Id;
}

export interface DirectAdGroupTargeting {
  readonly name: string;
  readonly keywords: readonly string[];
  readonly adCopy: DirectTextAdCopy;
}

export interface BuiltDirectAdGroup {
  readonly name: string;
  readonly adGroupId: number;
  readonly reused: boolean;
  readonly rejectedKeywords: readonly string[];
}

export interface MultiGroupDirectCampaign {
  readonly campaignId: number;
  readonly reused: boolean;
  readonly adGroups: readonly BuiltDirectAdGroup[];
}

// The Яндекс.Директ analogue of google-ads.ts's buildMultiGroupSearchCampaign
// — one campaign, several ad groups by search intent, each with its own
// keywords and text ad. Structure ported from
// scripts/draft_campaigns_setup.py (PPC Master Tool), which used exactly
// this shape (Campaign → AdGroups[] → Keywords + Ad each) to create real
// Warface campaigns. Campaign itself stays suspended throughout (same
// "never actually spends" guarantee as createOrReusePausedCampaign) — ad
// groups/keywords/ads can still be written onto a suspended campaign, only
// serving is blocked.
export async function buildMultiGroupSearchCampaign(
  name: string,
  budgetShare: number,
  finalUrl: string,
  regionIds: readonly number[],
  adGroups: readonly DirectAdGroupTargeting[],
  clientLogin?: string,
  accessTokenEnv?: string,
  // Bidding strategy override — TEXT_CAMPAIGN only (this function's ad
  // groups/keywords/ads shape is search-only); defaults preserve the
  // original HIGHEST_POSITION/SERVING_OFF behavior when omitted. Full
  // campaignType selection (Dynamic Text/CPM/Smart/Mobile App) lives on
  // createOrReusePausedCampaign directly — those types' ad groups aren't
  // keyword-shaped, so this multi-group keyword/ad builder doesn't apply.
  strategy?: { readonly searchStrategy?: YandexSearchBiddingStrategy; readonly networkStrategy?: YandexNetworkBiddingStrategy },
): Promise<MultiGroupDirectCampaign> {
  const campaign = await createOrReusePausedCampaign(name, budgetShare, clientLogin, {
    searchStrategy: strategy?.searchStrategy,
    networkStrategy: strategy?.networkStrategy,
  });

  const results: BuiltDirectAdGroup[] = [];
  for (const group of adGroups) {
    const existing = await findAdGroupByName(campaign.campaignId, group.name, clientLogin, accessTokenEnv);
    if (existing) {
      results.push({ name: group.name, adGroupId: existing.Id, reused: true, rejectedKeywords: [] });
      continue;
    }
    const adGroupId = await createAdGroup(campaign.campaignId, group.name, regionIds, clientLogin, accessTokenEnv);
    const { rejectedKeywords } = await addKeywordsToGroup(adGroupId, group.keywords, clientLogin, accessTokenEnv);
    await createTextAd(adGroupId, group.adCopy, finalUrl, clientLogin, accessTokenEnv);
    results.push({ name: group.name, adGroupId, reused: false, rejectedKeywords });
  }

  return { campaignId: campaign.campaignId, reused: campaign.reused, adGroups: results };
}

// ---------------------------------------------------------------------
// Keyword CPC forecast — ForecastsService, a Direct API v5 resource
// PPC Master Tool's direct_forecast.py and older docs/tutorials assume
// exists. It doesn't, as of 2026-08-30: `forecasts.create` 404s with an
// EMPTY body (not an app-level JSON error) against both a personal token
// (YANDEX_ACCESS_TOKEN) AND an agency token (YANDEX_AGENCY_ACCESS_TOKEN)
// — confirmed live, not a guess, and not an account-permission issue
// (403 would mean permission; 404 means the resource itself is gone).
// Yandex's own current API v5 overview page no longer lists Forecasts
// among its resources either. Same pattern as this file's
// getWordstatFrequency finding: an older Yandex API this codebase
// (and PPC Master Tool) assumed was live has been retired without an
// obvious replacement for this specific "auction CPC estimate without a
// live campaign" use case — unlike Wordstat, which DID get a live
// replacement (Yandex Cloud Search API, see yandex-wordstat.ts).
//
// Kept in the codebase (not deleted) because: the request/response
// shape and the parseForecastCpc field-name fallback chain reflect real
// research into what the API is documented to look like, in case Yandex
// reintroduces this resource or a scoped credential unlocks it later.
// getForecastCpc fails soft (empty map, doesn't throw) specifically
// because the endpoint is known-currently-dead, not hypothetically
// unreliable — a caller should not treat this as a live data source
// today. See docs/07-planning/backlog.md #29: real per-keyword CPC has
// no working Yandex-side source right now; getKeywordIdeas
// (google-ads.ts) is Google-only and Wordstat gives volume, not CPC.
// ---------------------------------------------------------------------

// Exported for testing the field-name fallback chain in isolation from
// the async create/poll flow above.
export function parseForecastCpc(forecast: {
  readonly Keywords?: ReadonlyArray<{
    readonly Keyword?: string;
    readonly KeywordName?: string;
    readonly TrafficVolumeForecast?: ReadonlyArray<{
      readonly TrafficVolume?: number;
      readonly AvgClickCost?: number; // account currency, not micros — unverified field name, see note above
      readonly CpcInCents?: number;
      readonly Cost?: number;
      readonly Clicks?: number;
    }>;
  }>;
}): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const kw of forecast.Keywords ?? []) {
    const name = (kw.Keyword ?? kw.KeywordName ?? "").toLowerCase();
    if (!name || !kw.TrafficVolumeForecast?.length) continue;
    // Highest traffic volume = closest to 100% auction coverage, the most
    // representative CPC (same choice PPC Master Tool made).
    const best = kw.TrafficVolumeForecast.reduce((max, tv) =>
      (tv.TrafficVolume ?? 0) > (max.TrafficVolume ?? 0) ? tv : max,
    );
    const cpc =
      best.AvgClickCost ??
      (best.CpcInCents !== undefined ? best.CpcInCents / 100 : undefined) ??
      (best.Cost && best.Clicks ? best.Cost / best.Clicks : undefined);
    if (cpc && cpc > 0) result.set(name, Math.round(cpc * 100) / 100);
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Async report: create → poll get until Status is "Done"/"Error". Returns
// an empty map (not a throw) on timeout, missing token, or API error —
// callers should treat "no estimate" as "fall back to a formula", not as
// "confirmed zero-cost", same reasoning as the ad_stat/conversion-audit
// convention of never quietly presenting a guess as a measured fact.
export async function getForecastCpc(
  keywords: readonly string[],
  geoIds: readonly number[],
  currency: string,
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<ReadonlyMap<string, number>> {
  if (keywords.length === 0) return new Map();
  const batch = keywords.slice(0, 200); // Direct API limit per forecast request

  let createResult: { ForecastIDs?: readonly number[] };
  try {
    createResult = (await callDirect(
      "forecasts",
      "create",
      { Keywords: batch, GeoID: geoIds, Currency: currency },
      clientLogin,
      accessTokenEnv,
    )) as { ForecastIDs?: readonly number[] };
  } catch {
    // Confirmed 2026-08-30: this 404s today (see module comment above) —
    // caught here, not left to propagate, because that failure is a known
    // "this data source doesn't exist right now" fact, not an unexpected
    // error a caller building a keyword list should have to handle.
    return new Map();
  }
  const forecastId = createResult.ForecastIDs?.[0];
  if (!forecastId) return new Map();

  const maxAttempts = 10;
  const pollIntervalMs = 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const getResult = (await callDirect(
      "forecasts",
      "get",
      { ForecastIDs: [forecastId] },
      clientLogin,
      accessTokenEnv,
    )) as {
      Forecasts?: ReadonlyArray<{
        Status?: string;
        Keywords?: Parameters<typeof parseForecastCpc>[0]["Keywords"];
      }>;
    };
    const forecast = getResult.Forecasts?.[0];
    if (!forecast) {
      await sleep(pollIntervalMs);
      continue;
    }
    if (forecast.Status === "Done") return parseForecastCpc(forecast);
    if (forecast.Status === "Error") return new Map();
    await sleep(pollIntervalMs); // Pending/Processing
  }
  return new Map(); // timed out — not "zero CPC", just no answer within the poll budget
}

// ---------------------------------------------------------------------
// Existing-campaign optimization (2026-08-30, Track B / campaign-
// optimization plan) — closes the two read gaps documented in
// docs/05-operations/yandex-direct-api-known-issues.md #3/#4 (real budget
// for autostrategy campaigns lives in BiddingStrategy.Search.
// <StrategyTypeName>.WeeklySpendLimit, not DailyBudget; real keyword bids
// live in keywords.get's Bid/ContextBid, not keywordbids.get), then adds
// the write paths on top of them. Built and unit-tested against a mocked
// fetch only — NOT yet exercised against a real account (same disclosed
// stance as buildPausedSearchCampaign's own history before its 2026-08-30
// wiring; see project_agent_framework_maturity memory). Do not mark the
// known-issues doc's status "verified live" until this has actually run
// against a real client campaign.
// ---------------------------------------------------------------------

export interface WeeklySpendLimit {
  readonly weeklySpendLimitMicros: number | null; // null when the campaign has no autostrategy (e.g. uses a fixed DailyBudget instead)
  readonly strategyType: string | undefined; // e.g. "AverageCpa", "AverageCpc", "WbMaximumConversionRate" — whichever key matches BiddingStrategyType
  readonly scope: "Search" | "Network" | undefined; // which branch of BiddingStrategy actually carried the autostrategy
}

// Real gap found 2026-09-03 auditing Медавеню through generic tooling: this
// used to check ONLY the Search branch of BiddingStrategy. A РСЯ (network-only)
// campaign has Search.BiddingStrategyType = SERVING_OFF (no WeeklySpendLimit
// there at all — SERVING_OFF carries no nested params, see
// SEARCH_STRATEGY_FIELD) and its real autostrategy/WeeklySpendLimit lives
// under Network instead. Checking Search only made every РСЯ campaign look
// like it "has no autostrategy" (null), when in fact the budget signal was
// just in the other branch. Now checks both and reports which one matched.
export async function getWeeklySpendLimit(
  campaignId: number,
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<WeeklySpendLimit> {
  const result = (await callDirect(
    "campaigns",
    "get",
    { SelectionCriteria: { Ids: [campaignId] }, FieldNames: ["Id"], TextCampaignFieldNames: ["BiddingStrategy"] },
    clientLogin,
    accessTokenEnv,
  )) as {
    Campaigns: ReadonlyArray<{
      TextCampaign?: { BiddingStrategy?: { Search?: Record<string, unknown>; Network?: Record<string, unknown> } };
    }>;
  };

  const biddingStrategy = result.Campaigns[0]?.TextCampaign?.BiddingStrategy;
  if (!biddingStrategy) return { weeklySpendLimitMicros: null, strategyType: undefined, scope: undefined };

  for (const scope of ["Search", "Network"] as const) {
    const branch = biddingStrategy[scope];
    if (!branch) continue;
    const strategyType = branch.BiddingStrategyType as string | undefined;
    // The strategy's own settings live nested under a key matching
    // BiddingStrategyType (e.g. Search.AverageCpa.WeeklySpendLimit) — not a
    // fixed field name, so this looks for whichever nested object actually
    // carries WeeklySpendLimit rather than hardcoding one strategy's shape.
    for (const [key, value] of Object.entries(branch)) {
      if (key === "BiddingStrategyType") continue;
      if (value && typeof value === "object" && "WeeklySpendLimit" in (value as Record<string, unknown>)) {
        const limit = (value as { WeeklySpendLimit?: number }).WeeklySpendLimit;
        if (typeof limit === "number") return { weeklySpendLimitMicros: limit, strategyType, scope };
      }
    }
  }
  return { weeklySpendLimitMicros: null, strategyType: undefined, scope: undefined };
}

export async function adjustWeeklySpendLimit(
  campaignId: number,
  newLimitMicros: number,
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<void> {
  const current = await getWeeklySpendLimit(campaignId, clientLogin, accessTokenEnv);
  if (!current.strategyType || !current.scope) {
    throw new Error(
      `Campaign ${campaignId} has no autostrategy BiddingStrategyType in either Search or Network — cannot set ` +
        `WeeklySpendLimit (it may use a fixed DailyBudget instead — see getDailyBudget).`,
    );
  }
  await callDirect(
    "campaigns",
    "update",
    {
      Campaigns: [
        {
          Id: campaignId,
          TextCampaign: { BiddingStrategy: { [current.scope]: { [current.strategyType]: { WeeklySpendLimit: newLimitMicros } } } },
        },
      ],
    },
    clientLogin,
    accessTokenEnv,
  );
}

export interface DailyBudgetInfo {
  readonly dailyBudgetMicros: number | null; // null when the campaign has no fixed DailyBudget (i.e. it's on an autostrategy — see getWeeklySpendLimit instead)
  readonly mode: string | undefined; // "STANDARD" | "DISTRIBUTED"
}

// Real gap found 2026-09-03: this file could only WRITE a DailyBudget
// (createOrReusePausedCampaign), never read one back for an existing
// campaign — so campaigns on a fixed daily budget (HIGHEST_POSITION and
// similar non-auto strategies) had no generic way to check "is this
// campaign pinned at its budget?" at all. getWeeklySpendLimit legitimately
// returns null for these (they have no autostrategy), which is correct but
// was previously a dead end rather than a pointer to this function.
export async function getDailyBudget(
  campaignId: number,
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<DailyBudgetInfo> {
  const result = (await callDirect(
    "campaigns",
    "get",
    // Real bug found 2026-09-03 auditing Медавеню live: requesting
    // FieldNames: ["Id", "DailyBudget"] ALONE silently returns
    // DailyBudget: null even for a campaign confirmed (via the UI and via
    // a raw request that also asked for TextCampaignFieldNames) to have a
    // real fixed DailyBudget set — no error, no warning, just a false
    // "this campaign has no daily budget" that would have wrongly excluded
    // every HIGHEST_POSITION/manual-strategy campaign from the "is this
    // pinned at its budget?" check this function exists for. Adding
    // TextCampaignFieldNames: ["BiddingStrategy"] (a field this function
    // doesn't even need) makes DailyBudget populate correctly — API-side
    // quirk, not explained by Direct API v5 docs, confirmed by isolating it
    // against the same campaign ID with/without that extra selector.
    {
      SelectionCriteria: { Ids: [campaignId] },
      FieldNames: ["Id", "DailyBudget"],
      TextCampaignFieldNames: ["BiddingStrategy"],
    },
    clientLogin,
    accessTokenEnv,
  )) as { Campaigns: ReadonlyArray<{ DailyBudget?: { Amount?: number; Mode?: string } }> };

  const dailyBudget = result.Campaigns[0]?.DailyBudget;
  return {
    dailyBudgetMicros: typeof dailyBudget?.Amount === "number" ? dailyBudget.Amount : null,
    mode: dailyBudget?.Mode,
  };
}

export interface KeywordBid {
  readonly keywordId: number;
  readonly bidMicros: number | null;
  readonly contextBidMicros: number | null;
}

export async function getKeywordBids(
  campaignId: number,
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<readonly KeywordBid[]> {
  const result = (await callDirect(
    "keywords",
    "get",
    { SelectionCriteria: { CampaignIds: [campaignId] }, FieldNames: ["Id", "Bid", "ContextBid"] },
    clientLogin,
    accessTokenEnv,
  )) as { Keywords?: ReadonlyArray<{ Id: number; Bid?: number; ContextBid?: number }> };
  return (result.Keywords ?? []).map((kw) => ({
    keywordId: kw.Id,
    bidMicros: kw.Bid ?? null,
    contextBidMicros: kw.ContextBid ?? null,
  }));
}

// Campaign-level negative keywords for an EXISTING campaign — reads the
// current list first and merges/dedupes rather than a blind
// Items-overwrite, since Direct API's update semantics for this field
// replace the whole array (a naive `Items: keywords` call would silently
// wipe out negatives added any other way, e.g. by a human in the UI).
export async function addNegativeKeywords(
  campaignId: number,
  keywords: readonly string[],
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<{ readonly totalNegativeCount: number }> {
  const current = (await callDirect(
    "campaigns",
    "get",
    { SelectionCriteria: { Ids: [campaignId] }, FieldNames: ["Id", "NegativeKeywords"] },
    clientLogin,
    accessTokenEnv,
  )) as { Campaigns: ReadonlyArray<{ NegativeKeywords?: { Items?: readonly string[] } }> };
  const existing = current.Campaigns[0]?.NegativeKeywords?.Items ?? [];
  if (keywords.length === 0) return { totalNegativeCount: existing.length };

  const merged = [...new Set([...existing, ...keywords])];
  await callDirect(
    "campaigns",
    "update",
    { Campaigns: [{ Id: campaignId, NegativeKeywords: { Items: merged } }] },
    clientLogin,
    accessTokenEnv,
  );
  return { totalNegativeCount: merged.length };
}

export async function setCampaignStatus(
  campaignId: number,
  action: "resume" | "suspend",
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<void> {
  await callDirect("campaigns", action, { SelectionCriteria: { Ids: [campaignId] } }, clientLogin, accessTokenEnv);
}

// Same SelectionCriteria.Ids shape as setCampaignStatus above, just on the
// `ads` resource instead of `campaigns` — verified live 2026-09-10 (probed
// with a bogus id, API echoed back the expected "must be an integer" shape
// for SelectionCriteria.Ids, confirming this is the right resource/method).
export async function setAdStatus(
  adId: string,
  action: "resume" | "suspend",
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<void> {
  const result = (await callDirect(
    "ads",
    action,
    { SelectionCriteria: { Ids: [rawId(adId)] } },
    clientLogin,
    accessTokenEnv,
  )) as {
    SuspendResults?: ReadonlyArray<{ Errors?: ReadonlyArray<{ Message: string; Details?: string }> }>;
    ResumeResults?: ReadonlyArray<{ Errors?: ReadonlyArray<{ Message: string; Details?: string }> }>;
  };
  // Same "200 OK but the real failure is per-item" shape as
  // updateResponsiveAdContent above (SuspendResults/ResumeResults[].Errors,
  // not a top-level `error`) — verified live 2026-09-10.
  const itemErrors = (result.SuspendResults ?? result.ResumeResults)?.[0]?.Errors;
  if (itemErrors && itemErrors.length > 0) {
    throw new Error(`Yandex Direct ads.${action} failed for ad ${adId}: ${JSON.stringify(itemErrors)}`);
  }
}

// Replaces the full Titles[]/Texts[] pool of a RESPONSIVE_AD (up to 7
// titles / 3 texts) — `ads.update` overwrites the whole array per call, so
// callers must pass the complete desired pool (existing + new), not just
// the additions, or the previous titles/texts get silently dropped.
// Real gotcha found 2026-09-10: unlike `ads.get`'s read shape (Titles as
// [{Title, Status, StatusClarification}, ...]), `ads.update` wants Titles/
// Texts as plain string arrays — sending the read shape's objects fails
// with "Элемент массива Ads.ResponsiveAd.Titles должен содержать строку".
export async function updateResponsiveAdContent(
  adId: string,
  content: { readonly titles: readonly string[]; readonly texts: readonly string[] },
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<void> {
  const result = (await callDirect(
    "ads",
    "update",
    {
      Ads: [
        {
          Id: rawId(adId),
          ResponsiveAd: {
            Titles: content.titles,
            Texts: content.texts,
          },
        },
      ],
    },
    clientLogin,
    accessTokenEnv,
    API_BASE_V501,
  )) as { UpdateResults?: ReadonlyArray<{ Errors?: ReadonlyArray<{ Message: string; Details?: string }> }> };
  // v5/v501 both return HTTP 200 with an empty top-level `error` even when
  // an individual item failed — the real per-item failure is buried in
  // UpdateResults[].Errors, which callDirect's generic error check doesn't
  // see. Surface it here instead of reporting false success.
  const itemErrors = result.UpdateResults?.[0]?.Errors;
  if (itemErrors && itemErrors.length > 0) {
    throw new Error(`Yandex Direct ads.update failed for ad ${adId}: ${JSON.stringify(itemErrors)}`);
  }
}

export interface DirectCampaignReportRow {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly date: string; // YYYY-MM-DD
  readonly cost: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversionsByGoal: Record<string, number>;
}

// Reports API (a separate resource from the JSON campaigns.get/add/suspend
// methods used above). Real gotcha found 2026-08-18 building the Медавеню
// report: `CampaignStatus` is NOT a valid field for CAMPAIGN_PERFORMANCE_REPORT
// (400 "неверное значение перечисления").
//
// The API can also legitimately respond 201 (queued) or 202 (still
// processing) with an empty body and a `retryIn` header while a report is
// generated — confirmed for real 2026-09-03 running SEARCH_QUERY_PERFORMANCE_REPORT
// against a live account (CAMPAIGN_PERFORMANCE_REPORT had so far always
// returned 200 synchronously, which is why this wasn't caught earlier).
// Without a retry loop, this silently returns 0 rows instead of failing
// loudly — the caller sees "no search terms" rather than "report wasn't
// ready yet", which is worse than an error. Shared by every report type
// below so the fix only has to exist once.
async function fetchDirectReport(
  reportParams: Record<string, unknown>,
  clientLogin: string | undefined,
  accessTokenEnv: string | undefined,
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getYandexAccessToken(accessTokenEnv)}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json",
    processingMode: "auto",
    returnMoneyInMicros: "false",
    // Left unset (defaults to including a totals row), the Reports API
    // appends one extra row summing the whole range — this code only ever
    // strips the "Total rows: N" footer line, not that separate totals
    // row, so it would otherwise be parsed as a bogus extra campaign-day
    // row (garbage CampaignId, inflated aggregates). Explicit "true" is
    // the only header value that's safe to pair with footer-only
    // stripping — see YANDEX_DIRECT_API_KNOWN_ISSUES.md #1 for the mirror
    // bug (a real row silently dropped when this pairing is gotten wrong
    // the other way).
    skipReportSummary: "true",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;

  const MAX_ATTEMPTS = 6; // Yandex docs suggest polling every few seconds; this caps total wait around ~30-60s
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(`${API_BASE}/reports`, {
      method: "POST",
      headers,
      body: JSON.stringify({ params: reportParams }),
    });
    if (response.status === 201 || response.status === 202) {
      // Report queued/processing — body is empty, `retryIn` header names
      // the suggested wait in seconds (falls back to a fixed delay if absent).
      const retryInSeconds = Number(response.headers.get("retryIn")) || 2 * attempt;
      await sleep(retryInSeconds * 1000);
      continue;
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Yandex Direct Reports API call failed: ${response.status} ${text}`);
    }
    return text;
  }
  throw new Error(
    `Yandex Direct Reports API report still not ready after ${MAX_ATTEMPTS} polling attempts — try a narrower date range.`,
  );
}

export async function getCampaignReport(
  clientLogin: string | undefined,
  params: { readonly startDate: string; readonly endDate: string; readonly goalIds: readonly string[] },
  accessTokenEnv?: string,
): Promise<readonly DirectCampaignReportRow[]> {
  const text = await fetchDirectReport(
    {
      SelectionCriteria: { DateFrom: params.startDate, DateTo: params.endDate },
      Goals: params.goalIds,
      // Real bug found 2026-09-10 comparing this report's total against the
      // Direct UI for the same period/goals: without an explicit
      // AttributionModels, the API defaults to an older click-based model
      // (columns come back suffixed "_LSCCD") which undercounted real
      // conversions by ~35% (59 vs the UI's 90) — the account's actual
      // attribution setting is "Автоматическая", exposed here as "AUTO".
      // Must match whichever model the UI/account actually uses, or every
      // consumer of this report (ad_stat sync, DataLens) silently
      // under-reports conversions.
      AttributionModels: ["AUTO"],
      // "Date" (not just DateFrom/DateTo in SelectionCriteria) is what
      // makes the report return one row per campaign PER DAY instead of
      // one aggregated row for the whole range — needed for real
      // day-by-day ad_stat history, same reasoning as google-ads.ts's
      // segments.date.
      FieldNames: ["Date", "CampaignId", "CampaignName", "Impressions", "Clicks", "Cost", "Conversions"],
      ReportName: `ama-report-${Date.now()}`,
      ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "NO",
      IncludeDiscount: "NO",
    },
    clientLogin,
    accessTokenEnv,
  );

  // First line is the report title ("Report <id> (<from> - <to>)"), not a
  // TSV header — skip it before handing off to the generic parser. A
  // trailing "Total rows: N" footer line also showed up once the report
  // was segmented by Date (not present on the earlier non-segmented
  // report) — strip it too, or it gets misparsed as a data row with
  // garbage column values.
  const withoutTitle = text.slice(text.indexOf("\n") + 1);
  const withoutFooter = withoutTitle.replace(/\n?Total rows: \d+\s*$/, "");
  const rows = parseTsv(withoutFooter);

  return rows.map((row) => {
    const conversionsByGoal: Record<string, number> = {};
    for (const goalId of params.goalIds) {
      const value = row[`Conversions_${goalId}_AUTO`];
      conversionsByGoal[goalId] = value && value !== "--" ? Number(value) : 0;
    }
    return {
      campaignId: row.CampaignId,
      campaignName: row.CampaignName,
      date: row.Date,
      cost: Number(row.Cost || 0),
      impressions: Number(row.Impressions || 0),
      clicks: Number(row.Clicks || 0),
      conversionsByGoal,
    };
  });
}

export interface DirectSearchTermRow {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly adGroupId: string;
  readonly adGroupName: string;
  readonly searchTerm: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly cost: number;
  readonly conversionsByGoal: Record<string, number>;
}

// Negative-keyword mining and cross-campaign cannibalization both need the
// actual search terms that triggered a click, not just the bid keywords —
// no generic tool in this file exposed that before this function (found
// missing 2026-09-03 comparing a generic-tooling audit against
// .claude/agents/medavenue-analyst.md's read of this same report type).
// `Criterion` (not `Keyword`) is the field that actually carries the raw
// search term in this report — using `Keyword` here returns the matched
// bid keyword instead and silently defeats the whole exercise.
export async function getSearchTermsReport(
  clientLogin: string | undefined,
  params: { readonly startDate: string; readonly endDate: string; readonly goalIds: readonly string[] },
  accessTokenEnv?: string,
): Promise<readonly DirectSearchTermRow[]> {
  const text = await fetchDirectReport(
    {
      SelectionCriteria: { DateFrom: params.startDate, DateTo: params.endDate },
      Goals: params.goalIds,
      // Same AUTO-attribution fix as getCampaignReport above — must match
      // the account's actual attribution setting, not the API's default.
      AttributionModels: ["AUTO"],
      FieldNames: ["CampaignId", "CampaignName", "AdGroupId", "AdGroupName", "Criterion", "Impressions", "Clicks", "Cost", "Conversions"],
      ReportName: `ama-sqr-${Date.now()}`,
      ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "NO",
      IncludeDiscount: "NO",
    },
    clientLogin,
    accessTokenEnv,
  );

  const withoutTitle = text.slice(text.indexOf("\n") + 1);
  const withoutFooter = withoutTitle.replace(/\n?Total rows: \d+\s*$/, "");
  const rows = parseTsv(withoutFooter);

  return rows.map((row) => {
    const conversionsByGoal: Record<string, number> = {};
    for (const goalId of params.goalIds) {
      const value = row[`Conversions_${goalId}_AUTO`];
      conversionsByGoal[goalId] = value && value !== "--" ? Number(value) : 0;
    }
    return {
      campaignId: row.CampaignId,
      campaignName: row.CampaignName,
      adGroupId: row.AdGroupId,
      adGroupName: row.AdGroupName,
      searchTerm: row.Criterion,
      impressions: Number(row.Impressions || 0),
      clicks: Number(row.Clicks || 0),
      cost: Number(row.Cost || 0),
      conversionsByGoal,
    };
  });
}
