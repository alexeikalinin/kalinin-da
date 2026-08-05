import { defineAgent, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Glossary §2: "проработать пользовательские сценарии и структуру
// интерфейса." A planning role — like Media Buyer, no external tool.
// UI Designer Agent depends on this role's output (real dependency in a
// site-building Workflow, distinct from the ads-only reference graph
// already exercised in @ama/reference-scenario).
export interface UxPlan {
  readonly userFlows: readonly string[];
  readonly structureNotes: string;
}

export interface UxTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
}

export type UxModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
) => Promise<{ readonly plan: UxPlan; readonly decisionSummary: string }>;

export function createUxAgent(callModel: UxModelCaller) {
  return defineAgent<UxTaskPayload, UxPlan>({
    roleId: "ux",
    displayName: "UX Agent",
    purpose: "Проработать пользовательские сценарии и структуру интерфейса.",
    responsibility:
      "Только сценарии и структура — не визуальный дизайн (UI Designer Agent) и не вёрстка (Frontend Agent).",
    completionCriteria: "UX-документ проходит проверку QA Agent.",
    memoryLevels: ["task", "project", "client_kb"],
    toolIds: [],

    async handler(input: AgentInput<UxTaskPayload>): Promise<AgentOutput<UxPlan>> {
      let outcome: Awaited<ReturnType<UxModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      // Project Memory, not Task Memory — UI Designer needs to read this
      // from a different Task (same convention as Media Buyer's plan).
      await input.memory.write("project", "ux-plan", outcome.plan);

      return {
        status: "success",
        result: outcome.plan,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
