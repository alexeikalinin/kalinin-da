import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Tool Integration §1: "SEO Agent | Проверка позиций/ключевых слов через
// SEO-сервис." Not in the specific reference-scenario graph built so far
// (that example task was "настроить рекламные кампании" — no SEO needed),
// but still a fully specified role per Glossary's reference conveyor.
export interface SeoRecommendations {
  readonly targetKeywords: readonly string[];
  readonly recommendations: readonly string[];
}

export interface SeoTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly siteUrl: string;
}

export type SeoModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  keywordData: unknown,
) => Promise<{ readonly recommendations: SeoRecommendations; readonly decisionSummary: string }>;

export function createSeoAgent(callModel: SeoModelCaller) {
  return defineAgent<SeoTaskPayload, SeoRecommendations>({
    roleId: "seo",
    displayName: "SEO Agent",
    purpose: "Сформировать SEO-рекомендации для сайта клиента.",
    responsibility:
      "Только стратегия/рекомендации, не реализация на сайте (это Frontend Agent, если подключён).",
    completionCriteria: "Документ проходит проверку QA Agent по чек-листу качества SEO-раздела.",
    memoryLevels: ["task", "project", "client_kb"],
    toolIds: ["seo-service"],

    async handler(input: AgentInput<SeoTaskPayload>): Promise<AgentOutput<SeoRecommendations>> {
      let keywordData: unknown;
      try {
        keywordData = await input.tools.invoke("seo-service", { url: input.task.payload.siteUrl });
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      let outcome: Awaited<ReturnType<SeoModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, keywordData);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      await input.memory.write("task", "seo-recommendations", outcome.recommendations);

      return {
        status: "success",
        result: outcome.recommendations,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
