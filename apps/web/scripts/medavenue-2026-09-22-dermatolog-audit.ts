// Read-only audit (2026-09-22) for Медавеню Google Ads (customer
// 9714539590), campaign 19321388084 "Поиск_дерматолог" (PAUSED) — checking
// existing extensions/tracking-template pattern across other active SEARCH
// campaigns so we can bring this one to parity before launch. No writes.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-22-dermatolog-audit.ts
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_BASE = "https://googleads.googleapis.com/v25";
const TARGET_CAMPAIGN_ID = "19321388084";

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

async function search(query: string): Promise<any[]> {
  const data = await callGoogleAds("/googleAds:search", { query });
  return data.results ?? [];
}

async function main() {
  console.log("=== 1. All ENABLED/PAUSED SEARCH campaigns ===");
  const campaigns = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign.tracking_url_template, campaign.url_custom_parameters,
           campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.advertising_channel_type = 'SEARCH'
    ORDER BY campaign.status, campaign.id
  `);
  for (const r of campaigns) {
    console.log(
      r.campaign.id,
      r.campaign.status,
      JSON.stringify(r.campaign.name),
      "trackingTemplate=",
      r.campaign.trackingUrlTemplate ?? null,
      "budget=",
      r.campaignBudget?.amountMicros,
    );
  }

  console.log("\n=== 2. Account-level tracking template + final_url_suffix ===");
  const cust = await search(`
    SELECT customer.id, customer.tracking_url_template, customer.final_url_suffix
    FROM customer
  `);
  console.log(JSON.stringify(cust, null, 2));

  console.log("\n=== 3. Campaign-level assets (sitelinks/callouts/snippets) for ACTIVE search campaigns ===");
  const campaignAssets = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign_asset.field_type, campaign_asset.status,
           asset.type, asset.sitelink_asset.link_text, asset.final_urls,
           asset.callout_asset.callout_text,
           asset.structured_snippet_asset.header, asset.structured_snippet_asset.values
    FROM campaign_asset
    WHERE campaign.advertising_channel_type = 'SEARCH'
    ORDER BY campaign.id
  `);
  for (const r of campaignAssets) {
    console.log(
      r.campaign.id,
      r.campaign.status,
      JSON.stringify(r.campaign.name),
      r.campaignAsset.fieldType,
      r.campaignAsset.status,
      "->",
      JSON.stringify(r.asset),
    );
  }

  console.log("\n=== 4. Account-level (customer) assets (sitelinks/callouts/snippets applied to whole account) ===");
  const customerAssets = await search(`
    SELECT customer_asset.field_type, customer_asset.status,
           asset.type, asset.sitelink_asset.link_text, asset.sitelink_asset.final_urls,
           asset.callout_asset.callout_text,
           asset.structured_snippet_asset.header, asset.structured_snippet_asset.values
    FROM customer_asset
  `);
  for (const r of customerAssets) {
    console.log(r.customerAsset.fieldType, r.customerAsset.status, "->", JSON.stringify(r.asset));
  }

  console.log(`\n=== 5. Target campaign ${TARGET_CAMPAIGN_ID}: ad groups / keywords / ads / final URLs ===`);
  const adGroups = await search(`
    SELECT ad_group.id, ad_group.name, ad_group.status
    FROM ad_group
    WHERE campaign.id = ${TARGET_CAMPAIGN_ID}
    ORDER BY ad_group.id
  `);
  console.log(JSON.stringify(adGroups, null, 2));

  const ads = await search(`
    SELECT ad_group.id, ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.final_urls,
           ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
           ad_group_ad.ad.tracking_url_template, ad_group_ad.ad.final_url_suffix
    FROM ad_group_ad
    WHERE campaign.id = ${TARGET_CAMPAIGN_ID}
  `);
  console.log(JSON.stringify(ads, null, 2));

  const keywords = await search(`
    SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type, ad_group_criterion.status,
           ad_group_criterion.final_urls, ad_group_criterion.tracking_url_template
    FROM ad_group_criterion
    WHERE campaign.id = ${TARGET_CAMPAIGN_ID} AND ad_group_criterion.type = 'KEYWORD'
  `);
  console.log(JSON.stringify(keywords, null, 2));

  const campaignFull = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.tracking_url_template,
           campaign.url_custom_parameters, campaign.campaign_budget, campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.id = ${TARGET_CAMPAIGN_ID}
  `);
  console.log(JSON.stringify(campaignFull, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
