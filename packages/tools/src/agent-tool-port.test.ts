import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import type { Actor } from "@ama/memory";
import { ToolRegistry } from "./registry.ts";
import { CredentialStore } from "./credentials.ts";
import { createAgentToolPort } from "./agent-tool-port.ts";

function approver(tenant: string): Actor {
  return { kind: "approver", tenantId: asTenantId(tenant) };
}

function context(tenant: string) {
  return createInvocationContext({
    tenantId: asTenantId(tenant),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("ppc"),
    executionTier: "fast",
    approvalLevel: "strategy-gate",
  });
}

test("a role can only call tools it declared (Tool Integration §2)", async () => {
  const registry = new ToolRegistry();
  registry.register(approver("tenant-a"), { toolId: "google-ads", displayName: "Google Ads" });
  const credentials = new CredentialStore();

  const port = createAgentToolPort(registry, credentials, context("tenant-a"), ["google-ads"], async () => "ok");

  await assert.rejects(() => port.invoke("vk-ads", {}));
  assert.equal(await port.invoke("google-ads", {}), "ok");
});

test("an unapproved tool type is rejected even if the role declares it", async () => {
  const registry = new ToolRegistry(); // nothing registered
  const credentials = new CredentialStore();
  const port = createAgentToolPort(registry, credentials, context("tenant-a"), ["google-ads"], async () => "ok");

  await assert.rejects(() => port.invoke("google-ads", {}));
});

test("the correct tenant's credential is passed to the underlying invoker, fetched fresh per call (MCP Integration §3)", async () => {
  const registry = new ToolRegistry();
  registry.register(approver("tenant-a"), { toolId: "google-ads", displayName: "Google Ads" });
  const credentials = new CredentialStore();
  credentials.issue(approver("tenant-a"), "google-ads", "token-a");

  const seenCredentials: unknown[] = [];
  const port = createAgentToolPort(
    registry,
    credentials,
    context("tenant-a"),
    ["google-ads"],
    async (_toolId, _args, credential) => {
      seenCredentials.push(credential);
      return "ok";
    },
  );

  await port.invoke("google-ads", {});
  // Rotate the credential between calls — the port must not have cached the old one.
  credentials.issue(approver("tenant-a"), "google-ads", "token-a-rotated");
  await port.invoke("google-ads", {});

  assert.deepEqual(seenCredentials, ["token-a", "token-a-rotated"]);
});
