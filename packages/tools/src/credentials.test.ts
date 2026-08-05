import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@ama/agent-framework";
import type { Actor } from "@ama/memory";
import { CredentialStore } from "./credentials.ts";

function approver(tenant: string): Actor {
  return { kind: "approver", tenantId: asTenantId(tenant) };
}
function agent(tenant: string): Actor {
  return { kind: "agent", tenantId: asTenantId(tenant) };
}

test("only an approver can issue a tenant's credential", () => {
  const store = new CredentialStore();
  assert.throws(() => store.issue(agent("tenant-a"), "google-ads", "token-a"));

  store.issue(approver("tenant-a"), "google-ads", "token-a");
  assert.equal(store.get(agent("tenant-a"), "google-ads"), "token-a");
});

test("Tool Integration §3: a tenant can never retrieve another tenant's credential — structurally, not just by assertion", () => {
  const store = new CredentialStore();
  store.issue(approver("tenant-a"), "google-ads", "token-a");
  store.issue(approver("tenant-b"), "google-ads", "token-b");

  assert.equal(store.get(agent("tenant-a"), "google-ads"), "token-a");
  assert.equal(store.get(agent("tenant-b"), "google-ads"), "token-b");
});
