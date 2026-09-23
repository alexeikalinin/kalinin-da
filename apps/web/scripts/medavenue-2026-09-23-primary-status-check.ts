// Read-only: dump campaign.primary_status / primary_status_reasons /
// serving_status for all ENABLED SEARCH campaigns in the Медавеню account.
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-primary-status-check.ts
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
  console.log("========== ENABLED SEARCH CAMPAIGNS: primary_status ==========");
  const camps = await callGoogleAds("/googleAds:search", {
    query: `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status,
                    campaign.primary_status, campaign.primary_status_reasons,
                    campaign.advertising_channel_type
             FROM campaign
             WHERE campaign.status = 'ENABLED'
               AND campaign.advertising_channel_type = 'SEARCH'
             ORDER BY campaign.id`,
  });
  console.log(JSON.stringify(camps, null, 2));

  console.log("\n========== AD GROUP AD policy_summary for the two dermatology campaigns ==========");
  const dermatIds = [19321388084, 23484099509];
  for (const id of dermatIds) {
    console.log(`\n---- campaign ${id} ----`);
    const ads = await callGoogleAds("/googleAds:search", {
      query: `SELECT ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.policy_summary.approval_status,
                      ad_group_ad.policy_summary.review_status, ad_group.name, ad_group.status
               FROM ad_group_ad
               WHERE campaign.id = ${id}`,
    });
    console.log(JSON.stringify(ads, null, 2));

    const crit = await callGoogleAds("/googleAds:search", {
      query: `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
                      ad_group_criterion.status, ad_group_criterion.approval_status,
                      ad_group_criterion.system_serving_status, ad_group.name
               FROM keyword_view
               WHERE campaign.id = ${id}`,
    });
    console.log(JSON.stringify(crit, null, 2));

    const budget = await callGoogleAds("/googleAds:search", {
      query: `SELECT campaign_budget.amount_micros, campaign_budget.delivery_method,
                      campaign_budget.status, campaign.bidding_strategy_type
               FROM campaign WHERE campaign.id = ${id}`,
    });
    console.log(JSON.stringify(budget, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
