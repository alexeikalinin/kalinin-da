// Shared OAuth access for Yandex Direct + Metrika — unlike Google's ~1h
// tokens, Yandex OAuth tokens are long-lived (~1 year), so this reads the
// stored access token directly rather than refreshing on every call.
// getYandexAccessToken() still refreshes lazily if the stored token is
// ever rejected as expired (see callers' 401 handling).
export function isYandexConfigured(): boolean {
  return Boolean(process.env.YANDEX_ACCESS_TOKEN);
}

export function getYandexAccessToken(): string {
  const token = process.env.YANDEX_ACCESS_TOKEN;
  if (!token) throw new Error("YANDEX_ACCESS_TOKEN is not set");
  return token;
}
