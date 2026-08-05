import type { RoleId } from "@ama/agent-framework";

// Workflow Engine §1: PM Agent turns a Project into a graph of Task nodes,
// each bound to one role, with dependency edges saying "who goes after whom."
export interface WorkflowNode {
  readonly taskId: string;
  readonly roleId: RoleId;
  readonly dependsOn: readonly string[];
}

export interface WorkflowGraph {
  readonly nodes: readonly WorkflowNode[];
}

export function buildGraph(nodes: readonly WorkflowNode[]): WorkflowGraph {
  assertUniqueIds(nodes);
  assertDependenciesExist(nodes);
  assertNoCycles(nodes);
  return { nodes };
}

function assertUniqueIds(nodes: readonly WorkflowNode[]): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.taskId)) {
      throw new Error(`Duplicate taskId in workflow graph: ${node.taskId}`);
    }
    seen.add(node.taskId);
  }
}

function assertDependenciesExist(nodes: readonly WorkflowNode[]): void {
  const ids = new Set(nodes.map((n) => n.taskId));
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!ids.has(dep)) {
        throw new Error(
          `Task "${node.taskId}" depends on unknown task "${dep}"`,
        );
      }
    }
  }
}

function assertNoCycles(nodes: readonly WorkflowNode[]): void {
  const byId = new Map(nodes.map((n) => [n.taskId, n]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Cycle detected in workflow graph at task "${id}"`);
    }
    visiting.add(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) {
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const node of nodes) {
    visit(node.taskId);
  }
}
