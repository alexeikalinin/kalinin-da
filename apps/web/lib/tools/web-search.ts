// Tool Integration §1 — Research Agent's "поиск информации в интернете",
// backed by Perplexity's search-grounded chat completions (model "sonar"
// returns a synthesized, cited answer rather than raw links — no separate
// scraping/parsing step needed on our side).
const SEARCH_TIMEOUT_MS = 20_000;

export function isPerplexityConfigured(): boolean {
  return Boolean(process.env.PERPLEXITY_API_KEY);
}

interface PerplexityResponse {
  readonly choices: ReadonlyArray<{ readonly message: { readonly content: string } }>;
}

export async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY is not set");

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: query }],
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Perplexity search failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as PerplexityResponse;
  const content = data.choices[0]?.message.content;
  if (!content) {
    throw new Error("Perplexity search returned no content");
  }
  return content;
}
