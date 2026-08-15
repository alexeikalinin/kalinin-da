import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Tool Integration §1: "Analytics Agent | Чтение данных из аналитической
// системы клиента." Depends on PPC and Media Buyer in the reference graph
// (Workflow Engine §1) — reads their archived output from Project Memory
// (Memory System §1: Task Memory is archived into Project Memory on
// completion), not their private Task Memory directly.
export interface AnalyticsReport {
  readonly summary: string;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface AnalyticsTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly analyticsToolIds: readonly string[]; // e.g. ["google-analytics", "yandex-metrika"]
  readonly projectDisplayName: string; // identifies the project's tracking resources (GA4 property, GTM container, Metrika counter)
  readonly siteUrl: string;
  // The client's own accounts, if known — falls back to the agency's
  // sandbox account when a Project doesn't supply these (see
  // real-tools.ts).
  readonly gtmAccountId?: string;
  readonly gaAccountId?: string;
  readonly googleAdsCustomerId?: string;
}

export type AnalyticsModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  rawMetrics: unknown,
) => Promise<{ readonly report: AnalyticsReport; readonly decisionSummary: string }>;

export function createAnalyticsAgent(callModel: AnalyticsModelCaller) {
  return defineAgent<AnalyticsTaskPayload, AnalyticsReport>({
    roleId: "analytics",
    displayName: "Analytics Agent",
    purpose: "Оценить эффективность запущенных кампаний по данным аналитики клиента.",
    responsibility: "Только анализ и отчётность по уже запущенным кампаниям, не их настройка.",
    completionCriteria: "Отчёт проходит проверку QA Agent.",
    memoryLevels: ["task", "project", "client_kb"],
    toolIds: ["google-analytics", "yandex-metrika", "datalens"],

    async handler(input: AgentInput<AnalyticsTaskPayload>): Promise<AgentOutput<AnalyticsReport>> {
      const rawMetrics: Record<string, unknown> = {};
      try {
        for (const toolId of input.task.payload.analyticsToolIds) {
          rawMetrics[toolId] = await input.tools.invoke(toolId, {
            projectDisplayName: input.task.payload.projectDisplayName,
            siteUrl: input.task.payload.siteUrl,
            gtmAccountId: input.task.payload.gtmAccountId,
            gaAccountId: input.task.payload.gaAccountId,
            googleAdsCustomerId: input.task.payload.googleAdsCustomerId,
          });
        }
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      let outcome: Awaited<ReturnType<AnalyticsModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, rawMetrics);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      await input.memory.write("project", "analytics-report", outcome.report);

      return {
        status: "success",
        result: outcome.report,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
