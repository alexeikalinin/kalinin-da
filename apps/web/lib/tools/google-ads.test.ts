import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildMultiGroupSearchCampaign, buildPausedSearchCampaign, getKeywordIdeas, listGa4ImportCandidates } from "./google-ads.ts";

// 2026-08-30 — the app-level real-* tool files had zero test coverage
// before this (see project_agent_framework_maturity memory's "no
// automated tests cover the groundedPrompt fixes" gap). This is the first
// one: buildPausedSearchCampaign is the function that turns PPC Agent's
// keywords/ad copy into a real (but PAUSED end to end) Google Ads
// campaign + ad group + keywords + Responsive Search Ad, so a regression
// here would silently go back to "empty shell only" or, worse, start
// creating ENABLED objects.

const REAL_FETCH = globalThis.fetch;

interface Call {
  readonly url: string;
  readonly body: unknown;
}

let calls: Call[];
let respond: (url: string, body: unknown) => unknown;

function installFetchMock() {
  calls = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return new Response(JSON.stringify(respond(url, body)), { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_ADS_REFRESH_TOKEN = "refresh-token";
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  installFetchMock();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

const TARGETING = {
  keywords: ["грузоперевозки минск", "таможенное оформление"],
  adCopy: {
    headlines: ["Грузоперевозки Беларусь", "Таможня без очередей", "Расчёт за 2 часа"],
    descriptions: ["Полный цикл логистики.", "Работаем с импортёрами и экспортёрами."],
  },
  finalUrl: "https://belseltur.com",
};

test("creates a campaign, ad group, keywords, and a PAUSED responsive search ad when nothing exists yet", async () => {
  respond = (url) => {
    if (url.includes("googleAds:search")) return { results: [] }; // no existing campaign, no existing ad group
    if (url.includes("campaignBudgets:mutate")) return { results: [{ resourceName: "customers/123/campaignBudgets/1" }] };
    if (url.includes("campaigns:mutate")) return { results: [{ resourceName: "customers/123/campaigns/999" }] };
    if (url.includes("adGroups:mutate")) return { results: [{ resourceName: "customers/123/adGroups/555" }] };
    if (url.includes("adGroupCriteria:mutate")) return { results: [{ resourceName: "customers/123/adGroupCriteria/1~1" }] };
    if (url.includes("adGroupAds:mutate")) return { results: [{ resourceName: "customers/123/adGroupAds/555~1" }] };
    throw new Error(`unexpected URL in test: ${url}`);
  };

  const result = await buildPausedSearchCampaign("Test Campaign", 0.6, TARGETING, "123", {});

  assert.deepEqual(result, {
    campaignResourceName: "customers/123/campaigns/999",
    adGroupResourceName: "customers/123/adGroups/555",
    reused: false,
    rejectedKeywords: [],
  });

  const campaignCreate = calls.find((c) => c.url.includes("campaigns:mutate"))!;
  const campaignOp = (campaignCreate.body as { operations: [{ create: Record<string, unknown> }] }).operations[0].create;
  assert.equal(campaignOp.status, "PAUSED");

  const adCreate = calls.find((c) => c.url.includes("adGroupAds:mutate"))!;
  const adOp = (adCreate.body as { operations: [{ create: Record<string, unknown> }] }).operations[0].create;
  assert.equal(adOp.status, "PAUSED");
  const ad = adOp.ad as { responsiveSearchAd: { headlines: { text: string }[]; descriptions: { text: string }[] } };
  assert.equal(ad.responsiveSearchAd.headlines.length, 3);
  assert.equal(ad.responsiveSearchAd.descriptions.length, 2);

  const keywordCreate = calls.find((c) => c.url.includes("adGroupCriteria:mutate"))!;
  const keywordOps = (keywordCreate.body as { operations: unknown[] }).operations;
  assert.equal(keywordOps.length, 2);
});

test("reuses an existing ad group and does not create duplicate keywords/ads", async () => {
  respond = (url) => {
    if (url.includes("googleAds:search") && !calls.some((c) => c.url.includes("adGroups:mutate"))) {
      // First search call: existing campaign. Second search call (ad group
      // lookup) also returns a match — both paths reused.
      const isAdGroupLookup = calls.filter((c) => c.url.includes("googleAds:search")).length > 1;
      if (isAdGroupLookup) {
        return { results: [{ adGroup: { id: "555", resourceName: "customers/123/adGroups/555", name: "x" } }] };
      }
      return { results: [{ campaign: { id: "999", name: "Test Campaign", status: "PAUSED" } }] };
    }
    throw new Error(`unexpected URL in test: ${url}`);
  };

  const result = await buildPausedSearchCampaign("Test Campaign", 0.6, TARGETING, "123", {});

  assert.equal(result.reused, true);
  assert.equal(result.campaignResourceName, "customers/123/campaigns/999");
  assert.equal(result.adGroupResourceName, "customers/123/adGroups/555");
  assert.equal(calls.some((c) => c.url.includes("adGroupCriteria:mutate")), false);
  assert.equal(calls.some((c) => c.url.includes("adGroupAds:mutate")), false);
});

test("surfaces keywords Google's partial failure rejected instead of failing the whole batch", async () => {
  respond = (url) => {
    if (url.includes("googleAds:search")) return { results: [] };
    if (url.includes("campaignBudgets:mutate")) return { results: [{ resourceName: "customers/123/campaignBudgets/1" }] };
    if (url.includes("campaigns:mutate")) return { results: [{ resourceName: "customers/123/campaigns/999" }] };
    if (url.includes("adGroups:mutate")) return { results: [{ resourceName: "customers/123/adGroups/555" }] };
    if (url.includes("adGroupCriteria:mutate")) {
      // Second keyword (index 1) rejected by policy — first still created.
      return {
        results: [{ resourceName: "customers/123/adGroupCriteria/1~1" }],
        partialFailureError: {
          details: [{ errors: [{ location: { fieldPathElements: [{ fieldName: "operations", index: 1 }] } }] }],
        },
      };
    }
    if (url.includes("adGroupAds:mutate")) return { results: [{ resourceName: "customers/123/adGroupAds/555~1" }] };
    throw new Error(`unexpected URL in test: ${url}`);
  };

  const result = await buildPausedSearchCampaign("Test Campaign", 0.6, TARGETING, "123", {});

  assert.deepEqual(result.rejectedKeywords, ["таможенное оформление"]);
  // The mutate call itself must ask for partial failure, or Google would
  // reject the whole batch instead of reporting per-keyword errors.
  const keywordCreate = calls.find((c) => c.url.includes("adGroupCriteria:mutate"))!;
  assert.equal((keywordCreate.body as { partialFailure: boolean }).partialFailure, true);
});

test("applies campaign-level negative keywords, sitelinks/callouts, and geo/language targeting only on a freshly created campaign", async () => {
  respond = (url) => {
    if (url.includes("googleAds:search")) return { results: [] };
    if (url.includes("campaignBudgets:mutate")) return { results: [{ resourceName: "customers/123/campaignBudgets/1" }] };
    if (url.includes("campaigns:mutate")) return { results: [{ resourceName: "customers/123/campaigns/999" }] };
    if (url.includes("adGroups:mutate")) return { results: [{ resourceName: "customers/123/adGroups/555" }] };
    if (url.includes("adGroupCriteria:mutate")) return { results: [{ resourceName: "customers/123/adGroupCriteria/1~1" }] };
    if (url.includes("adGroupAds:mutate")) return { results: [{ resourceName: "customers/123/adGroupAds/555~1" }] };
    if (url.includes("assets:mutate")) return { results: [{ resourceName: "customers/123/assets/1" }] };
    if (url.includes("campaignAssets:mutate")) return { results: [{ resourceName: "customers/123/campaignAssets/1" }] };
    if (url.includes("campaignCriteria:mutate")) return { results: [{ resourceName: "customers/123/campaignCriteria/1" }] };
    throw new Error(`unexpected URL in test: ${url}`);
  };

  await buildPausedSearchCampaign(
    "Test Campaign",
    0.6,
    {
      ...TARGETING,
      negativeKeywords: ["бесплатно"],
      sitelinks: [{ text: "Контакты", finalUrl: "https://belseltur.com/contacts" }],
      callouts: ["Бесплатная консультация"],
      geoTargetConstants: ["geoTargetConstants/1011969"],
      languageConstants: ["languageConstants/1000"],
    },
    "123",
    {},
  );

  const campaignCriteriaCalls = calls.filter((c) => c.url.includes("campaignCriteria:mutate"));
  assert.equal(campaignCriteriaCalls.length, 2); // one for the negative keyword, one for geo+language
  const negativeCall = campaignCriteriaCalls.find(
    (c) => JSON.stringify(c.body).includes("бесплатно"),
  )!;
  assert.equal((negativeCall.body as { operations: [{ create: { negative: boolean } }] }).operations[0].create.negative, true);

  assert.equal(calls.some((c) => c.url.includes("assets:mutate")), true);
  assert.equal(calls.some((c) => c.url.includes("campaignAssets:mutate")), true);
});

test("getKeywordIdeas parses real search volume and bid ranges, and skips ideas with no text", async () => {
  respond = (url) => {
    if (url.includes(":generateKeywordIdeas")) {
      return {
        results: [
          {
            text: "грузоперевозки минск",
            keywordIdeaMetrics: {
              avgMonthlySearches: "1200",
              competition: "MEDIUM",
              lowTopOfPageBidMicros: "500000",
              highTopOfPageBidMicros: "2500000",
            },
          },
          { keywordIdeaMetrics: { avgMonthlySearches: "50" } }, // no text — must be skipped, not crash
        ],
      };
    }
    throw new Error(`unexpected URL in test: ${url}`);
  };

  const ideas = await getKeywordIdeas(["грузоперевозки"], "123", {}, {});

  assert.deepEqual(ideas, [
    {
      text: "грузоперевозки минск",
      avgMonthlySearches: 1200,
      competition: "MEDIUM",
      lowTopOfPageBidMicros: 500000,
      highTopOfPageBidMicros: 2500000,
    },
  ]);

  const call = calls.find((c) => c.url.includes(":generateKeywordIdeas"))!;
  assert.equal(call.url.includes("customers/123:generateKeywordIdeas"), true);
});

test("rejects ad copy below Google's minimum (3 headlines, 2 descriptions) with a clear error", async () => {
  respond = (url) => {
    if (url.includes("googleAds:search")) return { results: [] };
    if (url.includes("campaignBudgets:mutate")) return { results: [{ resourceName: "customers/123/campaignBudgets/1" }] };
    if (url.includes("campaigns:mutate")) return { results: [{ resourceName: "customers/123/campaigns/999" }] };
    if (url.includes("adGroups:mutate")) return { results: [{ resourceName: "customers/123/adGroups/555" }] };
    if (url.includes("adGroupCriteria:mutate")) return { results: [] };
    throw new Error(`unexpected URL in test: ${url}`);
  };

  await assert.rejects(
    () =>
      buildPausedSearchCampaign(
        "Test Campaign",
        0.6,
        { ...TARGETING, adCopy: { headlines: ["Only one"], descriptions: ["Only one"] } },
        "123",
        {},
      ),
    /at least 3 headlines/,
  );
  assert.equal(calls.some((c) => c.url.includes("adGroupAds:mutate")), false);
});

test("listGa4ImportCandidates surfaces only HIDDEN GA4-type conversion actions, not ENABLED Ads-native ones", async () => {
  respond = (url) => {
    if (url.includes("googleAds:search")) {
      return {
        results: [
          {
            conversionAction: {
              id: "1",
              name: "generate_lead (GA4)",
              status: "HIDDEN",
              type: "GOOGLE_ANALYTICS_4_CUSTOM",
              category: "LEAD",
            },
          },
          {
            conversionAction: {
              id: "2",
              name: "Phone Call",
              status: "ENABLED",
              type: "PHONE_CALL_LEAD",
              category: "LEAD",
            },
          },
          {
            conversionAction: {
              id: "3",
              name: "purchase (GA4, already imported)",
              status: "ENABLED",
              type: "GOOGLE_ANALYTICS_4_PURCHASE",
              category: "PURCHASE",
            },
          },
        ],
      };
    }
    throw new Error(`unexpected URL in test: ${url}`);
  };

  const candidates = await listGa4ImportCandidates("123", {});

  assert.deepEqual(
    candidates.map((c) => c.id),
    ["1"],
  );
});

test("buildMultiGroupSearchCampaign creates one campaign with several ad groups, each with its own keywords and RSA", async () => {
  let adGroupCalls = 0;
  respond = (url) => {
    if (url.includes("googleAds:search")) return { results: [] }; // no existing campaign, no existing ad groups
    if (url.includes("campaignBudgets:mutate")) return { results: [{ resourceName: "customers/123/campaignBudgets/1" }] };
    if (url.includes("campaigns:mutate")) return { results: [{ resourceName: "customers/123/campaigns/999" }] };
    if (url.includes("adGroups:mutate")) {
      adGroupCalls += 1;
      return { results: [{ resourceName: `customers/123/adGroups/${adGroupCalls}` }] };
    }
    if (url.includes("adGroupCriteria:mutate")) return { results: [{ resourceName: "customers/123/adGroupCriteria/1~1" }] };
    if (url.includes("adGroupAds:mutate")) return { results: [{ resourceName: "customers/123/adGroupAds/1~1" }] };
    if (url.includes("campaignCriteria:mutate")) return { results: [] };
    throw new Error(`unexpected URL in test: ${url}`);
  };

  const result = await buildMultiGroupSearchCampaign(
    "МаякДент — Имплантация",
    0.5,
    "https://mayakdent.by",
    [
      { name: "Имплантация — общее", keywords: ["имплантация зубов минск"], adCopy: TARGETING.adCopy },
      { name: "Имплантация — цена", keywords: ["имплантация зубов цена"], adCopy: TARGETING.adCopy },
    ],
    { geoTargetConstants: ["geoTargetConstants/1001493"] },
    "123",
    {},
  );

  assert.equal(result.campaignResourceName, "customers/123/campaigns/999");
  assert.equal(result.reused, false);
  assert.equal(result.adGroups.length, 2);
  assert.deepEqual(
    result.adGroups.map((g) => g.name),
    ["Имплантация — общее", "Имплантация — цена"],
  );
  assert.equal(calls.filter((c) => c.url.includes("adGroups:mutate")).length, 2);
  assert.equal(calls.filter((c) => c.url.includes("adGroupCriteria:mutate")).length, 2);
  assert.equal(calls.filter((c) => c.url.includes("adGroupAds:mutate")).length, 2);

  const geoCall = calls.find((c) => c.url.includes("campaignCriteria:mutate"))!;
  const geoOps = (geoCall.body as { operations: [{ create: { location?: { geoTargetConstant: string } } }] }).operations;
  assert.equal(geoOps[0].create.location?.geoTargetConstant, "geoTargetConstants/1001493");
});
