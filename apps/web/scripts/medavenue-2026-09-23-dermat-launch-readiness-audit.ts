// Read-only launch-readiness audit (2026-09-23) for Медавеню Google Ads
// (customer 9714539590), campaigns:
//   19321388084 "Поиск // Дерматолог // Минск // 22.09.26" (general)
//   23484099509 "Поиск // Дерматолог // Минск" (diagnosis-specific)
// Checks: UTM pattern, sitelinks/callouts/structured snippets, ad approval
// status, ad-group ad coverage, negative keyword shared sets, budgets vs
// other active SEARCH campaigns. No writes.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-dermat-launch-readiness-audit.ts
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_BASE = "https://googleads.googleapis.com/v25";
const TARGET_IDS = ["19321388084", "23484099509"];

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
  console.log("=== 1. Both target campaigns: status/budget/tracking template ===");
  const campaigns = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign.tracking_url_template, campaign.url_custom_parameters,
           campaign_budget.id, campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.id IN (${TARGET_IDS.join(",")})
  `);
  for (const r of campaigns) {
    console.log(JSON.stringify(r, null, 2));
  }

  console.log("\n=== 2. All active SEARCH campaigns (for budget comparison) ===");
  const allActive = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.advertising_channel_type = 'SEARCH' AND campaign.status = 'ENABLED'
    ORDER BY campaign_budget.amount_micros DESC
  `);
  for (const r of allActive) {
    console.log(r.campaign.id, JSON.stringify(r.campaign.name), "budget=", r.campaignBudget?.amountMicros);
  }

  for (const campaignId of TARGET_IDS) {
    console.log(`\n\n########## CAMPAIGN ${campaignId} ##########`);

    console.log("\n--- Ad groups ---");
    const adGroups = await search(`
      SELECT ad_group.id, ad_group.name, ad_group.status
      FROM ad_group WHERE campaign.id = ${campaignId}
      ORDER BY ad_group.id
    `);
    console.log(JSON.stringify(adGroups, null, 2));

    console.log("\n--- Ads (status, approval, final_urls, tracking template) ---");
    const ads = await search(`
      SELECT ad_group.id, ad_group.name, ad_group_ad.status,
             ad_group_ad.policy_summary.approval_status,
             ad_group_ad.policy_summary.review_status,
             ad_group_ad.ad.id, ad_group_ad.ad.final_urls,
             ad_group_ad.ad.tracking_url_template,
             ad_group_ad.ad.responsive_search_ad.headlines,
             ad_group_ad.ad.responsive_search_ad.descriptions
      FROM ad_group_ad WHERE campaign.id = ${campaignId}
      ORDER BY ad_group.id
    `);
    console.log(JSON.stringify(ads, null, 2));

    console.log("\n--- Campaign-level assets (sitelinks/callouts/structured snippets) ---");
    const assets = await search(`
      SELECT campaign.id, campaign_asset.field_type, campaign_asset.status,
             asset.id, asset.type, asset.sitelink_asset.link_text, asset.final_urls,
             asset.callout_asset.callout_text,
             asset.structured_snippet_asset.header, asset.structured_snippet_asset.values
      FROM campaign_asset WHERE campaign.id = ${campaignId}
    `);
    console.log(JSON.stringify(assets, null, 2));

    console.log("\n--- Negative keyword shared sets attached ---");
    const sharedSets = await search(`
      SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.status
      FROM campaign_shared_set WHERE campaign.id = ${campaignId}
    `);
    console.log(JSON.stringify(sharedSets, null, 2));

    console.log("\n--- Campaign-level negative keywords (criteria) ---");
    const negKw = await search(`
      SELECT campaign_criterion.criterion_id, campaign_criterion.keyword.text,
             campaign_criterion.keyword.match_type, campaign_criterion.negative
      FROM campaign_criterion
      WHERE campaign.id = ${campaignId} AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = true
    `);
    console.log(JSON.stringify(negKw, null, 2));
  }

  console.log("\n\n=== 3. All negative keyword shared sets in account (for reuse reference) ===");
  const allSharedSets = await search(`
    SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.status, shared_set.member_count
    FROM shared_set WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
  `);
  console.log(JSON.stringify(allSharedSets, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
