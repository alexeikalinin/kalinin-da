import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { confirmGeneralizedLesson, proposeGeneralizedLesson } from "./generalize.ts";

function reflection(tenant: string): Actor {
  return { kind: "reflection", tenantId: asTenantId(tenant) };
}
function approver(tenant: string): Actor {
  return { kind: "approver", tenantId: asTenantId(tenant) };
}

// Learning System §4 — a pattern confirmed on several different tenants may
// be proposed as a generalized, shared lesson, but only via confirmation.
test("a generalized lesson is not visible until an approver confirms it", () => {
  const store = new MemoryStore();
  const proposal = proposeGeneralizedLesson(
    store,
    reflection("tenant-a"),
    "casual-tone-18-25",
    "Casual tone performs better for the 18-25 segment across clients",
  );

  const anyTenant = asTenantId("tenant-z");
  assert.equal(
    store.read({ kind: "agent", tenantId: anyTenant }, {
      level: "domain_kb",
      tenantId: anyTenant,
      key: "casual-tone-18-25",
    }),
    undefined,
  );

  const resolution = confirmGeneralizedLesson(store, approver("tenant-a"), proposal);
  assert.equal(resolution.outcome, "confirmed");

  assert.equal(
    store.read({ kind: "agent", tenantId: anyTenant }, {
      level: "domain_kb",
      tenantId: anyTenant,
      key: "casual-tone-18-25",
    }),
    "Casual tone performs better for the 18-25 segment across clients",
  );
});
