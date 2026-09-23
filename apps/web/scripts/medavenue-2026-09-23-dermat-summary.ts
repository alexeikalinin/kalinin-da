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
  for (const campaignId of TARGET_IDS) {
    console.log(`\n########## CAMPAIGN ${campaignId} ##########`);

    const ads = await search(`
      SELECT ad_group.id, ad_group.name, ad_group_ad.status,
             ad_group_ad.policy_summary.approval_status,
             ad_group_ad.ad.id, ad_group_ad.ad.final_urls,
             ad_group_ad.ad.tracking_url_template
      FROM ad_group_ad WHERE campaign.id = ${campaignId}
      ORDER BY ad_group.id
    `);
    console.log("--- Ads summary ---");
    for (const r of ads) {
      console.log(
        r.adGroup.name, "|", r.adGroup.id, "| ad", r.adGroupAd.ad.id,
        "| status", r.adGroupAd.status,
        "| approval", r.adGroupAd.policySummary?.approvalStatus,
        "| finalUrls", JSON.stringify(r.adGroupAd.ad.finalUrls),
        "| trackingTemplate", r.adGroupAd.ad.trackingUrlTemplate ?? null,
      );
    }

    const assets = await search(`
      SELECT campaign.id, campaign_asset.field_type, campaign_asset.status,
             asset.id, asset.type, asset.sitelink_asset.link_text, asset.final_urls,
             asset.callout_asset.callout_text,
             asset.structured_snippet_asset.header, asset.structured_snippet_asset.values
      FROM campaign_asset WHERE campaign.id = ${campaignId}
    `);
    console.log("--- Campaign assets ---");
    for (const r of assets) {
      const a = r.asset;
      console.log(
        r.campaignAsset.fieldType, "|", r.campaignAsset.status, "|", a.type, "|",
        a.sitelinkAsset?.linkText ?? a.calloutAsset?.calloutText ?? (a.structuredSnippetAsset ? `${a.structuredSnippetAsset.header}: ${JSON.stringify(a.structuredSnippetAsset.values)}` : ""),
        "|", JSON.stringify(a.finalUrls ?? null),
      );
    }

    const sharedSets = await search(`
      SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.status
      FROM campaign_shared_set WHERE campaign.id = ${campaignId}
    `);
    console.log("--- Shared negative sets attached ---");
    for (const r of sharedSets) console.log(JSON.stringify(r.sharedSet));

    const negKw = await search(`
      SELECT campaign_criterion.criterion_id, campaign_criterion.keyword.text,
             campaign_criterion.keyword.match_type
      FROM campaign_criterion
      WHERE campaign.id = ${campaignId} AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = true
    `);
    console.log(`--- Campaign-level negative keywords (count=${negKw.length}) ---`);
  }

  console.log("\n=== Account-level shared negative sets ===");
  const allSharedSets = await search(`
    SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.status, shared_set.member_count
    FROM shared_set WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
  `);
  for (const r of allSharedSets) console.log(JSON.stringify(r.sharedSet));

  console.log("\n=== Existing callout assets in account (for reuse) ===");
  const allCallouts = await search(`
    SELECT asset.id, asset.callout_asset.callout_text FROM asset WHERE asset.type = 'CALLOUT'
  `);
  for (const r of allCallouts) console.log(r.asset.id, r.asset.calloutAsset?.calloutText);

  console.log("\n=== Existing structured snippet assets in account (for reuse) ===");
  const allSnippets = await search(`
    SELECT asset.id, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values FROM asset WHERE asset.type = 'STRUCTURED_SNIPPET'
  `);
  for (const r of allSnippets) console.log(r.asset.id, r.asset.structuredSnippetAsset?.header, JSON.stringify(r.asset.structuredSnippetAsset?.values));

  console.log("\n=== Account-level assets (callouts/sitelinks attached at customer level) ===");
  const custAssets = await search(`
    SELECT customer_asset.field_type, customer_asset.status, asset.id, asset.type
    FROM customer_asset
  `);
  for (const r of custAssets) console.log(JSON.stringify(r.customerAsset), r.asset.type, r.asset.id);
}

main().catch((e) => { console.error(e); process.exit(1); });
