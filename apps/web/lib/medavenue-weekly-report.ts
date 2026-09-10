// Weekly Медавеню reporting job — Vercel Cron target (see vercel.json,
// route at app/api/cron/medavenue-weekly-sheet-report). Reuses the
// client-ad-account reporting foundation (ad_stat, target_conversion,
// client_ad_account — see project_client_ad_account_access_model memory)
// instead of re-deriving conversion IDs here, so this file automatically
// benefits from any future fix to that pipeline (e.g. the 2026-09-10
// Yandex AUTO-attribution fix in yandex-direct.ts).
//
// Médavenue-specific for now (hardcoded IDs below) — see
// docs/07-planning/backlog.md for the planned generalization once other
// StarMedia clients get the same per-client Google Sheet treatment.
import { getSupabase, getSupabaseOwnerTenantId } from "./supabase.ts";
import { syncAdStats } from "./sync-ad-stats.ts";
import { readRange, writeRange } from "./tools/google-sheets.ts";
import { sendInternalEmail } from "./tools/email-provider.ts";

const MEDAVENUE_CLIENT_ID = "6ff0a928-cc9e-4ad5-ba7d-09fa4eea718d";
const MEDAVENUE_SHEET_ID = "1Fmh342iE28Bgk9z-2-Ds1LSIQUoiFzcUP3ERICKsawY";
const LOG_TAB = "МедАвеню - Лог правок";
const TAB_BY_PLATFORM: Record<"google-ads" | "yandex-direct", string> = {
  "google-ads": "Google Ads",
  "yandex-direct": "Яндекс Директ",
};
const ALERT_EMAIL = process.env.PPC_NEWS_DIGEST_TO;

const HEADER = [
  "Дата",
  "Площадка",
  "Кампания",
  "Расход",
  "Показы",
  "Клики",
  "CTR",
  "Конверсии",
  "CR",
  "CPA",
  "Δ Конверсии, %",
  "Δ CPA, %",
  "Комментарий",
] as const;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Most recent complete Monday-Sunday week strictly before `now` — "closed
// week" per the user's request (the week containing `now` isn't over yet).
export function getClosedWeekRange(now: Date = new Date()): { readonly start: string; readonly end: string } {
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceLastMonday = day === 0 ? 6 : day - 1;
  const thisMonday = new Date(now);
  thisMonday.setUTCDate(now.getUTCDate() - daysSinceLastMonday);
  const lastSunday = new Date(thisMonday);
  lastSunday.setUTCDate(thisMonday.getUTCDate() - 1);
  const lastMonday = new Date(lastSunday);
  lastMonday.setUTCDate(lastSunday.getUTCDate() - 6);
  return { start: isoDate(lastMonday), end: isoDate(lastSunday) };
}

function shiftWeek(range: { readonly start: string; readonly end: string }, weeks: number): { start: string; end: string } {
  const start = new Date(range.start);
  const end = new Date(range.end);
  start.setUTCDate(start.getUTCDate() + weeks * 7);
  end.setUTCDate(end.getUTCDate() + weeks * 7);
  return { start: isoDate(start), end: isoDate(end) };
}

interface CampaignWeekStat {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly cost: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversions: number;
}

async function fetchWeekStats(
  platform: "google-ads" | "yandex-direct",
  range: { readonly start: string; readonly end: string },
): Promise<readonly CampaignWeekStat[]> {
  const { data, error } = await getSupabase()
    .from("ad_stat")
    .select("campaign_id, campaign_name, cost, impressions, clicks, conversions_total")
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .eq("client_id", MEDAVENUE_CLIENT_ID)
    .eq("platform", platform)
    .gte("date", range.start)
    .lte("date", range.end);
  if (error) throw new Error(`Failed to read ad_stat: ${error.message}`);

  const byCampaign = new Map<string, CampaignWeekStat>();
  for (const row of data ?? []) {
    const existing = byCampaign.get(row.campaign_id) ?? {
      campaignId: row.campaign_id,
      campaignName: row.campaign_name ?? row.campaign_id,
      cost: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
    };
    byCampaign.set(row.campaign_id, {
      ...existing,
      cost: existing.cost + Number(row.cost),
      impressions: existing.impressions + Number(row.impressions),
      clicks: existing.clicks + Number(row.clicks),
      conversions: existing.conversions + Number(row.conversions_total),
    });
  }
  return [...byCampaign.values()];
}

interface LogEntry {
  readonly date: string; // dd.mm.yyyy as stored in the sheet
  readonly platform: string;
  readonly campaign: string;
  readonly changeType: string;
  readonly change: string;
}

async function readLogEntries(): Promise<readonly LogEntry[]> {
  const rows = await readRange(MEDAVENUE_SHEET_ID, `${LOG_TAB}!A2:H1000`);
  return rows
    .filter((r) => r[0] && r[3]) // has a date and a campaign name — skip stub/placeholder rows
    .map((r) => ({ date: r[0], platform: r[2] ?? "", campaign: r[3], changeType: r[4] ?? "", change: r[7] ?? "" }));
}

function parseSheetDate(ddmmyyyy: string): Date | null {
  const m = ddmmyyyy.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

// A 14-day lookback from the closed week's start — catches a change logged
// mid-week or up to a week before the reporting week began, so its effect
// has a chance to already show up in this week's numbers.
function matchLogEntries(
  entries: readonly LogEntry[],
  platform: string,
  campaignName: string,
  weekStart: string,
): readonly LogEntry[] {
  const cutoff = new Date(weekStart);
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);
  const weekStartDate = new Date(weekStart);
  return entries.filter((e) => {
    if (e.platform !== platform || e.campaign !== campaignName) return false;
    const d = parseSheetDate(e.date);
    return d !== null && d >= cutoff && d <= weekStartDate;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pctDelta(curr: number, prev: number): number | "" {
  if (prev === 0) return "";
  return round2(((curr - prev) / prev) * 100);
}

interface ReportRow {
  readonly key: string; // period|platform|campaignName — identifies a unique row for upsert
  readonly values: readonly (string | number)[];
}

function buildRows(
  platform: "google-ads" | "yandex-direct",
  period: string,
  weekStart: string,
  current: readonly CampaignWeekStat[],
  previous: readonly CampaignWeekStat[],
  logEntries: readonly LogEntry[],
): readonly ReportRow[] {
  const prevByCampaign = new Map(previous.map((s) => [s.campaignId, s]));
  return current
    .sort((a, b) => b.cost - a.cost)
    .map((stat) => {
      const ctr = stat.impressions > 0 ? round2((stat.clicks / stat.impressions) * 100) : 0;
      const cr = stat.clicks > 0 ? round2((stat.conversions / stat.clicks) * 100) : 0;
      const cpa = stat.conversions > 0 ? round2(stat.cost / stat.conversions) : "";
      const prev = prevByCampaign.get(stat.campaignId);
      const prevCpa = prev && prev.conversions > 0 ? prev.cost / prev.conversions : 0;
      const deltaConversions = prev ? pctDelta(stat.conversions, prev.conversions) : "";
      const deltaCpa = prev && typeof cpa === "number" ? pctDelta(cpa, prevCpa) : "";
      const matches = matchLogEntries(logEntries, platform, stat.campaignName, weekStart);
      const comment = matches.map((m) => `Правка ${m.date} (${m.changeType})`).join("; ");
      return {
        key: `${period}|${platform}|${stat.campaignName}`,
        values: [
          period,
          platform,
          stat.campaignName,
          round2(stat.cost),
          stat.impressions,
          stat.clicks,
          ctr,
          round2(stat.conversions),
          cr,
          cpa,
          deltaConversions,
          deltaCpa,
          comment,
        ],
      };
    });
}

// Upserts by (period, platform, campaign) key — re-running the same week
// (retry, manual backfill) overwrites its own rows instead of duplicating
// them. Deliberately does NOT use the Sheets `:append` endpoint (see
// google-sheets.ts's appendRows) — its "find the table, insert after it"
// heuristic inserted new rows right after the header instead of at the
// bottom on a sparsely-filled sheet (found for real 2026-09-10 filling
// МедАвеню - Лог правок), which would silently corrupt row-number-based
// upserts here. Always computes the exact next row explicitly instead.
async function upsertRows(tab: string, rows: readonly ReportRow[]): Promise<void> {
  const existing = await readRange(MEDAVENUE_SHEET_ID, `${tab}!A1:C10000`);
  const keyToRow = new Map<string, number>();
  existing.forEach((r, i) => {
    if (i === 0) return; // header
    if (!r[0] || !r[2]) return;
    keyToRow.set(`${r[0]}|${r[1]}|${r[2]}`, i + 1);
  });

  let nextRow = existing.length + 1;
  const writes: Array<{ row: number; values: readonly (string | number)[] }> = [];
  for (const row of rows) {
    const existingRow = keyToRow.get(row.key);
    if (existingRow) {
      writes.push({ row: existingRow, values: row.values });
    } else {
      writes.push({ row: nextRow, values: row.values });
      nextRow += 1;
    }
  }

  for (const w of writes) {
    const lastCol = String.fromCharCode("A".charCodeAt(0) + w.values.length - 1);
    await writeRange(MEDAVENUE_SHEET_ID, `${tab}!A${w.row}:${lastCol}${w.row}`, [[...w.values]]);
  }
}

interface VerificationMismatch {
  readonly tab: string;
  readonly key: string;
  readonly field: string;
  readonly expected: string | number;
  readonly actual: string | number | undefined;
}

// Reads back exactly what was just written and diffs it against what was
// intended — the habit this whole job exists to enforce (see the 2026-09-10
// Google Ads sync gap and Yandex attribution-model bug, both only found by
// comparing written numbers against a second, independent source). A float
// tolerance of 0.01 absorbs Sheets' own display rounding, not real drift.
async function verifyRows(tab: string, rows: readonly ReportRow[]): Promise<readonly VerificationMismatch[]> {
  const sheetRows = await readRange(MEDAVENUE_SHEET_ID, `${tab}!A1:M10000`);
  const byKey = new Map<string, readonly string[]>();
  sheetRows.forEach((r, i) => {
    if (i === 0 || !r[0] || !r[2]) return;
    byKey.set(`${r[0]}|${r[1]}|${r[2]}`, r);
  });

  const mismatches: VerificationMismatch[] = [];
  for (const row of rows) {
    const actualRow = byKey.get(row.key);
    if (!actualRow) {
      mismatches.push({ tab, key: row.key, field: "(вся строка)", expected: "записана", actual: "не найдена" });
      continue;
    }
    row.values.forEach((expected, colIndex) => {
      const actual = actualRow[colIndex];
      if (typeof expected === "number") {
        const actualNum = Number(String(actual ?? "").replace(",", "."));
        if (!Number.isFinite(actualNum) || Math.abs(actualNum - expected) > 0.01) {
          mismatches.push({ tab, key: row.key, field: HEADER[colIndex], expected, actual });
        }
      } else if (String(actual ?? "") !== String(expected)) {
        mismatches.push({ tab, key: row.key, field: HEADER[colIndex], expected, actual });
      }
    });
  }
  return mismatches;
}

export interface WeeklyReportResult {
  readonly period: string;
  readonly rowsWritten: { readonly "google-ads": number; readonly "yandex-direct": number };
  readonly mismatches: readonly VerificationMismatch[];
  readonly emailSent: boolean;
}

export async function runMedavenueWeeklyReport(referenceDate: Date = new Date()): Promise<WeeklyReportResult> {
  const week = getClosedWeekRange(referenceDate);
  const prevWeek = shiftWeek(week, -1);
  const period = `${formatDate(week.start)} - ${formatDate(week.end)}`;

  const { data: accounts, error } = await getSupabase()
    .from("client_ad_account")
    .select("id, platform")
    .eq("client_id", MEDAVENUE_CLIENT_ID)
    .eq("status", "active");
  if (error) throw new Error(`Failed to read client_ad_account: ${error.message}`);

  // Ensure ad_stat is fresh for both weeks before reading it back — cheap
  // (upsert, same rows re-written if already synced) and closes exactly the
  // kind of silent gap found 2026-09-10 (Google Ads sync had stalled 5+
  // days without this job noticing).
  for (const account of accounts ?? []) {
    await syncAdStats(account.id, { startDate: prevWeek.start, endDate: week.end });
  }

  const logEntries = await readLogEntries();
  const mismatches: VerificationMismatch[] = [];
  const rowsWritten = { "google-ads": 0, "yandex-direct": 0 };

  for (const platform of ["google-ads", "yandex-direct"] as const) {
    const [current, previous] = await Promise.all([
      fetchWeekStats(platform, week),
      fetchWeekStats(platform, prevWeek),
    ]);
    const rows = buildRows(platform, period, week.start, current, previous, logEntries);
    const tab = TAB_BY_PLATFORM[platform];
    await upsertRows(tab, rows);
    rowsWritten[platform] = rows.length;
    mismatches.push(...(await verifyRows(tab, rows)));
  }

  let emailSent = false;
  if (mismatches.length > 0 && ALERT_EMAIL) {
    const body =
      `Еженедельный отчёт Медавеню за ${period}: самопроверка нашла ${mismatches.length} расхождение(й) ` +
      `между посчитанными и записанными в Google Sheets значениями.\n\n` +
      mismatches
        .map((m) => `- [${m.tab}] ${m.key} — ${m.field}: ожидалось "${m.expected}", в таблице "${m.actual}"`)
        .join("\n");
    emailSent = await sendInternalEmail(ALERT_EMAIL, `⚠ Медавеню: расхождение в еженедельном отчёте (${period})`, body);
  }

  return { period, rowsWritten, mismatches, emailSent };
}
