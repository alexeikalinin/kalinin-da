// Read-only status check (2026-09-18): are there active, actually-spending
// campaigns for "ЛОР" and "Терапия"/"Терапевт" in both Google Ads and
// Yandex Direct for Медавеню? No writes.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-18-lor-terapia-check.ts
import { listCampaigns as yListCampaigns, getCampaignReport as yGetCampaignReport } from "../lib/tools/yandex-direct.ts";
import { listCampaigns as gListCampaigns, getCampaignReport as gGetCampaignReport } from "../lib/tools/google-ads.ts";

const CLIENT_LOGIN = "porg-yw2ynqgs";
const CUSTOMER_ID = "9714539590";
const GOOGLE_OPTIONS = { refreshTokenEnv: "GOOGLE_ADS_AGENCY_REFRESH_TOKEN" };
const ACCESS_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const YANDEX_GOAL_IDS = [
  "477291881",
  "276054933",
  "505646406",
  "276055053",
  "477289884",
  "477293288",
  "477294948",
];

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const start = daysAgo(7);
  const end = today();

  console.log("=== ALL YANDEX DIRECT campaigns (name/status/state) ===");
  const yCampaigns = await yListCampaigns(CLIENT_LOGIN, ACCESS_TOKEN_ENV);
  for (const c of yCampaigns) console.log(`${c.Id}\t${c.Status}\t${c.State}\t${c.Name}`);

  const yMatches = yCampaigns.filter((c) => /лор|терап/i.test(c.Name));
  console.log("\n=== Matched Yandex campaigns (лор/терап) ===");
  for (const c of yMatches) console.log(JSON.stringify(c));

  if (yMatches.length > 0) {
    console.log("\n=== Yandex 7d report for matched campaigns ===");
    const report = await yGetCampaignReport(CLIENT_LOGIN, { startDate: start, endDate: end, goalIds: YANDEX_GOAL_IDS }, ACCESS_TOKEN_ENV);
    const ids = new Set(yMatches.map((c) => String(c.Id)));
    const byCampaign: Record<string, { cost: number; impressions: number; clicks: number; conversions: number }> = {};
    for (const r of report) {
      if (!ids.has(String(r.campaignId))) continue;
      const key = `${r.campaignId} ${r.campaignName}`;
      byCampaign[key] ??= { cost: 0, impressions: 0, clicks: 0, conversions: 0 };
      byCampaign[key].cost += r.cost;
      byCampaign[key].impressions += r.impressions;
      byCampaign[key].clicks += r.clicks;
      byCampaign[key].conversions += Object.values(r.conversionsByGoal).reduce((a, b) => a + b, 0);
    }
    console.log(JSON.stringify(byCampaign, null, 2));
  }

  console.log("\n=== ALL GOOGLE ADS campaigns (id/name/status) ===");
  const gCampaigns = (await gListCampaigns(CUSTOMER_ID, GOOGLE_OPTIONS)) ?? [];
  for (const c of gCampaigns as any[]) console.log(`${c.campaign.id}\t${c.campaign.status}\t${c.campaign.name}`);

  const gMatches = (gCampaigns as any[]).filter((c) => /лор|терап/i.test(c.campaign.name));
  console.log("\n=== Matched Google Ads campaigns (лор/терап) ===");
  for (const c of gMatches) console.log(JSON.stringify(c));

  if (gMatches.length > 0) {
    console.log("\n=== Google Ads 7d report for matched campaigns ===");
    const report = await gGetCampaignReport(CUSTOMER_ID, { startDate: start, endDate: end, conversionActionIds: [] }, GOOGLE_OPTIONS);
    const ids = new Set(gMatches.map((c: any) => String(c.campaign.id)));
    const byCampaign: Record<string, { costMicros: number; impressions: number; clicks: number }> = {};
    for (const r of report) {
      if (!ids.has(String(r.campaignId))) continue;
      const key = `${r.campaignId} ${r.campaignName}`;
      byCampaign[key] ??= { costMicros: 0, impressions: 0, clicks: 0 };
      byCampaign[key].costMicros += r.costMicros;
      byCampaign[key].impressions += r.impressions;
      byCampaign[key].clicks += r.clicks;
    }
    console.log(JSON.stringify(byCampaign, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
