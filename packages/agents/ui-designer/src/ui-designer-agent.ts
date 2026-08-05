import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Glossary §2: "создать визуальные макеты на основе UX." Depends on UX
// Agent's plan (read from Project Memory, same pattern as Analytics
// reading PPC's archived output — see @ama/agent-analytics's README).
export interface UiDesign {
  readonly mockupRefs: readonly string[];
  readonly designNotes: string;
}

export interface UiDesignerTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly designToolId: string;
}

export type UiDesignerModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  toolOutput: unknown,
) => Promise<{ readonly design: UiDesign; readonly decisionSummary: string }>;

export function createUiDesignerAgent(callModel: UiDesignerModelCaller) {
  return defineAgent<UiDesignerTaskPayload, UiDesign>({
    roleId: "ui-designer",
    displayName: "UI Designer Agent",
    purpose: "Создать визуальные макеты на основе UX.",
    responsibility:
      "Только визуальный дизайн — не пользовательские сценарии (UX Agent) и не вёрстка (Frontend Agent).",
    completionCriteria: "Макеты проходят проверку QA Agent.",
    memoryLevels: ["task", "project", "client_kb"],
    toolIds: ["design-tool"],

    async handler(input: AgentInput<UiDesignerTaskPayload>): Promise<AgentOutput<UiDesign>> {
      // UX's plan is read via Project Memory before this, by the dispatcher
      // (see dispatch.ts) and included in the assembled prompt's project
      // context block — the handler itself only drives the design tool.
      let toolOutput: unknown;
      try {
        toolOutput = await input.tools.invoke(input.task.payload.designToolId, {});
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      let outcome: Awaited<ReturnType<UiDesignerModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, toolOutput);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      await input.memory.write("task", "ui-design", outcome.design);

      return {
        status: "success",
        result: outcome.design,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
