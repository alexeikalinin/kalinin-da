// Read-only pre-check (2026-09-23) before launching both dermatology
// campaigns for Медавеню Google Ads (customer 9714539590).
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_BASE = "https://googleads.googleapis.com/v25";

async function callGoogleAds(path: string, body: unknown): Promise<any> {
  const accessToken = await getGoogleAccessToken(REFRESH_TOKEN_ENV);
  const response = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      "Content-Type": "application/json",
    },
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
  console.log("=== Shared sets (negative keyword lists) ===");
  const sets = await search(`
    SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.status, shared_set.member_count
    FROM shared_set
    WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
    ORDER BY shared_set.name
  `);
  for (const r of sets) console.log(JSON.stringify(r.sharedSet));

  console.log("\n=== Campaigns 19321388084 / 23484099509: status/budget ===");
  const camps = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name,
           campaign_budget.id, campaign_budget.resource_name, campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.id IN (19321388084, 23484099509)
  `);
  for (const r of camps) console.log(JSON.stringify(r, null, 2));

  console.log("\n=== Campaign shared sets currently attached to 19321388084 ===");
  const css = await search(`
    SELECT campaign_shared_set.resource_name, campaign_shared_set.shared_set, campaign_shared_set.status
    FROM campaign_shared_set
    WHERE campaign_shared_set.campaign = 'customers/9714539590/campaigns/19321388084'
  `);
  for (const r of css) console.log(JSON.stringify(r.campaignSharedSet));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
