// One-off write task, explicitly approved by the Owner (2026-09-17):
//   1) add 2 positive keywords to campaign "Поиск // Бренд // МедАвеню" (23822529267)
//   2) reconcile 3 candidate phrases against shared negative set "Брендовые" (11861968020)
//   3) log to the client's "МедАвеню - Лог правок" Google Sheet
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-17-brand-keywords.ts <mode>
//   mode: "discover" | "apply" | "verify"
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";
import { appendRows, readRange } from "../lib/tools/google-sheets.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_VERSION = "v25";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;

const BRAND_CAMPAIGN_ID = "23822529267";
const NEG_SET_ID = "11861968020";

async function callGoogleAds(path: string, body: unknown): Promise<any> {
  const accessToken = await getGoogleAccessToken(REFRESH_ENV);
  const res = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Ads API call failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function search(query: string): Promise<any[]> {
  const data = await callGoogleAds("/googleAds:search", { query });
  return data.results ?? [];
}

async function discover() {
  const groups = await search(
    `SELECT ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE campaign.id = ${BRAND_CAMPAIGN_ID} ORDER BY ad_group.id`,
  );
  console.log("=== Ad groups in brand campaign ===");
  console.log(JSON.stringify(groups, null, 2));

  const keywords = await search(
    `SELECT ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status FROM ad_group_criterion WHERE campaign.id = ${BRAND_CAMPAIGN_ID} AND ad_group_criterion.type = 'KEYWORD' ORDER BY ad_group.id`,
  );
  console.log("=== Existing keywords in brand campaign ===");
  console.log(JSON.stringify(keywords, null, 2));

  const negs = await search(
    `SELECT shared_criterion.criterion_id, shared_criterion.keyword.text, shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.id = ${NEG_SET_ID} ORDER BY shared_criterion.criterion_id`,
  );
  console.log("=== Shared negative set 'Брендовые' contents ===");
  console.log(JSON.stringify(negs, null, 2));

  const setInfo = await search(
    `SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.status, shared_set.member_count FROM shared_set WHERE shared_set.id = ${NEG_SET_ID}`,
  );
  console.log("=== Shared set info ===");
  console.log(JSON.stringify(setInfo, null, 2));
}

async function apply() {
  // Target ad group: pick the one whose name best matches "Бренд — Основные запросы" or fallback to first group.
  const groups = await search(
    `SELECT ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE campaign.id = ${BRAND_CAMPAIGN_ID} ORDER BY ad_group.id`,
  );
  console.log("Groups:", JSON.stringify(groups));
  const candidates = groups.filter((g: any) => g.adGroup.status !== "REMOVED");
  const preferred =
    candidates.find((g: any) => /основн/i.test(g.adGroup.name)) ??
    candidates.find((g: any) => /бренд/i.test(g.adGroup.name)) ??
    candidates[0];
  if (!preferred) throw new Error("No usable ad group found in brand campaign");
  const adGroupResourceName = `customers/${CUSTOMER_ID}/adGroups/${preferred.adGroup.id}`;
  console.log(`Using ad group: ${preferred.adGroup.name} (${preferred.adGroup.id})`);

  // Check existing keyword text/matchType in this campaign to avoid dupes.
  const existing = await search(
    `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status FROM ad_group_criterion WHERE campaign.id = ${BRAND_CAMPAIGN_ID} AND ad_group_criterion.type = 'KEYWORD'`,
  );
  const existingSet = new Set(
    existing.map((r: any) => `${r.adGroupCriterion.keyword.text.toLowerCase()}|${r.adGroupCriterion.keyword.matchType}`),
  );

  const toAdd: { text: string; matchType: string }[] = [];
  if (!existingSet.has("медавенью|EXACT")) toAdd.push({ text: "медавенью", matchType: "EXACT" });
  if (!existingSet.has("мед авеню|PHRASE")) toAdd.push({ text: "мед авеню", matchType: "PHRASE" });

  console.log("Positive keywords to add:", JSON.stringify(toAdd));

  if (toAdd.length > 0) {
    const opRes = await callGoogleAds("/adGroupCriteria:mutate", {
      operations: toAdd.map((k) => ({
        create: {
          adGroup: adGroupResourceName,
          status: "ENABLED",
          keyword: { text: k.text, matchType: k.matchType },
        },
      })),
    });
    console.log("adGroupCriteria:mutate result:", JSON.stringify(opRes, null, 2));
  } else {
    console.log("Both positive keywords already exist — nothing to add.");
  }

  // Negative shared set reconciliation.
  const negCandidates = ["медавенью", "перминов медавеню", "челомбитько медавеню"];
  const negs = await search(
    `SELECT shared_criterion.keyword.text, shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.id = ${NEG_SET_ID}`,
  );
  const negSet = new Set(
    negs.map((r: any) => `${r.sharedCriterion.keyword.text.toLowerCase()}|${r.sharedCriterion.keyword.matchType}`),
  );
  const negsToAdd = negCandidates.filter((t) => !negSet.has(`${t.toLowerCase()}|EXACT`));
  console.log("Existing negatives already present:", negCandidates.filter((t) => negSet.has(`${t.toLowerCase()}|EXACT`)));
  console.log("Negatives to add:", JSON.stringify(negsToAdd));

  if (negsToAdd.length > 0) {
    const sharedSetResourceName = `customers/${CUSTOMER_ID}/sharedSets/${NEG_SET_ID}`;
    const negRes = await callGoogleAds("/sharedCriteria:mutate", {
      operations: negsToAdd.map((text) => ({
        create: {
          sharedSet: sharedSetResourceName,
          keyword: { text, matchType: "EXACT" },
        },
      })),
    });
    console.log("sharedCriteria:mutate result:", JSON.stringify(negRes, null, 2));
  } else {
    console.log("All 3 candidate negatives already present in shared set — nothing to add.");
  }

  console.log(JSON.stringify({ toAdd, negsToAdd, adGroupUsed: preferred.adGroup.name, adGroupId: preferred.adGroup.id }));
}

async function verify() {
  const keywords = await search(
    `SELECT ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status FROM ad_group_criterion WHERE campaign.id = ${BRAND_CAMPAIGN_ID} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.keyword.text IN ('медавенью', 'мед авеню') ORDER BY ad_group.id`,
  );
  console.log("=== Verify positive keywords ===");
  console.log(JSON.stringify(keywords, null, 2));

  const negs = await search(
    `SELECT shared_criterion.criterion_id, shared_criterion.keyword.text, shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.id = ${NEG_SET_ID} AND shared_criterion.keyword.text IN ('медавенью', 'перминов медавеню', 'челомбитько медавеню')`,
  );
  console.log("=== Verify negatives in shared set ===");
  console.log(JSON.stringify(negs, null, 2));
}

async function readLogTail() {
  const rows = await readRange("1Fmh342iE28Bgk9z-2-Ds1LSIQUoiFzcUP3ERICKsawY", "МедАвеню - Лог правок!A1:Z2000");
  console.log(JSON.stringify(rows.slice(-15), null, 2));
}

const mode = process.argv[2];
if (mode === "discover") discover().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "apply") apply().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "verify") verify().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "readlog") readLogTail().catch((e) => { console.error(e); process.exit(1); });
else {
  console.error("Usage: node script.ts <discover|apply|verify|readlog>");
  process.exit(1);
}
