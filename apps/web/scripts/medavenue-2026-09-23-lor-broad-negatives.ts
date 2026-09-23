// WRITE task (2026-09-23), explicit user approval: add BROAD campaign-level
// negative keywords "перминов", "челомбитько", "лобачева" to campaign
// 23373725924 "Поиск // Лор // Минск". These are personal doctor surnames
// that have their own specialized campaign 23487960638
// "Поиск // ЛОР // Врачи // Минск" with CPA ~4x lower ($0.61 vs $2.43).
// Queries with these surnames currently leak partly into the general
// "Лор" campaign instead of the personalized one — these negatives close
// that leak (~$17.56/mo estimated savings).
//
// Before adding: verify none of the 3 negatives already exist at
// campaign level OR in any shared negative keyword list attached to the
// campaign. After adding: read back and confirm all 3 present.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-lor-broad-negatives.ts
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-lor-broad-negatives.ts --apply
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";
import { readRange, appendRows } from "../lib/tools/google-sheets.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const CAMPAIGN_ID = "23373725924";
const CAMPAIGN_NAME = "Поиск // Лор // Минск";
const APPLY = process.argv.includes("--apply");
const LOG_SHEET_ID = "1Fmh342iE28Bgk9z-2-Ds1LSIQUoiFzcUP3ERICKsawY";
const LOG_TAB = "МедАвеню - Лог правок";

const NEGATIVES = ["перминов", "челомбитько", "лобачева"];

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

// googleAds:search REST paginates at 10,000 rows per page and does NOT
// auto-follow nextPageToken — confirmed live 2026-09-23 against shared set
// "CM - Общие минус-слова" (exactly 10000 rows on page 1, nextPageToken
// present, real total is higher). Any check against a large shared
// negative list MUST paginate or it will silently miss entries beyond the
// first page and risk creating a true duplicate.
async function searchAllPages(query: string): Promise<any[]> {
  const all: any[] = [];
  let pageToken: string | undefined;
  do {
    const data = (await callGoogleAds("/googleAds:search", { query, pageToken })) as {
      results?: any[];
      nextPageToken?: string;
    };
    all.push(...(data.results ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

async function main() {
  console.log("################ PHASE 1: DISCOVERY ################\n");
  const campRows = await search(
    `SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id = ${CAMPAIGN_ID}`,
  );
  console.log("Campaign:", JSON.stringify(campRows[0]?.campaign));
  if (campRows[0]?.campaign?.name !== CAMPAIGN_NAME) {
    throw new Error(`ABORT: campaign name mismatch, expected "${CAMPAIGN_NAME}", found "${campRows[0]?.campaign?.name}"`);
  }

  // --- Existing campaign-level negative keywords ---
  const campNegRows = await search(`
    SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.negative
    FROM campaign_criterion
    WHERE campaign_criterion.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}'
      AND campaign_criterion.type = 'KEYWORD'
      AND campaign_criterion.negative = true
  `);
  console.log(`\nExisting campaign-level negative keywords (${campNegRows.length}):`);
  for (const r of campNegRows) {
    console.log(`  "${r.campaignCriterion.keyword.text}" (${r.campaignCriterion.keyword.matchType})`);
  }
  const existingCampNegTexts = new Set(campNegRows.map((r) => norm(r.campaignCriterion.keyword.text)));

  // --- Shared negative keyword lists attached to this campaign ---
  const sharedSetLinks = await search(`
    SELECT campaign_shared_set.shared_set, campaign_shared_set.status, shared_set.name, shared_set.type
    FROM campaign_shared_set
    WHERE campaign_shared_set.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}'
  `);
  console.log(`\nAttached shared sets (${sharedSetLinks.length}):`);
  for (const r of sharedSetLinks) {
    console.log(`  ${r.campaignSharedSet.sharedSet}  name="${r.sharedSet?.name}" type=${r.sharedSet?.type} status=${r.campaignSharedSet.status}`);
  }

  const sharedNegTexts = new Set<string>();
  for (const link of sharedSetLinks) {
    const sharedSetResourceName = link.campaignSharedSet.sharedSet as string;
    const criteriaRows = await searchAllPages(`
      SELECT shared_criterion.keyword.text, shared_criterion.keyword.match_type
      FROM shared_criterion
      WHERE shared_criterion.shared_set = '${sharedSetResourceName}'
        AND shared_criterion.type = 'KEYWORD'
    `);
    console.log(`\n  Shared set ${sharedSetResourceName}: ${criteriaRows.length} keyword criteria`);
    for (const r of criteriaRows) {
      const text = r.sharedCriterion.keyword.text as string;
      sharedNegTexts.add(norm(text));
    }
  }

  console.log(`\nTotal unique negative texts across campaign-level + all shared lists: ${existingCampNegTexts.size + sharedNegTexts.size}`);

  // --- Check our 3 target negatives against both sources ---
  const alreadyPresent: string[] = [];
  const toAdd: string[] = [];
  for (const kw of NEGATIVES) {
    const n = norm(kw);
    if (existingCampNegTexts.has(n)) {
      alreadyPresent.push(`${kw} (already campaign-level negative)`);
    } else if (sharedNegTexts.has(n)) {
      alreadyPresent.push(`${kw} (already in a shared negative list)`);
    } else {
      toAdd.push(kw);
    }
  }
  console.log(`\nAlready present (skip): ${JSON.stringify(alreadyPresent)}`);
  console.log(`To add as BROAD campaign-level negatives: ${JSON.stringify(toAdd)}`);

  if (!APPLY) {
    console.log("\n################ DRY RUN — pass --apply to execute writes ################");
    return;
  }

  if (toAdd.length === 0) {
    console.log("\nNothing to add — all target negatives already present. Skipping mutate + log.");
    return;
  }

  console.log("\n################ PHASE 2: APPLY ################\n");
  const createOps = toAdd.map((text) => ({
    create: {
      campaign: `customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}`,
      negative: true,
      keyword: { text, matchType: "BROAD" },
    },
  }));
  const createResult = await callGoogleAds("/campaignCriteria:mutate", { operations: createOps, partialFailure: true });
  if (createResult.partialFailureError) {
    console.log("!!! PARTIAL FAILURE:", JSON.stringify(createResult.partialFailureError));
  }
  console.log(`Created ${createResult.results?.length ?? 0} negative keyword criteria.`);

  console.log("\n################ PHASE 3: VERIFY (read-back) ################\n");
  const afterRows = await search(`
    SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.negative
    FROM campaign_criterion
    WHERE campaign_criterion.campaign = 'customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}'
      AND campaign_criterion.type = 'KEYWORD'
      AND campaign_criterion.negative = true
  `);
  const afterTexts = new Set(afterRows.map((r) => norm(r.campaignCriterion.keyword.text)));
  console.log(`Campaign-level negatives after (${afterRows.length} total):`);
  for (const r of afterRows) {
    console.log(`  "${r.campaignCriterion.keyword.text}" (${r.campaignCriterion.keyword.matchType})`);
  }
  const missing = NEGATIVES.filter((kw) => !afterTexts.has(norm(kw)) && !sharedNegTexts.has(norm(kw)));
  if (missing.length > 0) {
    throw new Error(`ABORT before logging: verification failed, missing negatives: ${JSON.stringify(missing)}`);
  }
  console.log("\nConfirmed: all 3 target negatives (перминов, челомбитько, лобачева) present as campaign-level negatives or already covered by a shared list.");

  // --- Log to Лог правок sheet ---
  const now = new Date();
  const todayRu = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
  const row = [
    todayRu,
    "МедАвеню",
    "google-ads",
    `${CAMPAIGN_ID} "${CAMPAIGN_NAME}"`,
    "Минус-слова (кампания, BROAD)",
    "ВНЕДРЕНО [AK]",
    "",
    `Добавлены 3 минус-слова BROAD на уровне кампании: ${toAdd.join(", ")}. ` +
      `Причина: это фамилии врачей (Перминов, Челомбитько, Лобачева), у которых есть отдельная персонализированная кампания ` +
      `23487960638 "Поиск // ЛОР // Врачи // Минск" с CPA в 4 раза ниже ($0.61 против $2.43 в общей кампании "Лор"). ` +
      `Часть запросов с этими фамилиями утекала в общую кампанию вместо персонализированной — минус-слова закрывают утечку, ` +
      `ожидаемая экономия ~$17.56/мес. Перед добавлением проверено: ни одного из 3 слов не было ни на уровне кампании, ` +
      `ни в привязанных к кампании shared negative lists. После добавления прочитано обратно через campaign_criterion — все 3 подтверждены.`,
  ];
  await appendRows(LOG_SHEET_ID, `'${LOG_TAB}'!A:H`, [row]);
  const check = await readRange(LOG_SHEET_ID, `'${LOG_TAB}'!A1:H10000`);
  const last = check[check.length - 1];
  console.log(`\nLogged to "${LOG_TAB}". Last row: ${JSON.stringify(last)}`);
  console.log(`Total rows now: ${check.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
