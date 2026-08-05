import { test } from "node:test";
import assert from "node:assert/strict";
import { asRoleId } from "@ama/agent-framework";
import { defaultModelSelector } from "./tiers.ts";

function input(overrides: Partial<Parameters<typeof defaultModelSelector>[0]> = {}) {
  return {
    complexity: "standard" as const,
    executionTier: "standard" as const,
    approvalLevel: "output-only" as const,
    roleId: asRoleId("ppc"),
    ...overrides,
  };
}

// Cost Optimization §2 — the reference example almost verbatim.
test("routine Copywriter task on Fast tier gets the cheapest tier", () => {
  const tier = defaultModelSelector(
    input({ complexity: "routine", executionTier: "fast", roleId: asRoleId("copywriter") }),
  );
  assert.equal(tier, "fast");
});

test("a complex strategy task on Standard tier gets the most capable tier", () => {
  const tier = defaultModelSelector(
    input({ complexity: "complex", executionTier: "standard", roleId: asRoleId("pm") }),
  );
  assert.equal(tier, "advanced");
});

test("Fast Execution Tier nudges the tier down by one step", () => {
  const standardResult = defaultModelSelector(input({ complexity: "standard", executionTier: "standard" }));
  const fastResult = defaultModelSelector(input({ complexity: "standard", executionTier: "fast" }));
  assert.equal(standardResult, "base");
  assert.equal(fastResult, "fast");
});

test("Strategy-gate nudges the tier down (§1: draft can be cheaper, you review it anyway)", () => {
  const outputOnly = defaultModelSelector(
    input({ complexity: "complex", approvalLevel: "output-only" }),
  );
  const strategyGate = defaultModelSelector(
    input({ complexity: "complex", approvalLevel: "strategy-gate" }),
  );
  assert.equal(outputOnly, "advanced");
  assert.equal(strategyGate, "base");
});

test("combined nudges never go below the cheapest tier", () => {
  const tier = defaultModelSelector(
    input({ complexity: "routine", executionTier: "fast", approvalLevel: "strategy-gate" }),
  );
  assert.equal(tier, "fast");
});
