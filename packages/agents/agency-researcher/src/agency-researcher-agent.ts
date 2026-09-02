import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Track A §2 — same site-first-then-grounded-search pattern as
// packages/agents/research's Research Agent (site-reader, then a search
// query grounded in what the site actually says, not a caller's guess) but
// a distinct role: the output shape (structured facts about PPC-secondary-
// service fit, team size signal, etc., written to prospect_research_fact)
// and the target (a prospect that has no `client` row yet) don't fit
// Research Agent's client-project-scoped contract.
export interface AgencyResearchFact {
  readonly factKey: string;
  readonly factValue: string;
  readonly sourceUrl?: string;
  readonly confidence?: "low" | "medium" | "high";
}

export interface AgencyResearcherResult {
  readonly facts: readonly AgencyResearchFact[];
}

export interface AgencyResearcherTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly prospectAgencyId: string;
  readonly websiteUrl: string;
}

export type AgencyResearcherModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  siteContent: unknown,
  searchResults: unknown,
) => Promise<{ readonly facts: readonly AgencyResearchFact[]; readonly decisionSummary: string }>;

export function createAgencyResearcherAgent(callModel: AgencyResearcherModelCaller) {
  return defineAgent<AgencyResearcherTaskPayload, AgencyResearcherResult>({
    roleId: "agency-researcher",
    displayName: "Agency Researcher",
    purpose: "Изучить сайт агентства-проспекта и собрать структурированные факты о её бизнесе.",
    responsibility:
      "Только сбор фактов с указанием источника — не оценка пригодности (Lead Scorer) и не поиск контактов (Decision Maker Finder).",
    completionCriteria: "Находки записаны в prospect_research_fact, проспект переведён в статус 'researching'.",
    memoryLevels: ["task", "project"],
    toolIds: ["site-reader", "web-search", "prospect-store"],

    async handler(input: AgentInput<AgencyResearcherTaskPayload>): Promise<AgentOutput<AgencyResearcherResult>> {
      let siteContent: unknown;
      let searchResults: unknown;
      try {
        siteContent = await input.tools.invoke("site-reader", { url: input.task.payload.websiteUrl });
        const query =
          `What services does this digital agency offer, who are its clients, and is Google Ads/PPC a secondary ` +
          `service rather than its core offering? Based on:\n${String(siteContent).slice(0, 800)}`;
        searchResults = await input.tools.invoke("web-search", { query });
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      let outcome: Awaited<ReturnType<AgencyResearcherModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, siteContent, searchResults);
      } catch (error) {
        return { status: "failed", error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true } };
      }

      try {
        await input.tools.invoke("prospect-store", {
          action: "addResearchFacts",
          prospectAgencyId: input.task.payload.prospectAgencyId,
          facts: outcome.facts,
        });
        await input.tools.invoke("prospect-store", {
          action: "updateProspectStatus",
          prospectAgencyId: input.task.payload.prospectAgencyId,
          status: "researching",
        });
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      await input.memory.write("task", "research-facts", outcome.facts);

      return {
        status: "success",
        result: { facts: outcome.facts },
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
