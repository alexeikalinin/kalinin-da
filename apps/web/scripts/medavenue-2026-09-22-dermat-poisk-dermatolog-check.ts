// Read-only follow-up check for dermatology campaign 19321388084
// ("Поиск_дерматолог", PAUSED) + a status sanity-check on the REMOVED
// campaign 14028008068. Google Ads customer 9714539590 (Медавеню).
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-22-dermat-poisk-dermatolog-check.ts
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const GOOGLE_REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";

async function callGoogleAds(path: string, body: unknown) {
  const accessToken = await getGoogleAccessToken(GOOGLE_REFRESH_TOKEN_ENV);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type": "application/json",
  };
  const response = await fetch(`https://googleads.googleapis.com/v25/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Ads API failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log("========== 1) CAMPAIGN 19321388084 basics ==========");
  const camp = await callGoogleAds("/googleAds:search", {
    query: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
                    campaign.serving_status, campaign_budget.amount_micros
             FROM campaign WHERE campaign.id = 19321388084`,
  });
  console.log(JSON.stringify(camp, null, 2));

  console.log("\n========== 2) AD GROUPS for 19321388084 ==========");
  const groups = await callGoogleAds("/googleAds:search", {
    query: `SELECT ad_group.id, ad_group.name, ad_group.status
             FROM ad_group WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/19321388084'
             ORDER BY ad_group.id`,
  });
  console.log(JSON.stringify(groups, null, 2));

  console.log("\n========== 3) KEYWORDS for 19321388084 (with match types) ==========");
  const keywords = await callGoogleAds("/googleAds:search", {
    query: `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                    ad_group_criterion.status, ad_group.name, ad_group.id
             FROM keyword_view WHERE campaign.id = 19321388084
             ORDER BY ad_group.id`,
  });
  console.log(JSON.stringify(keywords, null, 2));

  console.log("\n========== 4) ADS (responsive search ads) for 19321388084 ==========");
  const ads = await callGoogleAds("/googleAds:search", {
    query: `SELECT ad_group.id, ad_group.name, ad_group_ad.status,
                    ad_group_ad.ad.id, ad_group_ad.ad.type,
                    ad_group_ad.ad.responsive_search_ad.headlines,
                    ad_group_ad.ad.responsive_search_ad.descriptions,
                    ad_group_ad.ad.final_urls
             FROM ad_group_ad WHERE campaign.id = 19321388084
             ORDER BY ad_group.id`,
  });
  console.log(JSON.stringify(ads, null, 2));

  console.log("\n========== 5) GEO TARGETING for 19321388084 ==========");
  const geo = await callGoogleAds("/googleAds:search", {
    query: `SELECT campaign_criterion.location.geo_target_constant, campaign_criterion.type
             FROM campaign_criterion WHERE campaign.id = 19321388084 AND campaign_criterion.type = 'LOCATION'`,
  });
  console.log(JSON.stringify(geo, null, 2));

  console.log("\n========== 6) CHANGE HISTORY for 19321388084 (last changes, if within retention) ==========");
  try {
    const changes = await callGoogleAds("/googleAds:search", {
      query: `SELECT change_event.change_date_time, change_event.change_resource_type,
                      change_event.resource_change_operation, change_event.user_email
               FROM change_event
               WHERE change_event.campaign = 'customers/${CUSTOMER_ID}/campaigns/19321388084'
               ORDER BY change_event.change_date_time DESC
               LIMIT 20`,
    });
    console.log(JSON.stringify(changes, null, 2));
  } catch (e) {
    console.log("change_event query failed (likely outside 28-day retention or needs date filter):", String(e));
  }

  console.log("\n========== 7) CAMPAIGN 14028008068 status sanity-check (REMOVED) ==========");
  const removedCamp = await callGoogleAds("/googleAds:search", {
    query: `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status
             FROM campaign WHERE campaign.id = 14028008068`,
  });
  console.log(JSON.stringify(removedCamp, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
