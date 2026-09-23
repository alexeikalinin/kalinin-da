// Read-only follow-up to medavenue-2026-09-19-autotargeting-audit.ts:
// pull real search queries for a set of flagged (campaignId, criteriaType,
// targetingCategory) combos to judge by eye whether the spend behind a
// weak-CPA category is genuinely junk or just not-yet-converted.
import { getSearchTermsReport } from "../lib/tools/yandex-direct.ts";

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

// campaignId -> categories of interest (empty array = all non-empty categories)
const FLAGS: Record<string, string[]> = {
  "707005501": ["ALTERNATIVE", "ACCESSORY"], // Дерматология
  "707005508": ["ALTERNATIVE"], // ЛОР
  "707005515": ["ALTERNATIVE"], // Невролог
  "707993661": ["EXACT", "ACCESSORY"], // Уролог MaxClicks
  "708398165": ["EXACT", "ACCESSORY"], // Гинеколог MaxClick
  "709679607": ["EXACT"], // Лазерное обрезание — AUTOTARGETING EXACT 0 conv
  "713471948": ["EXACT"], // Удаление родинок
};

async function main() {
  const startDate = daysAgo(30);
  const endDate = today();
  const rows = await getSearchTermsReport(CLIENT_LOGIN, { startDate, endDate, goalIds: GOAL_IDS }, ACCESS_TOKEN_ENV);
  console.log(`Total search-term rows: ${rows.length}\n`);

  for (const [campaignId, cats] of Object.entries(FLAGS)) {
    const campRows = rows.filter((r) => r.campaignId === campaignId);
    if (campRows.length === 0) {
      console.log(`Campaign ${campaignId}: no search-term rows found`);
      continue;
    }
    console.log(`\n=== Campaign ${campaignId} (${campRows[0].campaignName}) ===`);
    for (const cat of cats) {
      const filtered = campRows
        .filter((r) => r.targetingCategory === cat)
        .sort((a, b) => b.cost - a.cost);
      console.log(`  -- category ${cat}, ${filtered.length} query rows --`);
      for (const r of filtered.slice(0, 25)) {
        const conv = Object.values(r.conversionsByGoal).reduce((a, b) => a + b, 0);
        console.log(
          `    "${r.searchTerm}" [${r.adGroupName}] cost=${r.cost.toFixed(2)} clicks=${r.clicks} conv=${conv}`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
