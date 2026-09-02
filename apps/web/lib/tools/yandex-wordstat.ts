// Tool Integration §1 — real search-volume data for PPC's keyword
// decisions (see docs/07-planning/backlog.md #29). This is NOT the same
// credential/auth model as yandex-direct.ts/yandex-metrika.ts: the
// classic OAuth-token Wordstat API (api.wordstat.yandex.net, Bearer
// token) is deprecated — confirmed live 2026-08-30, that host's TLS cert
// doesn't even cover it anymore. Yandex migrated Wordstat into Yandex
// Cloud's Search API product (part of "AI Studio"), which uses a
// completely different auth model: an API key bound to a Yandex Cloud
// service account, plus a mandatory folderId in every request body — not
// the YANDEX_ACCESS_TOKEN/YANDEX_CLIENT_ID pair used elsewhere in this
// codebase's Yandex integrations.
//
// Setup performed 2026-08-30 (for reference, not reproducible from code
// alone — this needed `yc` CLI access to an already-authenticated Yandex
// Cloud profile): created a dedicated service account (`ama-wordstat-sa`,
// folder `b1g7877j5387nfra3jg0` — the same folder DataLens already uses),
// granted it the `search-api.executor` IAM role (the generic `ai.editor`
// role does NOT cover Search API — confirmed by a real 403 first, then
// 200 once search-api.executor was added), and minted an API key. Wordstat
// itself is free on this product; only other AI Studio features (LLM
// tokens etc.) are billed.
const SEARCH_API_BASE = "https://searchapi.api.cloud.yandex.net/v2/wordstat";

export function isWordstatConfigured(): boolean {
  return Boolean(process.env.YANDEX_SEARCH_API_KEY && process.env.YANDEX_SEARCH_API_FOLDER_ID);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export interface WordstatPhrase {
  readonly phrase: string;
  readonly count: number;
}

export interface WordstatResult {
  readonly results: readonly WordstatPhrase[]; // top phrases containing/close to the seed
  readonly associations: readonly WordstatPhrase[]; // semantically related phrases, not just textual matches
  readonly totalCount: number; // monthly search count for the seed phrase itself
}

// Confirmed live 2026-08-30 against a real account (see module comment).
// count fields arrive as strings in the API response — a real gotcha
// found in the field, not assumed: parsed here so callers get numbers,
// not another silent-string-where-number-expected trap.
export async function getWordstatFrequency(
  phrase: string,
  regionIds: readonly string[] = [],
  numPhrases = 20,
): Promise<WordstatResult> {
  const response = await fetch(`${SEARCH_API_BASE}/topRequests`, {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${requiredEnv("YANDEX_SEARCH_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phrase,
      numPhrases,
      regions: regionIds,
      folderId: requiredEnv("YANDEX_SEARCH_API_FOLDER_ID"),
    }),
  });
  const data = (await response.json()) as {
    results?: ReadonlyArray<{ phrase: string; count: string }>;
    associations?: ReadonlyArray<{ phrase: string; count: string }>;
    totalCount?: string;
    message?: string; // present on error responses (code/message/details shape)
  };
  if (!response.ok) {
    throw new Error(`Yandex Search API (Wordstat) call failed: ${response.status} ${data.message ?? JSON.stringify(data)}`);
  }
  return {
    results: (data.results ?? []).map((r) => ({ phrase: r.phrase, count: Number(r.count) })),
    associations: (data.associations ?? []).map((r) => ({ phrase: r.phrase, count: Number(r.count) })),
    totalCount: Number(data.totalCount ?? 0),
  };
}
