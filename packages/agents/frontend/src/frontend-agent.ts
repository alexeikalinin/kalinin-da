import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Tool Integration §1: "Frontend Agent | Развёртывание/публикация кода
// (Этап 2)." The doc itself flags this as an Этап 2 concern — here it's
// modeled the same way as every other tool-using role (deploy tool
// injected, not a real hosting provider — no Vercel credentials exist in
// this environment, see Roadmap "какие аккаунты нужны").
export interface FrontendDeployment {
  readonly deployedUrl: string;
}

export interface FrontendTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly materials: Readonly<Record<string, unknown>>; // e.g. UI Designer's mockups, Copywriter's texts
}

export type FrontendModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  materials: Readonly<Record<string, unknown>>,
) => Promise<{ readonly buildArtifact: unknown; readonly decisionSummary: string }>;

export function createFrontendAgent(callModel: FrontendModelCaller) {
  return defineAgent<FrontendTaskPayload, FrontendDeployment>({
    roleId: "frontend",
    displayName: "Frontend Agent",
    purpose: "Развернуть/опубликовать готовые материалы (например, лендинг) технически.",
    responsibility:
      "Только реализация/публикация — не дизайн (UI Designer Agent) и не тексты (Copywriter Agent).",
    completionCriteria: "Публикация подтверждена, материал доступен по URL.",
    memoryLevels: ["task", "project"],
    toolIds: ["deployment-tool"],

    async handler(input: AgentInput<FrontendTaskPayload>): Promise<AgentOutput<FrontendDeployment>> {
      let outcome: Awaited<ReturnType<FrontendModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, input.task.payload.materials);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      let deployment: unknown;
      try {
        deployment = await input.tools.invoke("deployment-tool", { artifact: outcome.buildArtifact });
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      const result: FrontendDeployment = { deployedUrl: String((deployment as { url: string }).url) };
      await input.memory.write("task", "deployment", result);

      return {
        status: "success",
        result,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
