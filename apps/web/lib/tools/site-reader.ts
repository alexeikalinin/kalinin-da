// Tool Integration §1 — Research Agent's "просмотр сайта клиента": a real
// HTTP fetch + naive text extraction. No credentials needed — it's a
// public page fetch, not an authenticated API, so this has no
// isConfigured() gate the way web-search/model callers do.
const MAX_CONTENT_LENGTH = 6000;
const FETCH_TIMEOUT_MS = 10_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readSiteContent(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AmaResearchBot/1.0)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Site fetch failed: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  const text = stripHtml(html);
  if (!text) {
    throw new Error(`Site at ${url} returned no readable text content`);
  }
  return text.slice(0, MAX_CONTENT_LENGTH);
}
