// Read-only cross-platform check (2026-09-23): find any standalone
// campaigns dedicated to родинки/папилломы/бородавки/рубцы/шрамы/
// пигментация/невусы (any status, any platform) and compare their
// keywords against the "удаление родинок/папиллом/..." ad groups inside
// the diagnostic dermatology campaign 23484099509 (Google Ads,
// customer 9714539590). Also checks Yandex Direct (login porg-yw2ynqgs).
// Nothing in this script writes to any account.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-mole-removal-cannibalization-check.ts
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";
import { getYandexAccessToken } from "../lib/tools/yandex-oauth.ts";

const GOOGLE_CUSTOMER_ID = "9714539590";
const GOOGLE_REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const YANDEX_CLIENT_LOGIN = "porg-yw2ynqgs";
const YANDEX_ACCESS_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const YANDEX_API_BASE = "https://api.direct.yandex.com/json/v5";

const KEYWORD_PATTERN = /(родинк|невус|папиллом|бородавк|рубц|шрам|пигментац)/i;
const TARGET_CAMPAIGN_ID = "23484099509"; // Поиск // Дерматолог // Минск (diagnostic)

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

async function main() {
  console.log("========== GOOGLE ADS: all campaigns, any status ==========");
  const allCampaigns = await callGoogleAds("/googleAds:search", {
    query: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type
             FROM campaign ORDER BY campaign.id`,
  });
  const gCampaigns: any[] = allCampaigns.results ?? [];
  console.log(`Total Google campaigns: ${gCampaigns.length}`);
  const gCandidates = gCampaigns.filter((r) => KEYWORD_PATTERN.test(r.campaign?.name ?? ""));
  console.log("Google campaigns matching pattern (родинк/невус/папиллом/бородавк/рубц/шрам/пигментац):");
  console.log(JSON.stringify(gCandidates, null, 2));

  console.log("\n========== YANDEX DIRECT: all campaigns, any status ==========");
  const yCampaigns = await callDirect("campaigns", "get", {
    SelectionCriteria: {},
    FieldNames: ["Id", "Name", "Status", "State", "Type"],
  });
  const yList: any[] = yCampaigns.Campaigns ?? [];
  console.log(`Total Yandex campaigns: ${yList.length}`);
  const yCandidates = yList.filter((c) => KEYWORD_PATTERN.test(c.Name ?? ""));
  console.log("Yandex campaigns matching pattern:");
  console.log(JSON.stringify(yCandidates, null, 2));

  console.log("\n========== GOOGLE ADS: ad groups + keywords inside TARGET campaign 23484099509 ==========");
  const targetGroups = await callGoogleAds("/googleAds:search", {
    query: `SELECT ad_group.id, ad_group.name, ad_group.status
             FROM ad_group WHERE ad_group.campaign = 'customers/${GOOGLE_CUSTOMER_ID}/campaigns/${TARGET_CAMPAIGN_ID}'
             ORDER BY ad_group.id`,
  });
  console.log(JSON.stringify(targetGroups, null, 2));

  const targetKeywords = await callGoogleAds("/googleAds:search", {
    query: `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                    ad_group_criterion.status, ad_group.name, ad_group.id
             FROM keyword_view WHERE campaign.id = ${TARGET_CAMPAIGN_ID}
             ORDER BY ad_group.id`,
  });
  const targetKwRows: any[] = targetKeywords.results ?? [];
  const relevantGroupKws = targetKwRows.filter((r) => KEYWORD_PATTERN.test(r.adGroup?.name ?? "") || KEYWORD_PATTERN.test(r.adGroupCriterion?.keyword?.text ?? ""));
  console.log(`Total keywords in target campaign: ${targetKwRows.length}; relevant (mole/papilloma/etc groups): ${relevantGroupKws.length}`);
  console.log(JSON.stringify(relevantGroupKws, null, 2));

  // For every Google candidate campaign found, pull its keywords too
  for (const c of gCandidates) {
    const id = c.campaign.id;
    console.log(`\n========== GOOGLE ADS: keywords for candidate campaign ${id} (${c.campaign.name}) ==========`);
    const kws = await callGoogleAds("/googleAds:search", {
      query: `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                      ad_group_criterion.status, ad_group.name, ad_group.id
               FROM keyword_view WHERE campaign.id = ${id}
               ORDER BY ad_group.id`,
    });
    console.log(JSON.stringify(kws.results ?? [], null, 2));
  }

  // For every Yandex candidate campaign found, pull its keywords too
  for (const c of yCandidates) {
    console.log(`\n========== YANDEX: ad groups for candidate campaign ${c.Id} (${c.Name}) ==========`);
    const groups = await callDirect("adgroups", "get", {
      SelectionCriteria: { CampaignIds: [c.Id] },
      FieldNames: ["Id", "Name", "Status"],
    });
    const groupList: any[] = groups.AdGroups ?? [];
    console.log(JSON.stringify(groupList, null, 2));
    if (groupList.length === 0) continue;
    console.log(`---- keywords for campaign ${c.Id} ----`);
    const kws = await callDirect("keywords", "get", {
      SelectionCriteria: { AdGroupIds: groupList.map((g) => g.Id) },
      FieldNames: ["Id", "Keyword", "State", "Status"],
    });
    console.log(JSON.stringify(kws.Keywords ?? [], null, 2));
  }

  console.log("\n========== YANDEX: also scan ALL ad group names across the whole account for the pattern ==========");
  console.log("(covers the case where a dedicated campaign for this service exists under a broader campaign name)");
  const allGroupList: any[] = [];
  const ids = yList.map((c) => c.Id);
  const CHUNK = 10;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const allGroups = await callDirect("adgroups", "get", {
      SelectionCriteria: { CampaignIds: chunk },
      FieldNames: ["Id", "Name", "CampaignId", "Status"],
    });
    allGroupList.push(...(allGroups.AdGroups ?? []));
  }
  const matchingGroups = allGroupList.filter((g) => KEYWORD_PATTERN.test(g.Name ?? ""));
  console.log(`Total ad groups in account: ${allGroupList.length}; matching pattern: ${matchingGroups.length}`);
  console.log(JSON.stringify(matchingGroups, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
