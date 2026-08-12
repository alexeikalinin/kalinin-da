import { defineAgent, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Glossary §2: "CEO — принимает Project, определяет стратегию и назначает
// Project Manager." The top of the reference conveyor — receives the raw
// Project input (Product Specification §1: URL, business description,
// product, task) and turns it into strategic direction for PM Agent to
// decompose into a graph. Does not decompose into Task itself (PM Agent's
// job) and does not execute anything.
export interface Strategy {
  readonly strategySummary: string;
  readonly priorityGoals: readonly string[];
}

export interface CeoTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly siteUrl: string;
  readonly businessDescription: string;
  readonly product: string;
  readonly marketingTask: string;
}

export type CeoModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  input: { siteUrl: string; businessDescription: string; product: string; marketingTask: string },
) => Promise<{ readonly strategy: Strategy; readonly decisionSummary: string }>;

export function createCeoAgent(callModel: CeoModelCaller) {
  return defineAgent<CeoTaskPayload, Strategy>({
    roleId: "ceo",
    displayName: "CEO Agent",
    purpose: "Принять Project, определить стратегию и передать её PM Agent для декомпозиции.",
    responsibility:
      "Только стратегическое направление — не декомпозиция на Task (PM Agent) и не исполнение отдельных ролей.",
    completionCriteria: "Стратегия сформулирована и доступна PM Agent через Project Memory.",
    memoryLevels: ["project", "client_kb"],
    toolIds: [],

    async handler(input: AgentInput<CeoTaskPayload>): Promise<AgentOutput<Strategy>> {
      let outcome: Awaited<ReturnType<CeoModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, {
          siteUrl: input.task.payload.siteUrl,
          businessDescription: input.task.payload.businessDescription,
          product: input.task.payload.product,
          marketingTask: input.task.payload.marketingTask,
        });
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      // Project Memory, not Task Memory — PM Agent runs as a separate Task
      // and needs to read this (Memory System §1, same convention as Media
      // Buyer's plan / UX's plan).
      await input.memory.write("project", "strategy", outcome.strategy);

      return {
        status: "success",
        result: outcome.strategy,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
