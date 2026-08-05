import { test } from "node:test";
import assert from "node:assert/strict";
import { approvePlan, rejectPlan, statusAfterPlanBuilt } from "./strategy-gate.ts";

test("strategy-gate pauses the plan for approval", () => {
  assert.equal(statusAfterPlanBuilt("strategy-gate"), "awaiting_approval");
});

test("output-only skips the pause and goes straight to execution", () => {
  assert.equal(statusAfterPlanBuilt("output-only"), "executing");
});

test("approving a pending plan moves it to executing", () => {
  assert.equal(approvePlan("awaiting_approval"), "executing");
});

test("rejecting a pending plan sends it back to building", () => {
  assert.equal(rejectPlan("awaiting_approval"), "building");
});

test("cannot approve a plan that isn't awaiting approval", () => {
  assert.throws(() => approvePlan("executing"));
});

test("cannot reject a plan that isn't awaiting approval", () => {
  assert.throws(() => rejectPlan("completed"));
});
