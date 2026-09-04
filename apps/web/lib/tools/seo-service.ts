// Tool Integration §1 — SEO Agent's "seo-service": real keyword/semantic
// data for a site URL, not a stub.
//
// docs/07-planning/backlog.md #25 researched a full SEO vendor stack
// (Topvisor for rank tracking, DataForSEO for SERP/competitors, Screaming
// Frog for technical audit) but the user explicitly asked to leave this a
// stub until a vendor is chosen and paid for — that choice still hasn't
// been made, so this file does NOT wire any of those. What it does wire is
// the one piece of that recommended stack this codebase already has live,
// paid-for-nothing-extra credentials for: Google Ads' Keyword Planner via
// getKeywordIdeasFromUrl (google-ads.ts), seeded straight from the site URL
// the SEO agent is given (`urlSeed`, not a hand-picked keyword list — the
// agent never has one at this point). Real search volume + competition +
// bid range for keywords Google's own crawler considers relevant to the
// page, same trustworthy source PPC's keyword grounding already uses
// (docs/07-planning/backlog.md #29).
//
// Rank tracking (Topvisor) and technical crawl (Screaming Frog) stay
// genuinely unimplemented — isSeoServiceConfigured()/getSeoInsights()
// return only what this real source can answer, and say so, rather than
// fabricating a "positions" field with no backing data.
import { getKeywordIdeasFromUrl, isGoogleAdsConfigured, type GoogleAdsCallOptions, type KeywordIdea } from "./google-ads.ts";

export function isSeoServiceConfigured(): boolean {
  return isGoogleAdsConfigured();
}

export interface SeoInsights {
  readonly url: string;
  readonly keywordIdeas: readonly KeywordIdea[];
  // Explicit, not silently absent — the SEO agent's model prompt should be
  // able to say "no rank-tracking data available" instead of guessing.
  readonly rankTracking: null;
  readonly technicalAudit: null;
}

export async function getSeoInsights(
  url: string,
  customerId: string,
  params: { readonly geoTargetConstants?: readonly string[]; readonly languageConstant?: string } = {},
  options: GoogleAdsCallOptions = {},
): Promise<SeoInsights> {
  const keywordIdeas = await getKeywordIdeasFromUrl(url, customerId, params, options);
  return { url, keywordIdeas, rankTracking: null, technicalAudit: null };
}
