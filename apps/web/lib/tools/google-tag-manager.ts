// Tool Integration §1 — real Google Tag Manager API (v2). Provisions one
// Container per project under a fixed AMA-only GTM account (never the
// account's other, unrelated client containers — see api-application-
// layer.md's Decision Log), with a GA4 Configuration tag firing on all
// pages, then publishes it. The GTM API cannot create top-level Accounts
// (Google's own limitation, confirmed 2026-08-13) — only Containers and
// everything below them, which is exactly what a new project needs.
import { getGoogleAccessToken } from "./google-oauth.ts";

const API_BASE = "https://www.googleapis.com/tagmanager/v2";
const ALL_PAGES_TRIGGER_ID = "2147479553"; // GTM's well-known built-in "All Pages" trigger id

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function isGoogleTagManagerConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GTM_ACCOUNT_ID);
}

async function callGtm(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Tag Manager API call failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

interface GtmContainer {
  readonly path: string; // "accounts/X/containers/Y"
  readonly containerId: string;
  readonly publicId: string; // "GTM-XXXXXXX"
  readonly name: string;
}

function resolveGtmAccountId(accountId: string | undefined): string {
  return accountId ?? requiredEnv("GOOGLE_GTM_ACCOUNT_ID");
}

async function findContainerByName(name: string, accountId: string): Promise<GtmContainer | undefined> {
  const data = (await callGtm(`/accounts/${accountId}/containers`, "GET")) as { container?: GtmContainer[] };
  return data.container?.find((c) => c.name === name);
}

export interface ProvisionedContainer {
  readonly containerPath: string;
  readonly publicId: string; // the GTM-XXXXXXX snippet id for the client to install
  readonly reused: boolean;
}

// Idempotent by container name, then configures + publishes a GA4
// Configuration tag firing on every page — a real, working container, not
// an empty shell (unlike the Google Ads campaign, there's no meaningful
// "paused" state for a tag: the risk here is measurement, not ad spend).
export async function provisionContainerWithGa4Tag(
  projectDisplayName: string,
  measurementId: string,
  gtmAccountId?: string,
): Promise<ProvisionedContainer> {
  const accountId = resolveGtmAccountId(gtmAccountId);
  const existing = await findContainerByName(projectDisplayName, accountId);
  if (existing) {
    return { containerPath: existing.path, publicId: existing.publicId, reused: true };
  }

  const container = (await callGtm(`/accounts/${accountId}/containers`, "POST", {
    name: projectDisplayName,
    usageContext: ["web"],
  })) as GtmContainer;

  const workspaces = (await callGtm(`/${container.path}/workspaces`, "GET")) as {
    workspace: ReadonlyArray<{ path: string }>;
  };
  const workspacePath = workspaces.workspace[0].path; // GTM auto-creates a "Default Workspace"

  await callGtm(`/${workspacePath}/tags`, "POST", {
    name: "GA4 Configuration — AMA",
    type: "gaawc", // Google's built-in GA4 Configuration tag type
    parameter: [{ type: "template", key: "measurementId", value: measurementId }],
    firingTriggerId: [ALL_PAGES_TRIGGER_ID],
  });

  const version = (await callGtm(`/${workspacePath}:create_version`, "POST", {
    name: `${projectDisplayName} — initial GA4 setup`,
  })) as { containerVersion: { path: string } };
  await callGtm(`/${version.containerVersion.path}:publish`, "POST", {});

  return { containerPath: container.path, publicId: container.publicId, reused: false };
}
