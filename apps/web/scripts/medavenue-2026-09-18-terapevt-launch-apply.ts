// WRITE task (2026-09-18), explicit user approval relayed via coordinator:
// bring "Терапевт // Поиск // Минск // Manual" (714467575) to launch and
// turn it ON. Phase 1 of this script is READ-ONLY discovery (landing
// pages, keywords, negatives, ЛОР campaign as reference for budget/
// strategy/bids) — writes only run if `--apply` is passed AND phase 1
// found no blockers.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-18-terapevt-launch-apply.ts
//   node --env-file=apps/web/.env.local apps/web/scripts/medavenue-2026-09-18-terapevt-launch-apply.ts --apply
import { getYandexAccessToken } from "../lib/tools/yandex-oauth.ts";
import { addNegativeKeywords, setCampaignStatus, getDailyBudget } from "../lib/tools/yandex-direct.ts";

const CLIENT_LOGIN = "porg-yw2ynqgs";
const ACCESS_TOKEN_ENV = "YANDEX_AGENCY_ACCESS_TOKEN";
const CAMPAIGN_ID = "714467575";
const AD_GROUP_ID = "5799352204";
const REFERENCE_CAMPAIGN_ID = "707005508"; // ЛОР — reference for budget/strategy/bids
const AD_ID = "1921455957130277614"; // the single responsive ad in AD_GROUP_ID
const API_BASE = "https://api.direct.yandex.com/json/v5";
const API_BASE_V501 = "https://api.direct.yandex.com/json/v501";
const APPLY = process.argv.includes("--apply");

function rawId(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error(`rawId: not a plain integer string: ${id}`);
  return `__RAWID_${id}_RAWID__`;
}
function encodeRawIds(body: string): string {
  return body.replace(/"__RAWID_(\d+)_RAWID__"/g, "$1");
}

async function callDirect(resource: string, method: string, params: unknown, apiBase: string = API_BASE): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getYandexAccessToken(ACCESS_TOKEN_ENV)}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
    "Client-Login": CLIENT_LOGIN,
  };
  const response = await fetch(`${apiBase}/${resource}`, {
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

async function checkUrl(url: string): Promise<{ url: string; status: number | string }> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    return { url, status: res.status };
  } catch (e) {
    return { url, status: `ERROR: ${(e as Error).message}` };
  }
}

async function main() {
  console.log("################ PHASE 1: READ-ONLY DISCOVERY ################\n");

  // --- 1. Landing pages ---
  console.log("=== 1. Landing page checks ===");
  const adsResult = await callDirect("ads", "get", {
    SelectionCriteria: { CampaignIds: [rawId(CAMPAIGN_ID)] },
    FieldNames: ["Id", "AdGroupId"],
    ResponsiveAdFieldNames: ["Href", "SitelinkSetId"],
  });
  const ads: any[] = adsResult?.Ads ?? [];
  const mainHref = ads[0]?.ResponsiveAd?.Href;
  const sitelinkSetId = ads[0]?.ResponsiveAd?.SitelinkSetId;
  const urlsToCheck: string[] = [];
  if (mainHref) urlsToCheck.push(mainHref);

  let sitelinks: any[] = [];
  if (sitelinkSetId) {
    const slResult = await callDirect("sitelinks", "get", {
      SelectionCriteria: { Ids: [rawId(String(sitelinkSetId))] },
      SitelinkFieldNames: ["Title", "Description", "Href"],
    });
    sitelinks = slResult?.SitelinksSets?.[0]?.Sitelinks ?? [];
    for (const sl of sitelinks) urlsToCheck.push(sl.Href);
  }

  const checkResults = await Promise.all(urlsToCheck.map(checkUrl));
  for (const r of checkResults) console.log(`${r.status}\t${r.url}`);
  const blockedUrls = checkResults.filter((r) => r.status !== 200);
  const landingBlocker = blockedUrls.length > 0;
  if (landingBlocker) {
    console.log("\nBLOCKER: not all URLs returned 200:");
    console.log(JSON.stringify(blockedUrls, null, 2));
  }

  // --- 2. Keywords ---
  console.log("\n=== 2. Keywords in ad group", AD_GROUP_ID, "===");
  const kwResult = await callDirect("keywords", "get", {
    SelectionCriteria: { AdGroupIds: [rawId(AD_GROUP_ID)] },
    FieldNames: ["Id", "Keyword", "Bid", "ContextBid", "Status", "State"],
  });
  const keywords: any[] = kwResult?.Keywords ?? [];
  for (const kw of keywords) console.log(`${kw.Id}\t${kw.Keyword}\tBid=${kw.Bid}\tContextBid=${kw.ContextBid}\t${kw.Status}/${kw.State}`);
  console.log(`Total keywords: ${keywords.length}`);
  const keywordsBlocker = keywords.length === 0;

  // --- 3. Negative keyword shared sets — this campaign vs ЛОР reference ---
  console.log("\n=== 3. Negative keyword shared sets: this campaign vs ЛОР reference (", REFERENCE_CAMPAIGN_ID, ") ===");
  const campsResult = await callDirect("campaigns", "get", {
    SelectionCriteria: { Ids: [rawId(CAMPAIGN_ID), rawId(REFERENCE_CAMPAIGN_ID)] },
    FieldNames: ["Id", "Name", "DailyBudget"],
    TextCampaignFieldNames: ["BiddingStrategy", "NegativeKeywordSharedSetIds"],
  });
  const camps: any[] = campsResult?.Campaigns ?? [];
  const thisCamp = camps.find((c: any) => String(c.Id) === CAMPAIGN_ID);
  const refCamp = camps.find((c: any) => String(c.Id) === REFERENCE_CAMPAIGN_ID);
  console.log("Терапевт NegativeKeywordSharedSetIds:", JSON.stringify(thisCamp?.TextCampaign?.NegativeKeywordSharedSetIds));
  console.log("ЛОР (reference) NegativeKeywordSharedSetIds:", JSON.stringify(refCamp?.TextCampaign?.NegativeKeywordSharedSetIds));
  console.log("ЛОР DailyBudget:", JSON.stringify(refCamp?.DailyBudget));
  console.log("ЛОР BiddingStrategy:", JSON.stringify(refCamp?.TextCampaign?.BiddingStrategy, null, 2));

  const refSetIds: string[] = (refCamp?.TextCampaign?.NegativeKeywordSharedSetIds?.Items ?? []).map(String);
  const thisSetIds: string[] = (thisCamp?.TextCampaign?.NegativeKeywordSharedSetIds?.Items ?? []).map(String);
  const missingSets = refSetIds.filter((id) => !thisSetIds.includes(id));
  console.log("Missing shared sets on Терапевт:", missingSets);

  // --- 3b. Reference ЛОР keywords + bids (same theme, Minsk) ---
  console.log("\n=== 3b. ЛОР reference campaign keyword bids (for calibration) ===");
  const refKwResult = await callDirect("keywords", "get", {
    SelectionCriteria: { CampaignIds: [rawId(REFERENCE_CAMPAIGN_ID)] },
    FieldNames: ["Id", "Keyword", "Bid", "ContextBid", "Status", "State"],
  });
  const refKeywords: any[] = refKwResult?.Keywords ?? [];
  for (const kw of refKeywords.slice(0, 40)) {
    console.log(`${kw.Keyword}\tBid=${kw.Bid}\tContextBid=${kw.ContextBid}\t${kw.Status}/${kw.State}`);
  }
  // Autotargeting rows carry a structurally different, much lower bid
  // (0.30 BYN on ЛОР) than real keyword phrases (3.0-4.0 BYN) — averaging
  // them together would drag the "real keyword" bid down to an
  // unrepresentative number. Compute the two separately.
  const refRealKwBids = refKeywords
    .filter((k) => k.Keyword !== "---autotargeting")
    .map((k) => k.Bid)
    .filter((b) => typeof b === "number" && b > 0);
  const refAutoBids = refKeywords
    .filter((k) => k.Keyword === "---autotargeting")
    .map((k) => k.Bid)
    .filter((b) => typeof b === "number" && b > 0);
  const avgRefBid = refRealKwBids.length
    ? Math.round(refRealKwBids.reduce((a, b) => a + b, 0) / refRealKwBids.length)
    : null;
  const avgRefAutoBid = refAutoBids.length
    ? Math.round(refAutoBids.reduce((a, b) => a + b, 0) / refAutoBids.length)
    : null;
  console.log(`ЛОР avg real-keyword Bid (micros): ${avgRefBid} (${refRealKwBids.length} keywords)`);
  console.log(`ЛОР avg autotargeting Bid (micros): ${avgRefAutoBid} (${refAutoBids.length} rows)`);

  // --- 3c. Терапевт own DailyBudget current state ---
  const currentBudget = await getDailyBudget(Number(CAMPAIGN_ID), CLIENT_LOGIN, ACCESS_TOKEN_ENV);
  console.log("\nТерапевт current DailyBudget:", JSON.stringify(currentBudget));

  console.log("\n################ PHASE 1 SUMMARY ################");
  console.log(`Landing pages OK: ${!landingBlocker}`);
  console.log(`Keywords present: ${!keywordsBlocker} (count=${keywords.length})`);
  console.log(`Missing negative shared sets to attach: ${JSON.stringify(missingSets)}`);

  if (landingBlocker || keywordsBlocker) {
    console.log("\nBLOCKER FOUND — stopping here, no writes will be attempted regardless of --apply.");
    return;
  }

  if (!APPLY) {
    console.log("\nNo blockers found. Re-run with --apply to execute phase 2 (writes).");
    return;
  }

  console.log("\n################ PHASE 2: WRITES ################\n");

  // 4. Attach missing negative shared sets
  if (missingSets.length > 0) {
    console.log("4. Attaching negative keyword shared sets:", missingSets);
    const mergedSetIds = [...thisSetIds, ...missingSets];
    await callDirect("campaigns", "update", {
      Campaigns: [
        {
          Id: rawId(CAMPAIGN_ID),
          TextCampaign: { NegativeKeywordSharedSetIds: { Items: mergedSetIds.map((id) => Number(id)) } },
        },
      ],
    });
    console.log("Done.");
  } else {
    console.log("4. Negative shared sets already match ЛОР reference — nothing to do.");
  }

  // 5. Daily budget 20 BYN/day
  console.log("\n5. Setting DailyBudget = 20 BYN/day (20,000,000 micros; multiplier confirmed via getDailyBudget/ЛОР Amount field, both already store Amount directly in micros)");
  await callDirect("campaigns", "update", {
    Campaigns: [{ Id: rawId(CAMPAIGN_ID), DailyBudget: { Amount: 20_000_000, Mode: "STANDARD" } }],
  });
  console.log("Done.");

  // 6. Bidding strategy — mirror ЛОР's Search/Network BiddingStrategy shape
  console.log("\n6. Copying ЛОР BiddingStrategy shape onto Терапевт");
  const refStrategy = refCamp?.TextCampaign?.BiddingStrategy;
  if (!refStrategy) {
    console.log("BLOCKER: ЛОР campaign has no readable TextCampaign.BiddingStrategy — skipping strategy copy, campaign will keep its current default.");
  } else {
    await callDirect("campaigns", "update", {
      Campaigns: [{ Id: rawId(CAMPAIGN_ID), TextCampaign: { BiddingStrategy: refStrategy } }],
    });
    console.log("Done. Applied:", JSON.stringify(refStrategy));
  }

  // 7. Manual bids per keyword — real keyword phrases get ЛОР's average
  // real-keyword bid (same city/theme tier); the autotargeting row gets
  // ЛОР's separately-averaged autotargeting bid, since autotargeting is a
  // structurally different, much lower bid tier on ЛОР (0.30 BYN vs
  // 3.0-4.0 BYN) and averaging them together would misrepresent both.
  console.log("\n7. Setting manual bids per keyword");
  const realKwBid = avgRefBid ?? 300_000; // fallback 0.30 BYN if no reference bids found — should not happen
  const autoBid = avgRefAutoBid ?? realKwBid;
  console.log(
    `Real-keyword bid basis: ${avgRefBid ? `ЛОР average across ${refRealKwBids.length} real keywords = ${avgRefBid} micros (${(avgRefBid / 1_000_000).toFixed(2)} BYN)` : "FALLBACK default (no ЛОР bids found)"}`,
  );
  console.log(
    `Autotargeting bid basis: ${avgRefAutoBid ? `ЛОР average across ${refAutoBids.length} autotargeting rows = ${avgRefAutoBid} micros (${(avgRefAutoBid / 1_000_000).toFixed(2)} BYN)` : "fallback to real-keyword bid (no ЛОР autotargeting bids found)"}`,
  );
  const bidSetPayload = keywords.map((kw) => ({
    KeywordId: rawId(String(kw.Id)),
    Bid: kw.Keyword === "---autotargeting" ? autoBid : realKwBid,
  }));
  const bidsResult = await callDirect("bids", "set", { Bids: bidSetPayload });
  console.log(JSON.stringify(bidsResult, null, 2));
  for (const kw of keywords) {
    const bid = kw.Keyword === "---autotargeting" ? autoBid : realKwBid;
    console.log(`  ${kw.Keyword} (id ${kw.Id}) -> Bid=${bid} micros (${(bid / 1_000_000).toFixed(2)} BYN)`);
  }

  // 8. Draft campaigns can't be resumed directly (Code 8300 — "Кампания
  // является черновиком"). Submit for moderation by resuming the ad
  // itself instead; the campaign auto-transitions out of DRAFT once its
  // ad(s) are sent to moderation.
  console.log("\n8. Resuming ad", AD_ID, "to submit for moderation");
  const adResumeRaw = await callDirect("ads", "resume", { SelectionCriteria: { Ids: [rawId(AD_ID)] } });
  console.log("Raw ad resume response:", JSON.stringify(adResumeRaw, null, 2));
  const adResumeErrors = adResumeRaw?.ResumeResults?.[0]?.Errors;
  if (adResumeErrors && adResumeErrors.length > 0) {
    console.log("BLOCKER: ad resume returned errors:", JSON.stringify(adResumeErrors));
  } else {
    console.log("Ad resume OK — should now be submitted for moderation.");
  }

  console.log("\n8b. Re-checking campaign Status/State after ad resume");
  const campAfterAdResume = await callDirect("campaigns", "get", {
    SelectionCriteria: { Ids: [rawId(CAMPAIGN_ID)] },
    FieldNames: ["Id", "Name", "Status", "State"],
  });
  console.log(JSON.stringify(campAfterAdResume, null, 2));

  console.log("\n8c. Attempting campaigns.resume again (in case campaign left DRAFT)");
  const resumeRaw = await callDirect("campaigns", "resume", { SelectionCriteria: { Ids: [rawId(CAMPAIGN_ID)] } });
  console.log("Raw resume response:", JSON.stringify(resumeRaw, null, 2));
  const resumeErrors = resumeRaw?.ResumeResults?.[0]?.Errors;
  if (resumeErrors && resumeErrors.length > 0) {
    console.log("Campaign still not resumable:", JSON.stringify(resumeErrors));
  } else {
    console.log("Done — campaign resumed.");
  }

  // 9. Self-check: read everything back
  console.log("\n################ PHASE 3: SELF-CHECK (read back) ################\n");
  const finalCamp = await callDirect("campaigns", "get", {
    SelectionCriteria: { Ids: [rawId(CAMPAIGN_ID)] },
    FieldNames: ["Id", "Name", "Status", "State", "DailyBudget"],
    TextCampaignFieldNames: ["BiddingStrategy", "NegativeKeywordSharedSetIds"],
  });
  console.log(JSON.stringify(finalCamp, null, 2));

  const finalKw = await callDirect("keywords", "get", {
    SelectionCriteria: { AdGroupIds: [rawId(AD_GROUP_ID)] },
    FieldNames: ["Id", "Keyword", "Bid", "Status", "State"],
  });
  console.log(JSON.stringify(finalKw, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
