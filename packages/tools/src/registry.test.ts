import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@ama/agent-framework";
import type { Actor } from "@ama/memory";
import { ToolRegistry } from "./registry.ts";

function approver(): Actor {
  return { kind: "approver", tenantId: asTenantId("tenant-a") };
}
function agent(): Actor {
  return { kind: "agent", tenantId: asTenantId("tenant-a") };
}

test("only an approver can register a new tool type (Open Question #1)", () => {
  const registry = new ToolRegistry();
  assert.throws(() =>
    registry.register(agent(), { toolId: "google-ads", displayName: "Google Ads" }),
  );

  registry.register(approver(), { toolId: "google-ads", displayName: "Google Ads" });
  assert.equal(registry.isApproved("google-ads"), true);
});

test("an unregistered tool is not approved", () => {
  const registry = new ToolRegistry();
  assert.equal(registry.isApproved("unknown-tool"), false);
});
