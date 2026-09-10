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
// Real bug found 2026-09-03 auditing Медавеню through generic tooling: a
// hardcoded `LIMIT 50` with no `ORDER BY` silently dropped every one of the
// account's 17 currently-active campaigns on an account with a longer
// history (older/removed campaigns sorted ahead of them by whatever default
// order the API happens to return) — any caller treating this as "the
// account's campaign list" (budget checks, name-matching for
// createOrReusePausedCampaign) would have missed 100% of real activity.
// `googleAds:search` returns up to 10,000 rows per page without an explicit
// LIMIT, which comfortably covers any agency account size in practice —
// removing the cap (rather than raising it) is what actually fixes this,
// since any fixed number reintroduces the same class of bug on a bigger
// account. `ORDER BY campaign.id` makes the result deterministic across
// calls instead of depending on undocumented default ordering.
export async function listCampaigns(
  customerId?: string,
  options: GoogleAdsCallOptions = { loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID },
): Promise<GaqlSearchResponse["results"]> {
  const resolvedCustomerId = resolveCustomerId(customerId);
  const data = (await callGoogleAds(
    resolvedCustomerId,
    "/googleAds:search",
    { query: "SELECT campaign.id, campaign.name, campaign.status FROM campaign ORDER BY campaign.id" },
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

// 2026-08-30 — the piece that finishes "GTM → GA4 → Google Ads": until
// now, linkToGoogleAds (google-analytics.ts) only makes GA4 key events
// *available* to import; nothing created the Ads-side ConversionAction
// that actually finishes the import. Confirmed by real API behavior, not
// assumed: creating a GOOGLE_ANALYTICS_4_CUSTOM/PURCHASE ConversionAction
// via conversionActions:mutate is REJECTED by Google Ads API outright
// ("Creation of this conversion action type isn't supported by Google Ads
// API" — https://developers.google.com/google-ads/api/docs/conversions/categories,
// https://groups.google.com/g/adwords-api/c/8pgVMMieznM). There is no API
// path to finish this step; it is a manual click in the Ads UI (Goals and
// conversions → Conversion actions → + New → Import → Google Analytics 4
// properties). What IS real and useful here: once a GA4 property is
// linked, its key events already show up via listConversionActions with
// status HIDDEN until a human imports them — this surfaces exactly which
// ones are waiting, instead of leaving that invisible.
export async function listGa4ImportCandidates(
  customerId: string,
  options: GoogleAdsCallOptions = {},
): Promise<readonly ConversionAction[]> {
  const all = await listConversionActions(customerId, options);
  return all.filter((ca) => ca.type.startsWith("GOOGLE_ANALYTICS_4") && ca.status === "HIDDEN");
}

// A genuinely separate path from GA4 import above: a native WEBPAGE
// conversion action, tracked by Google Ads' own conversion tag (fired
// directly, e.g. via GTM's "Google Ads Conversion Tracking" tag type —
// see addGoogleAdsConversionTag in google-tag-manager.ts), not through
// GA4 at all. Exists because linkToGoogleAds's GA4-import conversions
// (google-analytics.ts) land HIDDEN and Google Ads rejects any API
// attempt to flip a GOOGLE_ANALYTICS_4_* action to ENABLED/imported — see
// the module comment on google-analytics.ts's linkToGoogleAds and the
// 2026-08-30 finding in this file about conversionActions:mutate
// rejecting that type outright. A plain WEBPAGE action has no such
// restriction: creating and enabling it is a normal, fully-API-supported
// operation.
export interface CreateConversionActionInput {
  readonly name: string;
  readonly category?: string; // default "SUBMIT_LEAD_FORM" — Google Ads' enum for a lead-gen form conversion
  readonly countingType?: "ONE_PER_CLICK" | "MANY_PER_CLICK"; // default ONE_PER_CLICK — one lead per click, not one per event
}

export interface CreatedConversionAction {
  readonly resourceName: string;
  readonly id: string;
  // Google Ads' own conversion tag identifiers — what a GTM "Google Ads
  // Conversion Tracking" tag (or gtag.js directly) needs to actually
  // report a conversion against this action.
  readonly conversionId: string;
  readonly conversionLabel: string;
}

// Idempotent by name — a repeated call for the same name reuses the
// existing action instead of creating a duplicate conversion action.
export async function createConversionAction(
  input: CreateConversionActionInput,
  customerId: string,
  options: GoogleAdsCallOptions = {},
): Promise<CreatedConversionAction> {
  const existing = await listConversionActions(customerId, options);
  const match = existing.find((ca) => ca.name === input.name && ca.type === "WEBPAGE");
  const resourceName = match
    ? `customers/${customerId}/conversionActions/${match.id}`
    : (
        (await callGoogleAds(
          customerId,
          "/conversionActions:mutate",
          {
            operations: [
              {
                create: {
                  name: input.name,
                  type: "WEBPAGE",
                  category: input.category ?? "SUBMIT_LEAD_FORM",
                  status: "ENABLED",
                  countingType: input.countingType ?? "ONE_PER_CLICK",
                  // includeInConversionsMetric is IMMUTABLE on create
                  // (confirmed live 2026-09-04 — Google Ads API rejects it
                  // outright with fieldError IMMUTABLE_FIELD) — Google Ads
                  // decides this itself at creation time based on category;
                  // not settable here.
                },
              },
            ],
          },
          options,
        )) as { results: ReadonlyArray<{ resourceName: string }> }
      ).results[0].resourceName;

  // tag_snippets is only populated when explicitly selected — not part of
  // listConversionActions' default field set, so this is a second read
  // rather than folding it into that shared function's fields for every
  // caller that doesn't need it.
  const data = (await callGoogleAds(
    customerId,
    "/googleAds:search",
    {
      query: `SELECT conversion_action.id, conversion_action.tag_snippets
              FROM conversion_action
              WHERE conversion_action.resource_name = '${resourceName}'`,
    },
    options,
  )) as {
    results?: ReadonlyArray<{
      conversionAction: {
        id: string;
        tagSnippets?: ReadonlyArray<{ globalSiteTag?: string; eventSnippet?: string }>;
      };
    }>;
  };
  const row = data.results?.[0]?.conversionAction;
  if (!row) throw new Error(`Could not read back conversion action ${resourceName} after creation`);

  // Google's snippets embed the conversion id/label as
  // `send_to: 'AW-<conversionId>/<conversionLabel>'` inside the
  // eventSnippet — parsed here rather than asking the caller to scrape it
  // themselves, since every caller of this function needs exactly this
  // pair (GTM's Conversion Tracking tag takes them as separate fields).
  const eventSnippet = row.tagSnippets?.[0]?.eventSnippet ?? "";
  const sendToMatch = eventSnippet.match(/'send_to':\s*'AW-(\d+)\/([\w-]+)'/);
  if (!sendToMatch) {
    throw new Error(`Could not parse conversion id/label from tag snippet for ${resourceName}: ${eventSnippet}`);
  }
  return { resourceName, id: row.id, conversionId: sendToMatch[1], conversionLabel: sendToMatch[2] };
}

// Real finding (2026-08-19): a Google Ads account's cost is reported in
// its own currency (Медавеню's: USD), separate from — and not
// interchangeable with — a Yandex Direct account's currency (BYN). See
// yandex-direct.ts's getAccountCurrency for the matching function there.
export async function getAccountCurrency(customerId: string, options: GoogleAdsCallOptions = {}): Promise<string> {
  const data = (await callGoogleAds(
    customerId,
    "/googleAds:search",
    { query: "SELECT customer.currency_code FROM customer LIMIT 1" },
    options,
  )) as { results?: ReadonlyArray<{ customer: { currencyCode: string } }> };
  const currencyCode = data.results?.[0]?.customer.currencyCode;
  if (!currencyCode) throw new Error(`Could not determine currency for customer ${customerId}`);
  return currencyCode;
}

export interface KeywordIdea {
  readonly text: string;
  readonly avgMonthlySearches?: number;
  readonly competition?: string; // LOW | MEDIUM | HIGH | UNSPECIFIED
  readonly lowTopOfPageBidMicros?: number;
  readonly highTopOfPageBidMicros?: number;
}

// KeywordPlanIdeaService.GenerateKeywordIdeas (2026-08-30) — grounds PPC's
// keyword/budget decisions in real search volume and real top-of-page bid
// ranges instead of the model guessing both with no data (see
// docs/07-planning/backlog.md #29). No new credential needed: this is the
// same Google Ads API surface as everything else in this file, just a
// different RPC. keywordSeed + one of urlSeed/geoTargetConstants — Google
// requires at least a keyword or URL seed, geo/language narrow the
// estimate to the actual target market (same geoTargetConstants/
// languageConstants resource-name shape as addGeoAndLanguageTargeting).
interface RawKeywordIdeasResponse {
  results?: ReadonlyArray<{
    text?: string;
    keywordIdeaMetrics?: {
      avgMonthlySearches?: string;
      competition?: string;
      lowTopOfPageBidMicros?: string;
      highTopOfPageBidMicros?: string;
    };
  }>;
}

function parseKeywordIdeas(data: RawKeywordIdeasResponse): readonly KeywordIdea[] {
  return (data.results ?? [])
    .filter((r): r is typeof r & { text: string } => Boolean(r.text))
    .map((r) => ({
      text: r.text,
      avgMonthlySearches: r.keywordIdeaMetrics?.avgMonthlySearches ? Number(r.keywordIdeaMetrics.avgMonthlySearches) : undefined,
      competition: r.keywordIdeaMetrics?.competition,
      lowTopOfPageBidMicros: r.keywordIdeaMetrics?.lowTopOfPageBidMicros
        ? Number(r.keywordIdeaMetrics.lowTopOfPageBidMicros)
        : undefined,
      highTopOfPageBidMicros: r.keywordIdeaMetrics?.highTopOfPageBidMicros
        ? Number(r.keywordIdeaMetrics.highTopOfPageBidMicros)
        : undefined,
    }));
}

export async function getKeywordIdeas(
  seedKeywords: readonly string[],
  customerId: string,
  params: { readonly geoTargetConstants?: readonly string[]; readonly languageConstant?: string } = {},
  options: GoogleAdsCallOptions = {},
): Promise<readonly KeywordIdea[]> {
  if (seedKeywords.length === 0) return [];
  const data = (await callGoogleAds(
    customerId,
    ":generateKeywordIdeas",
    {
      keywordSeed: { keywords: seedKeywords },
      geoTargetConstants: params.geoTargetConstants,
      language: params.languageConstant,
      keywordPlanNetwork: "GOOGLE_SEARCH",
    },
    options,
  )) as RawKeywordIdeasResponse;
  return parseKeywordIdeas(data);
}

// Same RPC as getKeywordIdeas, but seeded from a URL instead of literal
// keywords — Google's GenerateKeywordIdeas supports `urlSeed` as an
// alternative to `keywordSeed` (it crawls the page and suggests keywords
// it's actually relevant for). Added for the SEO agent (seo-service tool,
// see apps/web/lib/tools/seo-service.ts): that role only ever has a site
// URL, not a hand-picked seed list, at the point it needs keyword/search-
// volume data — mirrors what a real SEO tool's "keywords this page could
// rank for" report does, using infrastructure (Google Ads Keyword Planner)
// this codebase already has live credentials for, rather than waiting on
// a paid SEO vendor decision (docs/07-planning/backlog.md #25).
export async function getKeywordIdeasFromUrl(
  url: string,
  customerId: string,
  params: { readonly geoTargetConstants?: readonly string[]; readonly languageConstant?: string } = {},
  options: GoogleAdsCallOptions = {},
): Promise<readonly KeywordIdea[]> {
  const data = (await callGoogleAds(
    customerId,
    ":generateKeywordIdeas",
    {
      urlSeed: { url },
      geoTargetConstants: params.geoTargetConstants,
      language: params.languageConstant,
      keywordPlanNetwork: "GOOGLE_SEARCH",
    },
    options,
  )) as RawKeywordIdeasResponse;
  return parseKeywordIdeas(data);
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

export interface SearchTermReportRow {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly adGroupId: string;
  readonly adGroupName: string;
  readonly searchTerm: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly costMicros: number;
  readonly conversions: number;
}

// Negative-keyword mining and cross-campaign cannibalization both need the
// actual search terms that triggered a click, not just the bid keywords —
// missing from this file entirely before this function (found 2026-09-03
// comparing a generic-tooling audit against .claude/agents/medavenue-analyst.md's
// hand-written GAQL for the same report). Performance Max campaigns don't
// populate search_term_view (they need campaign_search_term_insight
// instead, a separate resource this function does not cover) — callers
// should expect near-zero rows for PMax campaign IDs.
export async function getSearchTermsReport(
  customerId: string,
  params: { readonly startDate: string; readonly endDate: string },
  options: GoogleAdsCallOptions = {},
): Promise<readonly SearchTermReportRow[]> {
  const data = (await callGoogleAds(
    customerId,
    "/googleAds:search",
    {
      query: `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
                search_term_view.search_term, metrics.impressions, metrics.clicks,
                metrics.cost_micros, metrics.conversions
              FROM search_term_view
              WHERE segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'`,
    },
    options,
  )) as {
    results?: ReadonlyArray<{
      campaign: { id: string; name: string };
      adGroup: { id: string; name: string };
      searchTermView: { searchTerm: string };
      metrics: Record<string, number>;
    }>;
  };

  return (data.results ?? []).map((r) => ({
    campaignId: r.campaign.id,
    campaignName: r.campaign.name,
    adGroupId: r.adGroup.id,
    adGroupName: r.adGroup.name,
    searchTerm: r.searchTermView.searchTerm,
    impressions: Number(r.metrics.impressions ?? 0),
    clicks: Number(r.metrics.clicks ?? 0),
    costMicros: Number(r.metrics.costMicros ?? 0),
    conversions: Number(r.metrics.conversions ?? 0),
  }));
}

export interface ImpressionShareReportRow {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly searchImpressionShare: number | null;
  readonly searchBudgetLostImpressionShare: number | null;
  readonly searchRankLostImpressionShare: number | null;
}

// The signal that tells "raise the budget" apart from "fix the ad/bid" —
// budget-lost high means more budget would actually buy more impressions;
// rank-lost high means it wouldn't (ad rank/quality is the ceiling, not
// spend). Without this, a campaign that's simply pinned at its daily
// budget looks identical to one that's losing on quality, and "scale up"
// becomes a guess instead of a data-backed call — the gap that made a
// generic-tooling audit (2026-09-03) recommend budget increases a
// specialized audit correctly flagged as premature. Search-only metric —
// not populated for Performance Max or Display campaigns.
export async function getImpressionShareReport(
  customerId: string,
  params: { readonly startDate: string; readonly endDate: string },
  options: GoogleAdsCallOptions = {},
): Promise<readonly ImpressionShareReportRow[]> {
  const data = (await callGoogleAds(
    customerId,
    "/googleAds:search",
    {
      query: `SELECT campaign.id, campaign.name, metrics.search_impression_share,
                metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
              FROM campaign
              WHERE segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
                AND campaign.advertising_channel_type = 'SEARCH'`,
    },
    options,
  )) as {
    results?: ReadonlyArray<{
      campaign: { id: string; name: string };
      metrics: Record<string, number | null>;
    }>;
  };

  // Real finding (2026-09-03, running this against a live account for the
  // first time): Google Ads omits `metrics` entirely on a result row when
  // every requested metric is unset for that campaign/date range (not just
  // zero-valued) — roughly half of Медавеню's SEARCH campaigns hit this
  // (no impression-share data recorded at all, e.g. very low volume or
  // paused mid-period). `r.metrics.searchImpressionShare` on such a row
  // threw `TypeError: Cannot read properties of undefined`, silently
  // aborting the whole report for every campaign, not just the affected
  // ones. Fixed with `r.metrics ?? {}` — a missing metrics object is
  // legitimate "no impression-share data for this campaign", not an error.
  return (data.results ?? []).map((r) => {
    const metrics = r.metrics ?? {};
    return {
      campaignId: r.campaign.id,
      campaignName: r.campaign.name,
      searchImpressionShare: metrics.searchImpressionShare ?? null,
      searchBudgetLostImpressionShare: metrics.searchBudgetLostImpressionShare ?? null,
      searchRankLostImpressionShare: metrics.searchRankLostImpressionShare ?? null,
    };
  });
}

export interface CampaignBudgetRow {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly dailyBudgetMicros: number;
  readonly deliveryMethod: string | undefined; // STANDARD | ACCELERATED
}

// Current (not historical) daily budget per SEARCH campaign — pairs with
// getImpressionShareReport to tell "budget-constrained" (search_budget_lost
// high) apart from "rank-constrained" (search_rank_lost high, more budget
// wouldn't help) apart from "under-spending its own budget with low lost
// impression share on both" (demand-limited or a bidding-strategy ceiling).
export async function getCampaignBudgets(
  customerId: string,
  options: GoogleAdsCallOptions = {},
): Promise<readonly CampaignBudgetRow[]> {
  const data = (await callGoogleAds(
    customerId,
    "/googleAds:search",
    {
      query: `SELECT campaign.id, campaign.name, campaign_budget.amount_micros, campaign_budget.delivery_method
              FROM campaign
              WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type = 'SEARCH'`,
    },
    options,
  )) as {
    results?: ReadonlyArray<{
      campaign: { id: string; name: string };
      campaignBudget?: { amountMicros?: number; deliveryMethod?: string };
    }>;
  };
  return (data.results ?? []).map((r) => ({
    campaignId: r.campaign.id,
    campaignName: r.campaign.name,
    dailyBudgetMicros: r.campaignBudget?.amountMicros ?? 0,
    deliveryMethod: r.campaignBudget?.deliveryMethod,
  }));
}

// Creates a real CampaignBudget + Campaign, PAUSED, SEARCH channel type, no
// ad groups/keywords/ads yet — a real but empty shell. Idempotent per call:
// if a campaign with the same name already exists, it's reused rather than
// duplicated (repeated task runs/tests shouldn't flood the account).
//
// 2026-08-30 — kept as its own exported function (not folded into
// buildPausedSearchCampaign below) because PPC's tool call falls back to
// this shell when the model didn't produce keywords/ad copy for a channel
// (real-tools.ts's "google-ads" case) — an empty paused campaign is still
// useful for a human to finish by hand, and better than failing the Task.
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

// ---------------------------------------------------------------------
// Ad group / keywords / ad — 2026-08-30. Until this point,
// createOrReusePausedCampaign only ever produced "a real but empty shell":
// no ad group, no keywords, no ad, so nothing a PPC Agent decided (target
// keywords, ad copy) ever reached a real campaign object. This closes that
// gap. Still safe: the campaign itself stays PAUSED (created above), and
// the ad is additionally created PAUSED itself — belt and suspenders, even
// though a paused campaign alone already guarantees no spend.
// ---------------------------------------------------------------------

interface GaqlAdGroupSearchResponse {
  readonly results?: ReadonlyArray<{
    readonly adGroup?: { readonly id?: string; readonly resourceName?: string; readonly name?: string };
  }>;
}

async function findAdGroupByName(
  campaignId: string,
  name: string,
  customerId: string,
  options: GoogleAdsCallOptions,
): Promise<{ readonly resourceName: string; readonly id: string } | undefined> {
  const escaped = name.replace(/'/g, "\\'");
  const data = (await callGoogleAds(
    customerId,
    "/googleAds:search",
    {
      query: `SELECT ad_group.id, ad_group.resource_name, ad_group.name FROM ad_group
              WHERE campaign.id = ${campaignId} AND ad_group.name = '${escaped}'`,
    },
    options,
  )) as GaqlAdGroupSearchResponse;
  const match = data.results?.[0]?.adGroup;
  return match?.resourceName && match.id ? { resourceName: match.resourceName, id: match.id } : undefined;
}

async function createAdGroup(
  campaignResourceName: string,
  name: string,
  customerId: string,
  options: GoogleAdsCallOptions,
): Promise<string> {
  const data = (await callGoogleAds(
    customerId,
    "/adGroups:mutate",
    {
      operations: [
        {
          create: {
            name,
            campaign: campaignResourceName,
            status: "ENABLED", // the ad itself is PAUSED below; the campaign (already PAUSED) is what actually gates spend
            type: "SEARCH_STANDARD",
          },
        },
      ],
    },
    options,
  )) as { results: ReadonlyArray<{ resourceName: string }> };
  return data.results[0].resourceName;
}

// PHRASE match by default — a deliberate middle ground: narrower than
// BROAD (which can match wildly unrelated searches and burn budget once
// unpaused), looser than EXACT (which would need every literal query
// variant spelled out). A human reviewing the paused campaign can tighten
// or loosen per keyword before launch.
//
// partialFailure: true (2026-08-30, ported from PPC Master Tool's
// create_da_by_new_campaigns.py) — without it, a single keyword rejected
// by policy/moderation fails the whole batch mutate and no keywords reach
// the ad group at all. With it, rejected operations are reported in
// partialFailureError while every other keyword in the same call still
// gets created. Returns the rejected keyword texts (empty if none) so the
// caller can surface them instead of silently losing them.
async function addKeywords(
  adGroupResourceName: string,
  keywords: readonly string[],
  customerId: string,
  options: GoogleAdsCallOptions,
): Promise<readonly string[]> {
  if (keywords.length === 0) return [];
  const data = (await callGoogleAds(
    customerId,
    "/adGroupCriteria:mutate",
    {
      partialFailure: true,
      operations: keywords.map((text) => ({
        create: {
          adGroup: adGroupResourceName,
          status: "ENABLED",
          keyword: { text, matchType: "PHRASE" },
        },
      })),
    },
    options,
  )) as { results?: ReadonlyArray<unknown>; partialFailureError?: { details?: ReadonlyArray<{ errors?: ReadonlyArray<{ location?: { fieldPathElements?: ReadonlyArray<{ index?: number }> } }> }> } };

  const failedIndexes = new Set<number>();
  for (const detail of data.partialFailureError?.details ?? []) {
    for (const err of detail.errors ?? []) {
      const opIndex = err.location?.fieldPathElements?.find((el) => el.index !== undefined)?.index;
      if (opIndex !== undefined) failedIndexes.add(opIndex);
    }
  }
  return keywords.filter((_, i) => failedIndexes.has(i));
}

export type NegativeKeywordMatchType = "EXACT" | "PHRASE" | "BROAD";

// Adds negative keywords to a campaign that already exists — usable both at
// creation time (buildPausedSearchCampaign, below) and, since 2026-08-30
// (Track B), against a live client campaign from packages/agents/ppc's
// "apply" action. NOT idempotent: Google allows duplicate negative
// criteria, so callers must not re-run this against an already-applied
// campaign_changes_log row (see this file's module comment above
// setCampaignStatus for the guard that matters).
export async function addNegativeKeywordsToExistingCampaign(
  campaignResourceName: string,
  keywords: readonly string[],
  customerId: string,
  matchType: NegativeKeywordMatchType = "EXACT",
  options: GoogleAdsCallOptions = {},
): Promise<{ readonly addedCount: number }> {
  if (keywords.length === 0) return { addedCount: 0 };
  await callGoogleAds(
    customerId,
    "/campaignCriteria:mutate",
    {
      operations: keywords.map((text) => ({
        create: { campaign: campaignResourceName, negative: true, keyword: { text, matchType } },
      })),
    },
    options,
  );
  return { addedCount: keywords.length };
}

// Campaign-level negative keywords at creation time — applied once at the
// campaign, not per ad group, since PPC's model output produces one
// negative list per channel today (real-tools.ts), not per ad group. Thin
// wrapper over the public function above so both call sites (creation and
// later optimization) share one real API call, not two copies.
async function addCampaignNegativeKeywords(
  campaignResourceName: string,
  negativeKeywords: readonly string[],
  customerId: string,
  options: GoogleAdsCallOptions,
): Promise<void> {
  await addNegativeKeywordsToExistingCampaign(campaignResourceName, negativeKeywords, customerId, "EXACT", options);
}

// Geo + language targeting via CampaignCriterion — until this point
// buildPausedSearchCampaign created campaigns with no location/language
// targeting at all, which for a real launch means "wrong audience", not
// just "less optimal". Callers pass resource names directly
// (geoTargetConstants/<id>, languageConstants/<id> — e.g. "1011969" for
// Moscow, "1000" for Russian) rather than free-text region names: Google
// requires the resolved constant, and guessing the right one from a city
// name is a separate lookup (GeoTargetConstantService.suggestGeoTargetConstants)
// not implemented here.
async function addGeoAndLanguageTargeting(
  campaignResourceName: string,
  targeting: { readonly geoTargetConstants?: readonly string[]; readonly languageConstants?: readonly string[] },
  customerId: string,
  options: GoogleAdsCallOptions,
): Promise<void> {
  const operations = [
    ...(targeting.geoTargetConstants ?? []).map((resourceName) => ({
      create: { campaign: campaignResourceName, location: { geoTargetConstant: resourceName } },
    })),
    ...(targeting.languageConstants ?? []).map((resourceName) => ({
      create: { campaign: campaignResourceName, language: { languageConstant: resourceName } },
    })),
  ];
  if (operations.length === 0) return;
  await callGoogleAds(customerId, "/campaignCriteria:mutate", { operations }, options);
}

export interface Sitelink {
  readonly text: string; // ≤25 chars
  readonly finalUrl: string;
}

// Sitelinks/callouts are campaign-level extensions here (not per-ad-group)
// — same reasoning as negative keywords above. Uses the v25 asset +
// campaignAsset two-step: create the asset, then link it to the campaign
// with the right AssetFieldType.
async function addSitelinksAndCallouts(
  campaignResourceName: string,
  extras: { readonly sitelinks?: readonly Sitelink[]; readonly callouts?: readonly string[] },
  customerId: string,
  options: GoogleAdsCallOptions,
): Promise<void> {
  const assetOps = [
    ...(extras.sitelinks ?? []).map((s) => ({
      create: { sitelinkAsset: { linkText: s.text, finalUrls: [s.finalUrl] } },
    })),
    ...(extras.callouts ?? []).map((text) => ({
      create: { calloutAsset: { calloutText: text } },
    })),
  ];
  if (assetOps.length === 0) return;

  const assetData = (await callGoogleAds(customerId, "/assets:mutate", { operations: assetOps }, options)) as {
    results: ReadonlyArray<{ resourceName: string }>;
  };

  const sitelinkCount = extras.sitelinks?.length ?? 0;
  const campaignAssetOps = assetData.results.map((r, i) => ({
    create: {
      campaign: campaignResourceName,
      asset: r.resourceName,
      fieldType: i < sitelinkCount ? "SITELINK" : "CALLOUT",
    },
  }));
  await callGoogleAds(customerId, "/campaignAssets:mutate", { operations: campaignAssetOps }, options);
}

export interface ResponsiveSearchAdCopy {
  readonly headlines: readonly string[]; // Google requires 3–15, each ≤30 chars
  readonly descriptions: readonly string[]; // Google requires 2–4, each ≤90 chars
}

async function createResponsiveSearchAd(
  adGroupResourceName: string,
  finalUrl: string,
  copy: ResponsiveSearchAdCopy,
  customerId: string,
  options: GoogleAdsCallOptions,
): Promise<void> {
  // Validated here, not just left to the API's error, so a caller gets a
  // clear reason instead of a raw 400 buried in a mutate response — Google
  // rejects an RSA outside these bounds either way.
  if (copy.headlines.length < 3) {
    throw new Error(`Responsive Search Ad needs at least 3 headlines, got ${copy.headlines.length}`);
  }
  if (copy.descriptions.length < 2) {
    throw new Error(`Responsive Search Ad needs at least 2 descriptions, got ${copy.descriptions.length}`);
  }
  await callGoogleAds(
    customerId,
    "/adGroupAds:mutate",
    {
      operations: [
        {
          create: {
            adGroup: adGroupResourceName,
            status: "PAUSED",
            ad: {
              finalUrls: [finalUrl],
              responsiveSearchAd: {
                headlines: copy.headlines.slice(0, 15).map((text) => ({ text })),
                descriptions: copy.descriptions.slice(0, 4).map((text) => ({ text })),
              },
            },
          },
        },
      ],
    },
    options,
  );
}

export interface SearchCampaignTargeting {
  readonly keywords: readonly string[];
  readonly adCopy: ResponsiveSearchAdCopy;
  readonly finalUrl: string;
  // All optional and additive — omitting any of these preserves the exact
  // prior behavior (empty campaign-level negatives/extensions/geo).
  readonly negativeKeywords?: readonly string[];
  readonly sitelinks?: readonly Sitelink[];
  readonly callouts?: readonly string[];
  readonly geoTargetConstants?: readonly string[]; // e.g. ["geoTargetConstants/1011969"] for Moscow
  readonly languageConstants?: readonly string[]; // e.g. ["languageConstants/1000"] for Russian
}

export interface BuiltSearchCampaign {
  readonly campaignResourceName: string;
  readonly adGroupResourceName: string;
  readonly reused: boolean; // true if either the campaign or the ad group already existed — nothing new was created in that case
  readonly rejectedKeywords: readonly string[]; // keywords Google rejected (policy/moderation) — empty when nothing was, or the ad group was reused
}

// Pure, offline preview of what buildPausedSearchCampaign would send —
// zero network calls, so it's safe to show a human before committing to
// the real thing (ported pattern: PPC Master Tool's campaign-creation
// scripts print this same kind of plan under a --dry-run flag instead of
// calling the API). Deliberately doesn't check for an existing
// campaign/ad group by the same name — that check itself requires a real
// API read, and a preview's whole point is running with zero
// preconditions. Callers that need an accurate reused/not-reused verdict
// still have to call buildPausedSearchCampaign for real.
export function previewSearchCampaign(
  name: string,
  budgetShare: number,
  targeting: SearchCampaignTargeting,
): {
  readonly campaign: { readonly name: string; readonly dailyBudgetMicros: number };
  readonly adGroup: { readonly name: string; readonly keywordCount: number; readonly keywords: readonly string[] };
  readonly ad: ResponsiveSearchAdCopy & { readonly finalUrl: string };
  readonly negativeKeywords: readonly string[];
  readonly sitelinks: readonly Sitelink[];
  readonly callouts: readonly string[];
  readonly geoTargetConstants: readonly string[];
  readonly languageConstants: readonly string[];
} {
  const dailyBudgetMicros = Math.max(
    MIN_DAILY_BUDGET_MICROS,
    Math.round(DEFAULT_TOTAL_DAILY_BUDGET_MICROS * budgetShare),
  );
  return {
    campaign: { name, dailyBudgetMicros },
    adGroup: { name: `${name} — Ad Group`, keywordCount: targeting.keywords.length, keywords: targeting.keywords },
    ad: { ...targeting.adCopy, finalUrl: targeting.finalUrl },
    negativeKeywords: targeting.negativeKeywords ?? [],
    sitelinks: targeting.sitelinks ?? [],
    callouts: targeting.callouts ?? [],
    geoTargetConstants: targeting.geoTargetConstants ?? [],
    languageConstants: targeting.languageConstants ?? [],
  };
}

// The real, non-empty version of createOrReusePausedCampaign: campaign +
// one ad group + keywords + one Responsive Search Ad, all idempotent by
// name so re-running the same Task doesn't duplicate anything. Everything
// stays PAUSED end to end — see the module comment at the top of this file.
export async function buildPausedSearchCampaign(
  name: string,
  budgetShare: number,
  targeting: SearchCampaignTargeting,
  customerId?: string,
  options: GoogleAdsCallOptions = { loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID },
): Promise<BuiltSearchCampaign> {
  const resolvedCustomerId = resolveCustomerId(customerId);
  const campaign = await createOrReusePausedCampaign(name, budgetShare, resolvedCustomerId, options);
  const campaignId = campaign.campaignResourceName.split("/").pop();
  if (!campaignId) throw new Error(`Could not parse campaign id from ${campaign.campaignResourceName}`);

  const adGroupName = `${name} — Ad Group`;
  const existingAdGroup = await findAdGroupByName(campaignId, adGroupName, resolvedCustomerId, options);
  if (existingAdGroup) {
    return {
      campaignResourceName: campaign.campaignResourceName,
      adGroupResourceName: existingAdGroup.resourceName,
      reused: true,
      rejectedKeywords: [],
    };
  }

  const adGroupResourceName = await createAdGroup(campaign.campaignResourceName, adGroupName, resolvedCustomerId, options);
  const rejectedKeywords = await addKeywords(adGroupResourceName, targeting.keywords, resolvedCustomerId, options);
  await createResponsiveSearchAd(adGroupResourceName, targeting.finalUrl, targeting.adCopy, resolvedCustomerId, options);

  // Only meaningful on a freshly created campaign — a reused campaign
  // (campaign.reused === true, checked inside createOrReusePausedCampaign)
  // already has whatever negatives/extensions/geo it was given the first
  // time, and re-applying here would either duplicate them or is simply
  // redundant work against the same idempotency guarantee the rest of
  // this function relies on.
  if (!campaign.reused) {
    if (targeting.negativeKeywords?.length) {
      await addCampaignNegativeKeywords(campaign.campaignResourceName, targeting.negativeKeywords, resolvedCustomerId, options);
    }
    if (targeting.sitelinks?.length || targeting.callouts?.length) {
      await addSitelinksAndCallouts(
        campaign.campaignResourceName,
        { sitelinks: targeting.sitelinks, callouts: targeting.callouts },
        resolvedCustomerId,
        options,
      );
    }
    if (targeting.geoTargetConstants?.length || targeting.languageConstants?.length) {
      await addGeoAndLanguageTargeting(
        campaign.campaignResourceName,
        { geoTargetConstants: targeting.geoTargetConstants, languageConstants: targeting.languageConstants },
        resolvedCustomerId,
        options,
      );
    }
  }

  return { campaignResourceName: campaign.campaignResourceName, adGroupResourceName, reused: false, rejectedKeywords };
}

export interface AdGroupTargeting {
  readonly name: string;
  readonly keywords: readonly string[];
  readonly adCopy: ResponsiveSearchAdCopy;
}

export interface BuiltAdGroup {
  readonly name: string;
  readonly adGroupResourceName: string;
  readonly reused: boolean;
  readonly rejectedKeywords: readonly string[];
}

export interface MultiGroupSearchCampaign {
  readonly campaignResourceName: string;
  readonly reused: boolean;
  readonly adGroups: readonly BuiltAdGroup[];
}

// The real "several ad groups by intent under one campaign" structure —
// ported from PPC Master Tool's scripts/create_google_gastro.py, which
// used exactly this shape (Campaign → 3 AdGroups → keywords + one RSA
// each) to build a real МедАвеню campaign (customer 9714539590,
// "Гастроэнтеролог"). buildPausedSearchCampaign above only ever builds ONE
// ad group per call — this is the multi-group generalization
// packages/agents/ppc's PpcSetupResult needed (see
// docs/07-planning/backlog.md #31 and the schema change in
// packages/agents/ppc/src/ppc-agent.ts) to express "имплантация" and
// "протезирование" as separate ad groups under the same campaign instead
// of flattening every direction into a single keyword list. Reuses the
// same private helpers as buildPausedSearchCampaign — same idempotency,
// same PAUSED-throughout guarantee.
export async function buildMultiGroupSearchCampaign(
  name: string,
  budgetShare: number,
  finalUrl: string,
  adGroups: readonly AdGroupTargeting[],
  extras: {
    readonly negativeKeywords?: readonly string[];
    readonly sitelinks?: readonly Sitelink[];
    readonly callouts?: readonly string[];
    readonly geoTargetConstants?: readonly string[];
    readonly languageConstants?: readonly string[];
  } = {},
  customerId?: string,
  options: GoogleAdsCallOptions = { loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID },
): Promise<MultiGroupSearchCampaign> {
  const resolvedCustomerId = resolveCustomerId(customerId);
  const campaign = await createOrReusePausedCampaign(name, budgetShare, resolvedCustomerId, options);
  const campaignId = campaign.campaignResourceName.split("/").pop();
  if (!campaignId) throw new Error(`Could not parse campaign id from ${campaign.campaignResourceName}`);

  const results: BuiltAdGroup[] = [];
  for (const group of adGroups) {
    const existingAdGroup = await findAdGroupByName(campaignId, group.name, resolvedCustomerId, options);
    if (existingAdGroup) {
      results.push({ name: group.name, adGroupResourceName: existingAdGroup.resourceName, reused: true, rejectedKeywords: [] });
      continue;
    }
    const adGroupResourceName = await createAdGroup(campaign.campaignResourceName, group.name, resolvedCustomerId, options);
    const rejectedKeywords = await addKeywords(adGroupResourceName, group.keywords, resolvedCustomerId, options);
    await createResponsiveSearchAd(adGroupResourceName, finalUrl, group.adCopy, resolvedCustomerId, options);
    results.push({ name: group.name, adGroupResourceName, reused: false, rejectedKeywords });
  }

  // Only meaningful on a freshly created campaign — same reasoning as
  // buildPausedSearchCampaign: a reused campaign already has whatever
  // negatives/extensions/geo it was given the first time.
  if (!campaign.reused) {
    if (extras.negativeKeywords?.length) {
      await addCampaignNegativeKeywords(campaign.campaignResourceName, extras.negativeKeywords, resolvedCustomerId, options);
    }
    if (extras.sitelinks?.length || extras.callouts?.length) {
      await addSitelinksAndCallouts(campaign.campaignResourceName, extras, resolvedCustomerId, options);
    }
    if (extras.geoTargetConstants?.length || extras.languageConstants?.length) {
      await addGeoAndLanguageTargeting(campaign.campaignResourceName, extras, resolvedCustomerId, options);
    }
  }

  return { campaignResourceName: campaign.campaignResourceName, reused: campaign.reused, adGroups: results };
}

// ---------------------------------------------------------------------
// Existing-campaign optimization writes (2026-08-30, Track B / backlog
// campaign-optimization plan). Everything above this point only ever
// creates NEW campaigns; a live campaign already running for a real client
// had no write path at all until now. These close that gap for
// packages/agents/ppc's "apply" action — it only ever calls these against
// campaign_changes_log rows already status='approved' by a human (see that
// package's own guard); nothing here enforces that itself, by design, the
// same "campaign always created PAUSED" pattern as the rest of this file:
// safety lives at the call site that decides *whether* to call, not inside
// the API wrapper.
// ---------------------------------------------------------------------

// Budget/bid changes are naturally idempotent (setting the same value twice
// is a no-op on Google's side) — unlike addNegativeKeywordsToExistingCampaign
// above, no separate idempotency note needed here.
export async function adjustCampaignBudget(
  campaignBudgetResourceName: string,
  newAmountMicros: number,
  customerId: string,
  options: GoogleAdsCallOptions = {},
): Promise<{ readonly resourceName: string }> {
  const data = (await callGoogleAds(
    customerId,
    "/campaignBudgets:mutate",
    {
      operations: [
        {
          update: { resourceName: campaignBudgetResourceName, amountMicros: String(newAmountMicros) },
          updateMask: "amountMicros",
        },
      ],
    },
    options,
  )) as { results: ReadonlyArray<{ resourceName: string }> };
  return { resourceName: data.results[0].resourceName };
}

export async function adjustAdGroupCriterionBid(
  adGroupCriterionResourceName: string,
  newCpcBidMicros: number,
  customerId: string,
  options: GoogleAdsCallOptions = {},
): Promise<{ readonly resourceName: string }> {
  const data = (await callGoogleAds(
    customerId,
    "/adGroupCriteria:mutate",
    {
      operations: [
        {
          update: { resourceName: adGroupCriterionResourceName, cpcBidMicros: String(newCpcBidMicros) },
          updateMask: "cpcBidMicros",
        },
      ],
    },
    options,
  )) as { results: ReadonlyArray<{ resourceName: string }> };
  return { resourceName: data.results[0].resourceName };
}

export async function setCampaignStatus(
  campaignResourceName: string,
  status: "ENABLED" | "PAUSED",
  customerId: string,
  options: GoogleAdsCallOptions = {},
): Promise<{ readonly resourceName: string }> {
  const data = (await callGoogleAds(
    customerId,
    "/campaigns:mutate",
    { operations: [{ update: { resourceName: campaignResourceName, status }, updateMask: "status" }] },
    options,
  )) as { results: ReadonlyArray<{ resourceName: string }> };
  return { resourceName: data.results[0].resourceName };
}
