import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { recordFactDirectly } from "./direct.ts";
import { resolveProposal } from "./resolve.ts";

function agent(tenant: string): Actor {
  return { kind: "agent", tenantId: asTenantId(tenant) };
}
function approver(tenant: string): Actor {
  return { kind: "approver", tenantId: asTenantId(tenant) };
}

// Knowledge Base §3 example: "клиент раньше не любил яркие цвета, но новый
// Research показывает смену бренд-политики" — must never silently overwrite.
test("a contradicting proposal is flagged as a conflict, not silently applied", () => {
  const store = new MemoryStore();
  const you = approver("tenant-a");
  const tenantId = asTenantId("tenant-a");

  recordFactDirectly(
    store,
    you,
    { level: "client_kb", tenantId, key: "brand-colors" },
    "no bright colors",
  );

  const newProposal = store.proposeFact(
    agent("tenant-a"),
    { level: "client_kb", tenantId, key: "brand-colors" },
    "bright colors now embraced",
  );

  const result = resolveProposal(store, you, newProposal);

  assert.equal(result.outcome, "conflict");
  if (result.outcome === "conflict") {
    assert.equal(result.existing.value, "no bright colors");
    assert.equal(result.proposal.value, "bright colors now embraced");
  }

  // The old fact must still stand — it was not overwritten.
  assert.equal(
    store.read(you, { level: "client_kb", tenantId, key: "brand-colors" }),
    "no bright colors",
  );
});

test("a matching proposal (same value) is confirmed without being flagged as a conflict", () => {
  const store = new MemoryStore();
  const you = approver("tenant-a");
  const tenantId = asTenantId("tenant-a");

  recordFactDirectly(
    store,
    you,
    { level: "client_kb", tenantId, key: "brand-colors" },
    "no bright colors",
  );

  const sameProposal = store.proposeFact(
    agent("tenant-a"),
    { level: "client_kb", tenantId, key: "brand-colors" },
    "no bright colors",
  );

  const result = resolveProposal(store, you, sameProposal);
  assert.equal(result.outcome, "confirmed");
});
