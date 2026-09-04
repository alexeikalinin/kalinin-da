import { getSupabase, getSupabaseOwnerTenantId } from "./supabase.ts";

// Weekly performance tracking + sustained-degradation detection, generalized
// from Astrum Analyzer's Warface-specific weekly protocol (see
// ~/Documents/VibeCoding/Astrum Analyzer/analysis/{periods,trend_alerts,metrics}.py)
// so any current or future client_ad_account gets the same mechanism, not a
// bespoke per-client analyzer. Key differences from the ported original,
// each forced by this being generic across clients/platforms rather than
// one client's own local Postgres + one client's Regs/FL/Rets funnel:
//
// - Astrum Analyzer reads a hand-maintained `warface_analyses` table (one
//   row per already-computed period, written by a human running `cli.py
//   analyze` weekly) and a spreadsheet-driven Dashboard Import for
//   conversions. This reads directly from `ad_stat` (already populated
//   daily by the existing sync-ad-stats cron for every client) and
//   aggregates into ISO weeks (Monday-Sunday) on the fly — no separate
//   weekly-snapshot table to keep in sync, no spreadsheet dependency.
// - Astrum's metric is CPUser (spend / (FL + Rets)), specific to a game
//   client's funnel. The generic equivalent here is CPA (spend / approved
//   conversions), already the metric every other tool in this repo computes
//   from `ad_stat.conversions_total` — see `sync-ad-stats.ts`.
// - Astrum's `_diagnose`/`_hypothesis` distinguish "Regs→FL conversion rate
//   dropped" from "CPC rose" from "volume dropped". The generic version
//   below uses CVR (conversions / clicks) as the conversion-rate proxy,
//   since a generic ad_stat row has no equivalent to Regs — any platform's
//   funnel reduces to spend/clicks/conversions at this layer.
// - `campaign_status` (is_running) is ported as-is — same reason it exists
//   in Astrum Analyzer: a CPA climb on a campaign that's since been paused
//   is the spend tail draining out, not a live problem to act on.

export interface WeeklyCampaignPoint {
  readonly weekStart: string; // Monday, ISO date (YYYY-MM-DD)
  readonly weekEnd: string; // Sunday, ISO date
  readonly isComplete: boolean; // false for the current, still-accumulating week
  readonly spend: number;
  readonly clicks: number;
  readonly impressions: number;
  readonly conversions: number;
  readonly cpa: number | null; // null when conversions === 0 — "no data", never treated as 0
}

export interface CampaignWeeklySeries {
  readonly platform: "google-ads" | "yandex-direct" | "openai-ads";
  readonly campaignId: string;
  readonly campaignName: string;
  readonly isRunning: boolean | null; // null when campaign_status has no row yet (never synced)
  readonly weeks: readonly WeeklyCampaignPoint[]; // oldest -> newest, complete weeks only unless includeCurrentPartialWeek
}

interface AdStatRow {
  readonly platform: "google-ads" | "yandex-direct" | "openai-ads";
  readonly campaign_id: string;
  readonly campaign_name: string;
  readonly date: string;
  readonly cost: number;
  readonly clicks: number;
  readonly impressions: number;
  readonly conversions_total: number;
}

// Monday of the ISO week containing `dateStr`. Plain Date arithmetic (not
// date_trunc('week', ...) in SQL) because ad_stat is fetched once per client
// and grouped in memory here — same "pull raw rows, aggregate in the
// language that also does the trend math" shape Astrum Analyzer's
// trend_alerts.py uses over its own local Postgres reads.
function isoWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sunday..6=Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getWeeklyCampaignHistory(
  clientId: string,
  options: { readonly platform?: "google-ads" | "yandex-direct" | "openai-ads"; readonly includeCurrentPartialWeek?: boolean } = {},
): Promise<readonly CampaignWeeklySeries[]> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();

  let query = supabase
    .from("ad_stat")
    .select("platform, campaign_id, campaign_name, date, cost, clicks, impressions, conversions_total")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .order("date", { ascending: true });
  if (options.platform) query = query.eq("platform", options.platform);

  const { data, error } = await query;
  if (error) throw new Error(`getWeeklyCampaignHistory: failed to read ad_stat: ${error.message}`);
  const rows = (data ?? []) as readonly AdStatRow[];

  const { data: statusRows, error: statusError } = await supabase
    .from("campaign_status")
    .select("platform, campaign_id, is_running")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId);
  if (statusError) throw new Error(`getWeeklyCampaignHistory: failed to read campaign_status: ${statusError.message}`);
  const statusByKey = new Map((statusRows ?? []).map((s) => [`${s.platform}:${s.campaign_id}`, s.is_running as boolean]));

  return aggregateWeeklySeries(rows, statusByKey, options.includeCurrentPartialWeek ?? false);
}

// Pure aggregation step, split out from getWeeklyCampaignHistory so the
// weekly-bucketing logic is unit-testable without a live Supabase call —
// same "deterministic engine, thin I/O wrapper" split Astrum Analyzer's
// metrics.py/store.py use.
export function aggregateWeeklySeries(
  rows: readonly AdStatRow[],
  statusByKey: ReadonlyMap<string, boolean>,
  includeCurrentPartialWeek: boolean,
  today: string = new Date().toISOString().slice(0, 10),
): readonly CampaignWeeklySeries[] {
  const currentWeekStart = isoWeekStart(today);

  // campaign key -> week key -> aggregate. Two-level grouping done in one
  // pass over the (small, per-client) row set rather than N queries.
  const byCampaign = new Map<
    string,
    {
      platform: "google-ads" | "yandex-direct" | "openai-ads";
      campaignId: string;
      campaignName: string;
      weeks: Map<string, { spend: number; clicks: number; impressions: number; conversions: number }>;
    }
  >();

  for (const row of rows) {
    const campaignKey = `${row.platform}:${row.campaign_id}`;
    let campaign = byCampaign.get(campaignKey);
    if (!campaign) {
      campaign = { platform: row.platform, campaignId: row.campaign_id, campaignName: row.campaign_name, weeks: new Map() };
      byCampaign.set(campaignKey, campaign);
    }
    const weekStart = isoWeekStart(row.date);
    let week = campaign.weeks.get(weekStart);
    if (!week) {
      week = { spend: 0, clicks: 0, impressions: 0, conversions: 0 };
      campaign.weeks.set(weekStart, week);
    }
    week.spend += row.cost;
    week.clicks += row.clicks;
    week.impressions += row.impressions;
    week.conversions += row.conversions_total;
  }

  const result: CampaignWeeklySeries[] = [];
  for (const campaign of byCampaign.values()) {
    const weekStarts = [...campaign.weeks.keys()].sort();
    const weeks: WeeklyCampaignPoint[] = weekStarts
      .filter((weekStart) => includeCurrentPartialWeek || weekStart !== currentWeekStart)
      .map((weekStart) => {
        const agg = campaign.weeks.get(weekStart)!;
        return {
          weekStart,
          weekEnd: addDaysIso(weekStart, 6),
          isComplete: weekStart !== currentWeekStart,
          spend: agg.spend,
          clicks: agg.clicks,
          impressions: agg.impressions,
          conversions: agg.conversions,
          cpa: agg.conversions > 0 ? agg.spend / agg.conversions : null,
        };
      });

    result.push({
      platform: campaign.platform,
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      isRunning: statusByKey.get(`${campaign.platform}:${campaign.campaignId}`) ?? null,
      weeks,
    });
  }

  return result;
}

// ── sustained-degradation detection ─────────────────────────────────────
// Direct port of Astrum Analyzer's analysis/trend_alerts.py
// detect_sustained_degradation: not a strict week-over-week streak (real
// data has noise — one flat/down week inside an otherwise-climbing run
// shouldn't hide a genuine multi-week problem). Looks at the trailing
// `minWeeks + 1` weeks and flags a net CPA rise over that whole window, as
// long as at most `maxDipSteps` of the individual steps went down.

const MIN_CONSECUTIVE_WEEKS = 3;
const MIN_TOTAL_INCREASE_PCT = 20;
const MAX_DIP_STEPS = 1;

export interface DegradationAlert {
  readonly platform: "google-ads" | "yandex-direct" | "openai-ads";
  readonly campaignId: string;
  readonly campaignName: string;
  readonly weeksDegrading: number;
  readonly cpaHistory: readonly number[]; // oldest -> newest, only the flagged window
  readonly weekStarts: readonly string[];
  readonly totalIncreasePct: number;
  readonly hypothesis: string;
  readonly recommendation: string;
}

interface DiagnoseSignals {
  readonly cvrFirst: number | null;
  readonly cvrLast: number | null;
  readonly cvrDeltaPct: number | null;
  readonly cpcDeltaPct: number | null;
  readonly conversionsDeltaPct: number | null;
  readonly spendDeltaPct: number | null;
  readonly convDrop: boolean;
  readonly cpcRise: boolean;
  readonly volumeDrop: boolean;
  readonly spendFlat: boolean;
  readonly spendDown: boolean;
}

function diagnose(first: WeeklyCampaignPoint, last: WeeklyCampaignPoint): DiagnoseSignals {
  const cvrFirst = first.clicks > 0 ? (first.conversions / first.clicks) * 100 : null;
  const cvrLast = last.clicks > 0 ? (last.conversions / last.clicks) * 100 : null;
  const cvrDeltaPct = cvrFirst && cvrLast !== null ? ((cvrLast - cvrFirst) / cvrFirst) * 100 : null;

  const cpcFirst = first.clicks > 0 ? first.spend / first.clicks : null;
  const cpcLast = last.clicks > 0 ? last.spend / last.clicks : null;
  const cpcDeltaPct = cpcFirst && cpcLast !== null ? ((cpcLast - cpcFirst) / cpcFirst) * 100 : null;

  const conversionsDeltaPct = first.conversions > 0 ? ((last.conversions - first.conversions) / first.conversions) * 100 : null;
  const spendDeltaPct = first.spend > 0 ? ((last.spend - first.spend) / first.spend) * 100 : null;

  return {
    cvrFirst,
    cvrLast,
    cvrDeltaPct,
    cpcDeltaPct,
    conversionsDeltaPct,
    spendDeltaPct,
    convDrop: cvrDeltaPct !== null && cvrDeltaPct < -20,
    cpcRise: cpcDeltaPct !== null && cpcDeltaPct > 15,
    volumeDrop: conversionsDeltaPct !== null && conversionsDeltaPct < -15,
    spendFlat: spendDeltaPct !== null && Math.abs(spendDeltaPct) <= 15,
    spendDown: spendDeltaPct !== null && spendDeltaPct < -15,
  };
}

function hypothesis(d: DiagnoseSignals): string {
  const parts: string[] = [];
  if (d.convDrop) {
    parts.push(
      `конверсия из клика упала с ${d.cvrFirst!.toFixed(2)}% до ${d.cvrLast!.toFixed(2)}% — похоже на проблему с качеством трафика или посадочной, не с ценой клика`,
    );
  }
  if (d.cpcRise) {
    parts.push(`средняя цена клика выросла на ${d.cpcDeltaPct!.toFixed(0)}% — возможно, обострилась конкуренция в аукционе`);
  }
  if (d.volumeDrop) {
    if (d.spendFlat) {
      parts.push(
        `объём конверсий упал на ${Math.abs(d.conversionsDeltaPct!).toFixed(0)}% при примерно том же расходе (${d.spendDeltaPct!.toFixed(0)}%) — падает конверсия или объём показов`,
      );
    } else if (d.spendDown) {
      parts.push(
        `объём конверсий упал на ${Math.abs(d.conversionsDeltaPct!).toFixed(0)}%, но и расход снизился на ${Math.abs(d.spendDeltaPct!).toFixed(0)}% — возможно, просто снизили бюджет, а не упала эффективность`,
      );
    } else {
      parts.push(`объём конверсий упал на ${Math.abs(d.conversionsDeltaPct!).toFixed(0)}%`);
    }
  }
  if (parts.length === 0) {
    return "Локальных данных недостаточно, чтобы предположить причину — нужна ручная проверка (объявления/конкуренты/сезонность).";
  }
  return "Гипотеза: " + parts.join("; ") + ".";
}

function recommendation(d: DiagnoseSignals): string {
  const actions: string[] = [];
  if (d.convDrop && !d.cpcRise) {
    actions.push("Обновите объявления/креативы или сузьте таргетинг — цена клика не растёт, проблема в качестве трафика или посадочной странице");
  }
  if (d.cpcRise) {
    actions.push(
      "Проверьте ставку и Impression Share (rank-lost vs budget-lost для Google, WeeklySpendLimit/DailyBudget для Яндекса): если кампания упирается в свою ставку, её можно поднять; если нет — конкуренция обошла бюджет, и накачивать ставку дальше не даст эффекта",
    );
  }
  if (d.volumeDrop && d.spendFlat) {
    actions.push("Расширьте охват — гео/ключевые фразы/аудиторию — объём падает при том же расходе, значит упёрлись не в деньги, а в размер аудитории");
  }
  if (d.volumeDrop && d.spendDown && actions.length === 0) {
    actions.push("Если сокращение бюджета не было намеренным решением — верните расход к прежнему уровню и посмотрите, восстановится ли объём");
  }
  if (actions.length === 0) {
    return "Автоматической рекомендации нет — проверьте кампанию вручную (объявления/конкуренты/сезонность).";
  }
  return "Рекомендация: " + actions.join("; ") + ".";
}

export interface DegradationOptions {
  readonly minWeeks?: number;
  readonly minTotalIncreasePct?: number;
  readonly maxDipSteps?: number;
  readonly excludeStopped?: boolean;
}

export async function detectSustainedDegradation(
  clientId: string,
  options: DegradationOptions & { readonly platform?: "google-ads" | "yandex-direct" | "openai-ads" } = {},
): Promise<readonly DegradationAlert[]> {
  const series = await getWeeklyCampaignHistory(clientId, { platform: options.platform });
  return computeDegradation(series, options);
}

// Pure detection step over an already-fetched series — same split as
// aggregateWeeklySeries, unit-testable without a live Supabase call.
export function computeDegradation(series: readonly CampaignWeeklySeries[], options: DegradationOptions = {}): readonly DegradationAlert[] {
  const minWeeks = options.minWeeks ?? MIN_CONSECUTIVE_WEEKS;
  const minTotalIncreasePct = options.minTotalIncreasePct ?? MIN_TOTAL_INCREASE_PCT;
  const maxDipSteps = options.maxDipSteps ?? MAX_DIP_STEPS;
  const excludeStopped = options.excludeStopped ?? true;
  const windowSize = minWeeks + 1;

  const alerts: DegradationAlert[] = [];
  for (const campaign of series) {
    if (excludeStopped && campaign.isRunning === false) continue;

    const withCpa = campaign.weeks.filter((w) => w.cpa !== null);
    if (withCpa.length < windowSize) continue;

    const window = withCpa.slice(-windowSize);
    const cpaHistory = window.map((w) => w.cpa!);

    let dips = 0;
    for (let i = 1; i < cpaHistory.length; i++) {
      if (cpaHistory[i] < cpaHistory[i - 1]) dips++;
    }
    const totalIncreasePct = cpaHistory[0] > 0 ? ((cpaHistory[cpaHistory.length - 1] - cpaHistory[0]) / cpaHistory[0]) * 100 : 0;

    if (dips > maxDipSteps || totalIncreasePct < minTotalIncreasePct) continue;

    const diag = diagnose(window[0], window[window.length - 1]);
    alerts.push({
      platform: campaign.platform,
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      weeksDegrading: windowSize - 1,
      cpaHistory,
      weekStarts: window.map((w) => w.weekStart),
      totalIncreasePct,
      hypothesis: hypothesis(diag),
      recommendation: recommendation(diag),
    });
  }

  alerts.sort((a, b) => b.totalIncreasePct - a.totalIncreasePct);
  return alerts;
}
