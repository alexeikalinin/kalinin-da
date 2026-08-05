import { test } from "node:test";
import assert from "node:assert/strict";
import { asRoleId } from "@ama/agent-framework";
import { createAnthropicModelCatalog } from "./catalog.ts";
import { estimateProjectCost, RunningCostHistory } from "./estimate.ts";

test("cold start: with no history, the estimate uses the rough per-tier default (§3)", () => {
  const catalog = createAnthropicModelCatalog();
  const history = new RunningCostHistory();

  const estimate = estimateProjectCost(catalog, history, {
    roles: [asRoleId("research"), asRoleId("ppc")],
    executionTier: "fast",
  });

  assert.equal(estimate.perRole.get(asRoleId("research"))?.source, "cold-start");
  assert.equal(estimate.perRole.get(asRoleId("ppc"))?.source, "cold-start");
  assert.equal(estimate.total, catalog.costPerCall("base") * 1 * 2); // 1 call/role on Fast, 2 roles
});

test("the estimate switches to real historical data automatically once it exists, no separate cutover step (§3)", () => {
  const catalog = createAnthropicModelCatalog();
  const history = new RunningCostHistory();
  const roleId = asRoleId("ppc");

  const before = estimateProjectCost(catalog, history, { roles: [roleId], executionTier: "standard" });
  assert.equal(before.perRole.get(roleId)?.source, "cold-start");

  // Simulate a few completed Projects recording their real cost for this role.
  history.record(roleId, 0.5);
  history.record(roleId, 0.7);

  const after = estimateProjectCost(catalog, history, { roles: [roleId], executionTier: "standard" });
  assert.equal(after.perRole.get(roleId)?.source, "history");
  assert.equal(after.perRole.get(roleId)?.cost, 0.6); // average of 0.5 and 0.7
});

test("roles with history and roles without it can be mixed in the same estimate", () => {
  const catalog = createAnthropicModelCatalog();
  const history = new RunningCostHistory();
  const known = asRoleId("research");
  const unknown = asRoleId("qa");
  history.record(known, 0.3);

  const estimate = estimateProjectCost(catalog, history, {
    roles: [known, unknown],
    executionTier: "fast",
  });

  assert.equal(estimate.perRole.get(known)?.source, "history");
  assert.equal(estimate.perRole.get(unknown)?.source, "cold-start");
});
