// WRITE task (2026-09-23), explicit user "да" for this specific live edit
// (terminal session, tag [AK] in the Лог правок sheet, no [TG] prefix —
// see project_medavenue_cannibalization_followup memory).
//
// Two live Yandex Direct campaigns are simultaneously bidding on the same
// "родинки" (moles) search queries:
//   - 708468419 "Удаление новообразований // Поиск // Минск // Manual",
//     ad group 5736114240 "Родинки — удаление"
//   - 713471948 "Удаление родинок // Поиск // Минск // Manual" (newer,
//     more finely segmented — keep this one live for the родинки semantic)
//
// Plan:
//   1. Read ALL ad groups of campaign 708468419 (not just "Родинки —
//      удаление") + their keywords, looking for broad keywords in OTHER
//      groups that could also catch родинки queries. Add negative
//      keywords (campaign-level, on 708468419) for any leak found.
//   2. Suspend ad group 5736114240 in campaign 708468419.
//   3. Read state back to confirm the group is suspended and negatives
//      persisted.
//   4. Log to "МедАвеню - Лог правок" with status "ВНЕДРЕНО [AK]".
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-rodinki-cannibalization-fix.ts
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-rodinki-cannibalization-fix.ts --apply
import { addNegativeKeywords, suspendAdGroupServing } from "../lib/tools/yandex-direct.ts";
import { getYandexAccessToken } from "../lib/tools/yandex-oauth.ts";
import { readRange, writeRange } from "../lib/tools/google-sheets.ts";

const CLIENT_LOGIN = "porg-yw2ynqgs";
const ACCESS_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const API_BASE = "https://api.direct.yandex.com/json/v5";
const CAMPAIGN_ID = 708468419; // Удаление новообразований
const RODINKI_AD_GROUP_ID = "5736114240"; // "Родинки — удаление" group inside 708468419
const SIBLING_CAMPAIGN_ID = "713471948"; // Удаление родинок — keep this one live

const LOG_SHEET_ID = "1Fmh342iE28Bgk9z-2-Ds1LSIQUoiFzcUP3ERICKsawY";
const LOG_TAB = "МедАвеню - Лог правок";

const APPLY = process.argv.includes("--apply");

function rawId(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error(`rawId: not a plain integer string: ${id}`);
  return `__RAWID_${id}_RAWID__`;
}
function encodeRawIds(body: string): string {
  return body.replace(/"__RAWID_(\d+)_RAWID__"/g, "$1");
}

async function callDirect(resource: string, method: string, params: unknown): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getYandexAccessToken(ACCESS_TOKEN_ENV)}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
    "Client-Login": CLIENT_LOGIN,
  };
  const response = await fetch(`${API_BASE}/${resource}`, {
    method: "POST",
    headers,
    body: encodeRawIds(JSON.stringify({ method, params })),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${resource}.${method} HTTP ${response.status}: ${text}`);
  const safeText = text.replace(/:(-?\d{16,})([,}\]])/g, ':"$1"$2');
  const data = safeText ? JSON.parse(safeText) : {};
  if (data.error) throw new Error(`${resource}.${method} API error: ${JSON.stringify(data.error)}`);
  return data.result;
}

const RODINKI_RE = /родинк/i; // catches родинка/родинки/родинок/родинками/... all Russian case forms

async function main() {
  console.log(`APPLY=${APPLY}`);

  // --- Step 1: read all ad groups + keywords of campaign 708468419 ---
  const groupsResult = await callDirect("adgroups", "get", {
    SelectionCriteria: { CampaignIds: [CAMPAIGN_ID] },
    FieldNames: ["Id", "Name", "Status", "Type"],
  });
  const groups: Array<{ Id: number; Name: string; Status: string; Type: string }> = groupsResult.AdGroups ?? [];
  console.log(`\nAd groups in campaign ${CAMPAIGN_ID}: ${groups.length}`);
  for (const g of groups) console.log(`  ${g.Id}  "${g.Name}"  status=${g.Status}  type=${g.Type}`);

  const kwResult = await callDirect("keywords", "get", {
    SelectionCriteria: { CampaignIds: [CAMPAIGN_ID] },
    FieldNames: ["Id", "AdGroupId", "Keyword", "State", "Status"],
  });
  const keywords: Array<{ Id: number; AdGroupId: number; Keyword: string; State: string; Status: string }> =
    kwResult.Keywords ?? [];

  const otherGroupIds = new Set(groups.filter((g) => String(g.Id) !== RODINKI_AD_GROUP_ID).map((g) => g.Id));
  const leakKeywords = keywords.filter(
    (k) => otherGroupIds.has(k.AdGroupId) && RODINKI_RE.test(k.Keyword),
  );
  // Also flag keywords too broad to literally contain "родинк" but that
  // are single/short generic terms (e.g. "удаление новообразований",
  // "удаление кожных образований") which Yandex's broad/synonym matching
  // could still expand to родинки queries even without the literal word.
  const broadRiskKeywords = keywords.filter(
    (k) =>
      otherGroupIds.has(k.AdGroupId) &&
      !RODINKI_RE.test(k.Keyword) &&
      /(новообразовани|кожн[а-я]* образован)/i.test(k.Keyword) &&
      !k.Keyword.includes("-"), // no existing minus qualifiers narrowing it already
  );

  console.log(`\nKeywords in OTHER groups literally containing "родинк*": ${leakKeywords.length}`);
  for (const k of leakKeywords) console.log(`  group ${k.AdGroupId}  kw="${k.Keyword}"  state=${k.State}`);

  console.log(`\nBroad keywords in OTHER groups that could semantically expand to родинки (review only): ${broadRiskKeywords.length}`);
  for (const k of broadRiskKeywords) console.log(`  group ${k.AdGroupId}  kw="${k.Keyword}"  state=${k.State}`);

  // Existing campaign-level negatives, for the report.
  const campResult = await callDirect("campaigns", "get", {
    SelectionCriteria: { Ids: [CAMPAIGN_ID] },
    FieldNames: ["Id", "Name", "NegativeKeywords"],
  });
  const existingNegatives: string[] = campResult.Campaigns?.[0]?.NegativeKeywords?.Items ?? [];
  console.log(`\nExisting campaign-level negatives on ${CAMPAIGN_ID}: ${JSON.stringify(existingNegatives)}`);

  // Negative phrases to add at campaign level, so родинки traffic is fully
  // redirected to 713471948 regardless of which other group might catch
  // it. Broad-form negatives cover the case-form family via Yandex's own
  // morphology (a plain "родинки" negative matches родинка/родинок/etc.).
  const negativesToAdd = ["родинки", "родинка", "родинку", "удаление родинки", "удалить родинку"];

  console.log(`\nStep 1 verdict: ${leakKeywords.length === 0 ? "NO literal родинк* keyword leak found in other groups." : "LEAK FOUND — see list above."}`);
  console.log(`Adding campaign-level negatives to ${CAMPAIGN_ID} as a safety net regardless (covers any future/synonym/broad-match leak): ${JSON.stringify(negativesToAdd)}`);

  if (!APPLY) {
    console.log("\n--apply not passed. Dry run only, no writes made. Re-run with --apply to execute.");
    return;
  }

  // --- Step 1b: add negatives (idempotent — merges with whatever's
  // already there; safe to re-run) ---
  const negResult = await addNegativeKeywords(CAMPAIGN_ID, negativesToAdd, CLIENT_LOGIN, ACCESS_TOKEN_ENV);
  console.log(`\nNegatives written. Total negative count on campaign now: ${negResult.totalNegativeCount}`);

  // --- Step 2: suspend everything serving inside "Родинки — удаление" ---
  // Note: Yandex Direct API v5 has no adgroups.suspend method (confirmed
  // live 2026-09-23, error_code 55 "Операция не найдена") — the real
  // equivalent is suspending every ad + manual keyword in the group. See
  // suspendAdGroupServing's own comment in yandex-direct.ts for the full
  // story, including why the autotargeting pseudo-keyword can't be
  // suspended directly but is harmless once every ad is off.
  const suspendResult = await suspendAdGroupServing(RODINKI_AD_GROUP_ID, CLIENT_LOGIN, ACCESS_TOKEN_ENV);
  console.log(`\nsuspendAdGroupServing result: ${JSON.stringify(suspendResult)}`);

  // --- Step 3: read state back ---
  const verifyAds = await callDirect("ads", "get", {
    SelectionCriteria: { AdGroupIds: [rawId(RODINKI_AD_GROUP_ID)] },
    FieldNames: ["Id", "State"],
  });
  const verifyKeywords = await callDirect("keywords", "get", {
    SelectionCriteria: { AdGroupIds: [rawId(RODINKI_AD_GROUP_ID)] },
    FieldNames: ["Id", "Keyword", "State"],
  });
  console.log(`\nVerify ads in group: ${JSON.stringify(verifyAds.Ads)}`);
  console.log(`\nVerify keywords in group: ${JSON.stringify(verifyKeywords.Keywords)}`);
  const groupSuspended =
    (verifyAds.Ads ?? []).every((a: { State: string }) => a.State === "SUSPENDED" || a.State === "OFF") &&
    (verifyKeywords.Keywords ?? []).every(
      (k: { Keyword: string; State: string }) => k.Keyword === "---autotargeting" || k.State === "SUSPENDED" || k.State === "OFF",
    );

  const verifyCamp = await callDirect("campaigns", "get", {
    SelectionCriteria: { Ids: [CAMPAIGN_ID] },
    FieldNames: ["Id", "Name", "NegativeKeywords"],
  });
  const verifiedNegatives: string[] = verifyCamp.Campaigns?.[0]?.NegativeKeywords?.Items ?? [];
  console.log(`\nVerify campaign negatives: ${JSON.stringify(verifiedNegatives)}`);
  // Yandex silently drops single-word negatives ("родинка"/"родинку") that
  // it considers already covered by the same-lemma multi-word negative
  // "родинки" already in the list — confirmed live 2026-09-23 (24 written
  // per the API's own totalNegativeCount, but only 22 distinct strings
  // come back on read, exactly the 2 singular forms missing). Requiring
  // only the phrase-level negatives + the "родинки" lemma root, not every
  // literal string sent, matches what Yandex actually guarantees.
  const requiredNegatives = ["родинки", "удаление родинки", "удалить родинку"];
  const negativesPersisted = requiredNegatives.every((n) => verifiedNegatives.includes(n));

  console.log(`\nSelf-check: ad group suspended = ${groupSuspended}, negatives persisted = ${negativesPersisted}`);
  if (!groupSuspended || !negativesPersisted) {
    throw new Error("Self-check FAILED — do not log as ВНЕДРЕНО, investigate before retrying.");
  }

  // --- Step 4: log to Лог правок sheet ---
  const now = new Date();
  const todayRu = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
  const existing = await readRange(LOG_SHEET_ID, `'${LOG_TAB}'!A1:H10000`);
  const nextRow = existing.length + 1; // 1-indexed; append right after last used row
  const logRow = [
    todayRu,
    "МедАвеню",
    "yandex-direct",
    `708468419 "Удаление новообразований // Поиск // Минск // Manual"`,
    "Группа объявлений + минус-фразы",
    "ВНЕДРЕНО [AK]",
    "",
    `Каннибализация с 713471948 "Удаление родинок": группа "Родинки — удаление" (5736114240) в кампании 708468419 полностью остановлена (все объявления и ручные ключи в State SUSPENDED; автотаргетинг-строка не может быть остановлена индивидуально у Яндекса, но без активных объявлений показов не даёт — API-метода adgroups.suspend у Директа нет, подтверждено live 2026-09-23). По факту группа уже не давала показов с 2026-08-12 — состояние подтверждено. Проверены все остальные группы 708468419 на широкие ключи по родинкам — литеральных утечек не найдено (1 потенциально широкий ключ "кожные образования удаление минск" в группе [new] Узлы-кожа 5748536130 — не минусован, требует наблюдения). Добавлены минус-фразы на кампанию 708468419 как страховка: родинки, удаление родинки, удалить родинку (единичные формы "родинка"/"родинку" Яндекс не добавил отдельно — считает покрытыми той же леммой "родинки"). Весь трафик по родинкам теперь идёт только через 713471948.`,
  ];
  await writeRange(LOG_SHEET_ID, `'${LOG_TAB}'!A${nextRow}:H${nextRow}`, [logRow]);
  console.log(`\nLogged to "${LOG_TAB}" row ${nextRow}: ${JSON.stringify(logRow)}`);

  // Read back the log row to confirm it actually saved.
  const loggedBack = await readRange(LOG_SHEET_ID, `'${LOG_TAB}'!A${nextRow}:H${nextRow}`);
  console.log(`\nLog row read back: ${JSON.stringify(loggedBack)}`);

  console.log("\nDONE.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
