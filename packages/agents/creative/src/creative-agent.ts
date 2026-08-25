import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Filled in 2026-08-21 — the gap Agent Framework §1 warns every new role
// must be checked against: no existing role owned "рекламные визуальные и
// видео-креативы". Explicit boundary against the three roles it could be
// confused with (Agent Framework §1, "Ответственность"):
// - Copywriter Agent: text only, not visuals.
// - Media Buyer Agent: budget/audience strategy, not creative production.
// - UI Designer Agent: product UI (site/landing), not ad creative.
// - PPC Agent: configures campaigns with whatever creative it's given,
//   does not produce it.
export interface CreativeAssets {
  readonly assetRefs: readonly string[]; // one ref per requested channel/format
  readonly notes: string;
}

export interface CreativeTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly creativeToolId: string;
  // Ad channels needing a creative format, e.g. ["google-ads", "vk-ads"] —
  // same convention as PpcTaskPayload's `channels` (Agent Framework §3).
  readonly channels: readonly string[];
}

export type CreativeModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  toolOutput: unknown,
) => Promise<{ readonly assets: CreativeAssets; readonly decisionSummary: string }>;

export function createCreativeAgent(callModel: CreativeModelCaller) {
  return defineAgent<CreativeTaskPayload, CreativeAssets>({
    roleId: "creative",
    displayName: "Creative Agent",
    purpose:
      "Создать визуальные и видео-креативы (баннеры, изображения, короткие видео) для рекламных кампаний под конкретные форматы площадок.",
    responsibility:
      "Только производство визуальных/видео рекламных материалов — не тексты объявлений (Copywriter Agent), не бюджет/аудитория (Media Buyer Agent), не настройка и запуск кампаний (PPC Agent), не продуктовый UI/UX сайта клиента (UI Designer/UX Agent).",
    completionCriteria:
      "Материалы проходят проверку QA Agent — соответствие техтребованиям площадки (размер/формат/длительность) и бренд-гайдлайнам клиента.",
    memoryLevels: ["task", "project", "client_kb"],
    toolIds: ["creative-generation"],

    async handler(input: AgentInput<CreativeTaskPayload>): Promise<AgentOutput<CreativeAssets>> {
      // Same "call the tool before the model" order as UI Designer's
      // design-tool (Agent Framework §3's own worked pattern for a
      // production role) — the model is asked to explain/refine what the
      // tool actually produced, not to invent asset refs itself.
      let toolOutput: unknown;
      try {
        toolOutput = await input.tools.invoke(input.task.payload.creativeToolId, {
          briefText: input.task.payload.prompt.task,
          channels: input.task.payload.channels,
        });
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      let outcome: Awaited<ReturnType<CreativeModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, toolOutput);
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      // Task-level, like PPC's campaign-summary and UI Designer's
      // ui-design — archived into Project Memory by the Workflow Engine
      // after success (see @ama/memory's archiveTaskIntoProject), so PPC
      // can read it back as project context on its own Task.
      await input.memory.write("task", "creative-assets", outcome.assets);

      return {
        status: "success",
        result: outcome.assets,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
