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

// refreshTokenEnv — which identity's token to use (client ad-account
// reporting foundation, 2026-08-18); defaults to the original
// single-tenant GOOGLE_ADS_REFRESH_TOKEN via google-oauth.ts.
async function callGtm(path: string, method: "GET" | "POST" | "DELETE", body?: unknown, refreshTokenEnv?: string): Promise<unknown> {
  const accessToken = await getGoogleAccessToken(refreshTokenEnv);
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  // DELETE responses are empty (204/200 with no body) — nothing to parse.
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : undefined;
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
    console.log(`[gtm] REUSED existing container "${projectDisplayName}" (${existing.publicId}) in account ${accountId} — nothing created.`);
    return { containerPath: existing.path, publicId: existing.publicId, reused: true };
  }

  console.log(`[gtm] CREATING new container "${projectDisplayName}" in account ${accountId} — the GTM API cannot delete containers with the currently granted scope, so this cannot be undone automatically; clean up manually or via apps/web/scripts/delete-gtm-container.ts if this was a test run.`);
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

  console.log(`[gtm] CREATED and published container "${projectDisplayName}" (${container.publicId}) in account ${accountId}.`);
  return { containerPath: container.path, publicId: container.publicId, reused: false };
}

// Shared by addGa4EventTag/addGoogleAdsConversionTag below — both need the
// same "did dataLayer.push({event: eventName, ...}) happen" trigger, and a
// second event tag reusing the same eventName should fire off the one
// trigger already created for the first, not a duplicate.
async function findOrCreateCustomEventTrigger(workspacePath: string, eventName: string): Promise<string> {
  const existingTriggers = (await callGtm(`/${workspacePath}/triggers`, "GET")) as {
    trigger?: ReadonlyArray<GtmTrigger & { path?: string }>;
  };
  const triggerName = `Custom Event — ${eventName}`;
  const existing = existingTriggers.trigger?.find((t) => t.name === triggerName)?.triggerId;
  if (existing) return existing;

  const trigger = (await callGtm(`/${workspacePath}/triggers`, "POST", {
    name: triggerName,
    type: "customEvent",
    customEventFilter: [
      { type: "equals", parameter: [{ type: "template", key: "arg0", value: "{{_event}}" }, { type: "template", key: "arg1", value: eventName }] },
    ],
  })) as GtmTrigger & { triggerId: string };
  return trigger.triggerId;
}

async function publishNewVersion(workspacePath: string, name: string): Promise<void> {
  const version = (await callGtm(`/${workspacePath}:create_version`, "POST", { name })) as {
    containerVersion: { path: string };
  };
  await callGtm(`/${version.containerVersion.path}:publish`, "POST", {});
}

// Wires a form/button dataLayer.push({event: eventName, ...}) through to a
// real GA4 event: a Custom Event trigger matching eventName, plus a GA4
// Event tag (using the same measurementId as the page's GA4 Configuration
// tag) that fires on it. provisionContainerWithGa4Tag only sets up the
// page-view side (a GA4 Configuration tag on All Pages) — without this,
// a client-side-only form submit (no page navigation for a page-view tag
// to catch) never reaches GA4 at all. Idempotent by trigger/tag name, same
// convention as provisionContainerWithGa4Tag itself.
export async function addGa4EventTag(containerPath: string, eventName: string, measurementId: string): Promise<void> {
  const workspaces = (await callGtm(`/${containerPath}/workspaces`, "GET")) as {
    workspace: ReadonlyArray<{ path: string }>;
  };
  const workspacePath = workspaces.workspace[0].path;
  const triggerId = await findOrCreateCustomEventTrigger(workspacePath, eventName);

  const existingTags = (await callGtm(`/${workspacePath}/tags`, "GET")) as { tag?: ReadonlyArray<GtmTag & { name: string }> };
  const tagName = `GA4 Event — ${eventName}`;
  const alreadyTagged = existingTags.tag?.some((t) => t.name === tagName);

  if (!alreadyTagged) {
    await callGtm(`/${workspacePath}/tags`, "POST", {
      name: tagName,
      type: "gaawe", // Google's built-in GA4 Event tag type
      parameter: [
        { type: "template", key: "measurementIdOverride", value: measurementId },
        { type: "template", key: "eventName", value: eventName },
      ],
      firingTriggerId: [triggerId],
    });
  }

  await publishNewVersion(workspacePath, `Add GA4 event tag — ${eventName}`);
}

// The Google Ads side of the same dataLayer.push({event: eventName, ...})
// — a "Google Ads Conversion Tracking" tag (GTM's built-in "awct" type)
// firing on the same Custom Event trigger as addGa4EventTag, reporting
// against a native Google Ads conversion action (created via
// google-ads.ts's createConversionAction, which returns exactly the
// conversionId/conversionLabel pair this tag needs). Independent of GA4 —
// this is Google Ads' own conversion tag, not an import from GA4's key
// events, so it isn't affected by the GA4-import HIDDEN-status limitation
// documented on createConversionAction.
export async function addGoogleAdsConversionTag(
  containerPath: string,
  eventName: string,
  conversionId: string,
  conversionLabel: string,
): Promise<void> {
  const workspaces = (await callGtm(`/${containerPath}/workspaces`, "GET")) as {
    workspace: ReadonlyArray<{ path: string }>;
  };
  const workspacePath = workspaces.workspace[0].path;
  const triggerId = await findOrCreateCustomEventTrigger(workspacePath, eventName);

  const existingTags = (await callGtm(`/${workspacePath}/tags`, "GET")) as { tag?: ReadonlyArray<GtmTag & { name: string }> };
  const tagName = `Google Ads Conversion — ${eventName}`;
  const alreadyTagged = existingTags.tag?.some((t) => t.name === tagName);

  if (!alreadyTagged) {
    await callGtm(`/${workspacePath}/tags`, "POST", {
      name: tagName,
      type: "awct", // Google's built-in Google Ads Conversion Tracking tag type
      parameter: [
        { type: "template", key: "conversionId", value: conversionId },
        { type: "template", key: "conversionLabel", value: conversionLabel },
      ],
      firingTriggerId: [triggerId],
    });
  }

  await publishNewVersion(workspacePath, `Add Google Ads conversion tag — ${eventName}`);
}

// ---------------------------------------------------------------------
// Conversion-audit read tools (see ~/.claude/skills/conversion-audit.md
// and 2026-08-18's real Медавеню audit) — read-only, never mutate.
// ---------------------------------------------------------------------

// Finds which account+container a client's GTM-XXXXXXX public id actually
// lives in — the client record only stores the public id, not the numeric
// accountId/containerId GTM's API needs, exactly the manual lookup done
// while auditing GTM-KT6CT27 (2026-08-18): list every account the identity
// can see, then every account's containers, until publicId matches.
export async function findContainerByPublicId(
  publicId: string,
  refreshTokenEnv?: string,
): Promise<{ readonly accountId: string; readonly containerId: string } | undefined> {
  const accounts = (await callGtm("/accounts", "GET", undefined, refreshTokenEnv)) as {
    account?: ReadonlyArray<{ accountId: string }>;
  };
  for (const account of accounts.account ?? []) {
    const containers = (await callGtm(`/accounts/${account.accountId}/containers`, "GET", undefined, refreshTokenEnv)) as {
      container?: readonly GtmContainer[];
    };
    const match = containers.container?.find((c) => c.publicId === publicId);
    if (match) return { accountId: account.accountId, containerId: match.containerId };
  }
  return undefined;
}

// Requires the tagmanager.delete.containers scope on the refresh token —
// not covered by tagmanager.edit.containers/publish (see api-application-
// layer.md's 2026-08-14 entry: the original test-run identity had to be
// re-issued with this scope added before deletion was possible).
export async function deleteContainer(
  accountId: string,
  containerId: string,
  refreshTokenEnv?: string,
): Promise<void> {
  await callGtm(`/accounts/${accountId}/containers/${containerId}`, "DELETE", undefined, refreshTokenEnv);
}

export interface GtmTag {
  readonly tagId: string;
  readonly name: string;
  readonly type: string;
  readonly parameter?: ReadonlyArray<{ readonly key: string; readonly value?: string }>;
  readonly firingTriggerId?: readonly string[];
}

export interface GtmTrigger {
  readonly triggerId: string;
  readonly name: string;
  readonly type: string;
}

export interface GtmLiveVersion {
  readonly containerVersionId: string;
  readonly tag?: readonly GtmTag[];
  readonly trigger?: readonly GtmTrigger[];
}

// Read-only fetch of the currently-published version — no workspace/draft
// state involved.
export async function getLiveContainerVersion(
  accountId: string,
  containerId: string,
  refreshTokenEnv?: string,
): Promise<GtmLiveVersion> {
  return (await callGtm(
    `/accounts/${accountId}/containers/${containerId}/versions:live`,
    "GET",
    undefined,
    refreshTokenEnv,
  )) as GtmLiveVersion;
}

export interface AuditFinding {
  readonly tagId: string;
  readonly tagName: string;
  readonly tagType: string;
  // "html" tags: the raw reachGoal argument found in the tag body (matches
  // a Yandex Metrika goal's `conditions[].url`, not the goal's display name).
  readonly matchedGoalUrlCondition?: string;
  // "awct" tags: conversionId is the AW-XXXXXXXXX id (NOT a Google Ads
  // customerId), conversionLabel is the opaque per-action label — match
  // both against a Google Ads conversion_action's tag_snippets to find
  // which action a tag actually fires (see google-ads.ts's
  // listConversionActions + the skill's step 4).
  readonly conversionId?: string;
  readonly conversionLabel?: string;
}

// Pure function, no network — parses raw tag bodies/params into
// structured candidates for a human (or the calling code, on their
// behalf) to cross-reference against listGoals()/listConversionActions().
// Deliberately does NOT decide "this is a duplicate" or "this is broken"
// — that judgment stays human (conversion-audit skill, step 5).
export function extractAuditFindings(version: GtmLiveVersion): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const tag of version.tag ?? []) {
    if (tag.type === "html") {
      const htmlParam = tag.parameter?.find((p) => p.key === "html")?.value ?? "";
      // New syntax: ym(12345, 'reachGoal', 'goal-url'). Legacy syntax:
      // yaCounter12345.reachGoal('goal-url') — both seen in the same real
      // container (GTM-KT6CT27, 2026-08-18).
      const match =
        htmlParam.match(/reachGoal['"]\s*,\s*['"]([^'"]+)['"]/) ??
        htmlParam.match(/reachGoal\(['"]([^'"]+)['"]\)/);
      if (match) {
        findings.push({ tagId: tag.tagId, tagName: tag.name, tagType: tag.type, matchedGoalUrlCondition: match[1] });
      }
    } else if (tag.type === "awct") {
      const conversionId = tag.parameter?.find((p) => p.key === "conversionId")?.value;
      const conversionLabel = tag.parameter?.find((p) => p.key === "conversionLabel")?.value;
      findings.push({ tagId: tag.tagId, tagName: tag.name, tagType: tag.type, conversionId, conversionLabel });
    } else if (tag.type === "ua") {
      // Universal Analytics — retired by Google since 2023/2024; still
      // firing here does nothing. Report as a finding either way (dead
      // code, not a live tracking gap) rather than silently skipping it.
      findings.push({ tagId: tag.tagId, tagName: tag.name, tagType: tag.type });
    }
  }
  return findings;
}
