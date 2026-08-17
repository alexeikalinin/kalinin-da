// Tool Integration §1 — PPC Agent's "настройка кампаний в Яндекс.Директ",
// backed by the real Yandex Direct API v5 (JSON). Mirrors google-ads.ts:
// every created campaign is immediately suspended — nothing here ever
// enables real ad spend.
import { getYandexAccessToken, isYandexConfigured } from "./yandex-oauth.ts";

const API_BASE = "https://api.direct.yandex.com/json/v5";
const DEFAULT_TOTAL_DAILY_BUDGET_MICROS = 20_000_000; // 20 currency units/day, placeholder default
// Direct API v5 rejects DailyBudget below 9 currency units (error code 5005,
// "Значение поля DailyBudget должно быть в диапазоне от 9 до 1000000000") —
// found for real 2026-08-17 while testing the async workflow runner's
// retry/escalate path (a real bug, not an intentional forced failure).
const MIN_DAILY_BUDGET_MICROS = 9_000_000;

export { isYandexConfigured };

// clientLogin — the client's Yandex login, required only in agency mode
// (acting on behalf of a client account under an agency login). Personal
// account use omits it.
async function callDirect(resource: string, method: string, params: unknown, clientLogin?: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getYandexAccessToken()}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;

  const response = await fetch(`${API_BASE}/${resource}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ method, params }),
  });
  const data = (await response.json()) as { error?: unknown; result?: unknown };
  if (data.error) {
    throw new Error(`Yandex Direct API call failed: ${JSON.stringify(data.error)}`);
  }
  return data.result;
}

interface DirectCampaign {
  readonly Id: number;
  readonly Name: string;
  readonly Status: string;
  readonly State: string;
}

export async function listCampaigns(clientLogin?: string): Promise<readonly DirectCampaign[]> {
  const result = (await callDirect(
    "campaigns",
    "get",
    { SelectionCriteria: {}, FieldNames: ["Id", "Name", "Status", "State"] },
    clientLogin,
  )) as { Campaigns: DirectCampaign[] };
  return result.Campaigns ?? [];
}

// Creates a real TextCampaign, then immediately suspends it. Idempotent by
// name — a repeated call for the same project reuses the existing
// campaign instead of duplicating it.
export async function createOrReusePausedCampaign(
  name: string,
  budgetShare: number,
  clientLogin?: string,
): Promise<{ readonly campaignId: number; readonly reused: boolean }> {
  const existing = await listCampaigns(clientLogin);
  const match = existing.find((c) => c.Name === name);
  if (match) return { campaignId: match.Id, reused: true };

  const dailyBudgetMicros = Math.max(
    MIN_DAILY_BUDGET_MICROS,
    Math.round(DEFAULT_TOTAL_DAILY_BUDGET_MICROS * budgetShare),
  );

  const addResult = (await callDirect(
    "campaigns",
    "add",
    {
      Campaigns: [
        {
          Name: name,
          StartDate: new Date().toISOString().slice(0, 10),
          DailyBudget: { Amount: dailyBudgetMicros, Mode: "STANDARD" },
          TextCampaign: {
            BiddingStrategy: {
              Search: { BiddingStrategyType: "HIGHEST_POSITION" },
              Network: { BiddingStrategyType: "SERVING_OFF" },
            },
          },
        },
      ],
    },
    clientLogin,
  )) as { AddResults: ReadonlyArray<{ Id?: number; Errors?: unknown[] }> };

  const added = addResult.AddResults[0];
  if (!added?.Id) {
    throw new Error(`Yandex Direct campaign creation failed: ${JSON.stringify(added?.Errors)}`);
  }

  await callDirect("campaigns", "suspend", { SelectionCriteria: { Ids: [added.Id] } }, clientLogin);

  return { campaignId: added.Id, reused: false };
}
