import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseForecastCpc,
  getWeeklySpendLimit,
  adjustWeeklySpendLimit,
  getKeywordBids,
  addNegativeKeywords,
  setCampaignStatus,
  buildMultiGroupSearchCampaign,
  createOrReusePausedCampaign,
} from "./yandex-direct.ts";

// 2026-08-30 — parseForecastCpc's field-name fallback chain (AvgClickCost
// → CpcInCents → Cost/Clicks) is the one piece of getForecastCpc that
// doesn't need network mocking to test, and it's also the part flagged in
// yandex-direct.ts as unverified against a live API response — a test
// pins down what the fallback chain is actually supposed to do so a
// future correction (once verified for real) has something to change
// deliberately, not silently.

test("prefers AvgClickCost when present", () => {
  const result = parseForecastCpc({
    Keywords: [
      {
        Keyword: "грузоперевозки минск",
        TrafficVolumeForecast: [
          { TrafficVolume: 50, AvgClickCost: 30, CpcInCents: 9999 },
          { TrafficVolume: 100, AvgClickCost: 45.678, CpcInCents: 9999 },
        ],
      },
    ],
  });
  assert.deepEqual([...result], [["грузоперевозки минск", 45.68]]); // highest TrafficVolume wins, rounded to 2dp
});

test("falls back to CpcInCents/100 when AvgClickCost is absent", () => {
  const result = parseForecastCpc({
    Keywords: [{ Keyword: "таможня", TrafficVolumeForecast: [{ TrafficVolume: 100, CpcInCents: 1250 }] }],
  });
  assert.equal(result.get("таможня"), 12.5);
});

test("falls back to Cost/Clicks when neither direct field is present", () => {
  const result = parseForecastCpc({
    Keywords: [{ Keyword: "растаможка", TrafficVolumeForecast: [{ TrafficVolume: 100, Cost: 500, Clicks: 20 }] }],
  });
  assert.equal(result.get("растаможка"), 25);
});

test("skips keywords with no usable CPC field and no keyword name, without throwing", () => {
  const result = parseForecastCpc({
    Keywords: [
      { Keyword: "no-data", TrafficVolumeForecast: [{ TrafficVolume: 100 }] },
      { TrafficVolumeForecast: [{ TrafficVolume: 100, AvgClickCost: 10 }] }, // no Keyword/KeywordName
    ],
  });
  assert.equal(result.size, 0);
});

test("accepts KeywordName as a fallback for Keyword, lowercased", () => {
  const result = parseForecastCpc({
    Keywords: [{ KeywordName: "ГРУЗОПЕРЕВОЗКИ", TrafficVolumeForecast: [{ TrafficVolume: 100, AvgClickCost: 10 }] }],
  });
  assert.equal(result.get("грузоперевозки"), 10);
});

// 2026-08-30 — Track B / campaign-optimization existing-campaign read/write
// functions. Mocked-fetch coverage only (see the module comment above
// these functions in yandex-direct.ts and known-issues.md #3/#4's updated
// status) — not yet exercised against a real account.

const REAL_FETCH = globalThis.fetch;

interface Call {
  readonly resource: string;
  readonly method: string;
  readonly params: unknown;
}

let calls: Call[];
let respond: (resource: string, method: string, params: unknown) => unknown;

function installFetchMock() {
  calls = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const resource = url.split("/").pop() ?? "";
    const body = init?.body ? (JSON.parse(String(init.body)) as { method: string; params: unknown }) : { method: "", params: {} };
    calls.push({ resource, method: body.method, params: body.params });
    return new Response(JSON.stringify({ result: respond(resource, body.method, body.params) }), { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.YANDEX_ACCESS_TOKEN = "fake-token";
  installFetchMock();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

test("getWeeklySpendLimit finds the nested WeeklySpendLimit under whatever key matches BiddingStrategyType", async () => {
  respond = () => ({
    Campaigns: [
      {
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: "AverageCpa", AverageCpa: { WeeklySpendLimit: 5_000_000, AverageCpa: 100_000 } },
          },
        },
      },
    ],
  });
  const result = await getWeeklySpendLimit(123);
  assert.deepEqual(result, { weeklySpendLimitMicros: 5_000_000, strategyType: "AverageCpa" });
});

test("getWeeklySpendLimit returns null when the campaign has no autostrategy Search block", async () => {
  respond = () => ({ Campaigns: [{}] });
  const result = await getWeeklySpendLimit(123);
  assert.deepEqual(result, { weeklySpendLimitMicros: null, strategyType: undefined });
});

test("adjustWeeklySpendLimit writes back under the campaign's own strategy type key", async () => {
  respond = (_resource, method) => {
    if (method === "get") {
      return {
        Campaigns: [{ TextCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "AverageCpc", AverageCpc: { WeeklySpendLimit: 1 } } } } }],
      };
    }
    return {};
  };
  await adjustWeeklySpendLimit(123, 9_000_000);
  const update = calls.find((c) => c.method === "update");
  assert.deepEqual((update?.params as { Campaigns: unknown[] }).Campaigns, [
    { Id: 123, TextCampaign: { BiddingStrategy: { Search: { AverageCpc: { WeeklySpendLimit: 9_000_000 } } } } },
  ]);
});

test("adjustWeeklySpendLimit refuses to write when the campaign has no autostrategy", async () => {
  respond = () => ({ Campaigns: [{}] });
  await assert.rejects(() => adjustWeeklySpendLimit(123, 9_000_000), /no autostrategy/);
});

test("getKeywordBids reads Bid/ContextBid from keywords.get, not keywordbids.get", async () => {
  respond = () => ({ Keywords: [{ Id: 1, Bid: 300_000, ContextBid: 200_000 }, { Id: 2 }] });
  const result = await getKeywordBids(123);
  assert.deepEqual(result, [
    { keywordId: 1, bidMicros: 300_000, contextBidMicros: 200_000 },
    { keywordId: 2, bidMicros: null, contextBidMicros: null },
  ]);
});

test("addNegativeKeywords merges with existing negatives instead of overwriting them", async () => {
  respond = (_resource, method) => {
    if (method === "get") return { Campaigns: [{ NegativeKeywords: { Items: ["existing"] } }] };
    return {};
  };
  const result = await addNegativeKeywords(123, ["new-one", "existing"]);
  assert.equal(result.totalNegativeCount, 2); // deduped
  const update = calls.find((c) => c.method === "update");
  assert.deepEqual((update?.params as { Campaigns: ReadonlyArray<{ NegativeKeywords: { Items: string[] } }> }).Campaigns[0].NegativeKeywords.Items.sort(), [
    "existing",
    "new-one",
  ]);
});

test("setCampaignStatus calls campaigns.resume/suspend by Id", async () => {
  respond = () => ({});
  await setCampaignStatus(123, "resume");
  assert.equal(calls[0].method, "resume");
  assert.deepEqual(calls[0].params, { SelectionCriteria: { Ids: [123] } });
});

test("buildMultiGroupSearchCampaign creates one campaign with several ad groups, each with keywords and a text ad", async () => {
  let adGroupId = 500;
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 999 }] };
    if (resource === "campaigns" && method === "suspend") return {};
    if (resource === "adgroups" && method === "get") return { AdGroups: [] }; // no existing group with this name
    if (resource === "adgroups" && method === "add") {
      adGroupId += 1;
      return { AddResults: [{ Id: adGroupId }] };
    }
    if (resource === "keywords" && method === "add") return { AddResults: [{ Id: 1 }] };
    if (resource === "ads" && method === "add") return { AddResults: [{ Id: 1 }] };
    throw new Error(`unexpected call: ${resource}.${method}`);
  };

  const result = await buildMultiGroupSearchCampaign(
    "МаякДент — Имплантация",
    0.5,
    "https://mayakdent.by",
    [157, 10996], // Минск + Минская область
    [
      { name: "Имплантация — общее", keywords: ["имплантация зубов минск"], adCopy: { title: "Имплантация зубов", text: "Опытные хирурги. Минск." } },
      { name: "Имплантация — цена", keywords: ["имплантация зубов цена"], adCopy: { title: "Имплантация — цена", text: "Прозрачные цены. Консультация." } },
    ],
  );

  assert.equal(result.campaignId, 999);
  assert.equal(result.reused, false);
  assert.equal(result.adGroups.length, 2);
  assert.deepEqual(
    result.adGroups.map((g) => g.name),
    ["Имплантация — общее", "Имплантация — цена"],
  );

  const adGroupAdds = calls.filter((c) => c.resource === "adgroups" && c.method === "add");
  assert.equal(adGroupAdds.length, 2);
  const firstGroupParams = adGroupAdds[0].params as { AdGroups: [{ CampaignId: number; RegionIds: number[] }] };
  assert.equal(firstGroupParams.AdGroups[0].CampaignId, 999);
  assert.deepEqual(firstGroupParams.AdGroups[0].RegionIds, [157, 10996]);

  assert.equal(calls.filter((c) => c.resource === "keywords" && c.method === "add").length, 2);
  assert.equal(calls.filter((c) => c.resource === "ads" && c.method === "add").length, 2);
});

// 2026-09-02 — campaign type / bidding strategy generalization (Track B
// follow-up, ported knowledge from PPC Master Tool's
// draft_campaigns_setup.py's search_only/network_only variants).

test("createOrReusePausedCampaign defaults to TextCampaign + HIGHEST_POSITION/SERVING_OFF when no options given", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1);
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [Record<string, unknown>] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign, {
    BiddingStrategy: {
      Search: { BiddingStrategyType: "HIGHEST_POSITION" },
      Network: { BiddingStrategyType: "SERVING_OFF" },
    },
  });
});

test("createOrReusePausedCampaign builds a network_only TextCampaign (PPC Master Tool's other supported variant)", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, {
    searchStrategy: { type: "SERVING_OFF" },
    networkStrategy: { type: "MAXIMUM_COVERAGE" },
  });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [Record<string, unknown>] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign, {
    BiddingStrategy: {
      Search: { BiddingStrategyType: "SERVING_OFF" },
      Network: { BiddingStrategyType: "MAXIMUM_COVERAGE" },
    },
  });
});

test("createOrReusePausedCampaign builds AVERAGE_CPA with WeeklySpendLimit/AverageCpa nested under the strategy's own key", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, {
    searchStrategy: { type: "AVERAGE_CPA", weeklySpendLimitMicros: 5_000_000, averageCpaMicros: 300_000, payForConversionEnabled: true },
  });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [{ TextCampaign: { BiddingStrategy: { Search: unknown } } }] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign.BiddingStrategy.Search, {
    BiddingStrategyType: "AVERAGE_CPA",
    AverageCpa: { WeeklySpendLimit: 5_000_000, AverageCpa: 300_000, PayForConversionEnabled: true },
  });
});

test("createOrReusePausedCampaign builds AVERAGE_ROI with RoiCoef/ReserveReturn/GoalId", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, {
    searchStrategy: { type: "AVERAGE_ROI", weeklySpendLimitMicros: 7_000_000, averageRoiCoef: 1.2, reserveReturnPercent: 10, goalId: 555 },
  });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [{ TextCampaign: { BiddingStrategy: { Search: unknown } } }] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign.BiddingStrategy.Search, {
    BiddingStrategyType: "AVERAGE_ROI",
    AverageRoi: { WeeklySpendLimit: 7_000_000, RoiCoef: 1.2, ReserveReturn: 10, GoalId: 555 },
  });
});

// 2026-09-02 follow-up — strategies confirmed via a live doc fetch of
// yandex.ru/dev/direct/doc/ref-v5/campaigns/add-text-campaign.html that
// weren't yet covered: AVERAGE_CRR/PAY_FOR_CONVERSION/PAY_FOR_CONVERSION_CRR/
// WEEKLY_CLICK_PACKAGE on Search, plus the six shared strategies Network
// was previously missing entirely (WB_MAXIMUM_CLICKS/WB_MAXIMUM_CONVERSION_RATE
// among them — real "Максимум кликов"/"Максимум конверсий" campaigns run
// with the SAME autostrategy under both Search and Network).

test("createOrReusePausedCampaign builds PAY_FOR_CONVERSION_CRR with Crr/GoalId", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, {
    searchStrategy: { type: "PAY_FOR_CONVERSION_CRR", crr: 15, goalId: 777, weeklySpendLimitMicros: 4_000_000 },
  });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [{ TextCampaign: { BiddingStrategy: { Search: unknown } } }] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign.BiddingStrategy.Search, {
    BiddingStrategyType: "PAY_FOR_CONVERSION_CRR",
    PayForConversionCrr: { WeeklySpendLimit: 4_000_000, GoalId: 777, Crr: 15 },
  });
});

test("createOrReusePausedCampaign builds WEEKLY_CLICK_PACKAGE with ClicksPerWeek/AverageCpc/BidCeiling", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, {
    searchStrategy: { type: "WEEKLY_CLICK_PACKAGE", clicksPerWeek: 500, averageCpcMicros: 200_000, bidCeilingMicros: 900_000 },
  });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [{ TextCampaign: { BiddingStrategy: { Search: unknown } } }] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign.BiddingStrategy.Search, {
    BiddingStrategyType: "WEEKLY_CLICK_PACKAGE",
    WeeklyClickPackage: { BidCeiling: 900_000, ClicksPerWeek: 500, AverageCpc: 200_000 },
  });
});

test("createOrReusePausedCampaign builds Network WB_MAXIMUM_CONVERSION_RATE (previously missing from Network entirely)", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, {
    searchStrategy: { type: "WB_MAXIMUM_CONVERSION_RATE", weeklySpendLimitMicros: 6_000_000, goalId: 42 },
    networkStrategy: { type: "WB_MAXIMUM_CONVERSION_RATE", weeklySpendLimitMicros: 6_000_000, goalId: 42 },
  });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [{ TextCampaign: { BiddingStrategy: { Network: unknown } } }] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign.BiddingStrategy.Network, {
    BiddingStrategyType: "WB_MAXIMUM_CONVERSION_RATE",
    WbMaximumConversionRate: { WeeklySpendLimit: 6_000_000, GoalId: 42 },
  });
});

test("createOrReusePausedCampaign builds Network NETWORK_DEFAULT with LimitPercent", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, {
    networkStrategy: { type: "NETWORK_DEFAULT", limitPercent: 50 },
  });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [{ TextCampaign: { BiddingStrategy: { Network: unknown } } }] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign.BiddingStrategy.Network, {
    BiddingStrategyType: "NETWORK_DEFAULT",
    NetworkDefault: { LimitPercent: 50 },
  });
});

test("createOrReusePausedCampaign now sets GoalId for AVERAGE_CPA (previously silently dropped — Direct requires it)", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, {
    searchStrategy: { type: "AVERAGE_CPA", averageCpaMicros: 300_000, goalId: 111 },
  });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [{ TextCampaign: { BiddingStrategy: { Search: unknown } } }] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign.BiddingStrategy.Search, {
    BiddingStrategyType: "AVERAGE_CPA",
    AverageCpa: { GoalId: 111, AverageCpa: 300_000 },
  });
});

test("createOrReusePausedCampaign can create a DynamicTextCampaign (Search/Network split type)", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, { campaignType: "DYNAMIC_TEXT_CAMPAIGN" });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [Record<string, unknown>] }).Campaigns[0];
  assert.ok(campaign.DynamicTextCampaign);
  assert.equal(campaign.TextCampaign, undefined);
});

test("createOrReusePausedCampaign refuses SmartCampaign/CpmBannerCampaign without explicit campaignTypeFields", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    return {};
  };
  await assert.rejects(
    () => createOrReusePausedCampaign("Test", 1, undefined, { campaignType: "SMART_CAMPAIGN" }),
    /needs campaignTypeFields/,
  );
});

test("createOrReusePausedCampaign accepts campaignTypeFields passthrough for SmartCampaign", async () => {
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 1 }] };
    return {};
  };
  await createOrReusePausedCampaign("Test", 1, undefined, {
    campaignType: "SMART_CAMPAIGN",
    campaignTypeFields: { BiddingStrategy: { Search: { BiddingStrategyType: "AVERAGE_CPA" } } },
  });
  const add = calls.find((c) => c.method === "add");
  const campaign = (add?.params as { Campaigns: [Record<string, unknown>] }).Campaigns[0];
  assert.deepEqual(campaign.SmartCampaign, { BiddingStrategy: { Search: { BiddingStrategyType: "AVERAGE_CPA" } } });
});

test("buildMultiGroupSearchCampaign forwards a strategy override to createOrReusePausedCampaign", async () => {
  let adGroupId = 500;
  respond = (resource, method) => {
    if (resource === "campaigns" && method === "get") return { Campaigns: [] };
    if (resource === "campaigns" && method === "add") return { AddResults: [{ Id: 999 }] };
    if (resource === "campaigns" && method === "suspend") return {};
    if (resource === "adgroups" && method === "get") return { AdGroups: [] };
    if (resource === "adgroups" && method === "add") {
      adGroupId += 1;
      return { AddResults: [{ Id: adGroupId }] };
    }
    if (resource === "keywords" && method === "add") return { AddResults: [{ Id: 1 }] };
    if (resource === "ads" && method === "add") return { AddResults: [{ Id: 1 }] };
    throw new Error(`unexpected call: ${resource}.${method}`);
  };

  await buildMultiGroupSearchCampaign(
    "Test",
    1,
    "https://example.com",
    [157],
    [{ name: "Group", keywords: ["kw"], adCopy: { title: "T", text: "D" } }],
    undefined,
    undefined,
    { searchStrategy: { type: "AVERAGE_CPC", weeklySpendLimitMicros: 3_000_000, averageCpcMicros: 100_000 } },
  );

  const add = calls.find((c) => c.resource === "campaigns" && c.method === "add");
  const campaign = (add?.params as { Campaigns: [{ TextCampaign: { BiddingStrategy: { Search: unknown } } }] }).Campaigns[0];
  assert.deepEqual(campaign.TextCampaign.BiddingStrategy.Search, {
    BiddingStrategyType: "AVERAGE_CPC",
    AverageCpc: { WeeklySpendLimit: 3_000_000, AverageCpc: 100_000 },
  });
});
