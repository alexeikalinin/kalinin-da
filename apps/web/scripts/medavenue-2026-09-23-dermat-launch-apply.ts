// LIVE writes (2026-09-23), explicitly approved by the user, for Медавеню
// Google Ads (customer 9714539590):
//   1. Attach shared negative-keyword list "CM - Общие минус-слова"
//      (sharedSets/11852680614, 16729 phrases) to campaign 19321388084
//      "Поиск // Дерматолог // Минск // 22.09.26" via campaignSharedSets:mutate.
//   2. Set daily budget = $10.00 (10,000,000 micros) for both:
//        - 19321388084 "Поиск // Дерматолог // Минск // 22.09.26" (was 6.3M)
//        - 23484099509 "Поиск // Дерматолог // Минск" (was 20M)
//   3. Set campaign.status = ENABLED for both campaigns.
//   Deliberately does NOT touch ad_group.status anywhere — groups paused
//   earlier during cannibalization cleanup stay paused.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-dermat-launch-apply.ts
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const API_BASE = "https://googleads.googleapis.com/v25";

const NEGATIVE_SHARED_SET_RESOURCE = "customers/9714539590/sharedSets/11852680614"; // CM - Общие минус-слова
const TARGET_CAMPAIGN_FOR_NEGATIVE_LIST = "customers/9714539590/campaigns/19321388084";

const CAMPAIGNS = [
  {
    id: "19321388084",
    resourceName: "customers/9714539590/campaigns/19321388084",
    budgetResourceName: "customers/9714539590/campaignBudgets/12168120445",
    name: "Поиск // Дерматолог // Минск // 22.09.26",
  },
  {
    id: "23484099509",
    resourceName: "customers/9714539590/campaigns/23484099509",
    budgetResourceName: "customers/9714539590/campaignBudgets/15303950336",
    name: "Поиск // Дерматолог // Минск",
  },
];

const NEW_BUDGET_MICROS = "10000000"; // $10.00/day

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
  // Safety check — refuse to run unless both campaigns are still PAUSED
  // with the expected budgets right now (matches state confirmed just
  // before this script was written).
  const before = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.id IN (19321388084, 23484099509)
  `);
  console.log("Before:", JSON.stringify(before, null, 2));
  for (const r of before) {
    if (r.campaign.status !== "PAUSED") {
      throw new Error(`Refusing to modify: campaign ${r.campaign.id} status is ${r.campaign.status}, expected PAUSED`);
    }
  }

  // 1. Attach the shared negative-keyword list to campaign 19321388084.
  console.log("\n=== Attaching CM - Общие минус-слова to 19321388084 ===");
  const attachResult = await callGoogleAds("/campaignSharedSets:mutate", {
    operations: [
      {
        create: {
          campaign: TARGET_CAMPAIGN_FOR_NEGATIVE_LIST,
          sharedSet: NEGATIVE_SHARED_SET_RESOURCE,
        },
      },
    ],
  });
  console.log(JSON.stringify(attachResult, null, 2));

  // 2. Set budgets to $10/day for both campaigns.
  console.log("\n=== Setting budgets to $10.00/day ===");
  const budgetOps = CAMPAIGNS.map((c) => ({
    update: { resourceName: c.budgetResourceName, amountMicros: NEW_BUDGET_MICROS },
    updateMask: "amountMicros",
  }));
  const budgetResult = await callGoogleAds("/campaignBudgets:mutate", { operations: budgetOps });
  console.log(JSON.stringify(budgetResult, null, 2));

  // 3. Enable both campaigns.
  console.log("\n=== Enabling both campaigns ===");
  const statusOps = CAMPAIGNS.map((c) => ({
    update: { resourceName: c.resourceName, status: "ENABLED" },
    updateMask: "status",
  }));
  const statusResult = await callGoogleAds("/campaigns:mutate", { operations: statusOps });
  console.log(JSON.stringify(statusResult, null, 2));

  // Read back and confirm.
  console.log("\n=== After: campaigns ===");
  const after = await search(`
    SELECT campaign.id, campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.id IN (19321388084, 23484099509)
  `);
  console.log(JSON.stringify(after, null, 2));

  console.log("\n=== After: campaign shared sets on 19321388084 (ENABLED only) ===");
  const afterSets = await search(`
    SELECT campaign_shared_set.resource_name, campaign_shared_set.shared_set, campaign_shared_set.status
    FROM campaign_shared_set
    WHERE campaign_shared_set.campaign = '${TARGET_CAMPAIGN_FOR_NEGATIVE_LIST}' AND campaign_shared_set.status = 'ENABLED'
  `);
  console.log(JSON.stringify(afterSets, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
