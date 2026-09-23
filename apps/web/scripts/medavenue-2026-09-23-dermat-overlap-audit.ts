// Read-only overlap audit (2026-09-23) for Медавеню Google Ads
// (customer 9714539590): campaign 19321388084 "Поиск // Дерматолог //
// Минск // 22.09.26" (general) vs campaign 23484099509 "Поиск // Дерматолог
// // Минск" (diagnosis-specific, mostly Broad). Pulls all live (non-REMOVED)
// keywords + negatives from both campaigns, plus search-term history for
// each over its lifetime, to find real/likely overlap. No writes.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-dermat-overlap-audit.ts
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_BASE = "https://googleads.googleapis.com/v25";

const GENERAL = "19321388084"; // Поиск // Дерматолог // Минск // 22.09.26
const DIAGNOSIS = "23484099509"; // Поиск // Дерматолог // Минск

async function callGoogleAds(path: string, body: unknown): Promise<any> {
  const accessToken = await getGoogleAccessToken(REFRESH_TOKEN_ENV);
  const response = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Ads API call failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function searchAll(query: string): Promise<any[]> {
  const results: any[] = [];
  let pageToken: string | undefined;
  do {
    const data = await callGoogleAds("/googleAds:search", { query, pageToken });
    results.push(...(data.results ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  console.log("=== Campaign names/status ===");
  const camps = await searchAll(`
    SELECT campaign.id, campaign.name, campaign.status
    FROM campaign
    WHERE campaign.id IN (${GENERAL}, ${DIAGNOSIS})
  `);
  console.log(JSON.stringify(camps, null, 2));

  for (const [id, label] of [
    [GENERAL, "GENERAL"],
    [DIAGNOSIS, "DIAGNOSIS"],
  ] as const) {
    console.log(`\n=== ${label} (${id}) — live keywords (not REMOVED) ===`);
    const kws = await searchAll(`
      SELECT ad_group.id, ad_group.name, ad_group.status,
             ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type, ad_group_criterion.status
      FROM ad_group_criterion
      WHERE campaign.id = ${id}
        AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status != 'REMOVED'
      ORDER BY ad_group.name, ad_group_criterion.keyword.text
    `);
    console.log(`Total live keywords: ${kws.length}`);
    let currentGroup = "";
    for (const r of kws) {
      if (r.adGroup.name !== currentGroup) {
        currentGroup = r.adGroup.name;
        console.log(`-- Group: ${currentGroup} (${r.adGroup.id}, ${r.adGroup.status}) --`);
      }
      console.log(
        `  [${r.adGroupCriterion.status}] ${r.adGroupCriterion.keyword.matchType}: "${r.adGroupCriterion.keyword.text}"`,
      );
    }

    console.log(`\n=== ${label} (${id}) — negative keywords (ad_group + campaign level) ===`);
    const negAdGroup = await searchAll(`
      SELECT ad_group.id, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
      FROM ad_group_criterion
      WHERE campaign.id = ${id} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = true
    `);
    console.log(`Ad-group level negatives: ${negAdGroup.length}`);
    for (const r of negAdGroup) {
      console.log(`  [${r.adGroup.name}] ${r.adGroupCriterion.keyword.matchType}: "${r.adGroupCriterion.keyword.text}"`);
    }
    const negCampaign = await searchAll(`
      SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
      FROM campaign_criterion
      WHERE campaign.id = ${id} AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = true
    `);
    console.log(`Campaign level negatives: ${negCampaign.length}`);
    for (const r of negCampaign) {
      console.log(`  ${r.campaignCriterion.keyword.matchType}: "${r.campaignCriterion.keyword.text}"`);
    }
  }

  console.log("\n=== Shared negative keyword lists attached to either campaign ===");
  const sharedSets = await searchAll(`
    SELECT campaign.id, campaign.name, campaign_shared_set.shared_set, shared_set.name, shared_set.type
    FROM campaign_shared_set
    WHERE campaign.id IN (${GENERAL}, ${DIAGNOSIS})
  `);
  console.log(JSON.stringify(sharedSets, null, 2));
  const sharedSetIds = [...new Set(sharedSets.map((r) => r.sharedSet?.resourceName).filter(Boolean))];
  for (const rn of sharedSetIds) {
    const idMatch = rn.match(/sharedSets\/(\d+)/);
    if (!idMatch) continue;
    const items = await searchAll(`
      SELECT shared_criterion.keyword.text, shared_criterion.keyword.match_type
      FROM shared_criterion
      WHERE shared_set.id = ${idMatch[1]}
    `);
    console.log(`Shared set ${rn}: ${items.length} items`);
    for (const it of items) {
      console.log(`  ${it.sharedCriterion.keyword.matchType}: "${it.sharedCriterion.keyword.text}"`);
    }
  }

  console.log("\n=== Search terms — lifetime history (last 365d) for both campaigns ===");
  const start = daysAgo(365);
  const end = today();
  for (const [id, label] of [
    [GENERAL, "GENERAL"],
    [DIAGNOSIS, "DIAGNOSIS"],
  ] as const) {
    const rows = await searchAll(`
      SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
             search_term_view.search_term, metrics.impressions, metrics.clicks,
             metrics.cost_micros, metrics.conversions
      FROM search_term_view
      WHERE campaign.id = ${id}
        AND segments.date BETWEEN '${start}' AND '${end}'
      ORDER BY metrics.cost_micros DESC
    `);
    console.log(`\n-- ${label} (${id}): ${rows.length} distinct search-term rows over last 365d --`);
    for (const r of rows) {
      console.log(
        `  "${r.searchTermView.searchTerm}" [${r.adGroup.name}] impr=${r.metrics.impressions ?? 0} clicks=${r.metrics.clicks ?? 0} cost=${((r.metrics.costMicros ?? 0) / 1e6).toFixed(2)} conv=${r.metrics.conversions ?? 0}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
