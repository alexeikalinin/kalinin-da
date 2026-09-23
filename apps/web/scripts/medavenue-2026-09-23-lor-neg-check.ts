import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";
const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
async function callGoogleAds(path: string, body: unknown): Promise<any> {
  const accessToken = await getGoogleAccessToken(REFRESH_TOKEN_ENV);
  const response = await fetch(`https://googleads.googleapis.com/v25/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`fail ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function search(query: string) { return (await callGoogleAds("/googleAds:search", { query })).results ?? []; }
async function main() {
  const rows = await search(`
    SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion
    WHERE campaign_criterion.campaign = 'customers/${CUSTOMER_ID}/campaigns/23373725924'
      AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = true
  `);
  console.log(JSON.stringify(rows));
}
main().catch(e=>{console.error(e);process.exit(1);});
