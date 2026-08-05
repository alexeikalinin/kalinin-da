import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Tool Integration §1: "Research Agent | Просмотр сайта клиента, поиск
// информации в интернете." The root of the reference graph (Workflow
// Engine §1) — no dependencies, everything else depends on this.
//
// Note (Security §7, RISK-03b — not fixed here by the user's own decision,
// 2026-08-04): this is exactly the role where the residual PII risk lives.
// Reading an existing client site can surface a real person's name/email
// (e.g. a staff bio page). No technical restriction is added at this stage
// — the risk stays open and low-priority in the Risk Register, on purpose.
export interface ResearchFindings {
  readonly summary: string;
  readonly facts: readonly string[];
}

export interface ResearchTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly siteUrl: string;
  readonly searchQuery: string;
}

export type ResearchModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  siteContent: unknown,
  searchResults: unknown,
) => Promise<{ readonly findings: ResearchFindings; readonly decisionSummary: string }>;

export function createResearchAgent(callModel: ResearchModelCaller) {
  return defineAgent<ResearchTaskPayload, ResearchFindings>({
    roleId: "research",
    displayName: "Research Agent",
    purpose: "Собрать и структурировать информацию о сайте клиента, бизнесе и рынке.",
    responsibility:
      "Только сбор и структурирование фактов — не стратегические выводы (это PM/PPC/Media Buyer).",
    completionCriteria: "Находки записаны и доступны для следующих ролей в этом Project.",
    memoryLevels: ["task", "project"],
    toolIds: ["site-reader", "web-search"],

    async handler(input: AgentInput<ResearchTaskPayload>): Promise<AgentOutput<ResearchFindings>> {
      let siteContent: unknown;
      let searchResults: unknown;
      try {
        siteContent = await input.tools.invoke("site-reader", { url: input.task.payload.siteUrl });
        searchResults = await input.tools.invoke("web-search", { query: input.task.payload.searchQuery });
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      let outcome: Awaited<ReturnType<ResearchModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, siteContent, searchResults);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      await input.memory.write("task", "findings", outcome.findings);

      return {
        status: "success",
        result: outcome.findings,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
