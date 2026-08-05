import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTenantId } from "@ama/agent-framework";
import { createDispatchContext, type ProjectContext } from "./dispatch.ts";

function projectFor(tenant: string): ProjectContext {
  return {
    tenantId: asTenantId(tenant),
    projectId: asProjectId("project-1"),
    executionTier: "fast",
    approvalLevel: "strategy-gate",
  };
}

test("dispatch context carries the project's tenant and the node's role/task", () => {
  const context = createDispatchContext(
    { taskId: "ppc", roleId: asRoleId("ppc"), dependsOn: [] },
    projectFor("tenant-a"),
  );
  assert.equal(context.tenantId, "tenant-a");
  assert.equal(context.taskId, "ppc");
  assert.equal(context.roleId, "ppc");
});

test("dispatch context is frozen (cannot be mutated after creation)", () => {
  const context = createDispatchContext(
    { taskId: "ppc", roleId: asRoleId("ppc"), dependsOn: [] },
    projectFor("tenant-a"),
  );
  assert.throws(() => {
    // @ts-expect-error — readonly by contract; verifying runtime enforcement too.
    context.tenantId = asTenantId("tenant-b");
  }, TypeError);
});

test("two dispatches for different tenants never share the same context object (isolation, Queue §5)", () => {
  const nodeA = { taskId: "ppc", roleId: asRoleId("ppc"), dependsOn: [] };
  const contextA = createDispatchContext(nodeA, projectFor("tenant-a"));
  const contextB = createDispatchContext(nodeA, projectFor("tenant-b"));

  assert.notEqual(contextA, contextB);
  assert.equal(contextA.tenantId, "tenant-a");
  assert.equal(contextB.tenantId, "tenant-b");
});
