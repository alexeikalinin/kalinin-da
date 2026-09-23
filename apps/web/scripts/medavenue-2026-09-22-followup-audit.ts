// Read-only follow-up (2026-09-22) to the 2026-09-19 autotargeting audit.
// Answers 4 specific questions + a budget-headroom summary for the 5
// campaigns flagged 🟢 "scale" in the previous audit. No writes.
import {
  getSearchTermsReport,
  getCampaignReport,
  getDailyBudget,
  getWeeklySpendLimit,
} from "../lib/tools/yandex-direct.ts";

const CLIENT_LOGIN = "porg-yw2ynqgs";
const ACCESS_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const GOAL_IDS = [
  "477291881",
  "276054933",
  "505646406",
  "276055053",
  "477289884",
  "477293288",
  "477294948",
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const LAZER_OBREZANIE = "709679607";
const GINEKOLOG_MAXCLICK = "708398165";
const UROLOG_MAXCLICKS = "707993661";
const ANDROLOGIYA = "709679599";

const SCALE_CAMPAIGNS: Record<string, string> = {
  "706782562": "УЗИ плода",
  "708468394": "Флеболог+Варикоз",
  "708468559": "Маммолог",
  "708468419": "Удаление новообразований",
  "707005501": "Дерматология",
};

async function main() {
  const start30 = daysAgo(30);
  const start14 = daysAgo(14);
  const start7 = daysAgo(7);
  const end = today();

  console.log("################ Q1: Лазерное обрезание (709679607) — search terms, 30d ################");
  const searchRows = await getSearchTermsReport(CLIENT_LOGIN, { startDate: start14, endDate: end, goalIds: GOAL_IDS }, ACCESS_TOKEN_ENV);
  const lazerRows = searchRows
    .filter((r) => r.campaignId === LAZER_OBREZANIE)
    .sort((a, b) => b.cost - a.cost);
  console.log(`Total query rows: ${lazerRows.length}`);
  let totalCost = 0;
  let totalClicks = 0;
  let totalConv = 0;
  for (const r of lazerRows) {
    totalCost += r.cost;
    totalClicks += r.clicks;
    totalConv += Object.values(r.conversionsByGoal).reduce((a, b) => a + b, 0);
  }
  console.log(`Sum: cost=${totalCost.toFixed(2)} clicks=${totalClicks} conv=${totalConv}`);
  console.log("Top queries by cost:");
  for (const r of lazerRows.slice(0, 15)) {
    const conv = Object.values(r.conversionsByGoal).reduce((a, b) => a + b, 0);
    console.log(`  "${r.searchTerm}" [${r.adGroupName}] cat=${r.targetingCategory} cost=${r.cost.toFixed(2)} clicks=${r.clicks} conv=${conv}`);
  }

  console.log("\n################ Q2/Q3: Гинеколог MaxClick (708398165) & Уролог MaxClicks (707993661) — 7d budget+conv ################");
  const campReport7d = await getCampaignReport(CLIENT_LOGIN, { startDate: start7, endDate: end, goalIds: GOAL_IDS }, ACCESS_TOKEN_ENV);
  for (const [id, label] of [
    [GINEKOLOG_MAXCLICK, "Гинеколог MaxClick"],
    [UROLOG_MAXCLICKS, "Уролог MaxClicks"],
  ] as const) {
    const rows = campReport7d.filter((r) => r.campaignId === id);
    let cost = 0;
    let clicks = 0;
    let conv = 0;
    for (const r of rows) {
      cost += r.cost;
      clicks += r.clicks;
      conv += Object.values(r.conversionsByGoal).reduce((a, b) => a + b, 0);
    }
    const daily = await getDailyBudget(Number(id), CLIENT_LOGIN, ACCESS_TOKEN_ENV);
    const weekly = await getWeeklySpendLimit(Number(id), CLIENT_LOGIN, ACCESS_TOKEN_ENV);
    console.log(`\n-- ${label} (${id}) --`);
    console.log(`  DailyBudget: ${daily.dailyBudgetMicros !== null ? (daily.dailyBudgetMicros / 1e6).toFixed(2) + " BYN/day, mode=" + daily.mode : "none (autostrategy)"}`);
    console.log(`  WeeklySpendLimit: ${weekly.weeklySpendLimitMicros !== null ? (weekly.weeklySpendLimitMicros / 1e6).toFixed(2) + " BYN/week, strategy=" + weekly.strategyType + " scope=" + weekly.scope : "none"}`);
    console.log(`  Last 7d: cost=${cost.toFixed(2)} BYN, clicks=${clicks}, conversions=${conv}`);
  }

  console.log("\n################ Q4: Андрология (709679599) — budget headroom, 7d & 14d ################");
  const campReport14d = await getCampaignReport(CLIENT_LOGIN, { startDate: start14, endDate: end, goalIds: GOAL_IDS }, ACCESS_TOKEN_ENV);
  {
    const id = ANDROLOGIYA;
    const rows7 = campReport7d.filter((r) => r.campaignId === id);
    const rows14 = campReport14d.filter((r) => r.campaignId === id);
    const cost7 = rows7.reduce((a, r) => a + r.cost, 0);
    const cost14 = rows14.reduce((a, r) => a + r.cost, 0);
    const conv7 = rows7.reduce((a, r) => a + Object.values(r.conversionsByGoal).reduce((x, y) => x + y, 0), 0);
    const daily = await getDailyBudget(Number(id), CLIENT_LOGIN, ACCESS_TOKEN_ENV);
    const weekly = await getWeeklySpendLimit(Number(id), CLIENT_LOGIN, ACCESS_TOKEN_ENV);
    console.log(`  DailyBudget: ${daily.dailyBudgetMicros !== null ? (daily.dailyBudgetMicros / 1e6).toFixed(2) + " BYN/day, mode=" + daily.mode : "none (autostrategy)"}`);
    console.log(`  WeeklySpendLimit: ${weekly.weeklySpendLimitMicros !== null ? (weekly.weeklySpendLimitMicros / 1e6).toFixed(2) + " BYN/week, strategy=" + weekly.strategyType + " scope=" + weekly.scope : "none"}`);
    console.log(`  Last 7d: cost=${cost7.toFixed(2)} BYN, conv=${conv7}`);
    console.log(`  Last 14d: cost=${cost14.toFixed(2)} BYN (avg/day=${(cost14 / 14).toFixed(2)})`);
    if (daily.dailyBudgetMicros !== null) {
      const dailyLimit = daily.dailyBudgetMicros / 1e6;
      const weeklyLimitFromDaily = dailyLimit * 7;
      console.log(`  Ratio (7d fact / 7d limit-from-daily): ${((cost7 / weeklyLimitFromDaily) * 100).toFixed(1)}%`);
    }
    if (weekly.weeklySpendLimitMicros !== null) {
      const limit = weekly.weeklySpendLimitMicros / 1e6;
      console.log(`  Ratio (7d fact / WeeklySpendLimit): ${((cost7 / limit) * 100).toFixed(1)}%`);
    }
  }

  console.log("\n################ Budget summary: 5 'scale' campaigns, 7d & 14d ################");
  for (const [id, label] of Object.entries(SCALE_CAMPAIGNS)) {
    const rows7 = campReport7d.filter((r) => r.campaignId === id);
    const rows14 = campReport14d.filter((r) => r.campaignId === id);
    const cost7 = rows7.reduce((a, r) => a + r.cost, 0);
    const cost14 = rows14.reduce((a, r) => a + r.cost, 0);
    const conv7 = rows7.reduce((a, r) => a + Object.values(r.conversionsByGoal).reduce((x, y) => x + y, 0), 0);
    const daily = await getDailyBudget(Number(id), CLIENT_LOGIN, ACCESS_TOKEN_ENV);
    const weekly = await getWeeklySpendLimit(Number(id), CLIENT_LOGIN, ACCESS_TOKEN_ENV);
    console.log(`\n-- ${label} (${id}) --`);
    console.log(`  DailyBudget: ${daily.dailyBudgetMicros !== null ? (daily.dailyBudgetMicros / 1e6).toFixed(2) + " BYN/day, mode=" + daily.mode : "none (autostrategy)"}`);
    console.log(`  WeeklySpendLimit: ${weekly.weeklySpendLimitMicros !== null ? (weekly.weeklySpendLimitMicros / 1e6).toFixed(2) + " BYN/week, strategy=" + weekly.strategyType + " scope=" + weekly.scope : "none"}`);
    console.log(`  7d fact=${cost7.toFixed(2)} BYN, conv=${conv7}; 14d fact=${cost14.toFixed(2)} BYN (avg/day=${(cost14 / 14).toFixed(2)})`);
    if (daily.dailyBudgetMicros !== null) {
      const weeklyLimitFromDaily = (daily.dailyBudgetMicros / 1e6) * 7;
      console.log(`  Ratio vs daily*7: ${((cost7 / weeklyLimitFromDaily) * 100).toFixed(1)}%`);
    }
    if (weekly.weeklySpendLimitMicros !== null) {
      const limit = weekly.weeklySpendLimitMicros / 1e6;
      console.log(`  Ratio vs WeeklySpendLimit: ${((cost7 / limit) * 100).toFixed(1)}%`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
