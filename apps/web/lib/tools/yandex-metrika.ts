// Tool Integration §1 — Analytics Agent's tracking setup, backed by the
// real Yandex Metrika Management API. Mirrors google-analytics.ts:
// provisions one counter per project (idempotent by name) and a goal
// marking the conversion event.
import { getYandexAccessToken } from "./yandex-oauth.ts";

const MANAGEMENT_API_BASE = "https://api-metrika.yandex.net/management/v1";

// accessTokenEnv — which identity's token to use (client ad-account
// reporting foundation, 2026-08-18); defaults to the original
// single-tenant YANDEX_ACCESS_TOKEN via yandex-oauth.ts.
async function callMetrika(path: string, method: "GET" | "POST", body?: unknown, accessTokenEnv?: string): Promise<unknown> {
  const response = await fetch(`${MANAGEMENT_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `OAuth ${getYandexAccessToken(accessTokenEnv)}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Yandex Metrika API call failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

interface MetrikaCounter {
  readonly id: number;
  readonly name: string;
  readonly site?: string;
}

async function findCounterByName(name: string): Promise<MetrikaCounter | undefined> {
  const data = (await callMetrika("/counters", "GET")) as { counters?: MetrikaCounter[] };
  return data.counters?.find((c) => c.name === name);
}

export interface ProvisionedCounter {
  readonly counterId: number;
  readonly reused: boolean;
}

// Idempotent by counter name — a repeated call for the same project
// reuses its counter instead of creating a duplicate.
export async function provisionCounter(projectDisplayName: string, siteUrl: string): Promise<ProvisionedCounter> {
  const existing = await findCounterByName(projectDisplayName);
  if (existing) return { counterId: existing.id, reused: true };

  const site = new URL(siteUrl).hostname;
  const data = (await callMetrika("/counters", "POST", {
    counter: { name: projectDisplayName, site },
  })) as { counter: MetrikaCounter };

  return { counterId: data.counter.id, reused: false };
}

// Marks a conversion goal on the counter — idempotent, Yandex rejects
// exact duplicate goal names with an error we treat as success.
export async function createGoal(counterId: number, goalName: string): Promise<void> {
  try {
    await callMetrika(`/counter/${counterId}/goals`, "POST", {
      goal: { name: goalName, type: "action", conditions: [{ type: "exact", url: "/thank-you" }] },
    });
  } catch (error) {
    if (error instanceof Error && /already exists|уже существ/i.test(error.message)) return;
    throw error;
  }
}

// Read-only — lists every counter the given identity's token can see
// (conversion-audit skill, step 2). Used to find a client's counter by
// matching site/name when the counter id isn't already known — exactly
// how the Медавеню counter (45848736, site medavenu.by) was found
// 2026-08-18.
export async function listCounters(accessTokenEnv?: string): Promise<readonly MetrikaCounter[]> {
  const data = (await callMetrika("/counters", "GET", undefined, accessTokenEnv)) as { counters?: MetrikaCounter[] };
  return data.counters ?? [];
}

export interface MetrikaGoal {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly status?: string;
}

// Read-only — the "what's available" list a human picks target
// conversions from (conversion-audit skill, step 2).
export async function listGoals(counterId: number, accessTokenEnv?: string): Promise<readonly MetrikaGoal[]> {
  const data = (await callMetrika(`/counter/${counterId}/goals`, "GET", undefined, accessTokenEnv)) as {
    goals?: MetrikaGoal[];
  };
  return data.goals ?? [];
}
