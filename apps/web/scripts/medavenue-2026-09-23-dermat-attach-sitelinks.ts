// Attach the 3 shared sitelink assets (already used on campaign 19321388084)
// to campaign 23484099509 for parity — reuses existing assets, creates no
// new ones. Campaign remains PAUSED throughout (no status mutation here).
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";
const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_BASE = "https://googleads.googleapis.com/v25";
const CAMPAIGN_RESOURCE = `customers/${CUSTOMER_ID}/campaigns/23484099509`;
const ASSET_IDS = ["100716329327", "100716329330", "100716329333"]; // Удаление новообразований, Трихология, Детский дерматолог

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

async function main() {
  const operations = ASSET_IDS.map((id) => ({
    create: {
      campaign: CAMPAIGN_RESOURCE,
      asset: `customers/${CUSTOMER_ID}/assets/${id}`,
      fieldType: "SITELINK",
    },
  }));
  const result = await callGoogleAds("/campaignAssets:mutate", { operations });
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
