// WRITE task (2026-09-23), explicit user approval via Telegram-adjacent
// terminal instruction: convert all live (ENABLED) keyword criteria in
// campaign 23487960638 "Поиск // ЛОР // Врачи // Минск" to EXACT match
// type. Google Ads does not support changing keyword.matchType on an
// existing ad_group_criterion via update (matchType is immutable once
// created) -> the only path is: create a new EXACT criterion with the
// same text in the same ad group, then REMOVE the old non-EXACT one.
// Several PHRASE/BROAD pairs share the same literal text (e.g.
// "перминов лор" exists as both BROAD and PHRASE) -> only ONE EXACT
// criterion is created per unique (adGroupId, text) pair; both originals
// get removed.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-lor-vrachi-exact-match.ts
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-lor-vrachi-exact-match.ts --apply
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";
import { readRange, writeRange } from "../lib/tools/google-sheets.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const CAMPAIGN_ID = "23487960638";
const CAMPAIGN_NAME = "Поиск // ЛОР // Врачи // Минск";
const APPLY = process.argv.includes("--apply");
const LOG_SHEET_ID = "1Fmh342iE28Bgk9z-2-Ds1LSIQUoiFzcUP3ERICKsawY";
const LOG_TAB = "МедАвеню - Лог правок";

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

interface KwRow {
  adGroupId: string;
  adGroupName: string;
  criterionId: string;
  text: string;
  matchType: string;
  status: string;
}

async function fetchLiveKeywords(): Promise<KwRow[]> {
  const rows = await search(`
    SELECT ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type, ad_group_criterion.status
    FROM ad_group_criterion
    WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}'
      AND ad_group_criterion.type = 'KEYWORD'
  `);
  return rows.map((r) => ({
    adGroupId: r.adGroup.id,
    adGroupName: r.adGroup.name,
    criterionId: r.adGroupCriterion.criterionId,
    text: r.adGroupCriterion.keyword.text as string,
    matchType: r.adGroupCriterion.keyword.matchType as string,
    status: r.adGroupCriterion.status as string,
  }));
}

async function main() {
  console.log("################ PHASE 1: DISCOVERY ################\n");
  const campRows = await search(`SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id = ${CAMPAIGN_ID}`);
  console.log("Campaign:", JSON.stringify(campRows[0]?.campaign));
  if (campRows[0]?.campaign?.name !== CAMPAIGN_NAME) {
    throw new Error(`ABORT: campaign name mismatch, expected "${CAMPAIGN_NAME}", found "${campRows[0]?.campaign?.name}"`);
  }

  const before = await fetchLiveKeywords();
  const enabled = before.filter((r) => r.status === "ENABLED");
  const alreadyExact = enabled.filter((r) => r.matchType === "EXACT");
  const nonExact = enabled.filter((r) => r.matchType !== "EXACT");
  console.log(`Total keyword criteria: ${before.length}`);
  console.log(`ENABLED: ${enabled.length} (EXACT already: ${alreadyExact.length}, need conversion: ${nonExact.length})`);

  // Group non-exact by (adGroupId, normalized text) -> unique EXACT targets
  const uniqueTargets = new Map<string, { adGroupId: string; adGroupName: string; text: string; removeIds: string[] }>();
  for (const r of nonExact) {
    const key = `${r.adGroupId}::${r.text.trim().toLowerCase()}`;
    const existing = uniqueTargets.get(key);
    if (existing) {
      existing.removeIds.push(r.criterionId);
    } else {
      uniqueTargets.set(key, { adGroupId: r.adGroupId, adGroupName: r.adGroupName, text: r.text, removeIds: [r.criterionId] });
    }
  }
  // Also check: does an EXACT criterion with this exact text already exist in this group? Skip creating a dup.
  const existingExactTexts = new Set(alreadyExact.map((r) => `${r.adGroupId}::${r.text.trim().toLowerCase()}`));
  const toCreate = [...uniqueTargets.values()].filter((t) => !existingExactTexts.has(`${t.adGroupId}::${t.text.trim().toLowerCase()}`));
  const skippedAsDupOfExisting = [...uniqueTargets.values()].filter((t) => existingExactTexts.has(`${t.adGroupId}::${t.text.trim().toLowerCase()}`));

  console.log(`\nUnique EXACT criteria to create: ${toCreate.length}`);
  for (const t of toCreate) console.log(`  [create EXACT] adGroup=${t.adGroupId} "${t.adGroupName}" text="${t.text}" (removes ${t.removeIds.length} old criteria: ${t.removeIds.join(",")})`);
  if (skippedAsDupOfExisting.length > 0) {
    console.log(`\nSkipped (EXACT already exists for this text) - will still remove old non-EXACT duplicates:`);
    for (const t of skippedAsDupOfExisting) console.log(`  adGroup=${t.adGroupId} text="${t.text}" removes ${t.removeIds.join(",")}`);
  }
  const totalToRemove = nonExact.length;
  console.log(`\nTotal non-EXACT ENABLED criteria to remove: ${totalToRemove}`);

  if (!APPLY) {
    console.log("\n################ DRY RUN — pass --apply to execute writes ################");
    return;
  }

  console.log("\n################ PHASE 2: APPLY ################\n");

  // 1. Create new EXACT criteria (only for texts without an existing EXACT)
  if (toCreate.length > 0) {
    const createOps = toCreate.map((t) => ({
      create: {
        adGroup: `customers/${CUSTOMER_ID}/adGroups/${t.adGroupId}`,
        status: "ENABLED",
        keyword: { text: t.text, matchType: "EXACT" },
      },
    }));
    const createResult = await callGoogleAds("/adGroupCriteria:mutate", { operations: createOps, partialFailure: true });
    if (createResult.partialFailureError) {
      console.log("!!! PARTIAL FAILURE on create:", JSON.stringify(createResult.partialFailureError));
    }
    console.log(`Created ${createResult.results?.length ?? 0} EXACT criteria.`);
  }

  // 2. Remove all old non-EXACT criteria
  const removeOps = nonExact.map((r) => ({ remove: `customers/${CUSTOMER_ID}/adGroupCriteria/${r.adGroupId}~${r.criterionId}` }));
  const removeResult = await callGoogleAds("/adGroupCriteria:mutate", { operations: removeOps, partialFailure: true });
  if (removeResult.partialFailureError) {
    console.log("!!! PARTIAL FAILURE on remove:", JSON.stringify(removeResult.partialFailureError));
  }
  console.log(`Removed ${removeResult.results?.length ?? 0} non-EXACT criteria.`);

  console.log("\n################ PHASE 3: VERIFY (read-back) ################\n");
  const after = await fetchLiveKeywords();
  const afterEnabled = after.filter((r) => r.status === "ENABLED");
  const afterNonExact = afterEnabled.filter((r) => r.matchType !== "EXACT");
  console.log(`After: ENABLED total=${afterEnabled.length}, non-EXACT remaining=${afterNonExact.length}`);
  for (const r of afterEnabled) {
    console.log(`  adGroup=${r.adGroupId} criterionId=${r.criterionId} text="${r.text}" matchType=${r.matchType} status=${r.status}`);
  }
  if (afterNonExact.length > 0) {
    console.log("\n!!! WARNING: non-EXACT ENABLED criteria still present:");
    for (const r of afterNonExact) console.log(`  ${JSON.stringify(r)}`);
    throw new Error("ABORT before logging: verification failed, non-EXACT keywords remain live.");
  }
  console.log("\nConfirmed: all live keyword criteria in campaign are EXACT.");

  // --- Log to Лог правок sheet ---
  const now = new Date();
  const todayRu = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
  const existingLog = await readRange(LOG_SHEET_ID, `'${LOG_TAB}'!A1:H10000`);
  const nextRow = existingLog.length + 1;
  const logRow = [
    todayRu,
    "МедАвеню",
    "google-ads",
    `${CAMPAIGN_ID} "${CAMPAIGN_NAME}"`,
    "Тип соответствия ключевых слов -> EXACT",
    "ВНЕДРЕНО [AK]",
    "",
    `Все ${totalToRemove} живых (ENABLED) ключевых слов кампании (PHRASE/BROAD, группы "Врач - Перминов", "Врач - Челомбитько", "Врач - Лобачева") переведены на точное соответствие: создано ${toCreate.length} новых EXACT-критериев (дубли текста между BROAD/PHRASE схлопнуты в один EXACT), старые PHRASE/BROAD критерии удалены (matchType неизменяем в API -> единственный путь create+remove). 4 ключа, уже бывших EXACT, не тронуты. Прочитано обратно: все ${afterEnabled.length} живых критериев в кампании теперь EXACT, non-EXACT ENABLED = 0.`,
  ];
  await writeRange(LOG_SHEET_ID, `'${LOG_TAB}'!A${nextRow}:H${nextRow}`, [logRow]);
  console.log(`\nLogged to "${LOG_TAB}" row ${nextRow}.`);
  const loggedBack = await readRange(LOG_SHEET_ID, `'${LOG_TAB}'!A${nextRow}:H${nextRow}`);
  console.log(`Log row read back: ${JSON.stringify(loggedBack)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
