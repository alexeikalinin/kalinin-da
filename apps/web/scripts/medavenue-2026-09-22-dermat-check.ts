// Read-only comparison check for dermatology campaigns (Yandex + Google).
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-22-dermat-check.ts
import { getYandexAccessToken } from "../lib/tools/yandex-oauth.ts";
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CLIENT_LOGIN = "porg-yw2ynqgs";
const YANDEX_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const CUSTOMER_ID = "9714539590";
const GOOGLE_REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";

function encodeRawIds(body: string): string {
  return body.replace(/"__RAWID_(\d+)_RAWID__"/g, "$1");
}

async function callDirect(resource: string, method: string, params: unknown) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getYandexAccessToken(YANDEX_TOKEN_ENV)}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
    "Client-Login": CLIENT_LOGIN,
  };
  const response = await fetch(`https://api.direct.yandex.com/json/v5/${resource}`, {
    method: "POST",
    headers,
    body: encodeRawIds(JSON.stringify({ method, params })),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Direct API failed: ${response.status} ${text}`);
  const safeText = text.replace(/:(-?\d{16,})([,}\]])/g, ':"$1"$2');
  const data = safeText ? JSON.parse(safeText) : {};
  if (data.error) throw new Error(`Direct API error: ${JSON.stringify(data.error)}`);
  return data.result;
}

async function callGoogleAds(path: string, body: unknown) {
  const accessToken = await getGoogleAccessToken(GOOGLE_REFRESH_TOKEN_ENV);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type": "application/json",
  };
  // Медавеню is reached via direct/representative access, not the agency
  // MCC hierarchy (see google-ads.ts's GoogleAdsCallOptions comment) —
  // no login-customer-id header.
  const response = await fetch(`https://googleads.googleapis.com/v25/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Ads API failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log("========== 1) YANDEX CAMPAIGNS: basic + dates ==========");
  const ids = [706782318, 706782578, 707005501, 708468567];
  const campResult = (await callDirect("campaigns", "get", {
    SelectionCriteria: { Ids: ids },
    FieldNames: ["Id", "Name", "Status", "State", "StartDate", "EndDate"],
  })) as { Campaigns: any[] };
  console.log(JSON.stringify(campResult.Campaigns, null, 2));

  console.log("\n========== 2) YANDEX AD GROUPS for 707005501 (active) ==========");
  const groups707005501 = (await callDirect("adgroups", "get", {
    SelectionCriteria: { CampaignIds: [707005501] },
    FieldNames: ["Id", "Name", "Status", "Type", "RegionIds"],
  })) as { AdGroups: any[] };
  console.log(JSON.stringify(groups707005501.AdGroups, null, 2));

  console.log("\n========== 3) YANDEX KEYWORDS for those groups ==========");
  const groupIds707005501 = groups707005501.AdGroups.map((g) => g.Id);
  const keywords707005501 = (await callDirect("keywords", "get", {
    SelectionCriteria: { AdGroupIds: groupIds707005501 },
    FieldNames: ["Id", "AdGroupId", "Keyword", "State", "Status"],
  })) as { Keywords: any[] };
  console.log(JSON.stringify(keywords707005501.Keywords, null, 2));

  console.log("\n========== 4) GOOGLE CAMPAIGN 23484099509 details ==========");
  const gCamp = await callGoogleAds("/googleAds:search", {
    query: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
                    campaign_budget.amount_micros
             FROM campaign WHERE campaign.id = 23484099509`,
  });
  console.log(JSON.stringify(gCamp, null, 2));

  console.log("\n========== 5) GOOGLE AD GROUPS for 23484099509 ==========");
  const gGroups = await callGoogleAds("/googleAds:search", {
    query: `SELECT ad_group.id, ad_group.name, ad_group.status
             FROM ad_group WHERE ad_group.campaign = 'customers/${CUSTOMER_ID}/campaigns/23484099509'`,
  });
  console.log(JSON.stringify(gGroups, null, 2));

  console.log("\n========== 6) GOOGLE KEYWORDS for 23484099509 ==========");
  const gKeywords = await callGoogleAds("/googleAds:search", {
    query: `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                    ad_group_criterion.status, ad_group.name, ad_group.id
             FROM keyword_view WHERE campaign.id = 23484099509`,
  });
  console.log(JSON.stringify(gKeywords, null, 2));

  console.log("\n========== 7) GOOGLE GEO TARGETING for 23484099509 ==========");
  const gGeo = await callGoogleAds("/googleAds:search", {
    query: `SELECT campaign_criterion.location.geo_target_constant, campaign_criterion.type
             FROM campaign_criterion WHERE campaign.id = 23484099509 AND campaign_criterion.type = 'LOCATION'`,
  });
  console.log(JSON.stringify(gGeo, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
