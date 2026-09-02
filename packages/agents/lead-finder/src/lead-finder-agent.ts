import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Track A (client acquisition) §2 — root of this track's graph, no
// dependencies. Finds candidate digital agencies matching the configured
// ICP (2–20 employees, PPC offered but not the core service) and records
// each one as a `prospect_agency` row via the "prospect-store" tool. Does
// NOT judge whether a candidate is actually a good fit — that's Lead
// Scorer's job, once Agency Researcher has gathered real facts about it.
export interface LeadCandidate {
  readonly name: string;
  readonly websiteUrl: string;
  readonly country?: string;
  readonly employeeCountEstimate?: number;
}

export interface LeadFinderResult {
  readonly candidates: readonly LeadCandidate[];
  readonly prospectAgencyIds: readonly string[];
}

export interface LeadFinderTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly countries: readonly string[];
  readonly employeeRangeHint?: string;
  readonly seedQueries?: readonly string[];
}

// The actual LLM call is injected — this package wires the contract
// together, it does not itself hold a Perplexity credential (see
// real-tools.ts's "web-search" case for the real implementation).
export type LeadFinderModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  searchResults: readonly string[],
) => Promise<{ readonly candidates: readonly LeadCandidate[]; readonly decisionSummary: string }>;

export function createLeadFinderAgent(callModel: LeadFinderModelCaller) {
  return defineAgent<LeadFinderTaskPayload, LeadFinderResult>({
    roleId: "lead-finder",
    displayName: "Lead Finder",
    purpose: "Найти кандидатов — digital-агентства, для которых PPC не основная услуга.",
    responsibility:
      "Только поиск и первичная запись кандидатов — не глубокая квалификация (Agency Researcher) и не оценка пригодности (Lead Scorer).",
    completionCriteria: "Каждый найденный кандидат записан в prospect_agency со статусом 'new'.",
    memoryLevels: ["task", "project"],
    toolIds: ["web-search", "prospect-store"],

    async handler(input: AgentInput<LeadFinderTaskPayload>): Promise<AgentOutput<LeadFinderResult>> {
      const queries = input.task.payload.seedQueries?.length
        ? input.task.payload.seedQueries
        : input.task.payload.countries.map(
            (country) => `digital marketing agencies in ${country} offering Google Ads/PPC as a secondary service, 2-20 employees`,
          );

      const searchResults: string[] = [];
      for (const query of queries) {
        try {
          const result = await input.tools.invoke("web-search", { query });
          searchResults.push(String(result));
        } catch (error) {
          return { status: "failed", error: error as AgentError };
        }
      }

      let outcome: Awaited<ReturnType<LeadFinderModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, searchResults);
      } catch (error) {
        return { status: "failed", error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true } };
      }

      const prospectAgencyIds: string[] = [];
      for (const candidate of outcome.candidates) {
        try {
          const created = (await input.tools.invoke("prospect-store", {
            action: "createProspectAgency",
            name: candidate.name,
            websiteUrl: candidate.websiteUrl,
            country: candidate.country,
            employeeCountEstimate: candidate.employeeCountEstimate,
            source: "lead-finder",
          })) as { id: string };
          prospectAgencyIds.push(created.id);
        } catch (error) {
          return { status: "failed", error: error as AgentError };
        }
      }

      await input.memory.write("task", "discovered-prospects", { candidates: outcome.candidates, prospectAgencyIds });

      return {
        status: "success",
        result: { candidates: outcome.candidates, prospectAgencyIds },
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
