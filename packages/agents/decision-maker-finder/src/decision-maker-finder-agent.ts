import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Track A §2 — finds the person most likely to decide on outsourcing PPC
// fulfillment (founder/owner/head of marketing/PPC director, in that
// priority order — never a random employee) and, where publicly visible,
// their business email. Does not fabricate emails: anything not directly
// confirmed on the agency's own site is marked emailConfidence:'guessed' or
// left unset ('unknown'), matching prospect-store's DecisionMakerInput
// contract.
export interface DecisionMakerFound {
  readonly fullName: string;
  readonly title?: string;
  readonly linkedinUrl?: string;
  readonly email?: string;
  readonly emailConfidence: "verified" | "guessed" | "unknown";
  readonly source?: string;
}

export interface DecisionMakerFinderResult {
  readonly decisionMakers: readonly DecisionMakerFound[];
  readonly decisionMakerIds: readonly string[];
}

export interface DecisionMakerFinderTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly prospectAgencyId: string;
  readonly websiteUrl: string;
}

export type DecisionMakerFinderModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  siteContent: unknown,
  searchResults: unknown,
) => Promise<{ readonly decisionMakers: readonly DecisionMakerFound[]; readonly decisionSummary: string }>;

export function createDecisionMakerFinderAgent(callModel: DecisionMakerFinderModelCaller) {
  return defineAgent<DecisionMakerFinderTaskPayload, DecisionMakerFinderResult>({
    roleId: "decision-maker-finder",
    displayName: "Decision Maker Finder",
    purpose: "Найти вероятного decision maker в агентстве-проспекте и, если возможно, его публичный email.",
    responsibility:
      "Только поиск контакта — не оценка пригодности агентства (Lead Scorer) и не написание письма (Outreach Copywriter). Никогда не выдумывает email.",
    completionCriteria: "Хотя бы одна попытка поиска зафиксирована — найденные контакты записаны в decision_maker.",
    memoryLevels: ["task", "project"],
    toolIds: ["web-search", "site-reader", "prospect-store"],

    async handler(input: AgentInput<DecisionMakerFinderTaskPayload>): Promise<AgentOutput<DecisionMakerFinderResult>> {
      let siteContent: unknown;
      let searchResults: unknown;
      try {
        siteContent = await input.tools.invoke("site-reader", { url: input.task.payload.websiteUrl });
        const query = `Who is the founder, owner, or head of marketing/PPC at the agency behind ${input.task.payload.websiteUrl}? Look for a name, title, and LinkedIn or public business email.`;
        searchResults = await input.tools.invoke("web-search", { query });
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      let outcome: Awaited<ReturnType<DecisionMakerFinderModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, siteContent, searchResults);
      } catch (error) {
        return { status: "failed", error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true } };
      }

      const decisionMakerIds: string[] = [];
      for (const dm of outcome.decisionMakers) {
        try {
          const created = (await input.tools.invoke("prospect-store", {
            action: "addDecisionMaker",
            prospectAgencyId: input.task.payload.prospectAgencyId,
            fullName: dm.fullName,
            title: dm.title,
            linkedinUrl: dm.linkedinUrl,
            email: dm.email,
            emailConfidence: dm.emailConfidence,
            source: dm.source,
          })) as { id: string };
          decisionMakerIds.push(created.id);
        } catch (error) {
          return { status: "failed", error: error as AgentError };
        }
      }

      await input.memory.write("task", "decision-makers", { decisionMakers: outcome.decisionMakers, decisionMakerIds });

      return {
        status: "success",
        result: { decisionMakers: outcome.decisionMakers, decisionMakerIds },
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
