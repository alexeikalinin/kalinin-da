// Shared OAuth token refresh for every real Google integration (Ads, Tag
// Manager, Analytics) — the OAuth app (client_id/secret) is shared; only
// the refresh token differs per credential ("identity"), so this is the
// single place that exchanges any one of them for a short-lived access
// token, cached per refresh-token-env-name until just before expiry.
//
// Multi-credential support (2026-08-18, client ad-account reporting
// foundation): `platform_identity.credential_ref` in Supabase names which
// refresh-token env var to use (e.g. "GOOGLE_ADS_AGENCY_REFRESH_TOKEN" for
// the StarMedia agency identity) — defaults to the original single-tenant
// "GOOGLE_ADS_REFRESH_TOKEN" so every existing call site (PPC/Analytics
// agents' own campaign-creation and tracking-setup flows) keeps working
// unchanged.
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const DEFAULT_REFRESH_TOKEN_ENV = "GOOGLE_ADS_REFRESH_TOKEN";

const cachedAccessTokens = new Map<string, { token: string; expiresAt: number }>();

export async function getGoogleAccessToken(refreshTokenEnv: string = DEFAULT_REFRESH_TOKEN_ENV): Promise<string> {
  const cached = cachedAccessTokens.get(refreshTokenEnv);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_ADS_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_ADS_CLIENT_SECRET"),
      refresh_token: requiredEnv(refreshTokenEnv),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(`Google OAuth token refresh failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccessTokens.set(refreshTokenEnv, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
