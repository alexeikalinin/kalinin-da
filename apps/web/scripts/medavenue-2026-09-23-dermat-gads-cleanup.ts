// LIVE writes (2026-09-23), explicitly approved by the user, for Медавеню
// Google Ads (customer 9714539590), campaign 19321388084 "Поиск //
// Дерматолог // Минск // 22.09.26":
//
//   Step 1 (read-only): check whether "романива" (BROAD positive keyword,
//   currently self-cancelling against its own campaign-level negative of
//   the same text in ad group "Дерматолог_Минск") is a misspelled doctor
//   surname (site check + search_term_view history), or garbage.
//
//   Step 2 (write, gated on step 1 verdict): apply the approved batch of
//   edits — see the task prompt for the full list. Only runs with
//   --apply, and only touches "романива" if step 1 concludes it's garbage.
//
//   Step 3 (write, gated): remove 11 wordforms from the account-wide
//   shared negative list "CM - Общие минус-слова" (11852680614) — but
//   only after confirming which OTHER campaigns it's attached to, and
//   only if none of them look like they need those wordforms as
//   protection for a different specialty.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-dermat-gads-cleanup.ts
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-dermat-gads-cleanup.ts --apply
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";
import { readRange, writeRange } from "../lib/tools/google-sheets.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_BASE = "https://googleads.googleapis.com/v25";
const CAMPAIGN_ID = "19321388084";
const CAMPAIGN_RESOURCE = `customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}`;
const SHARED_SET_ID = "11852680614";
const SHARED_SET_RESOURCE = `customers/${CUSTOMER_ID}/sharedSets/${SHARED_SET_ID}`;

const LOG_SHEET_ID = "1Fmh342iE28Bgk9z-2-Ds1LSIQUoiFzcUP3ERICKsawY";
const LOG_TAB = "МедАвеню - Лог правок";

const APPLY = process.argv.includes("--apply");

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
  const results: any[] = [];
  let pageToken: string | undefined;
  do {
    const data = await callGoogleAds("/googleAds:search", { query, pageToken });
    results.push(...(data.results ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}

async function main() {
  console.log(`APPLY=${APPLY}`);

  // ---------- Step 1: романива — врач или мусор? ----------
  console.log("\n=== Step 1: романива — search_term_view history ===");
  const termRows = await search(`
    SELECT search_term_view.search_term, campaign.id, campaign.name, ad_group.id, ad_group.name,
           metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
           segments.date
    FROM search_term_view
    WHERE search_term_view.search_term LIKE '%романив%'
      AND segments.date BETWEEN '2025-01-01' AND '2026-09-23'
    ORDER BY segments.date DESC
  `);
  console.log(`Rows found: ${termRows.length}`);
  for (const r of termRows) {
    console.log(
      `  ${r.segments?.date}  "${r.searchTermView?.searchTerm}"  campaign=${r.campaign?.name}  adgroup=${r.adGroup?.name}  impr=${r.metrics?.impressions} clicks=${r.metrics?.clicks} cost=${r.metrics?.costMicros} conv=${r.metrics?.conversions}`,
    );
  }

  console.log("\nSite check result (done via fetch against medavenu.by/staff/ and /dermatologija/ earlier in this session):");
  console.log(
    "  Full staff list (91 profiles) scanned for 'роман*' — two matches: Романенко Александр Евгеньевич (Anesthesiology, Заславская branch) and Романовская Светлана Эдуардовна (Oncology/Surgery, Грибоедова branch). NEITHER is a dermatologist, and neither surname is phonetically close to 'романива'. No dermatologist named anything like Романива/Романив/Романова found on medavenu.by/staff/ or /dermatologija/.",
  );

  const hasRealDoctorMatch = false; // confirmed by the site check above
  const hasSearchHistory = termRows.length > 0;
  // Conservative reading of the task's decision rule: "no confirmation
  // EITHER on the site OR in search queries" -> garbage. Here there IS
  // real, recurring search-query history (consistently "романива
  // дерматолог"/"дерматолог романива" over Jan-May 2026, ~24 impressions,
  // 2 real clicks with real cost) even though there's no site match — that
  // combination doesn't cleanly satisfy either branch of the rule, so this
  // stays a human decision rather than an automatic delete.
  const romanivaIsGarbage = !hasSearchHistory && !hasRealDoctorMatch;
  console.log(
    `\nStep 1 verdict: романива is ${
      romanivaIsGarbage
        ? "GARBAGE (no doctor match, no search history) — will remove both the positive keyword and the negative."
        : "AMBIGUOUS — real recurring search-query history (see rows above) but no matching doctor found on medavenu.by. Likely a real person's surname (possibly a competitor's doctor, or a doctor no longer listed on the site) rather than pure noise. NOT touching it; flagging for human decision."
    }`,
  );

  // ---------- Read current state: keywords, campaign negatives, ad group negatives ----------
  console.log("\n=== Current ad group keywords (Дерматолог_Минск, Дерматолог_Прием) ===");
  const adGroupRows = await search(`
    SELECT ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type, ad_group_criterion.negative, ad_group_criterion.status
    FROM ad_group_criterion
    WHERE campaign.id = ${CAMPAIGN_ID} AND ad_group_criterion.type = 'KEYWORD'
  `);
  for (const r of adGroupRows) {
    console.log(
      `  group="${r.adGroup?.name}" (${r.adGroup?.id})  kw="${r.adGroupCriterion?.keyword?.text}" match=${r.adGroupCriterion?.keyword?.matchType} negative=${r.adGroupCriterion?.negative} status=${r.adGroupCriterion?.status} criterionId=${r.adGroupCriterion?.criterionId}`,
    );
  }

  console.log("\n=== Current campaign-level negative keywords ===");
  const campNegRows = await search(`
    SELECT campaign_criterion.criterion_id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
           campaign_criterion.negative
    FROM campaign_criterion
    WHERE campaign.id = ${CAMPAIGN_ID} AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE
  `);
  for (const r of campNegRows) {
    console.log(
      `  neg kw="${r.campaignCriterion?.keyword?.text}" match=${r.campaignCriterion?.keyword?.matchType} criterionId=${r.campaignCriterion?.criterionId}`,
    );
  }

  // ---------- Step 3 prep: which other campaigns use the shared negative list? ----------
  console.log("\n=== Campaigns attached to shared negative list CM - Общие минус-слова (11852680614) ===");
  const sharedAttach = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign_shared_set.shared_set
    FROM campaign_shared_set
    WHERE campaign_shared_set.shared_set = '${SHARED_SET_RESOURCE}'
  `);
  for (const r of sharedAttach) {
    console.log(`  campaign ${r.campaign?.id} "${r.campaign?.name}" status=${r.campaign?.status}`);
  }

  console.log("\n=== The 11 wordforms currently in the shared set (if present) ===");
  const wordforms = [
    "центральный",
    "центральная",
    "центральные",
    "центральное",
    "центрального",
    "центральных",
    "центральной",
    "фрунзенски",
    "дерматовенеролога",
    "дерматовенерологи",
    "дерматовенерологов",
  ];
  const sharedItems = await search(`
    SELECT shared_criterion.criterion_id, shared_criterion.keyword.text, shared_criterion.keyword.match_type
    FROM shared_criterion
    WHERE shared_criterion.shared_set = '${SHARED_SET_RESOURCE}'
  `);
  const sharedByText = new Map<string, string>(); // text -> resourceName
  for (const r of sharedItems) {
    const text = r.sharedCriterion?.keyword?.text as string | undefined;
    if (text) sharedByText.set(text, r.sharedCriterion?.resourceName ?? `sharedSets/${SHARED_SET_ID}/sharedCriteria/${r.sharedCriterion?.criterionId}`);
  }
  console.log(`Total shared set items: ${sharedItems.length}`);
  for (const w of wordforms) {
    console.log(`  "${w}" -> ${sharedByText.has(w) ? "FOUND, resourceName=" + sharedByText.get(w) : "NOT FOUND"}`);
  }

  console.log(
    "\nRisk check: shared set is attached to the campaign(s) listed above. 'центральный/-ая/...' and 'фрунзенски' read as Minsk-district disambiguation terms (e.g. filtering out 'Центральная районная поликлиника' or a different city district) rather than protection specific to a non-dermatology specialty; 'дерматовенеролог*' forms are themselves dermatology-relevant terms and being negative on a dermatology-adjacent list looks like the actual bug being fixed here. Will only proceed with removal if the attached-campaign list above doesn't include something clearly non-dermatology that plausibly depends on district/branch disambiguation.",
  );

  if (!APPLY) {
    console.log("\n--apply not passed. Dry run only, no writes made. Re-run with --apply to execute after reviewing the verdicts above.");
    return;
  }

  // ================= WRITES =================
  const opsLog: string[] = [];

  // --- Step 2.1: 13 diagnosis BROAD campaign negatives + 1 PHRASE negative ---
  const diagnosisNegatives = [
    "акне",
    "бородавки",
    "папилломы",
    "грибок",
    "лишай",
    "себорея",
    "витилиго",
    "дерматит",
    "пигментация",
    "рубцы",
    "шрамы",
    "педикулез",
    "сыпь",
  ];
  const existingNegTexts = new Set(campNegRows.map((r: any) => r.campaignCriterion?.keyword?.text));
  const toAddBroad = diagnosisNegatives.filter((w) => !existingNegTexts.has(w));
  const needsPhraseUdalenieRodinok = !campNegRows.some(
    (r: any) => r.campaignCriterion?.keyword?.text === "удаление родинок" && r.campaignCriterion?.keyword?.matchType === "PHRASE",
  );
  console.log(`\n=== Step 2.1: adding negatives ===`);
  console.log(`BROAD diagnosis negatives to add (${toAddBroad.length}): ${JSON.stringify(toAddBroad)}`);
  console.log(`PHRASE "удаление родинок" needed: ${needsPhraseUdalenieRodinok}`);

  const addNegOps = [
    ...toAddBroad.map((text) => ({
      create: { campaign: CAMPAIGN_RESOURCE, negative: true, keyword: { text, matchType: "BROAD" } },
    })),
    ...(needsPhraseUdalenieRodinok
      ? [{ create: { campaign: CAMPAIGN_RESOURCE, negative: true, keyword: { text: "удаление родинок", matchType: "PHRASE" } } }]
      : []),
  ];
  if (addNegOps.length > 0) {
    const res = await callGoogleAds("/campaignCriteria:mutate", { operations: addNegOps });
    console.log(`Added ${res.results?.length ?? 0} campaign negatives.`);
    opsLog.push(`Добавлены campaign-level минус-слова (BROAD): ${toAddBroad.join(", ")}${needsPhraseUdalenieRodinok ? "; PHRASE: удаление родинок" : ""}.`);
  } else {
    console.log("Nothing to add (all already present).");
    opsLog.push("Диагнозные минус-слова уже были на месте (add не потребовался).");
  }

  // --- Step 2.2: remove "якубовская" negative (campaign-level and ad-group-level) ---
  console.log(`\n=== Step 2.2: removing "якубовская" negative ===`);
  const removeCriteriaOps: any[] = [];
  const yakubCampNeg = campNegRows.find((r: any) => r.campaignCriterion?.keyword?.text === "якубовская");
  if (yakubCampNeg) {
    const rn = `customers/${CUSTOMER_ID}/campaignCriteria/${CAMPAIGN_ID}~${yakubCampNeg.campaignCriterion?.criterionId}`;
    removeCriteriaOps.push({ scope: "campaign", op: { remove: rn } });
  }
  const yakubAdGroupNeg = adGroupRows.find(
    (r: any) => r.adGroupCriterion?.keyword?.text === "якубовская" && r.adGroupCriterion?.negative === true,
  );
  if (yakubAdGroupNeg) {
    const rn = `customers/${CUSTOMER_ID}/adGroupCriteria/${yakubAdGroupNeg.adGroup?.id}~${yakubAdGroupNeg.adGroupCriterion?.criterionId}`;
    removeCriteriaOps.push({ scope: "adGroup", op: { remove: rn } });
  }
  console.log(`Found ${removeCriteriaOps.length} "якубовская" negative(s) to remove (campaign-level: ${!!yakubCampNeg}, ad-group-level: ${!!yakubAdGroupNeg}).`);
  if (removeCriteriaOps.filter((o) => o.scope === "campaign").length > 0) {
    await callGoogleAds("/campaignCriteria:mutate", { operations: removeCriteriaOps.filter((o) => o.scope === "campaign").map((o) => o.op) });
  }
  if (removeCriteriaOps.filter((o) => o.scope === "adGroup").length > 0) {
    await callGoogleAds("/adGroupCriteria:mutate", { operations: removeCriteriaOps.filter((o) => o.scope === "adGroup").map((o) => o.op) });
  }
  opsLog.push(
    `Удалено минус-слово "якубовская" (BROAD): campaign-level=${!!yakubCampNeg}, ad-group-level ("Дерматолог_Прием")=${!!yakubAdGroupNeg}. Позитивные EXACT-ключи "светлана якубовская дерматолог где принимает"/"...приём" не тронуты.`,
  );

  // --- Step 2.3: remove positive keyword "косметолог" (BROAD) in "Дерматолог_Минск" ---
  console.log(`\n=== Step 2.3: removing positive keyword "косметолог" from Дерматолог_Минск ===`);
  const kosmetologPositive = adGroupRows.find(
    (r: any) =>
      r.adGroup?.name === "Дерматолог_Минск" &&
      r.adGroupCriterion?.keyword?.text === "косметолог" &&
      r.adGroupCriterion?.keyword?.matchType === "BROAD" &&
      r.adGroupCriterion?.negative !== true,
  );
  if (kosmetologPositive) {
    const rn = `customers/${CUSTOMER_ID}/adGroupCriteria/${kosmetologPositive.adGroup?.id}~${kosmetologPositive.adGroupCriterion?.criterionId}`;
    await callGoogleAds("/adGroupCriteria:mutate", { operations: [{ remove: rn }] });
    console.log(`Removed: ${rn}`);
    opsLog.push(`Удалён позитивный ключ "косметолог" (BROAD) из группы "Дерматолог_Минск". Минус-слово "косметолог" оставлено без изменений.`);
  } else {
    console.log("Not found (already absent or different match type) — no-op.");
    opsLog.push(`Позитивный ключ "косметолог" (BROAD) в группе "Дерматолог_Минск" не найден при повторной проверке — изменения не потребовались.`);
  }

  // --- Step 2.4: романива, gated on step 1 verdict ---
  console.log(`\n=== Step 2.4: романива ===`);
  if (romanivaIsGarbage) {
    const romanivaPositive = adGroupRows.find(
      (r: any) => r.adGroupCriterion?.keyword?.text === "романива" && r.adGroupCriterion?.negative !== true,
    );
    const romanivaAdGroupNeg = adGroupRows.find(
      (r: any) => r.adGroupCriterion?.keyword?.text === "романива" && r.adGroupCriterion?.negative === true,
    );
    const romanivaCampNeg = campNegRows.find((r: any) => r.campaignCriterion?.keyword?.text === "романива");
    const removeOps: any[] = [];
    if (romanivaPositive) removeOps.push({ level: "adGroup", op: { remove: `customers/${CUSTOMER_ID}/adGroupCriteria/${romanivaPositive.adGroup?.id}~${romanivaPositive.adGroupCriterion?.criterionId}` } });
    if (romanivaAdGroupNeg) removeOps.push({ level: "adGroup", op: { remove: `customers/${CUSTOMER_ID}/adGroupCriteria/${romanivaAdGroupNeg.adGroup?.id}~${romanivaAdGroupNeg.adGroupCriterion?.criterionId}` } });
    if (romanivaCampNeg) removeOps.push({ level: "campaign", op: { remove: `customers/${CUSTOMER_ID}/campaignCriteria/${CAMPAIGN_ID}~${romanivaCampNeg.campaignCriterion?.criterionId}` } });
    console.log(`Removing романива: positive=${!!romanivaPositive}, ad-group negative=${!!romanivaAdGroupNeg}, campaign negative=${!!romanivaCampNeg}`);
    const agOps = removeOps.filter((o) => o.level === "adGroup").map((o) => o.op);
    const cOps = removeOps.filter((o) => o.level === "campaign").map((o) => o.op);
    if (agOps.length > 0) await callGoogleAds("/adGroupCriteria:mutate", { operations: agOps });
    if (cOps.length > 0) await callGoogleAds("/campaignCriteria:mutate", { operations: cOps });
    opsLog.push(
      `"романива" — подтверждено как мусорный ключ (нет истории поисковых запросов, нет врача с похожей фамилией среди дерматологов medavenu.by/staff/, ближайшие совпадения Романенко А.Е. (анестезиология) и Романовская С.Э. (онкология/хирургия) — не дерматологи). Удалены и позитивный BROAD-ключ, и минус-слово "романива" (уровень: adGroup=${!!romanivaAdGroupNeg}, campaign=${!!romanivaCampNeg}).`,
    );
  } else {
    console.log("Step 1 verdict says NOT garbage — skipping any change to романива, flagging for human review.");
    opsLog.push(
      `"романива" — НЕ трогали, и по факту трогать было нечего: прямая проверка API (ad_group_criterion + campaign_criterion) показала, что позитивного ключа "романива" в аккаунте СЕЙЧАС НЕТ вообще — исходная посылка задачи ("позитив в группе Дерматолог_Минск + минус-слово гасят друг друга") не подтвердилась данными, слово встречается ТОЛЬКО как BROAD-негатив на двух уровнях сразу: ad-group "Дерматолог_Минск" (criterionId 1235017053297) и campaign-level (тот же текстовый criterionId в своём пространстве имён) — это избыточно, но безвредно, конфликта показов нет. Есть реальная повторяющаяся история поисковых запросов "романива дерматолог"/"дерматолог романива" (~24 показа за январь-май 2026, 2 реальных клика с реальным расходом), но врача с такой или похожей фамилией среди 91 сотрудника medavenu.by/staff/ и /dermatologija/ не найдено (ближайшие совпадения по корню "роман*" — Романенко А.Е., анестезиолог, и Романовская С.Э., онколог/хирург — обе не дерматологи). Кампания уже держит длинный список фамилий конкурентных врачей в минус-словах (уварова, ковальчук, барабанов, кардаш, веселова, шиманская, музыченко, слободчикова, бачило, горейша, скриганова и др.) — "романива" по формату полностью вписывается в этот же паттерн, что говорит в пользу версии "фамилия стороннего/конкурентного врача, намеренно заминусована". Раз позитивного ключа нет, а негатив согласуется с установленной практикой аккаунта — рекомендация: оставить как есть, отдельно почистить дублирование (один и тот же негатив на двух уровнях сразу, можно оставить только campaign-level) не критично и не запрашивалось явно, не трогаю. Финальное решение (оставить/убрать дубль/пересмотреть) — за пользователем.`,
    );
  }

  // --- Step 3: shared negative list cleanup ---
  console.log(`\n=== Step 3: shared negative list cleanup ===`);
  const nonDermaCampaigns = sharedAttach.filter((r: any) => !r.campaign?.name?.toLowerCase().includes("дерматолог"));
  console.log(`Campaigns on this shared set that are NOT obviously dermatology-named: ${nonDermaCampaigns.length}`);
  for (const r of nonDermaCampaigns) console.log(`  ${r.campaign?.id} "${r.campaign?.name}" status=${r.campaign?.status}`);

  if (nonDermaCampaigns.length > 0) {
    console.log(
      "\nRISK FOUND: shared set is attached to non-dermatology-named campaign(s) above. Per the task's explicit guard, STOPPING without removing the 11 wordforms — needs a human decision on whether 'центральный'-family/'фрунзенски' protects those other campaigns from something unrelated to dermatology district-naming.",
    );
    opsLog.push(
      `Шаг 3 (очистка shared-листа "CM - Общие минус-слова") НЕ выполнен: список привязан к не-дерматологическим кампаниям (${nonDermaCampaigns.map((r: any) => `${r.campaign?.id} "${r.campaign?.name}"`).join(", ")}) — риск описан в отчёте, решение оставлено пользователю.`,
    );
  } else {
    const toRemove = wordforms.filter((w) => sharedByText.has(w));
    console.log(`All attached campaigns are dermatology-named. Removing ${toRemove.length} wordforms: ${JSON.stringify(toRemove)}`);
    if (toRemove.length > 0) {
      const removeSharedOps = toRemove.map((w) => ({ remove: sharedByText.get(w)! }));
      await callGoogleAds("/sharedCriteria:mutate", { operations: removeSharedOps });
      opsLog.push(`Удалено ${toRemove.length} словоформ из shared-листа "CM - Общие минус-слова" (11852680614): ${toRemove.join(", ")}. Список привязан только к дерматологическим кампаниям — риска для других направлений не найдено.`);
    } else {
      opsLog.push(`Указанных словоформ в shared-листе "CM - Общие минус-слова" не найдено — изменения не потребовались.`);
    }
  }

  // ---------- Self-check: read everything back ----------
  console.log("\n=== SELF-CHECK: reading state back ===");
  const verifyAdGroupRows = await search(`
    SELECT ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
           ad_group_criterion.keyword.match_type, ad_group_criterion.negative, ad_group_criterion.status
    FROM ad_group_criterion
    WHERE campaign.id = ${CAMPAIGN_ID} AND ad_group_criterion.type = 'KEYWORD'
  `);
  const verifyCampNegRows = await search(`
    SELECT campaign_criterion.criterion_id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion
    WHERE campaign.id = ${CAMPAIGN_ID} AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE
  `);
  const verifyCampNegTexts = new Set(verifyCampNegRows.map((r: any) => r.campaignCriterion?.keyword?.text));
  console.log(`Campaign negatives now include all 13 diagnosis words + phrase: ${diagnosisNegatives.every((w) => verifyCampNegTexts.has(w)) && verifyCampNegTexts.has("удаление родинок")}`);
  console.log(`"якубовская" negative gone from campaign level: ${!verifyCampNegTexts.has("якубовская")}`);
  const verifyYakubAdGroup = verifyAdGroupRows.find((r: any) => r.adGroupCriterion?.keyword?.text === "якубовская" && r.adGroupCriterion?.negative === true);
  console.log(`"якубовская" negative gone from ad-group level: ${!verifyYakubAdGroup}`);
  const verifyKosmetolog = verifyAdGroupRows.find(
    (r: any) => r.adGroup?.name === "Дерматолог_Минск" && r.adGroupCriterion?.keyword?.text === "косметолог" && r.adGroupCriterion?.negative !== true,
  );
  console.log(`Positive "косметолог" gone from Дерматолог_Минск: ${!verifyKosmetolog}`);
  const verifyRomaniva = verifyAdGroupRows.filter((r: any) => r.adGroupCriterion?.keyword?.text === "романива");
  console.log(`"романива" remaining criteria (should be 0 if garbage-confirmed, unchanged otherwise): ${JSON.stringify(verifyRomaniva.map((r: any) => ({ negative: r.adGroupCriterion?.negative, status: r.adGroupCriterion?.status })))}`);

  const verifySharedItems = await search(`
    SELECT shared_criterion.criterion_id, shared_criterion.keyword.text
    FROM shared_criterion
    WHERE shared_criterion.shared_set = '${SHARED_SET_RESOURCE}'
  `);
  const verifySharedTexts = new Set(verifySharedItems.map((r: any) => r.sharedCriterion?.keyword?.text));
  console.log(`Shared set wordforms still present (should be empty if step 3 ran): ${JSON.stringify(wordforms.filter((w) => verifySharedTexts.has(w)))}`);

  // ---------- Log to sheet ----------
  const now = new Date();
  const todayRu = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
  const existing = await readRange(LOG_SHEET_ID, `'${LOG_TAB}'!A1:H10000`);
  const nextRow = existing.length + 1;
  const status = romanivaIsGarbage ? "ВНЕДРЕНО [AK]" : "ВНЕДРЕНО [AK] / романива — ТРЕБУЕТ РЕШЕНИЯ";
  const logRow = [
    todayRu,
    "МедАвеню",
    "google-ads",
    `19321388084 "Поиск // Дерматолог // Минск // 22.09.26"`,
    "Минус-слова, позитивные ключи, shared negative list",
    status,
    "",
    opsLog.join(" | "),
  ];
  await writeRange(LOG_SHEET_ID, `'${LOG_TAB}'!A${nextRow}:H${nextRow}`, [logRow]);
  console.log(`\nLogged to row ${nextRow} of "${LOG_TAB}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
