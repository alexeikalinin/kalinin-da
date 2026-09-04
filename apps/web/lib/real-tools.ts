import { ToolUnavailableError, type ToolInvoker } from "@ama/tools";
import { readSiteContent } from "./tools/site-reader.ts";
import { isPerplexityConfigured, searchWeb } from "./tools/web-search.ts";
import {
  adjustAdGroupCriterionBid,
  adjustCampaignBudget,
  addNegativeKeywordsToExistingCampaign,
  buildMultiGroupSearchCampaign,
  buildPausedSearchCampaign,
  createOrReusePausedCampaign,
  getAccountCurrency as getGoogleAdsAccountCurrency,
  getCampaignReport as getGoogleAdsCampaignReport,
  getImpressionShareReport as getGoogleAdsImpressionShareReport,
  getKeywordIdeas,
  getSearchTermsReport as getGoogleAdsSearchTermsReport,
  isGoogleAdsConfigured,
  listCampaigns as listGoogleAdsCampaigns,
  listGa4ImportCandidates,
  setCampaignStatus as setGoogleAdsCampaignStatus,
  type NegativeKeywordMatchType,
} from "./tools/google-ads.ts";
import {
  isGoogleAnalyticsConfigured,
  linkToGoogleAds,
  markKeyEvent,
  provisionAnalyticsProperty,
} from "./tools/google-analytics.ts";
import { isGoogleTagManagerConfigured, provisionContainerWithGa4Tag } from "./tools/google-tag-manager.ts";
import {
  addNegativeKeywords as addYandexNegativeKeywords,
  adjustWeeklySpendLimit,
  buildMultiGroupSearchCampaign as buildMultiGroupDirectCampaign,
  createOrReusePausedCampaign as createOrReuseYandexCampaign,
  getAccountCurrency as getYandexAccountCurrency,
  getCampaignReport as getYandexCampaignReport,
  getDailyBudget,
  getKeywordBids,
  getSearchTermsReport as getYandexSearchTermsReport,
  getWeeklySpendLimit,
  isYandexConfigured,
  listCampaigns as listYandexCampaigns,
  setCampaignStatus as setYandexCampaignStatus,
  type YandexCampaignType,
  type YandexNetworkBiddingStrategy,
  type YandexSearchBiddingStrategy,
} from "./tools/yandex-direct.ts";
import { createOrReusePausedCampaign as createOrReuseMetaCampaign, isMetaAdsConfigured } from "./tools/meta-ads.ts";
import {
  adjustCampaignBudget as adjustOpenAiAdsCampaignBudget,
  createOrReusePausedCampaign as createOrReuseOpenAiAdsCampaign,
  getAdInsights as getOpenAiAdsInsights,
  isOpenAiAdsConfigured,
  listCampaigns as listOpenAiAdsCampaigns,
  sendConversionEvents,
  setCampaignStatus as setOpenAiAdsCampaignStatus,
  verifyAdAccountAccess,
  type OpenAiAdsBiddingType,
  type OpenAiAdsCampaignTargeting,
  type OpenAiAdsConversionEvent,
} from "./tools/openai-ads.ts";
import { createOrReusePausedCampaign as createOrReuseVkCampaign, isVkAdsConfigured } from "./tools/vk-ads.ts";
import { createGoal, provisionCounter } from "./tools/yandex-metrika.ts";
import { isDataLensConfigured, provisionWorkbook } from "./tools/datalens.ts";
import { generateCreativeAssets, isCreativeGenerationConfigured } from "./tools/creative-generation.ts";
import { getClientContext, isSupabaseConfigured } from "./tools/client-context.ts";
import { getSeoInsights, isSeoServiceConfigured } from "./tools/seo-service.ts";
import {
  addDecisionMaker,
  addResearchFacts,
  addToSuppressionList,
  createOutreachDraft,
  createProspectAgency,
  getDecisionMakers,
  getOutreachMessage,
  getProspectAgency,
  getResearchFacts,
  isSuppressed,
  listOutreachMessagesByStatus,
  recordLeadScore,
  recordReplyClassification,
  updateOutreachMessageStatus,
  updateProspectStatus,
} from "./tools/prospect-store.ts";
import { deployArtifact, isVercelDeployConfigured } from "./tools/vercel-deploy.ts";
import { isResendConfigured, isSendingDomainVerified, sendOutreachEmail } from "./tools/email-provider.ts";
import {
  getCampaignChange,
  listCampaignChanges,
  listUnverifiedAppliedChanges,
  proposeCampaignChange,
  recordVerification,
  updateCampaignChangeStatus,
} from "./tools/campaign-changes-store.ts";
import { detectSustainedDegradation, getWeeklyCampaignHistory } from "./campaign-trends.ts";
import { generateDesign, isV0Configured } from "./tools/v0-design.ts";
import { getWordstatFrequency, isWordstatConfigured, type WordstatResult } from "./tools/yandex-wordstat.ts";

// Real ToolInvoker (packages/tools/src/invoke.ts) for the tools that have
// a genuine implementation today — mirrors real-models.ts's one-dispatcher-
// per-concern shape. Every other toolId still has no real implementation;
// orchestrator.ts keeps those roles on their own inline fake closures until
// this dispatcher grows a case for them.
export const realToolInvoker: ToolInvoker = async (toolId, args) => {
  switch (toolId) {
    case "site-reader": {
      const { url } = args as { url: string };
      try {
        return await readSiteContent(url);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "web-search": {
      const { query } = args as { query: string };
      if (!isPerplexityConfigured()) return "tool output"; // graceful degrade, no key configured
      try {
        return await searchWeb(query);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "google-ads": {
      const {
        budgetShare, googleAdsCustomerId, keywords, adCopy, siteUrl, negativeKeywords, sitelinks, callouts,
        campaignPlans, geoTargetConstants, languageConstants,
      } = args as {
        budgetShare: number;
        googleAdsCustomerId?: string;
        // Present only when PPC's model output actually produced targeting
        // for this channel (real-models.ts's realPpc) — falls back to the
        // empty-shell campaign below when it didn't, rather than failing.
        keywords?: readonly string[];
        adCopy?: { headlines: readonly string[]; descriptions: readonly string[] };
        siteUrl?: string;
        negativeKeywords?: readonly string[];
        sitelinks?: readonly { text: string; finalUrl: string }[];
        callouts?: readonly string[];
        // Preferred path (2026-09-02): one real campaign per direction,
        // each with several ad groups by intent — see ppc-agent.ts's
        // PpcDirectionCampaignPlan and google-ads.ts's
        // buildMultiGroupSearchCampaign.
        campaignPlans?: ReadonlyArray<{
          readonly name: string;
          readonly budgetShare: number;
          readonly adGroups: ReadonlyArray<{ readonly name: string; readonly keywords: readonly string[]; readonly headlines: readonly string[]; readonly descriptions: readonly string[] }>;
        }>;
        geoTargetConstants?: readonly string[];
        languageConstants?: readonly string[];
      };
      if (!isGoogleAdsConfigured()) return "configured"; // graceful degrade, no credentials configured
      try {
        const today = new Date().toISOString().slice(0, 10);
        if (campaignPlans?.length && siteUrl) {
          const built = [];
          for (const plan of campaignPlans) {
            built.push(
              await buildMultiGroupSearchCampaign(
                `AMA Auto — ${today} — google-ads — ${plan.name}`,
                budgetShare * plan.budgetShare,
                siteUrl,
                plan.adGroups.map((g) => ({ name: g.name, keywords: g.keywords, adCopy: { headlines: g.headlines, descriptions: g.descriptions } })),
                { negativeKeywords, sitelinks, callouts, geoTargetConstants, languageConstants },
                googleAdsCustomerId,
              ),
            );
          }
          return built;
        }
        const name = `AMA Auto — ${today} — google-ads`;
        if (keywords?.length && adCopy?.headlines?.length && adCopy.descriptions?.length && siteUrl) {
          const built = await buildPausedSearchCampaign(
            name,
            budgetShare,
            { keywords, adCopy, finalUrl: siteUrl, negativeKeywords, sitelinks, callouts, geoTargetConstants, languageConstants },
            googleAdsCustomerId,
          );
          // Real search-volume/bid grounding attached after the fact —
          // read-only, informational for whoever reviews the paused
          // campaign (QA/Report/a human), not fed back into what PPC
          // already decided (that would need keywords known before the
          // model call, the same "site before query" restructuring
          // research-agent.ts got on 2026-08-27 — out of scope here).
          let keywordIdeas: unknown = undefined;
          const customerIdForLookup = googleAdsCustomerId ?? process.env.GOOGLE_ADS_CUSTOMER_ID;
          if (customerIdForLookup) {
            try {
              keywordIdeas = await getKeywordIdeas(keywords, customerIdForLookup);
            } catch {
              // Best-effort enrichment — the campaign itself already
              // succeeded above, this must not fail the Task.
            }
          }
          return { ...built, keywordIdeas };
        }
        return await createOrReusePausedCampaign(name, budgetShare, googleAdsCustomerId);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "keyword-volume": {
      // Real search-volume grounding, fetched BEFORE PPC's model call
      // decides keywords/ad copy (ppc-agent.ts's handleSetup) — the fix for
      // the exact gap the "google-ads" case above documents at its own
      // getKeywordIdeas call: that one is post-hoc decoration on an
      // already-built campaign; this one grounds the decision itself.
      // Deliberately retries each source a few times before giving up on
      // it — a single transient failure must not silently degrade PPC back
      // to inventing keywords blind, per the Owner's explicit call
      // (2026-09-03). Google and Yandex are attempted independently: one
      // source's exhausted retries don't block the other's attempt.
      const { seedKeywords, channels, googleAdsCustomerId, geoTargetConstants, languageConstants, regionIds } = args as {
        seedKeywords: readonly string[];
        channels: readonly string[];
        googleAdsCustomerId?: string;
        geoTargetConstants?: readonly string[];
        languageConstants?: readonly string[];
        regionIds?: readonly number[];
      };

      const wantGoogle = channels.includes("google-ads");
      const wantYandex = channels.includes("yandex-direct");
      const failures: string[] = [];

      let google: unknown;
      if (wantGoogle) {
        const customerIdForLookup = googleAdsCustomerId ?? process.env.GOOGLE_ADS_CUSTOMER_ID;
        if (!isGoogleAdsConfigured() || !customerIdForLookup) {
          failures.push("google-ads: no credentials/customer id configured");
        } else {
          try {
            google = await retry(
              () =>
                getKeywordIdeas(seedKeywords, customerIdForLookup, {
                  geoTargetConstants,
                  languageConstant: languageConstants?.[0],
                }),
              3,
            );
          } catch (error) {
            failures.push(`google-ads: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      let yandex: unknown;
      if (wantYandex) {
        if (!isWordstatConfigured()) {
          failures.push("yandex-direct: Wordstat not configured (YANDEX_SEARCH_API_KEY/YANDEX_SEARCH_API_FOLDER_ID)");
        } else {
          try {
            const regionIdStrings = regionIds?.map(String) ?? [];
            const perSeed: Array<{ readonly seed: string } & WordstatResult> = [];
            for (const seed of seedKeywords) {
              perSeed.push({ seed, ...(await retry(() => getWordstatFrequency(seed, regionIdStrings), 3)) });
            }
            yandex = perSeed;
          } catch (error) {
            failures.push(`yandex-direct: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      // Fail the Task only if every requested source ended up unusable —
      // never silently return nothing while a channel was actually asked
      // for (that would be the exact bug this tool exists to prevent).
      const requestedSources = [wantGoogle, wantYandex].filter(Boolean).length;
      if (requestedSources > 0 && failures.length === requestedSources) {
        throw new ToolUnavailableError(`keyword-volume: all requested sources failed — ${failures.join("; ")}`);
      }

      return { google, yandex };
    }
    case "vk-ads": {
      const { siteUrl } = args as { siteUrl: string };
      if (!isVkAdsConfigured()) return "configured"; // graceful degrade, no credentials configured
      try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await createOrReuseVkCampaign(`AMA Auto — ${today} — vk-ads`, siteUrl);
        return result;
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "meta-ads": {
      const { metaAdAccountId } = args as { metaAdAccountId?: string };
      if (!isMetaAdsConfigured()) return "configured"; // graceful degrade, no credentials configured
      try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await createOrReuseMetaCampaign(`AMA Auto — ${today} — meta-ads`, metaAdAccountId);
        return result;
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    // OpenAI Ads (ChatGPT Ads) — docs/openai-ads-integration-research.md.
    // No keyword-driven multi-group builder like google-ads/yandex-direct:
    // this platform's campaigns target locations/custom_audiences, not
    // keywords, so there is no equivalent structure for a PPC agent to
    // fill in yet. This case only ever creates an empty, paused campaign
    // shell; read/write against an existing campaign lives in the
    // "openai-ads-optimize" action-dispatch case below, mirroring
    // "yandex-direct-optimize"'s split from "yandex-direct".
    case "openai-ads": {
      const { name, biddingType, lifetimeSpendLimitMicros, targeting, apiKeyEnv } = args as {
        name: string;
        biddingType: OpenAiAdsBiddingType;
        lifetimeSpendLimitMicros: number;
        targeting?: OpenAiAdsCampaignTargeting;
        apiKeyEnv?: string;
      };
      if (!isOpenAiAdsConfigured(apiKeyEnv)) return "configured"; // graceful degrade, no credentials configured
      try {
        return await createOrReuseOpenAiAdsCampaign({ name, biddingType, lifetimeSpendLimitMicros, targeting }, apiKeyEnv);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "openai-ads-optimize": {
      const { action, apiKeyEnv, ...rest } = args as { action: string; apiKeyEnv?: string; [key: string]: unknown };
      if (!isOpenAiAdsConfigured(apiKeyEnv)) return { note: "OpenAI Ads not configured — no change was applied." };
      try {
        switch (action) {
          case "verifyAdAccountAccess":
            return await verifyAdAccountAccess(apiKeyEnv);
          case "listCampaigns":
            return await listOpenAiAdsCampaigns(apiKeyEnv);
          case "setCampaignStatus": {
            const { campaignId, status } = rest as { campaignId: string; status: "activate" | "pause" | "archive" };
            return await setOpenAiAdsCampaignStatus(campaignId, status, apiKeyEnv);
          }
          case "adjustCampaignBudget": {
            const { campaignId, lifetimeSpendLimitMicros } = rest as { campaignId: string; lifetimeSpendLimitMicros: number };
            return await adjustOpenAiAdsCampaignBudget(campaignId, lifetimeSpendLimitMicros, apiKeyEnv);
          }
          case "getAdInsights": {
            const { adId } = rest as { adId: string };
            return await getOpenAiAdsInsights(adId, apiKeyEnv);
          }
          case "sendConversionEvents": {
            const { pixelId, events } = rest as { pixelId: string; events: readonly OpenAiAdsConversionEvent[] };
            await sendConversionEvents(pixelId, events, apiKeyEnv);
            return { sent: events.length };
          }
          default:
            throw new Error(`openai-ads-optimize: unknown action "${action}"`);
        }
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "yandex-direct": {
      const {
        budgetShare, yandexClientLogin, siteUrl, campaignPlans, regionIds, yandexCampaignType, yandexCampaignTypeFields,
      } = args as {
        budgetShare: number;
        yandexClientLogin?: string;
        siteUrl?: string;
        // Preferred path (2026-09-02) — see the "google-ads" case above and
        // yandex-direct.ts's buildMultiGroupSearchCampaign. Previously
        // Яндекс.Директ had no write path for ad groups/keywords/ads at
        // all (backlog #30) — this is that path, ported from PPC Master
        // Tool's scripts/draft_campaigns_setup.py.
        campaignPlans?: ReadonlyArray<{
          readonly name: string;
          readonly budgetShare: number;
          readonly adGroups: ReadonlyArray<{ readonly name: string; readonly keywords: readonly string[]; readonly headlines: readonly string[]; readonly descriptions: readonly string[] }>;
          // Per-direction bidding strategy override, 2026-09-02 — see
          // ppc-agent.ts's PpcYandexBiddingStrategy/PpcDirectionCampaignPlan.
          readonly yandexSearchStrategy?: YandexSearchBiddingStrategy;
          readonly yandexNetworkStrategy?: YandexNetworkBiddingStrategy;
        }>;
        regionIds?: readonly number[];
        // Flat-path campaign type selection, 2026-09-02 — see
        // ppc-agent.ts's PpcSetupPayload and yandex-direct.ts's
        // YandexCampaignType/createOrReusePausedCampaign.
        yandexCampaignType?: YandexCampaignType;
        yandexCampaignTypeFields?: Record<string, unknown>;
      };
      if (!isYandexConfigured()) return "configured"; // graceful degrade, no credentials configured
      try {
        const today = new Date().toISOString().slice(0, 10);
        if (campaignPlans?.length && siteUrl) {
          const built = [];
          for (const plan of campaignPlans) {
            built.push(
              await buildMultiGroupDirectCampaign(
                `AMA Auto — ${today} — yandex-direct — ${plan.name}`,
                budgetShare * plan.budgetShare,
                siteUrl,
                regionIds ?? [],
                plan.adGroups.map((g) => ({
                  name: g.name,
                  keywords: g.keywords,
                  adCopy: { title: (g.headlines[0] ?? "").slice(0, 56), title2: g.headlines[1]?.slice(0, 30), text: (g.descriptions[0] ?? "").slice(0, 81) },
                })),
                yandexClientLogin,
                undefined,
                { searchStrategy: plan.yandexSearchStrategy, networkStrategy: plan.yandexNetworkStrategy },
              ),
            );
          }
          return built;
        }
        const result = await createOrReuseYandexCampaign(
          `AMA Auto — ${today} — yandex-direct`,
          budgetShare,
          yandexClientLogin,
          yandexCampaignType || yandexCampaignTypeFields
            ? { campaignType: yandexCampaignType, campaignTypeFields: yandexCampaignTypeFields }
            : undefined,
        );
        return result;
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    // Separate toolId from "google-ads" on purpose (Plan §1.4): the
    // creation-time role (ppc-agent's "setup" action) and the
    // optimization-time role (its "apply" action, against a live client
    // campaign) hold distinct tool grants, so a grep for which agents can
    // write to a LIVE campaign never has to also read create-only code.
    // One toolId fronting four operations, same dispatch-by-action shape
    // as "prospect-store" above — these are narrow writes on the same
    // credential, not separate external systems.
    case "google-ads-optimize": {
      if (!isGoogleAdsConfigured()) return { note: "Google Ads not configured — no change was applied." };
      const { action, customerId, ...rest } = args as { action: string; customerId: string; [key: string]: unknown };
      try {
        switch (action) {
          case "adjustCampaignBudget": {
            const { campaignBudgetResourceName, newAmountMicros } = rest as {
              campaignBudgetResourceName: string;
              newAmountMicros: number;
            };
            return await adjustCampaignBudget(campaignBudgetResourceName, newAmountMicros, customerId);
          }
          case "addNegativeKeywords": {
            const { campaignResourceName, keywords, matchType } = rest as {
              campaignResourceName: string;
              keywords: readonly string[];
              matchType?: NegativeKeywordMatchType;
            };
            return await addNegativeKeywordsToExistingCampaign(campaignResourceName, keywords, customerId, matchType);
          }
          case "adjustBid": {
            const { adGroupCriterionResourceName, newCpcBidMicros } = rest as {
              adGroupCriterionResourceName: string;
              newCpcBidMicros: number;
            };
            return await adjustAdGroupCriterionBid(adGroupCriterionResourceName, newCpcBidMicros, customerId);
          }
          case "setStatus": {
            const { campaignResourceName, status } = rest as { campaignResourceName: string; status: "ENABLED" | "PAUSED" };
            return await setGoogleAdsCampaignStatus(campaignResourceName, status, customerId);
          }
          // Read actions — same credential/customerId as the write actions
          // above, added here (rather than routing "recommend"/"verify"
          // through the creation-oriented "google-ads" toolId) so every
          // Track B read+write for Google Ads lives behind one tool grant.
          case "listCampaigns":
            return await listGoogleAdsCampaigns(customerId);
          case "getCampaignReport": {
            const { startDate, endDate, conversionActionIds } = rest as {
              startDate: string;
              endDate: string;
              conversionActionIds: readonly string[];
            };
            return await getGoogleAdsCampaignReport(customerId, { startDate, endDate, conversionActionIds });
          }
          // Added for the "recommend" action's negative-keyword mining and
          // scale-vs-optimize verdicts — see google-ads.ts's
          // getSearchTermsReport/getImpressionShareReport comments.
          case "getSearchTermsReport": {
            const { startDate, endDate } = rest as { startDate: string; endDate: string };
            return await getGoogleAdsSearchTermsReport(customerId, { startDate, endDate });
          }
          case "getImpressionShareReport": {
            const { startDate, endDate } = rest as { startDate: string; endDate: string };
            return await getGoogleAdsImpressionShareReport(customerId, { startDate, endDate });
          }
          case "getAccountCurrency":
            return await getGoogleAdsAccountCurrency(customerId);
          default:
            throw new Error(`google-ads-optimize: unknown action "${action}"`);
        }
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "yandex-direct-optimize": {
      if (!isYandexConfigured()) return { note: "Yandex Direct not configured — no change was applied." };
      const { action, clientLogin, ...rest } = args as { action: string; clientLogin?: string; [key: string]: unknown };
      try {
        switch (action) {
          case "getWeeklySpendLimit": {
            const { campaignId } = rest as { campaignId: number };
            return await getWeeklySpendLimit(campaignId, clientLogin);
          }
          // Complements getWeeklySpendLimit — a campaign uses exactly one of
          // the two (fixed DailyBudget vs autostrategy WeeklySpendLimit),
          // never both. See yandex-direct.ts's getDailyBudget comment.
          case "getDailyBudget": {
            const { campaignId } = rest as { campaignId: number };
            return await getDailyBudget(campaignId, clientLogin);
          }
          case "adjustWeeklySpendLimit": {
            const { campaignId, newLimitMicros } = rest as { campaignId: number; newLimitMicros: number };
            await adjustWeeklySpendLimit(campaignId, newLimitMicros, clientLogin);
            return { ok: true };
          }
          case "getKeywordBids": {
            const { campaignId } = rest as { campaignId: number };
            return await getKeywordBids(campaignId, clientLogin);
          }
          case "addNegativeKeywords": {
            const { campaignId, keywords } = rest as { campaignId: number; keywords: readonly string[] };
            return await addYandexNegativeKeywords(campaignId, keywords, clientLogin);
          }
          case "setStatus": {
            const { campaignId, status } = rest as { campaignId: number; status: "resume" | "suspend" };
            await setYandexCampaignStatus(campaignId, status, clientLogin);
            return { ok: true };
          }
          case "listCampaigns":
            return await listYandexCampaigns(clientLogin);
          case "getCampaignReport": {
            const { startDate, endDate, goalIds } = rest as { startDate: string; endDate: string; goalIds: readonly string[] };
            return await getYandexCampaignReport(clientLogin, { startDate, endDate, goalIds });
          }
          // Added for the "recommend" action's negative-keyword mining —
          // see yandex-direct.ts's getSearchTermsReport comment.
          case "getSearchTermsReport": {
            const { startDate, endDate, goalIds } = rest as { startDate: string; endDate: string; goalIds: readonly string[] };
            return await getYandexSearchTermsReport(clientLogin, { startDate, endDate, goalIds });
          }
          case "getAccountCurrency":
            return await getYandexAccountCurrency(clientLogin);
          default:
            throw new Error(`yandex-direct-optimize: unknown action "${action}"`);
        }
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "yandex-metrika": {
      const { projectDisplayName, siteUrl } = args as { projectDisplayName: string; siteUrl: string };
      if (!isYandexConfigured()) return { ctr: 0.05 }; // graceful degrade
      try {
        const counter = await provisionCounter(projectDisplayName, siteUrl);
        await createGoal(counter.counterId, "generate_lead");
        return {
          counterId: counter.counterId,
          note: "Tracking just provisioned — no traffic/conversion data exists yet.",
        };
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "google-analytics": {
      const { projectDisplayName, siteUrl, gtmAccountId, gaAccountId, googleAdsCustomerId } = args as {
        projectDisplayName: string;
        siteUrl: string;
        gtmAccountId?: string;
        gaAccountId?: string;
        googleAdsCustomerId?: string;
      };
      if (!isGoogleAnalyticsConfigured() || !isGoogleTagManagerConfigured()) return { ctr: 0.05 }; // graceful degrade
      try {
        const analytics = await provisionAnalyticsProperty(projectDisplayName, siteUrl, gaAccountId);
        await markKeyEvent(analytics.propertyName, "generate_lead");
        await linkToGoogleAds(analytics.propertyName, googleAdsCustomerId);
        const gtm = await provisionContainerWithGa4Tag(projectDisplayName, analytics.measurementId, gtmAccountId);
        // Google Ads API has no operation that finishes a GA4→Ads
        // conversion import (confirmed real API rejection — see
        // listGa4ImportCandidates's comment in google-ads.ts) — this is
        // the honest substitute: surface which events are already visible
        // to Ads and waiting on a human, instead of silently doing nothing.
        let ga4ImportCandidates: readonly { readonly id: string; readonly name: string }[] = [];
        const adsCustomerIdForLookup = googleAdsCustomerId ?? process.env.GOOGLE_ADS_CUSTOMER_ID;
        if (isGoogleAdsConfigured() && adsCustomerIdForLookup) {
          try {
            ga4ImportCandidates = await listGa4ImportCandidates(adsCustomerIdForLookup);
          } catch {
            // Best-effort — a fresh link can take time to propagate, and
            // this is informational, not the reason the Task should fail.
          }
        }
        return {
          propertyName: analytics.propertyName,
          measurementId: analytics.measurementId,
          gtmContainerId: gtm.publicId,
          ga4ImportCandidates,
          note:
            "Tracking just provisioned — no traffic/conversion data exists yet." +
            (ga4ImportCandidates.length
              ? ` ${ga4ImportCandidates.length} GA4 event(s) visible to Google Ads but not yet imported as conversions — finish manually: Ads → Goals and conversions → Conversion actions → + New → Import → Google Analytics 4 properties (no API path exists for this step).`
              : ""),
        };
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "datalens": {
      const { projectDisplayName } = args as { projectDisplayName: string };
      if (!isDataLensConfigured()) return { ctr: 0.05 }; // graceful degrade
      try {
        const workbook = await provisionWorkbook(projectDisplayName);
        return {
          workbookId: workbook.workbookId,
          note: "Workbook provisioned — datasets/charts/dashboards are not built yet, this is the container only.",
        };
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "client-context": {
      const { clientId } = args as { clientId: string };
      if (!isSupabaseConfigured()) return { note: "Supabase not configured — no approved target conversions or synced ad_stat available." };
      try {
        return await getClientContext(clientId);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "seo-service": {
      // SEO Agent (packages/agents/seo) only ever calls this with { url } —
      // it has no client_ad_account to resolve a customerId from at this
      // point, so this falls back to the agency's own Google Ads sandbox,
      // same convention google-ads.ts's own functions use when no
      // customerId is supplied.
      const { url, googleAdsCustomerId } = args as { url: string; googleAdsCustomerId?: string };
      const customerId = googleAdsCustomerId ?? process.env.GOOGLE_ADS_CUSTOMER_ID;
      if (!isSeoServiceConfigured() || !customerId) {
        return { note: "seo-service: Google Ads not configured — no keyword data available." };
      }
      try {
        return await getSeoInsights(url, customerId, {}, { loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID });
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    // One tool id fronting several Supabase CRUD operations (Track A's CRM
    // schema, 0008_crm_outreach.sql) — dispatched by args.action rather than
    // one toolId per operation, since these are narrow reads/writes on one
    // table family a role already holds the grant for (Plan §1: "prospect-
    // store"), not distinct external systems needing separate credentials.
    case "prospect-store": {
      if (!isSupabaseConfigured()) {
        return { note: "Supabase not configured — no prospect data available." };
      }
      const { action, ...rest } = args as { action: string; [key: string]: unknown };
      try {
        switch (action) {
          case "createProspectAgency":
            return await createProspectAgency(rest as unknown as Parameters<typeof createProspectAgency>[0]);
          case "getProspectAgency":
            return await getProspectAgency((rest as { prospectAgencyId: string }).prospectAgencyId);
          case "getOutreachMessage":
            return await getOutreachMessage((rest as { outreachMessageId: string }).outreachMessageId);
          case "updateProspectStatus": {
            const { prospectAgencyId, status, disqualifyReason } = rest as {
              prospectAgencyId: string;
              status: Parameters<typeof updateProspectStatus>[1];
              disqualifyReason?: string;
            };
            await updateProspectStatus(prospectAgencyId, status, disqualifyReason);
            return { ok: true };
          }
          case "addResearchFacts": {
            const { prospectAgencyId, facts } = rest as {
              prospectAgencyId: string;
              facts: Parameters<typeof addResearchFacts>[1];
            };
            await addResearchFacts(prospectAgencyId, facts);
            return { ok: true };
          }
          case "getResearchFacts":
            return await getResearchFacts((rest as { prospectAgencyId: string }).prospectAgencyId);
          case "addDecisionMaker": {
            const { prospectAgencyId, ...dm } = rest as unknown as { prospectAgencyId: string } & Parameters<typeof addDecisionMaker>[1];
            return await addDecisionMaker(prospectAgencyId, dm);
          }
          case "getDecisionMakers":
            return await getDecisionMakers((rest as { prospectAgencyId: string }).prospectAgencyId);
          case "recordLeadScore": {
            const { prospectAgencyId, ...score } = rest as unknown as { prospectAgencyId: string } & Parameters<typeof recordLeadScore>[1];
            await recordLeadScore(prospectAgencyId, score);
            return { ok: true };
          }
          case "createOutreachDraft":
            return await createOutreachDraft(rest as unknown as Parameters<typeof createOutreachDraft>[0]);
          case "updateOutreachMessageStatus": {
            const { outreachMessageId, status, ...extra } = rest as {
              outreachMessageId: string;
              status: Parameters<typeof updateOutreachMessageStatus>[1];
            } & NonNullable<Parameters<typeof updateOutreachMessageStatus>[2]>;
            await updateOutreachMessageStatus(outreachMessageId, status, extra);
            return { ok: true };
          }
          case "listOutreachMessagesByStatus":
            return await listOutreachMessagesByStatus((rest as { status: Parameters<typeof listOutreachMessagesByStatus>[0] }).status);
          case "isSuppressed":
            return { suppressed: await isSuppressed((rest as { email: string }).email) };
          case "addToSuppressionList": {
            const { email, reason, addedBy } = rest as {
              email: string;
              reason: Parameters<typeof addToSuppressionList>[1];
              addedBy?: string;
            };
            await addToSuppressionList(email, reason, addedBy);
            return { ok: true };
          }
          case "recordReplyClassification": {
            const { outreachMessageId, category, confidence, classifiedByRunId } = rest as {
              outreachMessageId: string;
              category: Parameters<typeof recordReplyClassification>[1];
              confidence: Parameters<typeof recordReplyClassification>[2];
              classifiedByRunId?: string;
            };
            await recordReplyClassification(outreachMessageId, category, confidence, classifiedByRunId);
            return { ok: true };
          }
          default:
            throw new Error(`prospect-store: unknown action "${action}"`);
        }
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "email-outreach": {
      const { to, subject, bodyText, bodyHtml, replyTo, outreachMessageId } = args as {
        to: string;
        subject: string;
        bodyText: string;
        bodyHtml?: string;
        replyTo?: string;
        outreachMessageId: string;
      };
      if (!isResendConfigured()) {
        return { note: "RESEND_API_KEY not configured — no email was sent." };
      }
      if (!isSendingDomainVerified()) {
        // Deliberately not graceful-degrade: an approved draft that
        // silently doesn't send would look like a successful Task to
        // whoever reviews it. Surfacing the real reason here instead of
        // in a later "why did nothing happen" investigation.
        return {
          note: "EMAIL_FROM_ADDRESS not verified yet — draft approved but not sent. See docs/05-operations/resend-domain-warmup.md.",
        };
      }
      try {
        return await sendOutreachEmail({ to, subject, bodyText, bodyHtml, replyTo, outreachMessageId });
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    // Track B — same dispatch-by-action shape as "prospect-store"/
    // "google-ads-optimize" above, fronting campaign_changes_log CRUD for
    // ppc-agent's "recommend"/"apply"/"verify" actions.
    case "campaign-changes": {
      if (!isSupabaseConfigured()) return { note: "Supabase not configured — no campaign change data available." };
      const { action, ...rest } = args as { action: string; [key: string]: unknown };
      try {
        switch (action) {
          case "proposeCampaignChange":
            return await proposeCampaignChange(rest as unknown as Parameters<typeof proposeCampaignChange>[0]);
          case "getCampaignChange":
            return await getCampaignChange((rest as { id: string }).id);
          case "listCampaignChanges": {
            const { clientAdAccountId, status, limit } = rest as {
              clientAdAccountId: string;
              status?: Parameters<typeof listCampaignChanges>[1];
              limit?: number;
            };
            return await listCampaignChanges(clientAdAccountId, status, limit);
          }
          case "listUnverifiedAppliedChanges":
            return await listUnverifiedAppliedChanges((rest as { olderThanDays: number }).olderThanDays);
          case "updateCampaignChangeStatus": {
            const { id, status, ...extra } = rest as { id: string; status: Parameters<typeof updateCampaignChangeStatus>[1] } & NonNullable<
              Parameters<typeof updateCampaignChangeStatus>[2]
            >;
            await updateCampaignChangeStatus(id, status, extra);
            return { ok: true };
          }
          case "recordVerification": {
            const { id, actualEffect, afterMetrics } = rest as { id: string; actualEffect: string; afterMetrics: Record<string, unknown> };
            await recordVerification(id, actualEffect, afterMetrics);
            return { ok: true };
          }
          default:
            throw new Error(`campaign-changes: unknown action "${action}"`);
        }
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    // Weekly per-campaign trend history + sustained-CPA-degradation
    // detection (2026-09-03, docs/03-architecture/campaign-weekly-trends.md)
    // — ppc-agent's "trend-alerts" action's only I/O dependency besides
    // "campaign-changes". Read-only over ad_stat/campaign_status, so no
    // ToolUnavailableError graceful-degrade branch is needed beyond
    // Supabase itself (campaign-trends.ts throws its own clear errors).
    case "campaign-trends": {
      const { action, ...rest } = args as { action: string; [key: string]: unknown };
      switch (action) {
        case "getWeeklyCampaignHistory": {
          const { clientId, platform, includeCurrentPartialWeek } = rest as {
            clientId: string;
            platform?: "google-ads" | "yandex-direct";
            includeCurrentPartialWeek?: boolean;
          };
          return await getWeeklyCampaignHistory(clientId, { platform, includeCurrentPartialWeek });
        }
        case "detectSustainedDegradation": {
          const { clientId, platform, minWeeks, minTotalIncreasePct, maxDipSteps, excludeStopped } = rest as {
            clientId: string;
            platform?: "google-ads" | "yandex-direct";
            minWeeks?: number;
            minTotalIncreasePct?: number;
            maxDipSteps?: number;
            excludeStopped?: boolean;
          };
          return await detectSustainedDegradation(clientId, { platform, minWeeks, minTotalIncreasePct, maxDipSteps, excludeStopped });
        }
        default:
          throw new Error(`campaign-trends: unknown action "${action}"`);
      }
    }
    case "creative-generation": {
      const { briefText, channels } = args as { briefText: string; channels: readonly string[] };
      if (!isCreativeGenerationConfigured()) {
        // graceful degrade, no OPENAI_API_KEY configured
        return { assetRefs: channels.map((c) => `placeholder-asset-${c}`), note: "OPENAI_API_KEY not configured" };
      }
      try {
        return await generateCreativeAssets(briefText, channels);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "design-tool": {
      const { brief, projectTitle, brand } = args as {
        brief?: string;
        projectTitle?: string;
        brand?: Parameters<typeof generateDesign>[0]["brand"];
      };
      if (!isV0Configured()) {
        return { note: "V0_API_KEY not configured — no mockup was generated." };
      }
      // A brief is the whole input to this tool. Generating from an empty
      // string would burn a real generation on a screen nobody asked for,
      // so this is a caller bug, reported as one.
      if (!brief?.trim()) {
        throw new ToolUnavailableError("design-tool called without a brief — nothing to design.");
      }
      try {
        return await generateDesign({
          brief,
          brand,
          projectTitle: projectTitle ?? "AMA design",
        });
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "deployment-tool": {
      const { artifact, projectName } = args as { artifact: unknown; projectName?: string };
      if (!isVercelDeployConfigured()) {
        // Named as a placeholder instead of returning a plausible-looking
        // URL: the old inline stub returned https://dev-placeholder.example,
        // which read as a real deployment in the final report.
        return { url: "about:blank", note: "VERCEL_DEPLOY_TOKEN not configured — nothing was published." };
      }
      try {
        // "kalinin-da-web" default, not "ama-agent-deploy": VERCEL_DEPLOY_TOKEN
        // is scoped to that one existing project (project-scoped tokens can't
        // create new projects), so deploys land there as previews.
        return await deployArtifact(artifact, projectName ?? "kalinin-da-web");
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    default:
      throw new Error(`No real implementation wired for tool "${toolId}" yet.`);
  }
};

// Small local retry helper for the "keyword-volume" case above — this
// codebase has no shared retry utility (each tool module implements its
// own loop, e.g. yandex-direct.ts's report-polling loop); a few-line inline
// helper here is simpler than introducing a new shared abstraction for one
// caller. Fixed short backoff, not exponential — these are quick read-only
// lookups, not long-running operations.
async function retry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  throw lastError;
}
