import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  listCampaigns,
  getCampaign,
  createOrReusePausedCampaign,
  setCampaignStatus,
  adjustCampaignBudget,
  getAdInsights,
  sendConversionEvents,
  verifyAdAccountAccess,
} from "./openai-ads.ts";

// 2026-09-03 — built against developers.openai.com/ads' documented API
// shape (see docs/openai-ads-integration-research.md Phase 2). Mocked-fetch
// coverage only: no live API key was available at implementation time, so
// this pins down the adapter's own request/response mapping, not that
// OpenAI's real API behaves exactly as documented — same disclosed stance
// as yandex-direct.ts's un-exercised functions before their first real run.

const REAL_FETCH = globalThis.fetch;

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

let calls: Call[];
let respond: (url: string, method: string, body: unknown) => { status: number; body: unknown };

function installFetchMock() {
  calls = [];
  respond = () => ({ status: 200, body: {} });
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const { status, body: responseBody } = respond(url, method, body);
    return new Response(JSON.stringify(responseBody), { status });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.OPENAI_ADS_API_KEY = "fake-key";
  installFetchMock();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

test("verifyAdAccountAccess calls GET /ad_account with the bearer key", async () => {
  respond = () => ({ status: 200, body: { id: "acct_123" } });
  const result = await verifyAdAccountAccess();
  assert.deepEqual(result, { id: "acct_123" });
  assert.equal(calls[0].url, "https://api.ads.openai.com/v1/ad_account");
  assert.equal(calls[0].method, "GET");
});

test("listCampaigns maps raw snake_case fields to the adapter's camelCase shape", async () => {
  respond = () => ({
    status: 200,
    body: {
      data: [
        {
          id: "camp_1",
          name: "Test Campaign",
          status: "paused",
          bidding_type: "clicks",
          budget: { lifetime_spend_limit_micros: 5_000_000 },
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ],
    },
  });
  const result = await listCampaigns();
  assert.deepEqual(result, [
    {
      id: "camp_1",
      name: "Test Campaign",
      description: undefined,
      status: "paused",
      biddingType: "clicks",
      lifetimeSpendLimitMicros: 5_000_000,
      startTime: undefined,
      endTime: undefined,
      targeting: undefined,
      conversionEventSettingIds: undefined,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ]);
});

test("getCampaign fetches a single campaign by id", async () => {
  respond = () => ({
    status: 200,
    body: { id: "camp_1", name: "X", status: "active", bidding_type: "impressions", created_at: "t1", updated_at: "t2" },
  });
  const result = await getCampaign("camp_1");
  assert.equal(result.id, "camp_1");
  assert.equal(calls[0].url, "https://api.ads.openai.com/v1/campaigns/camp_1");
});

test("createOrReusePausedCampaign reuses an existing campaign by name instead of creating a duplicate", async () => {
  respond = () => ({
    status: 200,
    body: {
      data: [
        {
          id: "camp_existing",
          name: "AMA Auto — Test",
          status: "paused",
          bidding_type: "clicks",
          created_at: "t1",
          updated_at: "t2",
        },
      ],
    },
  });
  const result = await createOrReusePausedCampaign({
    name: "AMA Auto — Test",
    biddingType: "clicks",
    lifetimeSpendLimitMicros: 5_000_000,
  });
  assert.equal(result.reused, true);
  assert.equal(result.campaign.id, "camp_existing");
  assert.equal(calls.length, 1); // only the list call — no POST /campaigns
});

test("createOrReusePausedCampaign creates a new campaign always with status 'paused'", async () => {
  respond = (url, method, body) => {
    if (method === "GET") return { status: 200, body: { data: [] } };
    assert.equal(method, "POST");
    assert.equal((body as { status: string }).status, "paused");
    return {
      status: 200,
      body: { id: "camp_new", name: (body as { name: string }).name, status: "paused", bidding_type: "clicks", created_at: "t1", updated_at: "t2" },
    };
  };
  const result = await createOrReusePausedCampaign({
    name: "New Campaign",
    biddingType: "clicks",
    lifetimeSpendLimitMicros: 5_000_000,
  });
  assert.equal(result.reused, false);
  assert.equal(result.campaign.status, "paused");
});

test("createOrReusePausedCampaign rejects a budget below OpenAI's documented floor", async () => {
  respond = () => ({ status: 200, body: { data: [] } });
  await assert.rejects(
    () => createOrReusePausedCampaign({ name: "X", biddingType: "clicks", lifetimeSpendLimitMicros: 100 }),
    /at least 1000000/,
  );
});

test("setCampaignStatus posts to the action-specific endpoint", async () => {
  respond = (url) => {
    assert.equal(url, "https://api.ads.openai.com/v1/campaigns/camp_1/pause");
    return { status: 200, body: { id: "camp_1", name: "X", status: "paused", bidding_type: "clicks", created_at: "t1", updated_at: "t2" } };
  };
  const result = await setCampaignStatus("camp_1", "pause");
  assert.equal(result.status, "paused");
});

test("adjustCampaignBudget rejects a value below the documented floor without calling the API", async () => {
  await assert.rejects(() => adjustCampaignBudget("camp_1", 999), /at least 1000000/);
  assert.equal(calls.length, 0);
});

test("adjustCampaignBudget PATCHes the campaign's budget field", async () => {
  respond = (url, method, body) => {
    assert.equal(method, "POST");
    assert.deepEqual(body, { budget: { lifetime_spend_limit_micros: 9_000_000 } });
    return { status: 200, body: { id: "camp_1", name: "X", status: "paused", bidding_type: "clicks", created_at: "t1", updated_at: "t2" } };
  };
  await adjustCampaignBudget("camp_1", 9_000_000);
});

test("getAdInsights maps snake_case metrics", async () => {
  respond = () => ({ status: 200, body: { impressions: 1000, clicks: 20, spend_micros: 500_000, conversions: 3 } });
  const result = await getAdInsights("ad_1");
  assert.deepEqual(result, { impressions: 1000, clicks: 20, spendMicros: 500_000, conversions: 3 });
});

test("sendConversionEvents posts to the bzr.openai.com host with the pixel id as a query param", async () => {
  respond = (url, method, body) => {
    assert.equal(url, "https://bzr.openai.com/v1/events?pid=pixel_abc");
    assert.equal(method, "POST");
    assert.deepEqual((body as { events: unknown[] }).events, [{ id: "evt_1", type: "lead_created", timestamp_ms: 1000 }]);
    return { status: 200, body: {} };
  };
  await sendConversionEvents("pixel_abc", [{ id: "evt_1", type: "lead_created", timestampMs: 1000 }]);
});

test("sendConversionEvents is a no-op for an empty batch", async () => {
  await sendConversionEvents("pixel_abc", []);
  assert.equal(calls.length, 0);
});

test("sendConversionEvents refuses a batch larger than 1000 events without calling the API", async () => {
  const events = Array.from({ length: 1001 }, (_, i) => ({ id: `evt_${i}`, type: "lead_created" as const, timestampMs: 1000 }));
  await assert.rejects(() => sendConversionEvents("pixel_abc", events), /at most 1000/);
  assert.equal(calls.length, 0);
});
