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
  // Realistic search phrases the target audience would type to find this
  // kind of business — seeds for a downstream real frequency/volume check
  // (Google Keyword Planner / Yandex Wordstat), not final ad keywords.
  // Optional: only produced when the model can ground them in the real
  // site content/search results already fetched above; consumed by the
  // PPC agent when it depends on this Research task.
  readonly candidateKeywords?: readonly string[];
}

export interface ResearchTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly siteUrl: string;
  // Optional refinement only (e.g. a region, or the marketing task at
  // hand) — folded onto the site content, never the sole basis for the
  // search query. A caller-authored topic guess written before the site
  // was ever read produced a real, wrong-niche search in the 2026-08-27
  // belseltur.com pilot run (a logistics/customs company searched as if it
  // were a tourism business). The query now always grounds in the real,
  // just-fetched site content first.
  readonly searchQuery?: string;
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
        // Site first, always — the search query is derived from what the
        // site actually says, not guessed by whoever kicked off this Task.
        siteContent = await input.tools.invoke("site-reader", { url: input.task.payload.siteUrl });
        const hint = input.task.payload.searchQuery;
        const query =
          `Рынок, конкуренты и типичные рекламные показатели (CTR, CPC, конверсия) для бизнеса, ` +
          `судя по содержимому его сайта:\n${String(siteContent).slice(0, 800)}` +
          (hint ? `\n\nДополнительный фокус: ${hint}` : "");
        searchResults = await input.tools.invoke("web-search", { query });
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
