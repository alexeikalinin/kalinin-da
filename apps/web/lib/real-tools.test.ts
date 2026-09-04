import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { realToolInvoker } from "./real-tools.ts";

// 2026-09-03 — "keyword-volume" is the case that grounds PPC's model call
// in REAL search-volume data BEFORE it decides keywords/ad copy (see
// ppc-agent.ts's handleSetup and the plan "Ground PPC keyword/ad-copy
// decisions in real search-volume data before the model decides"). These
// tests pin down the behavior the Owner explicitly asked for: each source
// (Google Keyword Planner, Yandex Wordstat) is retried a few times before
// being counted as failed, one source's failure never blocks the other's
// attempt, and the Task only fails when EVERY requested source is
// exhausted — it must never silently degrade back to "no volume data,
// model invents keywords blind".

const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_ADS_REFRESH_TOKEN = "refresh-token";
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "999";
  process.env.YANDEX_SEARCH_API_KEY = "test-api-key";
  process.env.YANDEX_SEARCH_API_FOLDER_ID = "test-folder-id";
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.GOOGLE_ADS_CLIENT_ID;
  delete process.env.GOOGLE_ADS_CLIENT_SECRET;
  delete process.env.GOOGLE_ADS_REFRESH_TOKEN;
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  delete process.env.YANDEX_SEARCH_API_KEY;
  delete process.env.YANDEX_SEARCH_API_FOLDER_ID;
});

test("keyword-volume: both sources succeed", async () => {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("generateKeywordIdeas")) {
      return new Response(
        JSON.stringify({ results: [{ text: "окна пвх", keywordIdeaMetrics: { avgMonthlySearches: "1000" } }] }),
        { status: 200 },
      );
    }
    if (url.includes("searchapi.api.cloud.yandex.net")) {
      return new Response(
        JSON.stringify({ results: [{ phrase: "окна пвх", count: "800" }], associations: [], totalCount: "800" }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected URL in test: ${url}`);
  }) as typeof fetch;

  const result = (await realToolInvoker(
    "keyword-volume",
    { seedKeywords: ["окна пвх"], channels: ["google-ads", "yandex-direct"], googleAdsCustomerId: "123" },
    undefined,
  )) as { google?: unknown; yandex?: unknown };

  assert.ok(result.google);
  assert.ok(result.yandex);
});

test("keyword-volume: one source fails after retries, the other still succeeds and the Task does not fail", async () => {
  let googleAttempts = 0;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("generateKeywordIdeas")) {
      googleAttempts++;
      return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 });
    }
    if (url.includes("searchapi.api.cloud.yandex.net")) {
      return new Response(
        JSON.stringify({ results: [{ phrase: "окна пвх", count: "800" }], associations: [], totalCount: "800" }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected URL in test: ${url}`);
  }) as typeof fetch;

  const result = (await realToolInvoker(
    "keyword-volume",
    { seedKeywords: ["окна пвх"], channels: ["google-ads", "yandex-direct"], googleAdsCustomerId: "123" },
    undefined,
  )) as { google?: unknown; yandex?: unknown };

  assert.equal(result.google, undefined);
  assert.ok(result.yandex);
  assert.ok(googleAttempts >= 3, "google-ads must be retried before being counted as failed");
});

test("keyword-volume: both sources fail after retries — the Task fails with a descriptive error, not a silent empty result", async () => {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("generateKeywordIdeas")) {
      return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 });
    }
    if (url.includes("searchapi.api.cloud.yandex.net")) {
      return new Response(JSON.stringify({ code: 7, message: "Permission denied" }), { status: 403 });
    }
    throw new Error(`unexpected URL in test: ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () =>
      realToolInvoker(
        "keyword-volume",
        { seedKeywords: ["окна пвх"], channels: ["google-ads", "yandex-direct"], googleAdsCustomerId: "123" },
        undefined,
      ),
    /google-ads.*yandex-direct|yandex-direct.*google-ads/s,
  );
});
