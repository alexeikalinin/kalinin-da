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
  readonly analyticsToolId: string; // e.g. "google-analytics"
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
    toolIds: ["google-analytics"],

    async handler(input: AgentInput<AnalyticsTaskPayload>): Promise<AgentOutput<AnalyticsReport>> {
      let rawMetrics: unknown;
      try {
        rawMetrics = await input.tools.invoke(input.task.payload.analyticsToolId, {});
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
