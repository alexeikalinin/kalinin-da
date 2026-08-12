// Shared OAuth token refresh for every real Google integration (Ads, Tag
// Manager, Analytics) — one refresh token covers all three scopes (see
// apps/web/.env.local), so this is the single place that exchanges it for
// a short-lived access token, cached until just before expiry.
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let cachedAccessToken: { token: string; expiresAt: number } | undefined;

export async function getGoogleAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.token;
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_ADS_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_ADS_CLIENT_SECRET"),
      refresh_token: requiredEnv("GOOGLE_ADS_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(`Google OAuth token refresh failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}
