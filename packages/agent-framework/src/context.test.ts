import { test } from "node:test";
import assert from "node:assert/strict";
import { createInvocationContext } from "./context.ts";
import { asProjectId, asRoleId, asTaskId, asTenantId } from "./ids.ts";

function sampleContext() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-1"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("ppc"),
    executionTier: "fast",
    approvalLevel: "strategy-gate",
  });
}

test("invocation context cannot be mutated after creation", () => {
  const ctx = sampleContext();
  assert.throws(() => {
    // @ts-expect-error — readonly by contract; verifying it is also enforced at runtime.
    ctx.tenantId = asTenantId("tenant-2");
  }, TypeError);
});

test("invocation context preserves the fields it was created with", () => {
  const ctx = sampleContext();
  assert.equal(ctx.tenantId, "tenant-1");
  assert.equal(ctx.executionTier, "fast");
});

test("id constructors reject empty values", () => {
  assert.throws(() => asTenantId(""));
  assert.throws(() => asTenantId("   "));
});
