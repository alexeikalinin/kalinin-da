import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";
const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_BASE = "https://googleads.googleapis.com/v25";
async function callGoogleAds(path: string, body: unknown): Promise<any> {
  const accessToken = await getGoogleAccessToken(REFRESH_TOKEN_ENV);
  const response = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Ads API call failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function search(query: string): Promise<any[]> {
  const data = await callGoogleAds("/googleAds:search", { query });
  return data.results ?? [];
}
async function main() {
  const rows = await search(`
    SELECT campaign.id, campaign_asset.asset, campaign_asset.field_type, asset.id, asset.sitelink_asset.link_text
    FROM campaign_asset WHERE campaign.id = 19321388084 AND campaign_asset.field_type = 'SITELINK'
  `);
  for (const r of rows) console.log(r.asset.id, r.asset.sitelinkAsset?.linkText, r.campaignAsset.asset);
}
main().catch((e) => { console.error(e); process.exit(1); });
