import { getYandexAccessToken } from "../lib/tools/yandex-oauth.ts";

const YANDEX_CLIENT_LOGIN = "porg-yw2ynqgs";
const YANDEX_ACCESS_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const YANDEX_API_BASE = "https://api.direct.yandex.com/json/v5";

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
  if (!res.ok || data.error) throw new Error(JSON.stringify(data.error ?? text));
  return data.result;
}

async function main() {
  const ids = [706782578, 706782501, 708468419, 713471948];
  const res = await callDirect("campaigns", "get", {
    SelectionCriteria: { Ids: ids },
    FieldNames: ["Id", "Name", "Status", "State", "Type"],
  });
  console.log(JSON.stringify(res, null, 2));

  console.log("---- ad groups for these campaigns ----");
  const groups = await callDirect("adgroups", "get", {
    SelectionCriteria: { CampaignIds: ids },
    FieldNames: ["Id", "Name", "CampaignId", "Status"],
  });
  console.log(JSON.stringify(groups, null, 2));

  console.log("---- keywords for these ad groups ----");
  const groupIds = (groups.AdGroups ?? []).map((g: any) => g.Id);
  const kws = await callDirect("keywords", "get", {
    SelectionCriteria: { AdGroupIds: groupIds },
    FieldNames: ["Id", "Keyword", "AdGroupId", "State", "Status"],
  });
  console.log(JSON.stringify(kws, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
