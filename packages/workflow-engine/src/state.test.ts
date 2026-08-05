import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "./graph.ts";
import {
  getReadyNodes,
  initialGraphState,
  isGraphComplete,
  requeueStuckTask,
  withNodeState,
} from "./state.ts";
import { referenceScenarioNodes } from "./testing/reference-scenario.ts";

test("only the root task is ready when the graph starts", () => {
  const graph = buildGraph(referenceScenarioNodes());
  const state = initialGraphState(graph);
  const ready = getReadyNodes(graph, state);
  assert.deepEqual(
    ready.map((n) => n.taskId),
    ["research"],
  );
});

test("PPC and Media Buyer become ready together once Research succeeds (NFR-5 parallelism)", () => {
  const graph = buildGraph(referenceScenarioNodes());
  let state = initialGraphState(graph);
  state = withNodeState(state, "research", "succeeded");

  const ready = getReadyNodes(graph, state).map((n) => n.taskId).sort();
  assert.deepEqual(ready, ["media-buyer", "ppc"]);
});

test("Analytics is not ready until both PPC and Media Buyer succeed", () => {
  const graph = buildGraph(referenceScenarioNodes());
  let state = initialGraphState(graph);
  state = withNodeState(state, "research", "succeeded");
  state = withNodeState(state, "ppc", "succeeded");

  // Media Buyer only depends on Research, so it's still correctly "ready" here —
  // Analytics (which needs both PPC and Media Buyer) must not be.
  assert.deepEqual(
    getReadyNodes(graph, state).map((n) => n.taskId),
    ["media-buyer"],
  );

  state = withNodeState(state, "media-buyer", "succeeded");
  assert.deepEqual(
    getReadyNodes(graph, state).map((n) => n.taskId),
    ["analytics"],
  );
});

test("graph is complete only once every node has succeeded", () => {
  const graph = buildGraph(referenceScenarioNodes());
  let state = initialGraphState(graph);
  assert.equal(isGraphComplete(graph, state), false);

  for (const id of ["research", "ppc", "media-buyer", "analytics", "qa", "report"]) {
    state = withNodeState(state, id, "succeeded");
  }
  assert.equal(isGraphComplete(graph, state), true);
});

test("a stuck (running) task goes back to pending so it can be picked up again (Queue §4)", () => {
  const graph = buildGraph(referenceScenarioNodes());
  let state = initialGraphState(graph);
  state = withNodeState(state, "research", "running");

  state = requeueStuckTask(state, "research");
  assert.equal(state.states.get("research"), "pending");

  const ready = getReadyNodes(graph, state).map((n) => n.taskId);
  assert.deepEqual(ready, ["research"]);
});

test("cannot requeue a task that isn't currently running", () => {
  const graph = buildGraph(referenceScenarioNodes());
  const state = initialGraphState(graph);
  assert.throws(() => requeueStuckTask(state, "research"));
});
