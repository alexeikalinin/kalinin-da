// Shared OAuth access for Yandex Direct + Metrika — unlike Google's ~1h
// tokens, Yandex OAuth tokens are long-lived (~1 year), so this reads the
// stored access token directly rather than refreshing on every call.
// getYandexAccessToken() still refreshes lazily if the stored token is
// ever rejected as expired (see callers' 401 handling).
//
// Multi-credential support (2026-08-18, client ad-account reporting
// foundation): `platform_identity.credential_ref` in Supabase names which
// access-token env var to use directly (e.g. "YANDEX_AGENCY_ACCESS_TOKEN"
// for the StarMedia agency identity) — defaults to the original
// single-tenant "YANDEX_ACCESS_TOKEN" so every existing call site keeps
// working unchanged.
const DEFAULT_ACCESS_TOKEN_ENV = "YANDEX_ACCESS_TOKEN";

export function isYandexConfigured(accessTokenEnv: string = DEFAULT_ACCESS_TOKEN_ENV): boolean {
  return Boolean(process.env[accessTokenEnv]);
}

export function getYandexAccessToken(accessTokenEnv: string = DEFAULT_ACCESS_TOKEN_ENV): string {
  const token = process.env[accessTokenEnv];
  if (!token) throw new Error(`${accessTokenEnv} is not set`);
  return token;
}
