// WRITE task (2026-09-23), explicit user approval: campaign 23484099509
// "Поиск // Дерматолог // Минск" (PAUSED, stays PAUSED — campaign status
// itself is never touched here) has 17 ad groups that duplicate either the
// general dermatology campaign 19321388084 or the родинки/рубцы campaigns
// (14031020072, 14027972844). This script:
//   1. Pauses those 17 ad groups (ad group status -> PAUSED).
//   2. Removes the single keyword "врач дерматовенеролог" from the
//      "Врач-дерматовенеролог" ad group (the other 3 keywords in that
//      group stay untouched).
//   3. Adds campaign-level negative keywords (21 EXACT + 6 PHRASE) as
//      insurance against any residual overlap.
//   4. Reads everything back and verifies: campaign still PAUSED, all 17
//      groups PAUSED, the keyword REMOVED, negatives present.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-dermat-cannibalization-fix.ts
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-dermat-cannibalization-fix.ts --apply
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const GOOGLE_REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const CAMPAIGN_ID = "23484099509";
const APPLY = process.argv.includes("--apply");

const AD_GROUP_IDS_TO_PAUSE: Record<string, string> = {
  "Врач-дерматолог": "194470755560",
  "Дерматолог - Детский": "194470755760",
  "Дерматолог - Запись": "194470755800",
  "Дерматолог - Клиника": "194470755960",
  "Дерматолог - Консультация": "194470756000",
  "Дерматолог - Платно": "194470756040",
  "Дерматолог - Прием": "194470756200",
  "Дерматолог - Талон": "194470756240",
  "Дерматолог - Услуги": "194470756280",
  "Дерматолог - Центр": "194470756440",
  "Дерматолог - Цены": "194470756480",
  "Дерматология": "194470756520",
  "Дерматоскопия": "194470756680",
  "Удаление родинок": "194470758160",
  "Удаление родинок - Цена": "194470758200",
  "Удаление рубцов": "194470758360",
  "Удаление шрамов": "194470758400",
};

const KEYWORD_GROUP_NAME = "Врач-дерматовенеролог"; // ad group id discovered at runtime
const KEYWORD_TEXT_TO_REMOVE = "врач дерматовенеролог";

const NEGATIVE_EXACT = [
  "врач дерматовенеролог",
  "врач дерматолог",
  "врач дерматолог минск",
  "дерматолог минск",
  "дерматолог минск цены",
  "дерматолог цена",
  "дерматология минск",
  "дерматоскопия",
  "дерматоскопия минск",
  "детский дерматолог",
  "записаться к дерматологу",
  "записаться к дерматологу минск",
  "записаться на прием к дерматологу",
  "запись к дерматологу минск",
  "кожный дерматолог",
  "консультация дерматолога",
  "платный дерматолог",
  "прием врача дерматолога",
  "прием дерматолога минск",
  "услуга дерматолога",
  "цифровая дерматоскопия",
];

const NEGATIVE_PHRASE = [
  "проверка родинок",
  "обследование родинок",
  "осмотр родинок",
  "диагностика родинок",
  "картирование родинок",
  "карта родинок",
];

async function callGoogleAds(path: string, body: unknown): Promise<any> {
  const accessToken = await getGoogleAccessToken(GOOGLE_REFRESH_TOKEN_ENV);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type": "application/json",
  };
  // Direct/representative access to Медавеню — no login-customer-id header.
  const response = await fetch(`https://googleads.googleapis.com/v25/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Ads API failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function searchGoogleAds(query: string): Promise<any[]> {
  const data = await callGoogleAds("/googleAds:search", { query });
  return data.results ?? [];
}

async function main() {
  console.log("################ PHASE 1: DISCOVERY ################\n");

  // --- Campaign status sanity check (must be PAUSED before and after) ---
  const campRows = await searchGoogleAds(
    `SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id = ${CAMPAIGN_ID}`,
  );
  console.log("Campaign before:", JSON.stringify(campRows[0]?.campaign));
  if (campRows[0]?.campaign?.status !== "PAUSED") {
    throw new Error(`ABORT: campaign ${CAMPAIGN_ID} is not PAUSED (status=${campRows[0]?.campaign?.status}) — refusing to proceed.`);
  }

  // --- Ad group rows for the campaign, to confirm IDs/names match ---
  const groupRows = await searchGoogleAds(
    `SELECT ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}'`,
  );
  console.log(`\nFound ${groupRows.length} ad groups in campaign ${CAMPAIGN_ID}:`);
  const groupsByName = new Map<string, { id: string; status: string }>();
  for (const row of groupRows) {
    const name = row.adGroup.name as string;
    groupsByName.set(name, { id: row.adGroup.id, status: row.adGroup.status });
    console.log(`  ${row.adGroup.id}  ${name}  (${row.adGroup.status})`);
  }

  // Verify our hardcoded ID list matches discovery.
  const mismatches: string[] = [];
  for (const [name, expectedId] of Object.entries(AD_GROUP_IDS_TO_PAUSE)) {
    const found = groupsByName.get(name);
    if (!found) mismatches.push(`Group "${name}" not found in campaign`);
    else if (String(found.id) !== String(expectedId))
      mismatches.push(`Group "${name}" id mismatch: expected ${expectedId}, found ${found.id}`);
  }
  const keywordGroup = groupsByName.get(KEYWORD_GROUP_NAME);
  if (!keywordGroup) mismatches.push(`Group "${KEYWORD_GROUP_NAME}" not found`);
  if (mismatches.length > 0) {
    console.log("\nMISMATCHES FOUND:");
    mismatches.forEach((m) => console.log(`  - ${m}`));
    throw new Error("ABORT: ad group ID verification failed, refusing to apply.");
  }
  console.log("\nAll 17 ad group IDs verified. Keyword group found:", keywordGroup);

  // --- Find the specific keyword criterion to remove ---
  const kwRows = await searchGoogleAds(
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status
     FROM ad_group_criterion
     WHERE ad_group_criterion.ad_group = 'customers/${CUSTOMER_ID}/adGroups/${keywordGroup.id}'
       AND ad_group_criterion.type = 'KEYWORD'`,
  );
  console.log(`\nKeywords in "${KEYWORD_GROUP_NAME}" (${keywordGroup.id}):`);
  let targetCriterionId: string | undefined;
  for (const row of kwRows) {
    const text = row.adGroupCriterion.keyword.text as string;
    console.log(`  ${row.adGroupCriterion.criterionId}  "${text}"  (${row.adGroupCriterion.keyword.matchType}, ${row.adGroupCriterion.status})`);
    if (text.trim().toLowerCase() === KEYWORD_TEXT_TO_REMOVE) {
      targetCriterionId = row.adGroupCriterion.criterionId;
    }
  }
  if (!targetCriterionId) {
    throw new Error(`ABORT: keyword "${KEYWORD_TEXT_TO_REMOVE}" not found in group ${keywordGroup.id}`);
  }
  console.log(`\nTarget keyword criterion to remove: ${targetCriterionId}`);

  // --- Existing campaign negative keywords (avoid dup errors, informational) ---
  const existingNegRows = await searchGoogleAds(
    `SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.negative
     FROM campaign_criterion
     WHERE campaign_criterion.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}'
       AND campaign_criterion.type = 'KEYWORD'`,
  );
  console.log(`\nExisting campaign criteria (keyword type): ${existingNegRows.length}`);
  for (const row of existingNegRows) {
    console.log(`  neg=${row.campaignCriterion.negative} "${row.campaignCriterion.keyword.text}" (${row.campaignCriterion.keyword.matchType})`);
  }

  if (!APPLY) {
    console.log("\n################ DRY RUN — pass --apply to execute writes ################");
    return;
  }

  console.log("\n################ PHASE 2: APPLY ################\n");

  // 1. Pause the 17 ad groups
  const pauseOps = Object.entries(AD_GROUP_IDS_TO_PAUSE).map(([name, id]) => ({
    update: { resourceName: `customers/${CUSTOMER_ID}/adGroups/${id}`, status: "PAUSED" },
    updateMask: "status",
  }));
  const pauseResult = await callGoogleAds("/adGroups:mutate", { operations: pauseOps });
  console.log(`Paused ${pauseResult.results?.length ?? 0} ad groups.`);

  // 2. Remove the single keyword
  const removeResourceName = `customers/${CUSTOMER_ID}/adGroupCriteria/${keywordGroup.id}~${targetCriterionId}`;
  const removeResult = await callGoogleAds("/adGroupCriteria:mutate", {
    operations: [{ remove: removeResourceName }],
  });
  console.log(`Removed keyword criterion: ${JSON.stringify(removeResult.results)}`);

  // 3. Add campaign-level negative keywords
  const negOps = [
    ...NEGATIVE_EXACT.map((text) => ({
      create: {
        campaign: `customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}`,
        negative: true,
        keyword: { text, matchType: "EXACT" },
      },
    })),
    ...NEGATIVE_PHRASE.map((text) => ({
      create: {
        campaign: `customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}`,
        negative: true,
        keyword: { text, matchType: "PHRASE" },
      },
    })),
  ];
  const negResult = await callGoogleAds("/campaignCriteria:mutate", { operations: negOps });
  console.log(`Added ${negResult.results?.length ?? 0} campaign negative keywords.`);

  console.log("\n################ PHASE 3: VERIFY (read-back) ################\n");

  const campAfter = await searchGoogleAds(
    `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.id = ${CAMPAIGN_ID}`,
  );
  console.log("Campaign after:", JSON.stringify(campAfter[0]?.campaign));
  if (campAfter[0]?.campaign?.status !== "PAUSED") {
    console.log("!!! WARNING: campaign status is NOT PAUSED after apply — investigate immediately.");
  }

  const groupsAfter = await searchGoogleAds(
    `SELECT ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}'`,
  );
  console.log("\nAd group statuses after:");
  let pausedCount = 0;
  for (const row of groupsAfter) {
    const isTarget = Object.values(AD_GROUP_IDS_TO_PAUSE).includes(String(row.adGroup.id));
    if (isTarget && row.adGroup.status === "PAUSED") pausedCount++;
    console.log(`  ${row.adGroup.id}  ${row.adGroup.name}  ${row.adGroup.status}${isTarget ? "  <-- target" : ""}`);
  }
  console.log(`\n${pausedCount}/17 target groups confirmed PAUSED.`);

  const kwAfter = await searchGoogleAds(
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.status
     FROM ad_group_criterion
     WHERE ad_group_criterion.ad_group = 'customers/${CUSTOMER_ID}/adGroups/${keywordGroup.id}'
       AND ad_group_criterion.type = 'KEYWORD'`,
  );
  console.log(`\nKeywords in "${KEYWORD_GROUP_NAME}" after:`);
  for (const row of kwAfter) {
    console.log(`  ${row.adGroupCriterion.criterionId}  "${row.adGroupCriterion.keyword.text}"  ${row.adGroupCriterion.status}`);
  }
  const stillThere = kwAfter.some(
    (row: any) => row.adGroupCriterion.keyword.text.trim().toLowerCase() === KEYWORD_TEXT_TO_REMOVE && row.adGroupCriterion.status !== "REMOVED",
  );
  console.log(stillThere ? "!!! WARNING: target keyword still present/active." : "Confirmed: target keyword removed (absent from active list).");

  const negAfter = await searchGoogleAds(
    `SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
     FROM campaign_criterion
     WHERE campaign_criterion.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}'
       AND campaign_criterion.type = 'KEYWORD'
       AND campaign_criterion.negative = true`,
  );
  console.log(`\nCampaign negative keywords after (${negAfter.length} total):`);
  for (const row of negAfter) {
    console.log(`  "${row.campaignCriterion.keyword.text}" (${row.campaignCriterion.keyword.matchType})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
