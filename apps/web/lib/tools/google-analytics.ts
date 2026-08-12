// Tool Integration §1 — Analytics Agent's "чтение данных из аналитической
// системы клиента", backed by the real GA4 Admin API. Provisions a
// dedicated GA4 Property + Web Data Stream per project (under a fixed
// AMA-only GA4 account, never the account's other, unrelated client
// properties), marks the project's conversion events as key events, and
// links the property to the Google Ads customer so those events become
// importable as conversions there.
import { getGoogleAccessToken } from "./google-oauth.ts";

const ADMIN_API_BASE = "https://analyticsadmin.googleapis.com/v1beta";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function isGoogleAnalyticsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GA_ACCOUNT_ID && process.env.GOOGLE_ADS_CUSTOMER_ID);
}

async function callAnalyticsAdmin(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Analytics Admin API call failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

interface GaProperty {
  readonly name: string; // "properties/12345"
  readonly displayName: string;
}

async function findPropertyByName(displayName: string): Promise<GaProperty | undefined> {
  const accountId = requiredEnv("GOOGLE_GA_ACCOUNT_ID");
  const data = (await callAnalyticsAdmin(
    `/properties?filter=${encodeURIComponent(`parent:accounts/${accountId}`)}`,
    "GET",
  )) as { properties?: GaProperty[] };
  return data.properties?.find((p) => p.displayName === displayName);
}

export interface ProvisionedAnalytics {
  readonly propertyName: string; // "properties/12345"
  readonly measurementId: string; // "G-XXXXXXX", for the GTM GA4 config tag
  readonly reused: boolean;
}

// Idempotent by displayName — a repeated call for the same project reuses
// its property/stream instead of creating duplicates.
export async function provisionAnalyticsProperty(
  projectDisplayName: string,
  siteUrl: string,
): Promise<ProvisionedAnalytics> {
  const existing = await findPropertyByName(projectDisplayName);
  if (existing) {
    const streams = (await callAnalyticsAdmin(`/${existing.name}/dataStreams`, "GET")) as {
      dataStreams?: Array<{ webStreamData?: { measurementId?: string } }>;
    };
    const measurementId = streams.dataStreams?.[0]?.webStreamData?.measurementId;
    if (measurementId) return { propertyName: existing.name, measurementId, reused: true };
  }

  const accountId = requiredEnv("GOOGLE_GA_ACCOUNT_ID");
  const property = (await callAnalyticsAdmin("/properties", "POST", {
    parent: `accounts/${accountId}`,
    displayName: projectDisplayName,
    timeZone: "Etc/UTC",
    currencyCode: "USD",
  })) as GaProperty;

  const stream = (await callAnalyticsAdmin(`/${property.name}/dataStreams`, "POST", {
    type: "WEB_DATA_STREAM",
    webStreamData: { defaultUri: siteUrl },
    displayName: `${projectDisplayName} — Web`,
  })) as { webStreamData: { measurementId: string } };

  return { propertyName: property.name, measurementId: stream.webStreamData.measurementId, reused: false };
}

// Marks an event name (e.g. "generate_lead", "purchase") as a conversion
// ("key event") — idempotent, Google rejects exact duplicates silently via
// ALREADY_EXISTS, which we treat as success.
export async function markKeyEvent(propertyName: string, eventName: string): Promise<void> {
  try {
    await callAnalyticsAdmin(`/${propertyName}/keyEvents`, "POST", {
      eventName,
      countingMethod: "ONCE_PER_EVENT",
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("ALREADY_EXISTS")) return;
    throw error;
  }
}

// Links the GA4 property to the Google Ads customer so its key events
// become available to import as Ads conversions. Idempotent for the same
// reason as markKeyEvent.
export async function linkToGoogleAds(propertyName: string): Promise<void> {
  const customerId = requiredEnv("GOOGLE_ADS_CUSTOMER_ID");
  try {
    await callAnalyticsAdmin(`/${propertyName}/googleAdsLinks`, "POST", {
      customerId,
      adsPersonalizationEnabled: false,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("ALREADY_EXISTS")) return;
    throw error;
  }
}

