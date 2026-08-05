import { test } from "node:test";
import assert from "node:assert/strict";
import { asRoleId } from "@ama/agent-framework";
import { buildGraph } from "./graph.ts";
import { referenceScenarioNodes } from "./testing/reference-scenario.ts";

test("builds the reference scenario graph without error", () => {
  const graph = buildGraph(referenceScenarioNodes());
  assert.equal(graph.nodes.length, 6);
});

test("rejects a graph with a dependency on an unknown task", () => {
  assert.throws(() =>
    buildGraph([
      { taskId: "ppc", roleId: asRoleId("ppc"), dependsOn: ["research"] },
    ]),
  );
});

test("rejects a graph with a cycle", () => {
  assert.throws(() =>
    buildGraph([
      { taskId: "a", roleId: asRoleId("a"), dependsOn: ["b"] },
      { taskId: "b", roleId: asRoleId("b"), dependsOn: ["a"] },
    ]),
  );
});

test("rejects duplicate task ids", () => {
  assert.throws(() =>
    buildGraph([
      { taskId: "a", roleId: asRoleId("a"), dependsOn: [] },
      { taskId: "a", roleId: asRoleId("a"), dependsOn: [] },
    ]),
  );
});
