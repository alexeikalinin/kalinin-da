import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getSeoInsights, isSeoServiceConfigured } from "./seo-service.ts";

const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_ADS_REFRESH_TOKEN = "refresh-token";
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "999";
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes(":generateKeywordIdeas")) {
      return new Response(
        JSON.stringify({ results: [{ text: "seo keyword", keywordIdeaMetrics: { avgMonthlySearches: "500", competition: "LOW" } }] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200, statusText: String(init?.body) });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

test("isSeoServiceConfigured mirrors isGoogleAdsConfigured — real backing tool, not a fixed stub", () => {
  assert.equal(isSeoServiceConfigured(), true);
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  assert.equal(isSeoServiceConfigured(), false);
});

test("getSeoInsights returns real keyword ideas and explicit nulls for the not-yet-implemented sources", async () => {
  const insights = await getSeoInsights("https://example.com", "123");
  assert.deepEqual(insights, {
    url: "https://example.com",
    keywordIdeas: [{ text: "seo keyword", avgMonthlySearches: 500, competition: "LOW", lowTopOfPageBidMicros: undefined, highTopOfPageBidMicros: undefined }],
    rankTracking: null,
    technicalAudit: null,
  });
});
