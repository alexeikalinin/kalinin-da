import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Track A §2 — classifies an inbound reply to an outreach email. Triggered
// either by the Resend inbound webhook or, until that's wired (MVP
// fallback — see docs/05-operations/resend-domain-warmup.md §4), by manual
// reply logging. Pure LLM classification, no tools beyond recording the
// result — prospect-store.recordReplyClassification already handles the
// "unsubscribe_request -> add to suppression_list immediately" side effect,
// so this agent does not duplicate that logic.
export type ReplyCategory =
  | "interested"
  | "not_interested"
  | "not_relevant"
  | "ooo"
  | "unsubscribe_request"
  | "question"
  | "other";

export interface ReplyClassifierResult {
  readonly category: ReplyCategory;
  readonly confidence: "low" | "medium" | "high";
}

export interface ReplyClassifierTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly outreachMessageId: string;
  readonly replyText: string;
}

export type ReplyClassifierModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  replyText: string,
) => Promise<{
  readonly category: ReplyCategory;
  readonly confidence: "low" | "medium" | "high";
  readonly decisionSummary: string;
}>;

export function createReplyClassifierAgent(callModel: ReplyClassifierModelCaller) {
  return defineAgent<ReplyClassifierTaskPayload, ReplyClassifierResult>({
    roleId: "reply-classifier",
    displayName: "Reply Classifier",
    purpose: "Классифицировать входящий ответ на outreach-письмо по категории.",
    responsibility: "Только классификация — не подготовка follow-up и не автоматическая отправка.",
    completionCriteria: "reply_classification записана; при unsubscribe_request адрес немедленно попадает в suppression_list.",
    memoryLevels: ["task", "project"],
    toolIds: ["prospect-store"],

    async handler(input: AgentInput<ReplyClassifierTaskPayload>): Promise<AgentOutput<ReplyClassifierResult>> {
      let outcome: Awaited<ReturnType<ReplyClassifierModelCaller>>;
      try {
        outcome = await callModel(input.task.payload.prompt, input.task.payload.modelId, input.task.payload.replyText);
      } catch (error) {
        return { status: "failed", error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true } };
      }

      try {
        await input.tools.invoke("prospect-store", {
          action: "recordReplyClassification",
          outreachMessageId: input.task.payload.outreachMessageId,
          category: outcome.category,
          confidence: outcome.confidence,
        });
        // A positive/interested reply is itself real signal about the
        // sending prospect's status, worth reflecting immediately rather
        // than waiting on a separate step to notice it — matches
        // lead-scorer's own stance of owning its status consequence.
        if (outcome.category === "interested") {
          const message = (await input.tools.invoke("prospect-store", {
            action: "getOutreachMessage",
            outreachMessageId: input.task.payload.outreachMessageId,
          })) as { prospectAgencyId: string };
          await input.tools.invoke("prospect-store", {
            action: "updateProspectStatus",
            prospectAgencyId: message.prospectAgencyId,
            status: "replied",
          });
        }
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      await input.memory.write("task", "reply-classification", { category: outcome.category, confidence: outcome.confidence });

      return {
        status: "success",
        result: { category: outcome.category, confidence: outcome.confidence },
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
