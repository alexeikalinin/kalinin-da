// Read-only launch-readiness audit (2026-09-18) for the DRAFT campaign
// "Терапевт // Поиск // Минск // Manual" (ID 714467575), Медавеню, Yandex
// Direct. No writes anywhere in this script.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-18-terapevt-launch-readiness.ts
import { getYandexAccessToken } from "../lib/tools/yandex-oauth.ts";

const CLIENT_LOGIN = "porg-yw2ynqgs";
const ACCESS_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const CAMPAIGN_ID = "714467575";
const API_BASE = "https://api.direct.yandex.com/json/v5";

function rawId(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error(`rawId: not a plain integer string: ${id}`);
  return `__RAWID_${id}_RAWID__`;
}
function encodeRawIds(body: string): string {
  return body.replace(/"__RAWID_(\d+)_RAWID__"/g, "$1");
}

async function callDirect(resource: string, method: string, params: unknown, clientLogin?: string): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getYandexAccessToken(ACCESS_TOKEN_ENV)}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;
  const response = await fetch(`${API_BASE}/${resource}`, {
    method: "POST",
    headers,
    body: encodeRawIds(JSON.stringify({ method, params })),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Yandex Direct API call failed: ${response.status} ${text || "(empty body)"}`);
  const safeText = text.replace(/:(-?\d{16,})([,}\]])/g, ':"$1"$2');
  const data = safeText ? JSON.parse(safeText) : {};
  if (data.error) throw new Error(`Yandex Direct API call failed: ${JSON.stringify(data.error)}`);
  return data.result;
}

async function main() {
  console.log("=== 1. CAMPAIGN: status, tracking template, counters ===");
  const campResult = await callDirect(
    "campaigns",
    "get",
    {
      SelectionCriteria: { Ids: [rawId(CAMPAIGN_ID)] },
      FieldNames: [
        "Id",
        "Name",
        "Status",
        "State",
        "StatusClarification",
        "Currency",
        "DailyBudget",
      ],
      TextCampaignFieldNames: ["CounterIds", "Settings"],
    },
    CLIENT_LOGIN,
  );
  console.log(JSON.stringify(campResult, null, 2));

  console.log("\n=== 2. AD GROUPS for this campaign ===");
  const groupsResult = await callDirect(
    "adgroups",
    "get",
    {
      SelectionCriteria: { CampaignIds: [rawId(CAMPAIGN_ID)] },
      FieldNames: ["Id", "Name", "CampaignId", "Status", "Type", "RegionIds"],
    },
    CLIENT_LOGIN,
  );
  console.log(JSON.stringify(groupsResult, null, 2));

  const groupIds: string[] = (groupsResult?.AdGroups ?? []).map((g: any) => String(g.Id));
  console.log("Ad group IDs:", groupIds);

  console.log("\n=== 3. ADS in these ad groups (titles/texts/sitelinks/callouts refs) ===");
  const adsResult = await callDirect(
    "ads",
    "get",
    {
      SelectionCriteria: { CampaignIds: [rawId(CAMPAIGN_ID)] },
      FieldNames: ["Id", "AdGroupId", "CampaignId", "Status", "State", "Type"],
      TextAdFieldNames: ["Title", "Title2", "Text", "Href", "SitelinkSetId", "AdImageHash"],
      ResponsiveAdFieldNames: ["Titles", "Texts", "Href", "FinalUrl", "SitelinkSetId", "AdExtensions"],
    },
    CLIENT_LOGIN,
  );
  console.log(JSON.stringify(adsResult, null, 2));

  // Collect distinct sitelink set IDs referenced by ads, to fetch details.
  const ads: any[] = adsResult?.Ads ?? [];
  const sitelinkSetIds = new Set<string>();
  for (const ad of ads) {
    const setId = ad.TextAd?.SitelinkSetId ?? ad.ResponsiveAd?.SitelinkSetId;
    if (setId) sitelinkSetIds.add(String(setId));
  }
  console.log("\nDistinct SitelinkSetIds referenced:", [...sitelinkSetIds]);

  if (sitelinkSetIds.size > 0) {
    console.log("\n=== 4. SITELINK SETS detail ===");
    const sitelinksResult = await callDirect(
      "sitelinks",
      "get",
      {
        SelectionCriteria: { Ids: [...sitelinkSetIds].map((id) => rawId(id)) },
        SitelinkFieldNames: ["Title", "Description", "Href", "TurboPageId"],
      },
      CLIENT_LOGIN,
    );
    console.log(JSON.stringify(sitelinksResult, null, 2));
  } else {
    console.log("\n=== 4. SITELINK SETS: none referenced by any ad ===");
  }

  const calloutIds = new Set<string>();
  for (const ad of ads) {
    for (const ext of ad.ResponsiveAd?.AdExtensions ?? []) {
      if (ext.Type === "CALLOUT") calloutIds.add(String(ext.AdExtensionId));
    }
  }
  if (calloutIds.size > 0) {
    console.log("\n=== 4b. CALLOUT (уточнения) text detail ===");
    const calloutsResult = await callDirect(
      "adextensions",
      "get",
      {
        SelectionCriteria: { Ids: [...calloutIds].map((id) => rawId(id)), Types: ["CALLOUT"] },
        FieldNames: ["Id", "Type", "Status"],
        CalloutFieldNames: ["CalloutText"],
      },
      CLIENT_LOGIN,
    );
    console.log(JSON.stringify(calloutsResult, null, 2));
  }

  console.log("\n=== 5. For comparison: an ACTIVE Медавеню campaign's CounterIds + TrackingTemplate ===");
  const allCampsResult = await callDirect(
    "campaigns",
    "get",
    {
      SelectionCriteria: {},
      FieldNames: ["Id", "Name", "Status", "State"],
      TextCampaignFieldNames: ["CounterIds"],
    },
    CLIENT_LOGIN,
  );
  const camps: any[] = allCampsResult?.Campaigns ?? [];
  const onCamps = camps.filter((c) => c.State === "ON");
  console.log(`Total campaigns: ${camps.length}, State=ON: ${onCamps.length}`);
  for (const c of onCamps.slice(0, 5)) {
    console.log(
      `${c.Id}\t${c.Name}\tCounterIds=${JSON.stringify(c.TextCampaign?.CounterIds ?? c.DynamicTextCampaign?.CounterIds ?? c.SmartCampaign?.CounterIds ?? null)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
