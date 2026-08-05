import { defineAgent, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Agent Framework §3 explicitly draws this boundary against PPC Agent:
// "не медиапланирование бюджета (это Media Buyer Agent)". This role owns
// the overall spend plan; PPC owns the per-platform campaign configuration.
// They run in parallel in the reference graph (Workflow Engine §1), so
// deliberately no dependency between the two in this implementation either
// — Media Buyer's plan lands in Project Memory for Analytics/Report to use,
// it does not feed PPC's decision within the same Project run.
export interface MediaBudgetPlan {
  readonly totalBudget: number;
  readonly allocation: Readonly<Record<string, number>>; // channel -> share of totalBudget
}

export interface MediaBuyerTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
}

export type MediaBuyerModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
) => Promise<{ readonly plan: MediaBudgetPlan; readonly decisionSummary: string }>;

export function createMediaBuyerAgent(callModel: MediaBuyerModelCaller) {
  return defineAgent<MediaBuyerTaskPayload, MediaBudgetPlan>({
    roleId: "media-buyer",
    displayName: "Media Buyer Agent",
    purpose: "Спланировать общий медиа-бюджет и его распределение по каналам.",
    responsibility:
      "Только стратегия и объём бюджета — не техническая настройка кампаний (PPC Agent) и не тексты объявлений (Copywriter Agent).",
    completionCriteria: "План бюджета проходит проверку QA Agent.",
    memoryLevels: ["task", "project", "client_kb"],
    toolIds: [], // a planning role — no external system to call, same as Copywriter's likely-empty tool list (Tool Integration §1)

    async handler(input: AgentInput<MediaBuyerTaskPayload>): Promise<AgentOutput<MediaBudgetPlan>> {
      let outcome: Awaited<ReturnType<MediaBuyerModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      // Written to Project Memory (Memory System §1: "что уже сделали
      // другие агенты в этом Project") so Analytics/Report can read it later.
      await input.memory.write("project", "media-budget-plan", outcome.plan);

      return {
        status: "success",
        result: outcome.plan,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
