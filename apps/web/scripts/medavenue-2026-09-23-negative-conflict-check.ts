// Read-only audit (2026-09-23): verify that negative keywords added today
// to Google Ads campaigns 19321388084 / 23484099509 and Yandex Direct
// campaign 708468419 don't accidentally suppress live positive keywords in
// ANY active campaign of the same client. Nothing in this script writes.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-negative-conflict-check.ts
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";
import { getYandexAccessToken } from "../lib/tools/yandex-oauth.ts";

const GOOGLE_CUSTOMER_ID = "9714539590";
const GOOGLE_REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const YANDEX_CLIENT_LOGIN = "porg-yw2ynqgs";
const YANDEX_ACCESS_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const YANDEX_API_BASE = "https://api.direct.yandex.com/json/v5";

async function callGoogleAds(path: string, body: unknown): Promise<any> {
  const accessToken = await getGoogleAccessToken(GOOGLE_REFRESH_TOKEN_ENV);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type": "application/json",
  };
  const response = await fetch(`https://googleads.googleapis.com/v25/customers/${GOOGLE_CUSTOMER_ID}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Ads API failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function gaqlAll(query: string): Promise<any[]> {
  let results: any[] = [];
  let pageToken: string | undefined;
  do {
    const body: any = { query };
    if (pageToken) body.pageToken = pageToken;
    const data = await callGoogleAds("/googleAds:search", body);
    results = results.concat(data.results ?? []);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}

async function callDirect(resource: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(`${YANDEX_API_BASE}/${resource}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getYandexAccessToken(YANDEX_ACCESS_TOKEN_ENV)}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      "Client-Login": YANDEX_CLIENT_LOGIN,
    },
    body: JSON.stringify({ method, params }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok || data.error) {
    throw new Error(`${resource}.${method} failed: ${res.status} ${JSON.stringify(data.error ?? text)}`);
  }
  return data.result;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[+\[\]"!]/g, "").trim();
}

// Google Ads BROAD-negative matching is WORD-TOKEN based, not raw
// substring: "венеролог" as a negative does NOT block "дерматовенеролог"
// (one compound token, not the standalone word "венеролог"), and "ко"
// does NOT block "консультация". A naive `string.includes()` check
// produces heavy false positives on Russian compound words — this splits
// both sides into whitespace-delimited word tokens and requires every
// negative word to equal some positive word as a whole token (with a
// light russian-stemming allowance: match if one token is a
// prefix of the other and the shared prefix is >=5 chars, to approximate
// Google's plural/case "close variant" matching without over-matching
// short fragments).
function tokenize(s: string): string[] {
  return norm(s).split(/[\s\-]+/).filter(Boolean);
}

function wordCloseMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 5) return false; // too short to safely stem-match
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return longer.startsWith(shorter) && shorter.length >= 5;
}

function broadContains(negative: string, positiveText: string): boolean {
  const negWords = tokenize(negative);
  const posWords = tokenize(positiveText);
  return negWords.every((nw) => posWords.some((pw) => wordCloseMatch(nw, pw)));
}

function exactMatches(negative: string, positiveText: string): boolean {
  return norm(negative) === norm(positiveText);
}

// PHRASE-negative: blocks if the search contains this exact word SEQUENCE
// anywhere (word-level substring, i.e. the negative's word tokens appear
// contiguously and in order inside the positive's word tokens) — not raw
// character substring (avoids e.g. "ко" wrongly matching inside "кожа").
function phraseContains(negative: string, positiveText: string): boolean {
  const negWords = tokenize(negative);
  const posWords = tokenize(positiveText);
  if (negWords.length === 0) return false;
  for (let i = 0; i <= posWords.length - negWords.length; i++) {
    let ok = true;
    for (let j = 0; j < negWords.length; j++) {
      if (!wordCloseMatch(negWords[j], posWords[i + j])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

async function main() {
  console.log("========== GOOGLE ADS ==========");

  // 1. All active (ENABLED) campaigns
  const campaigns = await gaqlAll(
    `SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status = 'ENABLED' ORDER BY campaign.id`,
  );
  console.log(`\nActive ENABLED campaigns (${campaigns.length}):`);
  for (const c of campaigns) {
    console.log(`  ${c.campaign.id}  ${c.campaign.name}`);
  }

  // 2. All live positive keywords across active campaigns (ad_group_criterion, KEYWORD type, ENABLED, ad group ENABLED)
  const kwRows = await gaqlAll(
    `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id,
            ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            ad_group_criterion.status, ad_group.status, campaign.status
     FROM ad_group_criterion
     WHERE ad_group_criterion.type = 'KEYWORD'
       AND ad_group_criterion.status = 'ENABLED'
       AND ad_group.status = 'ENABLED'
       AND campaign.status = 'ENABLED'
     ORDER BY campaign.id, ad_group.id`,
  );
  const positiveKeywords = kwRows.map((r: any) => ({
    campaignId: r.campaign.id as string,
    campaignName: r.campaign.name as string,
    adGroupId: r.adGroup.id as string,
    adGroupName: r.adGroup.name as string,
    text: r.adGroupCriterion.keyword.text as string,
    matchType: r.adGroupCriterion.keyword.matchType as string,
  }));
  console.log(`\nLive positive keywords across ENABLED campaigns: ${positiveKeywords.length}`);

  // 3. Campaign-level negative keywords for the two dermatology campaigns
  const negRows = await gaqlAll(
    `SELECT campaign.id, campaign.name, campaign_criterion.criterion_id,
            campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
            campaign_criterion.negative
     FROM campaign_criterion
     WHERE campaign_criterion.type = 'KEYWORD'
       AND campaign_criterion.negative = TRUE
       AND campaign.id IN (19321388084, 23484099509)`,
  );
  const campaignNegatives = negRows.map((r: any) => ({
    campaignId: r.campaign.id as string,
    campaignName: r.campaign.name as string,
    text: r.campaignCriterion.keyword.text as string,
    matchType: r.campaignCriterion.keyword.matchType as string,
  }));
  console.log(`\nCampaign-level negatives on 19321388084 / 23484099509: ${campaignNegatives.length}`);
  for (const n of campaignNegatives) {
    console.log(`  [${n.campaignId}] (${n.matchType}) ${n.text}`);
  }

  // 4. Shared negative keyword set "CM - Общие минус-слова" attached to 19321388084
  const sharedSetLinks = await gaqlAll(
    `SELECT shared_set.id, shared_set.name, shared_set.type, campaign_shared_set.campaign
     FROM campaign_shared_set
     WHERE campaign_shared_set.campaign = 'customers/${GOOGLE_CUSTOMER_ID}/campaigns/19321388084'`,
  );
  console.log(`\nShared sets attached to 19321388084:`);
  let sharedNegatives: { text: string; matchType: string; setName: string }[] = [];
  for (const s of sharedSetLinks) {
    console.log(`  ${s.sharedSet.id}  ${s.sharedSet.name}  (${s.sharedSet.type})`);
    if (s.sharedSet.type === "NEGATIVE_KEYWORDS") {
      const items = await gaqlAll(
        `SELECT shared_criterion.criterion_id, shared_criterion.keyword.text, shared_criterion.keyword.match_type
         FROM shared_criterion
         WHERE shared_criterion.shared_set = '${s.sharedSet.resourceName ?? `customers/${GOOGLE_CUSTOMER_ID}/sharedSets/${s.sharedSet.id}`}'`,
      );
      console.log(`    -> ${items.length} negative keyword entries`);
      for (const it of items) {
        sharedNegatives.push({
          text: it.sharedCriterion.keyword.text,
          matchType: it.sharedCriterion.keyword.matchType,
          setName: s.sharedSet.name,
        });
      }
    }
  }

  // === Conflict detection ===
  console.log("\n\n========== CONFLICT CHECK: campaign-level negatives (19321388084 / 23484099509) ==========");
  const allNegSources = [
    ...campaignNegatives.map((n) => ({ ...n, source: `campaign-level neg on ${n.campaignId}` })),
  ];
  let conflictCount = 0;
  for (const neg of allNegSources) {
    for (const pos of positiveKeywords) {
      let hit = false;
      if (neg.matchType === "EXACT") hit = exactMatches(neg.text, pos.text);
      else if (neg.matchType === "PHRASE") hit = phraseContains(neg.text, pos.text);
      else if (neg.matchType === "BROAD") hit = broadContains(neg.text, pos.text);
      if (hit) {
        conflictCount++;
        const scope = pos.campaignId === neg.campaignId ? "SAME CAMPAIGN (self-conflict)" : "CROSS-CAMPAIGN";
        console.log(
          `  CONFLICT: neg [${neg.campaignId}] (${neg.matchType}) "${neg.text}"  vs  pos [${pos.campaignId} ${pos.campaignName} / ${pos.adGroupName}] (${pos.matchType}) "${pos.text}"  -- ${scope}`,
        );
      }
    }
  }
  console.log(`\nTotal campaign-level negative conflicts found: ${conflictCount}`);
  console.log(`(checked ${allNegSources.length} negatives against ${positiveKeywords.length} live positive keywords)`);

  console.log("\n\n========== CONFLICT CHECK: shared negative list 'CM - Общие минус-слова' vs 19321388084 own keywords ==========");
  const ownKeywords19321388084 = positiveKeywords.filter((p) => p.campaignId === "19321388084");
  console.log(`Own live positive keywords in 19321388084: ${ownKeywords19321388084.length}`);
  console.log(`Shared negative entries loaded: ${sharedNegatives.length}`);
  let sharedConflicts = 0;
  for (const neg of sharedNegatives) {
    for (const pos of ownKeywords19321388084) {
      let hit = false;
      if (neg.matchType === "EXACT") hit = exactMatches(neg.text, pos.text);
      else if (neg.matchType === "PHRASE") hit = phraseContains(neg.text, pos.text);
      else if (neg.matchType === "BROAD") hit = broadContains(neg.text, pos.text);
      if (hit) {
        sharedConflicts++;
        console.log(
          `  CONFLICT: shared neg (${neg.matchType}) "${neg.text}"  vs  own pos [${pos.adGroupName}] (${pos.matchType}) "${pos.text}"`,
        );
      }
    }
  }
  console.log(`\nTotal shared-list conflicts found: ${sharedConflicts}`);

  console.log("\n\n========== YANDEX DIRECT ==========");

  // Active campaigns of interest + all others for cross-campaign check
  const campResult = await callDirect("campaigns", "get", {
    SelectionCriteria: {},
    FieldNames: ["Id", "Name", "Status", "State"],
  });
  const allCampaigns: any[] = campResult.Campaigns ?? [];
  const activeCampaigns = allCampaigns.filter((c) => c.Status === "ACCEPTED" && c.State !== "OFF" && c.State !== "ARCHIVED");
  console.log(`\nActive Yandex campaigns (${activeCampaigns.length}):`);
  for (const c of activeCampaigns) console.log(`  ${c.Id}  ${c.Name}  (Status=${c.Status}, State=${c.State})`);

  // Ad groups + keywords for campaign 708468419 (Удаление новообразований)
  const TARGET_YANDEX_CAMPAIGN = 708468419;
  const groupsResult = await callDirect("adgroups", "get", {
    SelectionCriteria: { CampaignIds: [TARGET_YANDEX_CAMPAIGN] },
    FieldNames: ["Id", "Name", "CampaignId", "Status"],
  });
  const groups: any[] = groupsResult.AdGroups ?? [];
  console.log(`\nAd groups in campaign ${TARGET_YANDEX_CAMPAIGN}: ${groups.length}`);
  for (const g of groups) console.log(`  ${g.Id}  ${g.Name}  (Status=${g.Status})`);

  const kwResult = await callDirect("keywords", "get", {
    SelectionCriteria: { CampaignIds: [TARGET_YANDEX_CAMPAIGN] },
    FieldNames: ["Id", "Keyword", "AdGroupId", "CampaignId", "Status", "State"],
  });
  const targetKeywords: any[] = (kwResult.Keywords ?? []).filter((k: any) => k.Status === "ACCEPTED" || k.Status === "SENDED");
  const groupById = new Map(groups.map((g) => [g.Id, g.Name]));
  console.log(`\nLive keywords in campaign ${TARGET_YANDEX_CAMPAIGN}: ${targetKeywords.length}`);

  // Also pull keywords of ALL other active campaigns for cross-campaign checking
  const otherActiveCampaignIds = activeCampaigns
    .map((c) => c.Id)
    .filter((id: number) => id !== TARGET_YANDEX_CAMPAIGN);
  let otherKeywords: any[] = [];
  const CHUNK = 10;
  for (let i = 0; i < otherActiveCampaignIds.length; i += CHUNK) {
    const chunk = otherActiveCampaignIds.slice(i, i + CHUNK);
    const otherKwResult = await callDirect("keywords", "get", {
      SelectionCriteria: { CampaignIds: chunk },
      FieldNames: ["Id", "Keyword", "AdGroupId", "CampaignId", "Status", "State"],
    });
    otherKeywords = otherKeywords.concat(
      (otherKwResult.Keywords ?? []).filter((k: any) => k.Status === "ACCEPTED" || k.Status === "SENDED"),
    );
  }
  console.log(`Live keywords in all OTHER active campaigns: ${otherKeywords.length}`);

  const yandexNegatives = [
    { text: "родинки" },
    { text: "удаление родинки" },
    { text: "удалить родинку" },
  ];

  console.log("\n\n========== CONFLICT CHECK: Yandex negatives in 708468419 vs its own + other campaigns' keywords ==========");
  let yandexSelfConflicts = 0;
  let yandexCrossConflicts = 0;
  // Bare Yandex negative keywords (no +/!/[] operators) match if ALL their
  // words appear anywhere in the query in any order, with Yandex's own
  // morphology folding plural/case variants together — approximated here
  // via the same word-token + prefix-stem matcher used for Google BROAD,
  // not a raw substring check (raw substring wrongly matched "родинк" as
  // a fragment inside unrelated compound words in an earlier pass).
  for (const neg of yandexNegatives) {
    for (const kw of targetKeywords) {
      const kwText = String(kw.Keyword ?? "");
      if (broadContains(neg.text, kwText)) {
        yandexSelfConflicts++;
        console.log(
          `  SELF-CONFLICT: neg "${neg.text}"  vs  own kw [group ${groupById.get(kw.AdGroupId) ?? kw.AdGroupId}] "${kwText}"`,
        );
      }
    }
    for (const kw of otherKeywords) {
      const kwText = String(kw.Keyword ?? "");
      if (broadContains(neg.text, kwText)) {
        yandexCrossConflicts++;
        console.log(
          `  CROSS-CAMPAIGN: neg "${neg.text}" (in 708468419)  vs  kw in campaign ${kw.CampaignId} "${kwText}"`,
        );
      }
    }
  }
  console.log(`\nYandex self-conflicts: ${yandexSelfConflicts}, cross-campaign conflicts: ${yandexCrossConflicts}`);
  console.log(`(checked ${yandexNegatives.length} negatives against ${targetKeywords.length} own + ${otherKeywords.length} other live keywords)`);

  console.log("\n\nDONE.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
