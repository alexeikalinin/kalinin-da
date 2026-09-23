// Prep-only writes (2026-09-22) for Медавеню Google Ads (customer
// 9714539590), campaign 19321388084 "Поиск_дерматолог" — bringing it to
// parity with the account's active SEARCH-campaign conventions before the
// user's own final launch review. Campaign stays PAUSED throughout; this
// script never touches campaign.status.
//
// What it does:
//   1. Links the account's standard 6-sitelink pool (Услуги/Наши
//      специалисты/О центре/Контакты/Акции/Пациентам — same asset
//      resource names reused by every other active campaign) to this
//      campaign, on top of the 3 dermatology-specific sitelinks it
//      already has.
//   2. Links the existing dermatology STRUCTURED_SNIPPET asset (already
//      created for campaign 23484099509 "Поиск // Дерматолог // Минск",
//      topically identical — reused, not duplicated).
//   3. Rewrites campaign.tracking_url_template from the placeholder
//      {campaignid} slug to a static, readable slug matching the account's
//      "<transliteration>_poisk" convention used by every other active
//      campaign, disambiguated from the already-existing dermatolog_poisk
//      slug used by 23484099509.
//   4. Renames the campaign following the account's live "Поиск // <Спец>
//      // Минск" pattern, with a date suffix (the account's own
//      disambiguation convention for multiple same-specialty campaigns,
//      e.g. "Поиск // Проктолог // 10.11.25") — needed here because the
//      exact name "Поиск // Дерматолог // Минск" already belongs to
//      campaign 23484099509.
//   NOTE: campaign-level CALLOUT/CALL/BUSINESS_LOGO are intentionally left
//   alone — the account already has account-level (customer_asset)
//   CALLOUT ("Опытные врачи", "Запись 24/7", "Современное оборудование",
//   "Без выходных"), CALL, and BUSINESS_LOGO assets ENABLED, which apply
//   to every campaign by default including this one.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-22-dermatolog-launch-prep.ts
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_BASE = "https://googleads.googleapis.com/v25";
const CAMPAIGN_ID = "19321388084";
const CAMPAIGN_RESOURCE = `customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}`;

const STANDARD_SITELINK_ASSET_IDS = [
  "34142655859", // Услуги
  "34142655865", // Наши специалисты
  "34142655874", // О центре
  "34142655880", // Контакты
  "34142655889", // Акции
  "341405567776", // Пациентам
];
const DERMATOLOGY_STRUCTURED_SNIPPET_ASSET_ID = "338511029668"; // Услуги: Удаление папилом/родинок/бородавок/шрамов/пигментации (already used by campaign 23484099509)

const NEW_TRACKING_TEMPLATE =
  "{lpurl}?utm_source=google_cm&utm_medium=cpc&utm_campaign=dermatolog2_poisk&utm_content={adgroupid}&utm_term={keyword}";
const NEW_NAME = "Поиск // Дерматолог // Минск // 22.09.26";

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
  console.log(`Target campaign: ${CAMPAIGN_RESOURCE}`);

  // Safety check — refuse to touch anything if the campaign isn't PAUSED
  // right now, or if it somehow got enabled between audit and this run.
  const before = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.tracking_url_template
    FROM campaign WHERE campaign.id = ${CAMPAIGN_ID}
  `);
  const beforeCampaign = before[0]?.campaign;
  console.log("Before:", JSON.stringify(beforeCampaign, null, 2));
  if (beforeCampaign.status !== "PAUSED") {
    throw new Error(`Refusing to modify: campaign status is ${beforeCampaign.status}, expected PAUSED`);
  }

  // 1+2. Link sitelinks + structured snippet (campaignAssets:mutate,
  // linking to EXISTING assets — no new asset creation).
  const campaignAssetOps = [
    ...STANDARD_SITELINK_ASSET_IDS.map((id) => ({
      create: {
        campaign: CAMPAIGN_RESOURCE,
        asset: `customers/${CUSTOMER_ID}/assets/${id}`,
        fieldType: "SITELINK",
      },
    })),
    {
      create: {
        campaign: CAMPAIGN_RESOURCE,
        asset: `customers/${CUSTOMER_ID}/assets/${DERMATOLOGY_STRUCTURED_SNIPPET_ASSET_ID}`,
        fieldType: "STRUCTURED_SNIPPET",
      },
    },
  ];
  console.log("\nLinking sitelinks + structured snippet...");
  const assetResult = await callGoogleAds("/campaignAssets:mutate", { operations: campaignAssetOps });
  console.log(JSON.stringify(assetResult, null, 2));

  // 3+4. Update tracking template + rename, in the same mutate call.
  console.log("\nUpdating tracking_url_template + name...");
  const campaignUpdate = await callGoogleAds("/campaigns:mutate", {
    operations: [
      {
        update: {
          resourceName: CAMPAIGN_RESOURCE,
          trackingUrlTemplate: NEW_TRACKING_TEMPLATE,
          name: NEW_NAME,
        },
        updateMask: "trackingUrlTemplate,name",
      },
    ],
  });
  console.log(JSON.stringify(campaignUpdate, null, 2));

  // Self-check: read everything back.
  console.log("\n=== Self-check: read back ===");
  const after = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.tracking_url_template
    FROM campaign WHERE campaign.id = ${CAMPAIGN_ID}
  `);
  console.log(JSON.stringify(after, null, 2));
  if (after[0]?.campaign.status !== "PAUSED") {
    throw new Error(`POST-WRITE SAFETY CHECK FAILED: campaign status is now ${after[0]?.campaign.status}, expected PAUSED`);
  }

  const assetsAfter = await search(`
    SELECT campaign_asset.field_type, campaign_asset.status, asset.type,
           asset.sitelink_asset.link_text, asset.structured_snippet_asset.header
    FROM campaign_asset WHERE campaign.id = ${CAMPAIGN_ID}
  `);
  for (const r of assetsAfter) {
    console.log(r.campaignAsset.fieldType, r.campaignAsset.status, "->", JSON.stringify(r.asset));
  }

  console.log("\nDONE. Campaign confirmed PAUSED. Ready for user's final review before enabling.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
