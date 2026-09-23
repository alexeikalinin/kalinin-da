// Read-only discovery (2026-09-23) for the three-part LOR task:
//   1) cannibalization check between 23373725924 ("Поиск // Лор // Минск")
//      and 23487960638 ("Поиск // ЛОР // Врачи // Минск")
//   2) prep for converting 23487960638's live keywords to EXACT
//   3) prep for checking doctor-name ad headlines / final URLs
// No writes.
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const CAMP_LOR = "23373725924";
const CAMP_VRACHI = "23487960638";

async function callGoogleAds(path: string, body: unknown): Promise<any> {
  const accessToken = await getGoogleAccessToken(REFRESH_TOKEN_ENV);
  const response = await fetch(`https://googleads.googleapis.com/v25/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Ads API failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function search(query: string): Promise<any[]> {
  const data = await callGoogleAds("/googleAds:search", { query });
  return data.results ?? [];
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400000);
  const startDate = ymd(start);
  const endDate = ymd(end);

  console.log("################ 0. Campaign statuses ################");
  const camps = await search(
    `SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id IN (${CAMP_LOR}, ${CAMP_VRACHI})`,
  );
  for (const r of camps) console.log(JSON.stringify(r.campaign));

  console.log("\n################ 1. Search terms last 30 days, both LOR campaigns ################");
  const terms = await search(`
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
           search_term_view.search_term, metrics.impressions, metrics.clicks,
           metrics.cost_micros, metrics.conversions
    FROM search_term_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.id IN (${CAMP_LOR}, ${CAMP_VRACHI})
  `);
  console.log(`Rows: ${terms.length}`);
  console.log(JSON.stringify(terms));

  console.log("\n################ 2. Ad groups + live keyword criteria, campaign VRACHI ################");
  const groupsVrachi = await search(
    `SELECT ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMP_VRACHI}'`,
  );
  console.log(JSON.stringify(groupsVrachi));

  const kwVrachi = await search(`
    SELECT ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type, ad_group_criterion.status
    FROM ad_group_criterion
    WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMP_VRACHI}'
      AND ad_group_criterion.type = 'KEYWORD'
  `);
  console.log(`\nKeyword criteria rows: ${kwVrachi.length}`);
  console.log(JSON.stringify(kwVrachi));

  console.log("\n################ 3. Ads (RSA) in campaign VRACHI ################");
  const ads = await search(`
    SELECT ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.status,
           ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
           ad_group_ad.ad.final_urls
    FROM ad_group_ad
    WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMP_VRACHI}'
  `);
  console.log(`Ad rows: ${ads.length}`);
  console.log(JSON.stringify(ads));

  console.log("\n################ 4. All ad group names across the whole account (surname scan) ################");
  const allGroups = await search(`
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status
    FROM ad_group
    WHERE campaign.advertising_channel_type = 'SEARCH'
    ORDER BY campaign.name, ad_group.name
  `);
  console.log(`Total ad groups: ${allGroups.length}`);
  for (const r of allGroups) {
    console.log(`${r.campaign.id}\t${JSON.stringify(r.campaign.name)}\t${r.adGroup.id}\t${JSON.stringify(r.adGroup.name)}\t${r.adGroup.status}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
