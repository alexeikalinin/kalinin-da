// Read-only audit (2026-09-19): compare actual autotargeting checkbox
// settings per ad group against real spend/CPA by TargetingCategory over
// the last 30 days, for every active Search campaign in the Медавеню
// Direct account. Nothing in this script writes to the account.
//
// Usage:
//   node --env-file=.env.local scripts/medavenue-2026-09-19-autotargeting-audit.ts
import {
  listCampaigns,
  getAutotargetingCategoryReport,
  getSearchTermsReport,
} from "../lib/tools/yandex-direct.ts";
import { getYandexAccessToken } from "../lib/tools/yandex-oauth.ts";

const CLIENT_LOGIN = "porg-yw2ynqgs";
const ACCESS_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const API_BASE = "https://api.direct.yandex.com/json/v5";

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

async function callDirect(resource: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}/${resource}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getYandexAccessToken(ACCESS_TOKEN_ENV)}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      "Client-Login": CLIENT_LOGIN,
    },
    body: JSON.stringify({ method, params }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok || data.error) {
    throw new Error(`${resource}.${method} failed: ${res.status} ${JSON.stringify(data.error ?? text)}`);
  }
  return data.result;
}

async function getAdGroupIds(campaignId: number): Promise<{ id: number; name: string }[]> {
  const result = await callDirect("adgroups", "get", {
    SelectionCriteria: { CampaignIds: [campaignId] },
    FieldNames: ["Id", "Name"],
  });
  return (result.AdGroups ?? []).map((g: any) => ({ id: g.Id, name: g.Name }));
}

async function getAutotargetingSettings(adGroupIds: number[]): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  if (adGroupIds.length === 0) return map;
  // Batch — keywords.get selection by AdGroupIds directly (avoids a
  // separate call per group); autotargeting is represented as a special
  // Keyword row with text "---autotargeting---" per group.
  const result = await callDirect("keywords", "get", {
    SelectionCriteria: { AdGroupIds: adGroupIds },
    FieldNames: ["Id", "AdGroupId", "Keyword", "AutotargetingCategories"],
    AutotargetingSettingsCategoriesFieldNames: ["Exact", "Narrow", "Alternative", "Accessory", "Broader"],
    AutotargetingSettingsBrandOptionsFieldNames: ["WithoutBrands", "WithAdvertiserBrand", "WithCompetitorsBrand"],
  });
  for (const kw of result.Keywords ?? []) {
    // Live API returns the autotargeting row's Keyword text as
    // "---autotargeting" (no trailing "---"), confirmed 2026-09-19 —
    // differs from the doc's request-side "---autotargeting" example
    // formatting; match loosely to be safe against either.
    if (typeof kw.Keyword === "string" && kw.Keyword.replace(/-/g, "") === "autotargeting") {
      map.set(kw.AdGroupId, kw);
    }
  }
  return map;
}

async function main() {
  const startDate = daysAgo(30);
  const endDate = today();
  console.log(`Period: ${startDate} .. ${endDate}\n`);

  const campaigns = await listCampaigns(CLIENT_LOGIN, ACCESS_TOKEN_ENV);
  const activeSearch = campaigns.filter(
    (c) => c.Status === "ACCEPTED" && c.State !== "ARCHIVED" && c.Type === "TEXT_CAMPAIGN",
  );
  console.log(`Found ${campaigns.length} total campaigns, ${activeSearch.length} active TEXT_CAMPAIGN (Search).`);
  console.log(activeSearch.map((c) => `  - [${c.Id}] ${c.Name} (Status=${c.Status}, State=${c.State})`).join("\n"));
  console.log("");

  const output: any[] = [];

  for (const camp of activeSearch) {
    console.log(`\n=== Campaign [${camp.Id}] ${camp.Name} ===`);
    let catReport: readonly any[] = [];
    try {
      catReport = await getAutotargetingCategoryReport(
        CLIENT_LOGIN,
        { campaignId: String(camp.Id), startDate, endDate, goalIds: GOAL_IDS },
        ACCESS_TOKEN_ENV,
      );
    } catch (e) {
      console.log(`  getAutotargetingCategoryReport failed: ${(e as Error).message}`);
      continue;
    }

    const totalCost = catReport.reduce((s, r) => s + r.cost, 0);
    if (totalCost === 0) {
      console.log("  No spend in period, skipping.");
      continue;
    }

    // Ad group settings
    let adGroups: { id: number; name: string }[] = [];
    let settingsByGroup = new Map<number, any>();
    try {
      adGroups = await getAdGroupIds(camp.Id);
      settingsByGroup = await getAutotargetingSettings(adGroups.map((g) => g.id));
    } catch (e) {
      console.log(`  ad group settings fetch failed: ${(e as Error).message}`);
    }

    console.log(`  Ad groups: ${adGroups.length}, with autotargeting keyword: ${settingsByGroup.size}`);
    for (const g of adGroups) {
      const s = settingsByGroup.get(g.id);
      if (!s) {
        console.log(`    [${g.id}] ${g.name}: NO autotargeting entry found (autotargeting likely fully off for this group)`);
        continue;
      }
      const c = s.AutotargetingSettings?.Categories ?? {};
      const b = s.AutotargetingSettings?.BrandOptions ?? {};
      const on = (v: string) => (v === "YES" ? "ON" : "off");
      console.log(
        `    [${g.id}] ${g.name}: Exact=${on(c.Exact)} Narrow=${on(c.Narrow)} Alternative=${on(c.Alternative)} Accessory=${on(c.Accessory)} Broader=${on(c.Broader)} | Brand: Own=${on(b.WithAdvertiserBrand)} Competitor=${on(b.WithCompetitorsBrand)} NoBrand=${on(b.WithoutBrands)}`,
      );
    }

    // Aggregate by category
    const byCategory = new Map<string, { cost: number; clicks: number; impressions: number; conv: number }>();
    for (const row of catReport) {
      const key = `${row.criteriaType || "?"}:${row.targetingCategory || "(empty)"}`;
      const cur = byCategory.get(key) ?? { cost: 0, clicks: 0, impressions: 0, conv: 0 };
      const conv = Object.values(row.conversionsByGoal as Record<string, number>).reduce((a, b) => a + b, 0);
      cur.cost += row.cost;
      cur.clicks += row.clicks;
      cur.impressions += row.impressions;
      cur.conv += conv;
      byCategory.set(key, cur);
    }

    console.log("  Category breakdown (criteriaType:targetingCategory -> cost / clicks / impr / conv / CPA):");
    for (const [key, v] of Array.from(byCategory.entries()).sort((a, b) => b[1].cost - a[1].cost)) {
      const cpa = v.conv > 0 ? (v.cost / v.conv).toFixed(2) : "-";
      console.log(`    ${key}: cost=${v.cost.toFixed(2)} clicks=${v.clicks} impr=${v.impressions} conv=${v.conv} CPA=${cpa}`);
    }

    output.push({
      campaignId: camp.Id,
      campaignName: camp.Name,
      adGroups: adGroups.map((g) => ({ id: g.id, name: g.name, settings: settingsByGroup.get(g.id) ?? null })),
      byCategory: Object.fromEntries(byCategory),
    });
  }

  console.log("\n\n=== JSON DUMP (for further processing) ===");
  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
