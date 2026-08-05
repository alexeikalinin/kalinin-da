import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { recordFactDirectly } from "./direct.ts";

function approver(tenant: string): Actor {
  return { kind: "approver", tenantId: asTenantId(tenant) };
}

test("Knowledge Base §2.1: a fact you state directly is confirmed immediately, no pending step", () => {
  const store = new MemoryStore();
  const you = approver("tenant-a");
  const tenantId = asTenantId("tenant-a");

  const result = recordFactDirectly(
    store,
    you,
    { level: "client_kb", tenantId, key: "brand-colors" },
    "no bright colors",
  );

  assert.equal(result.outcome, "confirmed");
  assert.equal(
    store.read(you, { level: "client_kb", tenantId, key: "brand-colors" }),
    "no bright colors",
  );
});
