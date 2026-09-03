// Auth for OpenAI Ads (api.ads.openai.com/v1) — a static per-ad-account API
// key issued in Ads Manager → Settings, not an OAuth token: OpenAI Ads has
// no advertiser-facing OAuth flow (confirmed against developers.openai.com/ads,
// see docs/openai-ads-integration-research.md Phase 2). Mirrors
// yandex-oauth.ts's shape (a static token read straight from env) rather
// than google-oauth.ts's refresh-flow, since there is no refresh step here.
//
// `platform_identity.credential_ref` names which env var holds a given
// client's key (e.g. "OPENAI_ADS_MEDAVENUE_API_KEY") — defaults to
// "OPENAI_ADS_API_KEY" for a single-tenant setup, same convention as
// DEFAULT_ACCESS_TOKEN_ENV in yandex-oauth.ts.
const DEFAULT_API_KEY_ENV = "OPENAI_ADS_API_KEY";

export function isOpenAiAdsConfigured(apiKeyEnv: string = DEFAULT_API_KEY_ENV): boolean {
  return Boolean(process.env[apiKeyEnv]);
}

export function getOpenAiAdsApiKey(apiKeyEnv: string = DEFAULT_API_KEY_ENV): string {
  const key = process.env[apiKeyEnv];
  if (!key) throw new Error(`${apiKeyEnv} is not set`);
  return key;
}
