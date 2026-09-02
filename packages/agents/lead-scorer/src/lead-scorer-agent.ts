import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Track A §2 — explainable 0–100 score of how good a fit a researched
// prospect is as a white-label PPC partner. Reads what Agency Researcher
// and Decision Maker Finder already found (via "prospect-store"); does not
// gather new facts itself. Below-threshold scores short-circuit the rest
// of the graph — this agent moves the prospect straight to 'disqualified'
// rather than letting Outreach Copywriter draft a wasted email, matching
// the reference-scenario pattern of a role owning its own completion
// consequence rather than leaving it to the caller.
const DISQUALIFY_THRESHOLD = 40;

export interface LeadScoreResult {
  readonly score: number;
  readonly scoreBreakdown: Readonly<Record<string, number>>;
  readonly disqualified: boolean;
}

export interface LeadScorerTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly prospectAgencyId: string;
}

export type LeadScorerModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  facts: unknown,
  decisionMakers: unknown,
) => Promise<{
  readonly score: number;
  readonly scoreBreakdown: Readonly<Record<string, number>>;
  readonly decisionSummary: string;
}>;

export function createLeadScorerAgent(callModel: LeadScorerModelCaller) {
  return defineAgent<LeadScorerTaskPayload, LeadScoreResult>({
    roleId: "lead-scorer",
    displayName: "Lead Scorer",
    purpose: "Оценить проспекта как кандидата в white-label PPC партнёры по объяснимой шкале 0–100.",
    responsibility:
      "Только скоринг на основе уже собранных фактов — не сбор новых фактов (Agency Researcher/Decision Maker Finder) и не решение об отправке письма.",
    completionCriteria: "Записан lead_score со score_breakdown; при score < 40 проспект переведён в disqualified.",
    memoryLevels: ["task", "project"],
    toolIds: ["prospect-store"],

    async handler(input: AgentInput<LeadScorerTaskPayload>): Promise<AgentOutput<LeadScoreResult>> {
      let facts: unknown;
      let decisionMakers: unknown;
      try {
        facts = await input.tools.invoke("prospect-store", {
          action: "getResearchFacts",
          prospectAgencyId: input.task.payload.prospectAgencyId,
        });
        decisionMakers = await input.tools.invoke("prospect-store", {
          action: "getDecisionMakers",
          prospectAgencyId: input.task.payload.prospectAgencyId,
        });
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      let outcome: Awaited<ReturnType<LeadScorerModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, facts, decisionMakers);
      } catch (error) {
        return { status: "failed", error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true } };
      }

      const disqualified = outcome.score < DISQUALIFY_THRESHOLD;
      try {
        await input.tools.invoke("prospect-store", {
          action: "recordLeadScore",
          prospectAgencyId: input.task.payload.prospectAgencyId,
          score: outcome.score,
          scoreBreakdown: outcome.scoreBreakdown,
        });
        if (disqualified) {
          await input.tools.invoke("prospect-store", {
            action: "updateProspectStatus",
            prospectAgencyId: input.task.payload.prospectAgencyId,
            status: "disqualified",
            disqualifyReason: `Score ${outcome.score} below threshold ${DISQUALIFY_THRESHOLD}`,
          });
        } else {
          await input.tools.invoke("prospect-store", {
            action: "updateProspectStatus",
            prospectAgencyId: input.task.payload.prospectAgencyId,
            status: "qualified",
          });
        }
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      await input.memory.write("task", "lead-score", { score: outcome.score, scoreBreakdown: outcome.scoreBreakdown, disqualified });

      return {
        status: "success",
        result: { score: outcome.score, scoreBreakdown: outcome.scoreBreakdown, disqualified },
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
