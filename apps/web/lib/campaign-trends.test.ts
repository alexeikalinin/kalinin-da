import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateWeeklySeries, computeDegradation, type CampaignWeeklySeries } from "./campaign-trends.ts";

function row(date: string, cost: number, clicks: number, conversions: number) {
  return { platform: "google-ads" as const, campaign_id: "1", campaign_name: "Test Campaign", date, cost, clicks, impressions: clicks * 20, conversions_total: conversions };
}

test("aggregateWeeklySeries buckets by ISO week (Monday-Sunday) and excludes the current partial week by default", () => {
  // 2026-08-24 is a Monday. Week 1: Mon-Sun 08-24..08-30. Week 2 starts 08-31.
  const rows = [row("2026-08-24", 10, 5, 1), row("2026-08-30", 10, 5, 1), row("2026-08-31", 20, 10, 2)];
  const result = aggregateWeeklySeries(rows, new Map(), false, "2026-08-31");
  assert.equal(result.length, 1);
  // "today" = 2026-08-31 falls in the week starting 2026-08-31, so that
  // week is the current partial week and excluded; only the prior full
  // week (08-24..08-30) should remain.
  assert.deepEqual(
    result[0].weeks.map((w) => w.weekStart),
    ["2026-08-24"],
  );
  assert.equal(result[0].weeks[0].spend, 20);
  assert.equal(result[0].weeks[0].clicks, 10);
  assert.equal(result[0].weeks[0].conversions, 2);
  assert.equal(result[0].weeks[0].cpa, 10);
});

test("aggregateWeeklySeries includes the current partial week when asked, marked isComplete: false", () => {
  const rows = [row("2026-08-31", 20, 10, 2)];
  const result = aggregateWeeklySeries(rows, new Map(), true, "2026-08-31");
  assert.equal(result[0].weeks.length, 1);
  assert.equal(result[0].weeks[0].isComplete, false);
});

test("aggregateWeeklySeries reports cpa as null (not 0) when a week has zero conversions", () => {
  const rows = [row("2026-08-24", 50, 20, 0)];
  const result = aggregateWeeklySeries(rows, new Map(), false, "2026-09-07");
  assert.equal(result[0].weeks[0].cpa, null);
});

test("aggregateWeeklySeries attaches isRunning from the status map, null when never synced", () => {
  const rows = [row("2026-08-24", 10, 5, 1)];
  const running = aggregateWeeklySeries(rows, new Map([["google-ads:1", true]]), false, "2026-09-07");
  assert.equal(running[0].isRunning, true);
  const unknown = aggregateWeeklySeries(rows, new Map(), false, "2026-09-07");
  assert.equal(unknown[0].isRunning, null);
});

function series(weeks: ReadonlyArray<{ spend: number; clicks: number; conversions: number }>, isRunning: boolean | null = true): CampaignWeeklySeries {
  return {
    platform: "google-ads",
    campaignId: "1",
    campaignName: "Test Campaign",
    isRunning,
    weeks: weeks.map((w, i) => ({
      weekStart: `2026-08-${String(3 + i * 7).padStart(2, "0")}`,
      weekEnd: `2026-08-${String(9 + i * 7).padStart(2, "0")}`,
      isComplete: true,
      spend: w.spend,
      clicks: w.clicks,
      impressions: w.clicks * 20,
      conversions: w.conversions,
      cpa: w.conversions > 0 ? w.spend / w.conversions : null,
    })),
  };
}

test("computeDegradation flags a campaign whose CPA climbs >=20% net over 4 trailing weeks with at most 1 dip", () => {
  // CPA: 10 -> 11 (dip down would be lower, this is a rise) -> 13 -> 15: net +50%, 0 dips.
  const s = series([
    { spend: 100, clicks: 50, conversions: 10 }, // cpa 10
    { spend: 110, clicks: 50, conversions: 10 }, // cpa 11
    { spend: 130, clicks: 50, conversions: 10 }, // cpa 13
    { spend: 150, clicks: 50, conversions: 10 }, // cpa 15
  ]);
  const alerts = computeDegradation([s]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].campaignId, "1");
  assert.ok(alerts[0].totalIncreasePct >= 20);
});

test("computeDegradation does NOT flag noise: one dip is tolerated, two is not", () => {
  // One dip inside an otherwise-climbing window: 10 -> 15 -> 12 (dip) -> 20 — net +100%, 1 dip -> still flagged.
  const oneDip = series([
    { spend: 100, clicks: 50, conversions: 10 },
    { spend: 150, clicks: 50, conversions: 10 },
    { spend: 120, clicks: 50, conversions: 10 },
    { spend: 200, clicks: 50, conversions: 10 },
  ]);
  assert.equal(computeDegradation([oneDip]).length, 1);

  // Two dips: 10 -> 15 -> 12 (dip) -> 18 -> 14 (dip) -> net still positive but too noisy -> not flagged.
  const twoDips = series([
    { spend: 100, clicks: 50, conversions: 10 },
    { spend: 150, clicks: 50, conversions: 10 },
    { spend: 120, clicks: 50, conversions: 10 },
    { spend: 180, clicks: 50, conversions: 10 },
    { spend: 140, clicks: 50, conversions: 10 },
  ]);
  assert.equal(computeDegradation([twoDips]).length, 0);
});

test("computeDegradation does not flag a net rise below the minimum threshold", () => {
  // Net +10% over the window — below the default 20% threshold.
  const s = series([
    { spend: 100, clicks: 50, conversions: 10 },
    { spend: 103, clicks: 50, conversions: 10 },
    { spend: 106, clicks: 50, conversions: 10 },
    { spend: 110, clicks: 50, conversions: 10 },
  ]);
  assert.equal(computeDegradation([s]).length, 0);
});

test("computeDegradation excludes a stopped campaign by default, even with a real degradation pattern", () => {
  const s = series(
    [
      { spend: 100, clicks: 50, conversions: 10 },
      { spend: 110, clicks: 50, conversions: 10 },
      { spend: 130, clicks: 50, conversions: 10 },
      { spend: 150, clicks: 50, conversions: 10 },
    ],
    false,
  );
  assert.equal(computeDegradation([s]).length, 0);
  assert.equal(computeDegradation([s], { excludeStopped: false }).length, 1);
});

test("computeDegradation's hypothesis distinguishes a conversion-rate drop from a rising CPC", () => {
  // Conversions per click collapses (10/50=20% -> 3/50=6%) while spend/clicks stay flat -> CPC unchanged.
  const convDrop = series([
    { spend: 100, clicks: 50, conversions: 10 },
    { spend: 100, clicks: 50, conversions: 7 },
    { spend: 100, clicks: 50, conversions: 5 },
    { spend: 100, clicks: 50, conversions: 3 },
  ]);
  const [alert] = computeDegradation([convDrop]);
  assert.match(alert.hypothesis, /конверсия из клика упала/);

  // Same conversions/clicks ratio throughout, but CPC (spend/clicks) climbs sharply.
  const cpcRise = series([
    { spend: 100, clicks: 50, conversions: 10 },
    { spend: 130, clicks: 50, conversions: 10 },
    { spend: 160, clicks: 50, conversions: 10 },
    { spend: 200, clicks: 50, conversions: 10 },
  ]);
  const [alert2] = computeDegradation([cpcRise]);
  assert.match(alert2.hypothesis, /цена клика выросла/);
});
