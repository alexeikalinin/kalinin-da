import { readFileSync } from "node:fs";

const SF = process.argv[2];
const lines = readFileSync(SF, "utf8").split("\n");

function jsonArrayLineAfter(marker: string, occurrence = 1): string {
  let idx = -1;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(marker)) {
      idx = i;
      break;
    }
  }
  for (let i = idx; i < lines.length; i++) {
    if (lines[i] && lines[i].trim().startsWith("[")) {
      count++;
      if (count === occurrence) return lines[i];
    }
  }
  return "";
}

// --- Section 1: search terms ---
const termsLine = jsonArrayLineAfter("1. Search terms");
const terms: any[] = JSON.parse(termsLine);
type Agg = { campaignId: string; campaignName: string; impressions: number; clicks: number; cost: number; conversions: number };
const byTerm = new Map<string, Agg[]>();
for (const r of terms) {
  const term = r.searchTermView.searchTerm as string;
  const agg: Agg = {
    campaignId: r.campaign.id,
    campaignName: r.campaign.name,
    impressions: Number(r.metrics.impressions ?? 0),
    clicks: Number(r.metrics.clicks ?? 0),
    cost: Number(r.metrics.costMicros ?? 0) / 1e6,
    conversions: Number(r.metrics.conversions ?? 0),
  };
  const list = byTerm.get(term) ?? [];
  const existing = list.find((x) => x.campaignId === agg.campaignId);
  if (existing) {
    existing.impressions += agg.impressions;
    existing.clicks += agg.clicks;
    existing.cost += agg.cost;
    existing.conversions += agg.conversions;
  } else {
    list.push(agg);
  }
  byTerm.set(term, list);
}
const overlap = [...byTerm.entries()].filter(([, aggs]) => aggs.length >= 2);
console.log(`=== OVERLAP: ${overlap.length} search terms appeared in BOTH LOR campaigns (last 30d) ===`);
let campA_totalCost = 0, campB_totalCost = 0, campA_totalClicks = 0, campB_totalClicks = 0, campA_conv=0, campB_conv=0;
for (const [term, aggs] of overlap.sort((a, b) => (b[1][0].cost + (b[1][1]?.cost ?? 0)) - (a[1][0].cost + (a[1][1]?.cost ?? 0)))) {
  const line = aggs.map((a) => `${a.campaignName}(${a.campaignId}): clicks=${a.clicks} cost=${a.cost.toFixed(2)} conv=${a.conversions} imp=${a.impressions}`).join(" | ");
  console.log(`"${term}" -> ${line}`);
}

for (const [, aggs] of overlap) {
  for (const a of aggs) {
    if (a.campaignId === "23373725924") { campA_totalCost += a.cost; campA_totalClicks += a.clicks; campA_conv += a.conversions; }
    if (a.campaignId === "23487960638") { campB_totalCost += a.cost; campB_totalClicks += a.clicks; campB_conv += a.conversions; }
  }
}
console.log(`\nOverlap totals: Лор(23373725924) cost=${campA_totalCost.toFixed(2)} clicks=${campA_totalClicks} conv=${campA_conv}`);
console.log(`Overlap totals: Врачи(23487960638) cost=${campB_totalCost.toFixed(2)} clicks=${campB_totalClicks} conv=${campB_conv}`);

// Overall campaign totals for context
const totalsByCamp = new Map<string, { cost: number; clicks: number; conv: number; name: string }>();
for (const r of terms) {
  const id = r.campaign.id;
  const t = totalsByCamp.get(id) ?? { cost: 0, clicks: 0, conv: 0, name: r.campaign.name };
  t.cost += Number(r.metrics.costMicros ?? 0) / 1e6;
  t.clicks += Number(r.metrics.clicks ?? 0);
  t.conv += Number(r.metrics.conversions ?? 0);
  totalsByCamp.set(id, t);
}
console.log("\n=== Overall campaign totals (all search terms, 30d) ===");
for (const [id, t] of totalsByCamp) console.log(`${t.name} (${id}): cost=${t.cost.toFixed(2)} clicks=${t.clicks} conv=${t.conv}`);

// --- Section 2: keywords for VRACHI ---
console.log("\n\n=== SECTION 2: keyword criteria, campaign VRACHI ===");
const kwLine = jsonArrayLineAfter("2. Ad groups + live keyword criteria", 2);
const kwRows: any[] = JSON.parse(kwLine);
console.log(`Total criteria rows: ${kwRows.length}`);
const nonExactEnabled = kwRows.filter((r) => r.adGroupCriterion.status === "ENABLED" && r.adGroupCriterion.keyword.matchType !== "EXACT");
const exactEnabled = kwRows.filter((r) => r.adGroupCriterion.status === "ENABLED" && r.adGroupCriterion.keyword.matchType === "EXACT");
const notEnabled = kwRows.filter((r) => r.adGroupCriterion.status !== "ENABLED");
console.log(`ENABLED + EXACT already: ${exactEnabled.length}`);
console.log(`ENABLED + non-EXACT (need conversion): ${nonExactEnabled.length}`);
console.log(`NOT enabled (paused/removed, skip): ${notEnabled.length}`);
console.log("\n-- ENABLED non-EXACT list --");
for (const r of nonExactEnabled) {
  console.log(`adGroup=${r.adGroup.id} "${r.adGroup.name}" criterionId=${r.adGroupCriterion.criterionId} text="${r.adGroupCriterion.keyword.text}" matchType=${r.adGroupCriterion.keyword.matchType}`);
}
console.log("\n-- Already EXACT+ENABLED (skip) --");
for (const r of exactEnabled) {
  console.log(`adGroup=${r.adGroup.id} criterionId=${r.adGroupCriterion.criterionId} text="${r.adGroupCriterion.keyword.text}"`);
}

// --- Section 3: ads ---
console.log("\n\n=== SECTION 3: RSA ads, campaign VRACHI ===");
const adsLine = jsonArrayLineAfter("3. Ads (RSA)");
const adRows: any[] = JSON.parse(adsLine);
console.log(`Total ad rows: ${adRows.length}`);
for (const r of adRows) {
  const headlines = (r.adGroupAd.ad.responsiveSearchAd?.headlines ?? []).map((h: any) => h.text);
  const descriptions = (r.adGroupAd.ad.responsiveSearchAd?.descriptions ?? []).map((d: any) => d.text);
  console.log(`\nAdGroup ${r.adGroup.id} "${r.adGroup.name}" | Ad ${r.adGroupAd.ad.id} status=${r.adGroupAd.status}`);
  console.log(`  finalUrls=${JSON.stringify(r.adGroupAd.ad.finalUrls)}`);
  console.log(`  headlines=${JSON.stringify(headlines)}`);
  console.log(`  descriptions=${JSON.stringify(descriptions)}`);
}

// --- Section 4: all ad group names, scan for surnames ---
console.log("\n\n=== SECTION 4: ad group name scan (potential doctor surnames) ===");
const sec4Start = lines.findIndex((l) => l.includes("4. All ad group names"));
const groupLines = lines.slice(sec4Start + 2).filter((l) => l.includes("\t"));
console.log(`Total ad group lines: ${groupLines.length}`);
// Heuristic: Cyrillic capitalized word of length >=4 inside the name that isn't a generic medical term start
const genericStartWords = new Set(["Лор","ЛОР","Дерматолог","Дерматолог -","Терапевт","Кардиолог","Гинеколог","Педиатр","Оториноларингология","Поиск","Удаление","Диагностика","Консультация","Клиника","Запись","Прием","Прием врача","Услуги","Цены","Центр","Детский"]);
for (const l of groupLines) {
  const [campId, campName, groupId, groupName, status] = l.split("\t");
  // crude surname pattern: word starting with capital Cyrillic letter, length >= 5, ending typical surname suffix
  const m = groupName.match(/[А-ЯЁ][а-яё]{3,}(?:ов|ев|ин|ая|ий|кий|ская|цкая|ко|швили|дзе)\b/);
  if (m) {
    console.log(`CANDIDATE: ${campId}\t${campName}\t${groupId}\t${groupName}\t${status}`);
  }
}
