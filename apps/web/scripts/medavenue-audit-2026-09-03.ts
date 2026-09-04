// One-off data pull for the 2026-09-03 Медавеню 14-day audit, requested by
// the Owner explicitly to exercise ONLY the generic (non-client-specific)
// audit tooling in lib/tools/{google-ads,yandex-direct}.ts — no bespoke
// GAQL/report code beyond wiring these exact exported functions together.
// Safe: read-only calls (report/get/list), nothing here mutates a real
// campaign, budget, bid, or keyword.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-audit-2026-09-03.ts > /tmp/medavenue-audit-raw.json
import * as yandex from "../lib/tools/yandex-direct.ts";
import * as google from "../lib/tools/google-ads.ts";

const YANDEX_LOGIN = "porg-yw2ynqgs";
const YANDEX_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const GOOGLE_CUSTOMER_ID = "9714539590";
const GOOGLE_REFRESH_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";

const YANDEX_GOAL_IDS = [
  "477291881",
  "276054933",
  "505646406",
  "276055053",
  "477289884",
  "477293288",
  "477294948",
];

const GOOGLE_CONVERSION_ACTION_IDS = [
  "7353229186",
  "7353273296",
  "7353279815",
  "7469728245",
  "983588559",
  "7724447681",
];

const START_DATE = "2026-08-20";
const END_DATE = "2026-09-02"; // 14 days, ending yesterday (today = 2026-09-03, today's data incomplete)

async function main() {
  const out: Record<string, unknown> = {};

  // ---- Yandex Direct ----
  try {
    out.yandexCurrency = await yandex.getAccountCurrency(YANDEX_LOGIN, YANDEX_TOKEN_ENV);
  } catch (e) {
    out.yandexCurrencyError = String(e);
  }

  let yandexCampaigns: readonly { Id: number; Name: string; Status: string; State: string }[] = [];
  try {
    yandexCampaigns = await yandex.listCampaigns(YANDEX_LOGIN, YANDEX_TOKEN_ENV);
    out.yandexCampaigns = yandexCampaigns;
  } catch (e) {
    out.yandexCampaignsError = String(e);
  }

  try {
    out.yandexCampaignReport = await yandex.getCampaignReport(
      YANDEX_LOGIN,
      { startDate: START_DATE, endDate: END_DATE, goalIds: YANDEX_GOAL_IDS },
      YANDEX_TOKEN_ENV,
    );
  } catch (e) {
    out.yandexCampaignReportError = String(e);
  }

  try {
    out.yandexSearchTerms = await yandex.getSearchTermsReport(
      YANDEX_LOGIN,
      { startDate: START_DATE, endDate: END_DATE, goalIds: YANDEX_GOAL_IDS },
      YANDEX_TOKEN_ENV,
    );
  } catch (e) {
    out.yandexSearchTermsError = String(e);
  }

  const budgetInfo: Record<string, unknown> = {};
  for (const c of yandexCampaigns) {
    try {
      const weekly = await yandex.getWeeklySpendLimit(c.Id, YANDEX_LOGIN, YANDEX_TOKEN_ENV);
      const daily = await yandex.getDailyBudget(c.Id, YANDEX_LOGIN, YANDEX_TOKEN_ENV);
      budgetInfo[c.Id] = { name: c.Name, status: c.Status, state: c.State, weekly, daily };
    } catch (e) {
      budgetInfo[c.Id] = { name: c.Name, error: String(e) };
    }
  }
  out.yandexBudgetInfo = budgetInfo;

  // ---- Google Ads ----
  const googleOptions: { refreshTokenEnv: string; loginCustomerId?: string } = { refreshTokenEnv: GOOGLE_REFRESH_ENV };

  try {
    out.googleCurrency = await google.getAccountCurrency(GOOGLE_CUSTOMER_ID, googleOptions);
  } catch (e) {
    out.googleCurrencyError = String(e);
    try {
      const withMcc = { refreshTokenEnv: GOOGLE_REFRESH_ENV, loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID };
      out.googleCurrencyRetryWithMcc = await google.getAccountCurrency(GOOGLE_CUSTOMER_ID, withMcc);
      googleOptions.loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    } catch (e2) {
      out.googleCurrencyRetryError = String(e2);
    }
  }

  try {
    out.googleCampaigns = await google.listCampaigns(GOOGLE_CUSTOMER_ID, googleOptions);
  } catch (e) {
    out.googleCampaignsError = String(e);
  }

  try {
    out.googleCampaignReport = await google.getCampaignReport(
      GOOGLE_CUSTOMER_ID,
      { startDate: START_DATE, endDate: END_DATE, conversionActionIds: GOOGLE_CONVERSION_ACTION_IDS },
      googleOptions,
    );
  } catch (e) {
    out.googleCampaignReportError = String(e);
  }

  try {
    out.googleSearchTerms = await google.getSearchTermsReport(
      GOOGLE_CUSTOMER_ID,
      { startDate: START_DATE, endDate: END_DATE },
      googleOptions,
    );
  } catch (e) {
    out.googleSearchTermsError = String(e);
  }

  try {
    out.googleImpressionShare = await google.getImpressionShareReport(
      GOOGLE_CUSTOMER_ID,
      { startDate: START_DATE, endDate: END_DATE },
      googleOptions,
    );
  } catch (e) {
    out.googleImpressionShareError = String(e);
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
