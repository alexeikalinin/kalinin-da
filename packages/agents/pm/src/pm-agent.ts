import { defineAgent, type AgentInput, type AgentOutput, type RoleId } from "@ama/agent-framework";
import { buildGraph, type WorkflowGraph, type WorkflowNode } from "@ama/workflow-engine";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Workflow Engine §1: "PM Agent получает Project и решает, какие роли
// нужны... строит из этого граф Task." This is the real implementation —
// every graph used so far (including @ama/reference-scenario's) was
// hand-written in a test; this is what actually produces one from a task
// description, the way Workflow Engine's own example describes it (e.g.
// the "настроить рекламные кампании" case excludes SEO/UI Designer).
export interface RoleSelection {
  readonly taskId: string;
  readonly roleId: RoleId;
  readonly dependsOn: readonly string[];
}

export interface PmTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly availableRoleIds: readonly RoleId[];
  readonly strategySummary: string;
}

export type PmModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  availableRoleIds: readonly RoleId[],
  strategySummary: string,
) => Promise<{ readonly selections: readonly RoleSelection[]; readonly decisionSummary: string }>;

export function createPmAgent(callModel: PmModelCaller) {
  return defineAgent<PmTaskPayload, WorkflowGraph>({
    roleId: "pm",
    displayName: "Project Manager Agent",
    purpose: "Декомпозировать Project на Task и построить граф исполнения (Workflow Engine §1).",
    responsibility:
      "Только планирование — выбор нужных ролей и порядка их работы, не исполнение отдельных Task.",
    completionCriteria: "Граф Task построен и проходит структурную проверку (buildGraph — нет циклов, все зависимости существуют).",
    memoryLevels: ["project"],
    toolIds: [],

    async handler(input: AgentInput<PmTaskPayload>): Promise<AgentOutput<WorkflowGraph>> {
      let outcome: Awaited<ReturnType<PmModelCaller>>;
      try {
        outcome = await callModel(
          input.task.payload.prompt,
          input.task.payload.modelId,
          input.task.payload.availableRoleIds,
          input.task.payload.strategySummary,
        );
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      const nodes: readonly WorkflowNode[] = outcome.selections.map((s) => ({
        taskId: s.taskId,
        roleId: s.roleId,
        dependsOn: s.dependsOn,
      }));

      let graph: WorkflowGraph;
      try {
        // buildGraph is the real structural check (Workflow Engine's own
        // validation, not reinvented here) — an invalid proposal (a cycle,
        // a dependency on a non-existent Task) is PM's own mistake, and is
        // treated as retryable: the model can be asked again with the
        // error, not a systemic tool/provider failure.
        graph = buildGraph(nodes);
      } catch (error) {
        return {
          status: "failed",
          error: {
            code: "INVALID_GRAPH_PROPOSAL",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        };
      }

      await input.memory.write("project", "plan", {
        roleIds: [...new Set(nodes.map((n) => n.roleId))],
        nodeCount: nodes.length,
      });

      return {
        status: "success",
        result: graph,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
