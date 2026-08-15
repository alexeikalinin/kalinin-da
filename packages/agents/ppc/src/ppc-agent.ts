import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Agent Framework §3's own worked example, now actually implemented:
// "настроить рекламные кампании в Google Ads/Яндекс.Директ/VK Ads."
export interface PpcResult {
  readonly budgetSplit: Readonly<Record<string, number>>; // channel -> share, e.g. { "google-ads": 0.6, "vk-ads": 0.4 }
}

export interface PpcTaskPayload {
  // Assembled upstream (Prompt Architecture §1) — the agent consumes an
  // already-built prompt, it does not assemble its own (assemblePrompt
  // needs raw MemoryStore access that the standard MemoryPort intentionally
  // doesn't expose to an agent — see dispatch.ts).
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly channels: readonly string[];
  readonly googleAdsCustomerId?: string; // the client's own Ads account, if known
  readonly yandexClientLogin?: string; // the client's own Yandex Direct login, if known
  readonly metaAdAccountId?: string; // the client's own Meta ad account (format `act_<id>`), if known
}

// The actual LLM call is injected. This package wires the contract
// together; it does not itself hold API credentials or call a real
// provider — none exist in this environment. See README.
export type PpcModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
) => Promise<{ readonly result: PpcResult; readonly decisionSummary: string }>;

export function createPpcAgent(callModel: PpcModelCaller) {
  return defineAgent<PpcTaskPayload, PpcResult>({
    roleId: "ppc",
    displayName: "PPC Agent",
    purpose: "Настроить и запустить рекламные кампании клиента в указанных каналах.",
    responsibility:
      "Только настройка кампаний, не медиапланирование бюджета (Media Buyer Agent) и не тексты объявлений (Copywriter Agent).",
    completionCriteria: "Результат проходит проверку QA Agent по чек-листу качества PPC-раздела.",
    memoryLevels: ["task", "project", "client_kb"],
    toolIds: ["google-ads", "vk-ads", "yandex-direct", "meta-ads"],

    async handler(input: AgentInput<PpcTaskPayload>): Promise<AgentOutput<PpcResult>> {
      let outcome: Awaited<ReturnType<PpcModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      for (const channel of input.task.payload.channels) {
        try {
          await input.tools.invoke(channel, {
            budgetShare: outcome.result.budgetSplit[channel] ?? 0,
            googleAdsCustomerId: input.task.payload.googleAdsCustomerId,
            yandexClientLogin: input.task.payload.yandexClientLogin,
            metaAdAccountId: input.task.payload.metaAdAccountId,
          });
        } catch (error) {
          // Tool Integration §4 — createAgentToolPort already throws
          // AgentError-shaped failures after its own retry attempts.
          return { status: "failed", error: error as AgentError };
        }
      }

      await input.memory.write("task", "campaign-summary", outcome.result);

      return {
        status: "success",
        result: outcome.result,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
