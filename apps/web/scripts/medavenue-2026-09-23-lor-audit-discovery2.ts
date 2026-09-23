import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const CAMP_SHREDER = "23487531248";

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

async function main() {
  console.log("=== Campaign status ===");
  console.log(JSON.stringify(await search(`SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id = ${CAMP_SHREDER}`)));

  console.log("\n=== Ad groups ===");
  console.log(JSON.stringify(await search(`SELECT ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMP_SHREDER}'`)));

  console.log("\n=== Keyword criteria ===");
  console.log(JSON.stringify(await search(`
    SELECT ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type, ad_group_criterion.status
    FROM ad_group_criterion
    WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMP_SHREDER}'
      AND ad_group_criterion.type = 'KEYWORD'
  `)));

  console.log("\n=== Ads ===");
  console.log(JSON.stringify(await search(`
    SELECT ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.status,
           ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
           ad_group_ad.ad.final_urls
    FROM ad_group_ad
    WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMP_SHREDER}'
  `)));
}
main().catch((e) => { console.error(e); process.exit(1); });
