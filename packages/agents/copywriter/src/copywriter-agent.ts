import { defineAgent, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Tool Integration §2's own example: "Copywriter Agent, скорее всего, кроме
// текстового редактора ничего и не нужно" — no tools, same category as UX.
export interface CopyDraft {
  readonly texts: readonly string[];
}

export interface CopywriterTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly briefs: readonly string[];
}

export type CopywriterModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  briefs: readonly string[],
) => Promise<{ readonly draft: CopyDraft; readonly decisionSummary: string }>;

export function createCopywriterAgent(callModel: CopywriterModelCaller) {
  return defineAgent<CopywriterTaskPayload, CopyDraft>({
    roleId: "copywriter",
    displayName: "Copywriter Agent",
    purpose: "Написать тексты (объявления, лендинги, посты) под задачу.",
    responsibility:
      "Только тексты — не вёрстка (Frontend Agent) и не визуальный дизайн (UI Designer Agent).",
    completionCriteria: "Тексты проходят проверку QA Agent.",
    memoryLevels: ["task", "project", "client_kb"],
    toolIds: [],

    async handler(input: AgentInput<CopywriterTaskPayload>): Promise<AgentOutput<CopyDraft>> {
      let outcome: Awaited<ReturnType<CopywriterModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, input.task.payload.briefs);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      await input.memory.write("task", "copy-draft", outcome.draft);

      return {
        status: "success",
        result: outcome.draft,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
