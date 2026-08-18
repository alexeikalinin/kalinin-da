// Tool Integration §1 — PPC Agent's "настройка кампаний в Яндекс.Директ",
// backed by the real Yandex Direct API v5 (JSON). Mirrors google-ads.ts:
// every created campaign is immediately suspended — nothing here ever
// enables real ad spend.
import { getYandexAccessToken, isYandexConfigured } from "./yandex-oauth.ts";
import { parseTsv } from "./tsv.ts";

const API_BASE = "https://api.direct.yandex.com/json/v5";
const DEFAULT_TOTAL_DAILY_BUDGET_MICROS = 20_000_000; // 20 currency units/day, placeholder default
// Direct API v5 rejects DailyBudget below 9 currency units (error code 5005,
// "Значение поля DailyBudget должно быть в диапазоне от 9 до 1000000000") —
// found for real 2026-08-17 while testing the async workflow runner's
// retry/escalate path (a real bug, not an intentional forced failure).
const MIN_DAILY_BUDGET_MICROS = 9_000_000;

export { isYandexConfigured };

// clientLogin — the client's Yandex login, required only in agency mode
// (acting on behalf of a client account under an agency login). Personal
// account use omits it. accessTokenEnv — which identity's token to use
// (client ad-account reporting foundation, 2026-08-18); defaults to the
// original single-tenant YANDEX_ACCESS_TOKEN via yandex-oauth.ts.
async function callDirect(
  resource: string,
  method: string,
  params: unknown,
  clientLogin?: string,
  accessTokenEnv?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getYandexAccessToken(accessTokenEnv)}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;

  const response = await fetch(`${API_BASE}/${resource}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ method, params }),
  });
  const data = (await response.json()) as { error?: unknown; result?: unknown };
  if (data.error) {
    throw new Error(`Yandex Direct API call failed: ${JSON.stringify(data.error)}`);
  }
  return data.result;
}

interface DirectCampaign {
  readonly Id: number;
  readonly Name: string;
  readonly Status: string;
  readonly State: string;
}

export async function listCampaigns(clientLogin?: string, accessTokenEnv?: string): Promise<readonly DirectCampaign[]> {
  const result = (await callDirect(
    "campaigns",
    "get",
    { SelectionCriteria: {}, FieldNames: ["Id", "Name", "Status", "State"] },
    clientLogin,
    accessTokenEnv,
  )) as { Campaigns: DirectCampaign[] };
  return result.Campaigns ?? [];
}

// Creates a real TextCampaign, then immediately suspends it. Idempotent by
// name — a repeated call for the same project reuses the existing
// campaign instead of duplicating it.
export async function createOrReusePausedCampaign(
  name: string,
  budgetShare: number,
  clientLogin?: string,
): Promise<{ readonly campaignId: number; readonly reused: boolean }> {
  const existing = await listCampaigns(clientLogin);
  const match = existing.find((c) => c.Name === name);
  if (match) return { campaignId: match.Id, reused: true };

  const dailyBudgetMicros = Math.max(
    MIN_DAILY_BUDGET_MICROS,
    Math.round(DEFAULT_TOTAL_DAILY_BUDGET_MICROS * budgetShare),
  );

  const addResult = (await callDirect(
    "campaigns",
    "add",
    {
      Campaigns: [
        {
          Name: name,
          StartDate: new Date().toISOString().slice(0, 10),
          DailyBudget: { Amount: dailyBudgetMicros, Mode: "STANDARD" },
          TextCampaign: {
            BiddingStrategy: {
              Search: { BiddingStrategyType: "HIGHEST_POSITION" },
              Network: { BiddingStrategyType: "SERVING_OFF" },
            },
          },
        },
      ],
    },
    clientLogin,
  )) as { AddResults: ReadonlyArray<{ Id?: number; Errors?: unknown[] }> };

  const added = addResult.AddResults[0];
  if (!added?.Id) {
    throw new Error(`Yandex Direct campaign creation failed: ${JSON.stringify(added?.Errors)}`);
  }

  await callDirect("campaigns", "suspend", { SelectionCriteria: { Ids: [added.Id] } }, clientLogin);

  return { campaignId: added.Id, reused: false };
}

export interface DirectCampaignReportRow {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly date: string; // YYYY-MM-DD
  readonly cost: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversionsByGoal: Record<string, number>;
}

// Reports API (a separate resource from the JSON campaigns.get/add/suspend
// methods used above) — one request returns campaign metrics AND per-goal
// conversion columns together (Yandex bakes goal columns directly into the
// TSV, unlike Google Ads' two-query split — see google-ads.ts's
// getCampaignReport comment). Real gotchas found 2026-08-18 building the
// Медавеню report: `CampaignStatus` is NOT a valid field for
// CAMPAIGN_PERFORMANCE_REPORT (400 "неверное значение перечисления"); the
// API can also legitimately respond 201/202 with a Retry-After-style delay
// while the report is generated — this function does not yet retry on
// that (real accounts so far always returned 200 synchronously within a
// normal request timeout, but a busy/large report could still 202).
export async function getCampaignReport(
  clientLogin: string | undefined,
  params: { readonly startDate: string; readonly endDate: string; readonly goalIds: readonly string[] },
  accessTokenEnv?: string,
): Promise<readonly DirectCampaignReportRow[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getYandexAccessToken(accessTokenEnv)}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json",
    processingMode: "auto",
    returnMoneyInMicros: "false",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;

  const response = await fetch(`${API_BASE}/reports`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      params: {
        SelectionCriteria: { DateFrom: params.startDate, DateTo: params.endDate },
        Goals: params.goalIds,
        // "Date" (not just DateFrom/DateTo in SelectionCriteria) is what
        // makes the report return one row per campaign PER DAY instead of
        // one aggregated row for the whole range — needed for real
        // day-by-day ad_stat history, same reasoning as google-ads.ts's
        // segments.date.
        FieldNames: ["Date", "CampaignId", "CampaignName", "Impressions", "Clicks", "Cost", "Conversions"],
        ReportName: `ama-report-${Date.now()}`,
        ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
        DateRangeType: "CUSTOM_DATE",
        Format: "TSV",
        IncludeVAT: "NO",
        IncludeDiscount: "NO",
      },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Yandex Direct Reports API call failed: ${response.status} ${text}`);
  }

  // First line is the report title ("Report <id> (<from> - <to>)"), not a
  // TSV header — skip it before handing off to the generic parser. A
  // trailing "Total rows: N" footer line also showed up once the report
  // was segmented by Date (not present on the earlier non-segmented
  // report) — strip it too, or it gets misparsed as a data row with
  // garbage column values.
  const withoutTitle = text.slice(text.indexOf("\n") + 1);
  const withoutFooter = withoutTitle.replace(/\n?Total rows: \d+\s*$/, "");
  const rows = parseTsv(withoutFooter);

  return rows.map((row) => {
    const conversionsByGoal: Record<string, number> = {};
    for (const goalId of params.goalIds) {
      const value = row[`Conversions_${goalId}_LSCCD`];
      conversionsByGoal[goalId] = value && value !== "--" ? Number(value) : 0;
    }
    return {
      campaignId: row.CampaignId,
      campaignName: row.CampaignName,
      date: row.Date,
      cost: Number(row.Cost || 0),
      impressions: Number(row.Impressions || 0),
      clicks: Number(row.Clicks || 0),
      conversionsByGoal,
    };
  });
}
