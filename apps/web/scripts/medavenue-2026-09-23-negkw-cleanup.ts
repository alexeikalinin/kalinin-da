// Точечное удаление 11 словоформ из общего shared negative keyword list
// "CM - Общие минус-слова" (customers/9714539590/sharedSets/11852680614),
// привязанного к 44 кампаниям разных специальностей. Явное "да" пользователя
// 2026-09-23. НЕ трогает остальные ~16718 фраз и сам shared set.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-negkw-cleanup.ts search
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-negkw-cleanup.ts remove
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-23-negkw-cleanup.ts verify
import { getGoogleAccessToken } from "../lib/tools/google-oauth.ts";

const CUSTOMER_ID = "9714539590";
const GOOGLE_REFRESH_TOKEN_ENV = "GOOGLE_ADS_AGENCY_REFRESH_TOKEN";
const SHARED_SET_RESOURCE = `customers/${CUSTOMER_ID}/sharedSets/11852680614`;

const TARGET_PHRASES = [
  "центральный",
  "центральная",
  "центральные",
  "центральное",
  "центрального",
  "центральных",
  "центральной",
  "фрунзенски",
  "дерматовенеролога",
  "дерматовенерологи",
  "дерматовенерологов",
];

async function callGoogleAds(path: string, body: unknown) {
  const accessToken = await getGoogleAccessToken(GOOGLE_REFRESH_TOKEN_ENV);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type": "application/json",
  };
  const response = await fetch(`https://googleads.googleapis.com/v25/customers/${CUSTOMER_ID}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Ads API failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

interface SharedCriterionRow {
  readonly sharedCriterion: {
    readonly resourceName: string;
    readonly criterionId: string;
    readonly keyword?: { readonly text: string; readonly matchType: string };
  };
}

async function searchAllSharedCriteria(): Promise<SharedCriterionRow[]> {
  const rows: SharedCriterionRow[] = [];
  let pageToken: string | undefined;
  do {
    const data: any = await callGoogleAds("/googleAds:search", {
      query: `SELECT shared_criterion.resource_name, shared_criterion.criterion_id,
                      shared_criterion.keyword.text, shared_criterion.keyword.match_type
               FROM shared_criterion
               WHERE shared_criterion.shared_set = '${SHARED_SET_RESOURCE}'`,
      pageToken,
    });
    if (data.results) rows.push(...data.results);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return rows;
}

async function main() {
  const mode = process.argv[2];
  if (!mode) throw new Error("Usage: script.ts <search|remove|verify>");

  if (mode === "search") {
    console.log(`Reading all shared_criterion rows for ${SHARED_SET_RESOURCE}...`);
    const rows = await searchAllSharedCriteria();
    console.log(`Total phrases in shared set: ${rows.length}`);
    const matches: SharedCriterionRow[] = [];
    for (const target of TARGET_PHRASES) {
      const found = rows.filter((r) => r.sharedCriterion.keyword?.text === target);
      if (found.length === 0) {
        console.log(`  MISSING (not found, exact match): "${target}"`);
      } else {
        for (const f of found) {
          console.log(
            `  FOUND: "${f.sharedCriterion.keyword?.text}" matchType=${f.sharedCriterion.keyword?.matchType} -> ${f.sharedCriterion.resourceName}`,
          );
          matches.push(f);
        }
      }
    }
    console.log(`\nTotal resource names to remove: ${matches.length}`);
    console.log(JSON.stringify(matches.map((m) => m.sharedCriterion.resourceName)));
    return;
  }

  if (mode === "remove") {
    const rows = await searchAllSharedCriteria();
    const toRemove: string[] = [];
    for (const target of TARGET_PHRASES) {
      const found = rows.filter((r) => r.sharedCriterion.keyword?.text === target);
      for (const f of found) toRemove.push(f.sharedCriterion.resourceName);
    }
    if (toRemove.length === 0) throw new Error("No matching shared criteria found — aborting, nothing to remove");
    console.log(`About to REMOVE ${toRemove.length} shared_criterion resources:`);
    toRemove.forEach((r) => console.log(`  ${r}`));

    const operations = toRemove.map((resourceName) => ({ remove: resourceName }));
    const result = await callGoogleAds("/sharedCriteria:mutate", { operations });
    console.log("Mutate result:", JSON.stringify(result, null, 2));
    return;
  }

  if (mode === "verify") {
    const rows = await searchAllSharedCriteria();
    console.log(`Total phrases in shared set now: ${rows.length}`);
    let allGone = true;
    for (const target of TARGET_PHRASES) {
      const stillThere = rows.filter((r) => r.sharedCriterion.keyword?.text === target);
      if (stillThere.length > 0) {
        allGone = false;
        console.log(`  STILL PRESENT (bad): "${target}" x${stillThere.length}`);
      } else {
        console.log(`  Confirmed removed: "${target}"`);
      }
    }
    console.log(allGone ? "\nAll 11 target phrases confirmed removed." : "\nWARNING: some target phrases still present!");

    // Sample a few neighboring/unrelated phrases to confirm they survived.
    const sampleNeighbors = ["центр", "фрунзенский", "дерматовенеролог", "дерматолог"];
    console.log("\nNeighboring-phrase spot check (should still be present unless never existed):");
    for (const s of sampleNeighbors) {
      const found = rows.filter((r) => r.sharedCriterion.keyword?.text === s);
      console.log(`  "${s}": ${found.length > 0 ? "present" : "not present"}`);
    }
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
