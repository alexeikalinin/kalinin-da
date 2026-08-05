import type { WorkflowGraph, WorkflowNode } from "./graph.ts";

// Workflow Engine §1: PPC and Media Buyer become "ready" at the same time
// once Research succeeds — this is the mechanism NFR-5 parallelism relies on.
export type NodeState =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "needs_revision"
  | "failed"
  | "blocked";

export interface GraphState {
  readonly states: ReadonlyMap<string, NodeState>;
}

export function initialGraphState(graph: WorkflowGraph): GraphState {
  const states = new Map<string, NodeState>();
  for (const node of graph.nodes) {
    states.set(node.taskId, "pending");
  }
  return { states };
}

export function withNodeState(
  state: GraphState,
  taskId: string,
  nodeState: NodeState,
): GraphState {
  const next = new Map(state.states);
  next.set(taskId, nodeState);
  return { states: next };
}

// A node is ready to dispatch once every dependency has succeeded and it
// hasn't already been queued/resolved itself.
export function getReadyNodes(
  graph: WorkflowGraph,
  state: GraphState,
): readonly WorkflowNode[] {
  return graph.nodes.filter((node) => {
    if (state.states.get(node.taskId) !== "pending") return false;
    return node.dependsOn.every((dep) => state.states.get(dep) === "succeeded");
  });
}

export function isGraphComplete(graph: WorkflowGraph, state: GraphState): boolean {
  return graph.nodes.every((node) => state.states.get(node.taskId) === "succeeded");
}

// Queue §4: a Task picked up but not finished in time goes back to "pending"
// so any free instance of the same role can pick it up again.
export function requeueStuckTask(state: GraphState, taskId: string): GraphState {
  if (state.states.get(taskId) !== "running") {
    throw new Error(
      `Cannot requeue task "${taskId}" — it is not currently running.`,
    );
  }
  return withNodeState(state, taskId, "pending");
}
