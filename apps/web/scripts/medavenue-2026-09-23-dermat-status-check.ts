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
async function main() {
  const data = await callGoogleAds("/googleAds:search", { query: "SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id IN (19321388084, 23484099509)" });
  console.log(JSON.stringify(data.results, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
