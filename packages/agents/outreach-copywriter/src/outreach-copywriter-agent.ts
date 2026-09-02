import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Track A §2 — writes a personalized outreach email draft from a
// prospect's already-collected facts and decision maker. Distinct from
// packages/agents/copywriter's Copywriter Agent: that role drafts ad copy
// from campaign briefs (zero tools, different payload/output shape) — this
// one drafts a single cold-outreach email tied to a specific
// outreach_message row, grounded in prospect-store facts rather than a
// brief string. Never sends anything itself — only produces a 'drafted'
// row; Compliance Checker and human approval sit between this and any send.
export interface OutreachDraft {
  readonly subject: string;
  readonly bodyText: string;
}

export interface OutreachCopywriterResult extends OutreachDraft {
  readonly outreachMessageId: string;
}

export interface OutreachCopywriterTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly prospectAgencyId: string;
  readonly decisionMakerId?: string;
}

export type OutreachCopywriterModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  facts: unknown,
  decisionMakers: unknown,
) => Promise<OutreachDraft & { readonly decisionSummary: string }>;

export function createOutreachCopywriterAgent(callModel: OutreachCopywriterModelCaller) {
  return defineAgent<OutreachCopywriterTaskPayload, OutreachCopywriterResult>({
    roleId: "outreach-copywriter",
    displayName: "Outreach Copywriter",
    purpose: "Написать персонализированное outreach-письмо для проспекта на основе собранных фактов.",
    responsibility:
      "Только текст черновика — не отправка (human approval + email-outreach) и не проверка соответствия требованиям (Compliance Checker).",
    completionCriteria: "Черновик записан в outreach_message со статусом 'drafted'.",
    memoryLevels: ["task", "project"],
    toolIds: ["prospect-store"],

    async handler(input: AgentInput<OutreachCopywriterTaskPayload>): Promise<AgentOutput<OutreachCopywriterResult>> {
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

      let outcome: Awaited<ReturnType<OutreachCopywriterModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, facts, decisionMakers);
      } catch (error) {
        return { status: "failed", error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true } };
      }

      let outreachMessageId: string;
      try {
        const created = (await input.tools.invoke("prospect-store", {
          action: "createOutreachDraft",
          prospectAgencyId: input.task.payload.prospectAgencyId,
          decisionMakerId: input.task.payload.decisionMakerId,
          subject: outcome.subject,
          bodyText: outcome.bodyText,
        })) as { id: string };
        outreachMessageId = created.id;
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      await input.memory.write("task", "outreach-draft", { subject: outcome.subject, bodyText: outcome.bodyText, outreachMessageId });

      return {
        status: "success",
        result: { subject: outcome.subject, bodyText: outcome.bodyText, outreachMessageId },
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
