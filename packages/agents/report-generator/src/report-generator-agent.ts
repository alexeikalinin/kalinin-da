import type { RoleId } from "@ama/agent-framework";
import { defineAgent, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Functional Requirements FR-6 (Decision Log 2026-08-04) — the output is a
// flexible bundle built from *only* the roles actually involved in this
// Project, not a fixed template. Product Specification §1: the report
// includes, at minimum, which agents participated, what they decided, and
// what results were achieved.
export interface ProjectOutput {
  readonly involvedRoles: readonly RoleId[];
  readonly materials: Readonly<Record<string, unknown>>;
  readonly narrativeSummary: string;
}

export interface ReportMaterialRef {
  readonly roleId: RoleId;
  // Project Memory key (relative — createAgentMemoryPort adds the projectId
  // prefix automatically), e.g. "ppc-task:campaign-summary" after
  // archiveTaskIntoProject.
  readonly key: string;
}

export interface ReportGeneratorTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly materialRefs: readonly ReportMaterialRef[];
}

export type ReportModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  materials: Readonly<Record<string, unknown>>,
) => Promise<{ readonly narrativeSummary: string; readonly decisionSummary: string }>;

export function createReportGeneratorAgent(callModel: ReportModelCaller) {
  return defineAgent<ReportGeneratorTaskPayload, ProjectOutput>({
    roleId: "report-generator",
    displayName: "Report Generator Agent",
    purpose: "Собрать итоговый комплект материалов и отчёт по завершённому Project.",
    responsibility: "Только сборка и оформление уже готовых результатов — не создаёт новый контент.",
    completionCriteria:
      "Отчёт включает участвовавших агентов, ключевые решения и результаты (Product Specification §1).",
    memoryLevels: ["project"],
    toolIds: [],

    async handler(
      input: AgentInput<ReportGeneratorTaskPayload>,
    ): Promise<AgentOutput<ProjectOutput>> {
      const materials: Record<string, unknown> = {};
      const involvedRoles: RoleId[] = [];

      for (const ref of input.task.payload.materialRefs) {
        const value = await input.memory.read("project", ref.key);
        if (value === undefined) continue; // that role's output isn't there — FR-6: only what was actually produced
        materials[ref.key] = value;
        if (!involvedRoles.includes(ref.roleId)) involvedRoles.push(ref.roleId);
      }

      let outcome: Awaited<ReturnType<ReportModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, materials);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      const result: ProjectOutput = {
        involvedRoles,
        materials,
        narrativeSummary: outcome.narrativeSummary,
      };

      await input.memory.write("project", "project-output", result);

      return {
        status: "success",
        result,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
