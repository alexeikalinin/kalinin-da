import { defineAgent, type AgentError, type AgentInput, type AgentOutput } from "@ama/agent-framework";

// Track A §2 — the mandatory gate between a drafted outreach email and
// human approval. Deliberately NOT model-driven: per the plan (§4 MVP
// scope), this is "a mechanical checklist, not a model judgment call" —
// suppression-list membership and a few CAN-SPAM mechanics (non-empty
// subject, an opt-out phrase present, a sane word count) are simple enough
// to check in plain TypeScript, and doing so means this gate can never be
// talked out of rejecting something by a persuasive-sounding model output.
// No callModel/ModelCaller injection — unlike every other agent in this
// track, there is no LLM call in this role at all.
const MIN_WORDS = 40;
const MAX_WORDS = 200;
// Several independent phrasings, not one exact sentence — a real
// personalized draft will phrase this differently every time (see
// outreach-copywriter's own "no fake personalization" stance), so this
// checks for opt-out INTENT via a few common fragments rather than one
// rigid phrase.
const OPT_OUT_PATTERNS = /\b(unsubscribe|opt.?out|remove you from|rather not|won.?t follow up|no worries if not|feel free to (ignore|say no))\b/i;

export type ComplianceOutcome = "approved" | "suppressed" | "revision_needed";

export interface ComplianceCheckResult {
  readonly outcome: ComplianceOutcome;
  readonly issues: readonly string[];
}

export interface ComplianceCheckerTaskPayload {
  readonly outreachMessageId: string;
}

interface OutreachMessageInfo {
  readonly subject: string | null;
  readonly bodyText: string;
  readonly prospectAgencyId: string;
  readonly decisionMakerId: string | null;
}

interface DecisionMakerInfo {
  readonly id: string;
  readonly email?: string;
}

function checkMechanics(message: OutreachMessageInfo): readonly string[] {
  const issues: string[] = [];
  if (!message.subject?.trim()) issues.push("Subject is empty.");
  const wordCount = message.bodyText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_WORDS) issues.push(`Body is too short (${wordCount} words, minimum ${MIN_WORDS}).`);
  if (wordCount > MAX_WORDS) issues.push(`Body is too long (${wordCount} words, maximum ${MAX_WORDS}).`);
  if (!OPT_OUT_PATTERNS.test(message.bodyText)) issues.push("No opt-out / unsubscribe phrasing found in the body.");
  return issues;
}

export function createComplianceCheckerAgent() {
  return defineAgent<ComplianceCheckerTaskPayload, ComplianceCheckResult>({
    roleId: "compliance-checker",
    displayName: "Compliance Checker",
    purpose: "Проверить черновик письма на suppression-list и базовый CAN-SPAM чек-лист перед одобрением человеком.",
    responsibility:
      "Только гейт перед approval — не пишет и не переписывает письмо (Outreach Copywriter). Решение основано на детерминированном чек-листе, не на суждении модели.",
    completionCriteria: "Черновик либо переведён в 'pending_approval', либо помечен 'suppressed', либо возвращён needs_revision с конкретной причиной.",
    memoryLevels: ["task", "project"],
    toolIds: ["prospect-store"],

    async handler(input: AgentInput<ComplianceCheckerTaskPayload>): Promise<AgentOutput<ComplianceCheckResult>> {
      let message: OutreachMessageInfo;
      try {
        message = (await input.tools.invoke("prospect-store", {
          action: "getOutreachMessage",
          outreachMessageId: input.task.payload.outreachMessageId,
        })) as OutreachMessageInfo;
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      if (message.decisionMakerId) {
        try {
          const decisionMakers = (await input.tools.invoke("prospect-store", {
            action: "getDecisionMakers",
            prospectAgencyId: message.prospectAgencyId,
          })) as readonly DecisionMakerInfo[];
          const recipient = decisionMakers.find((dm) => dm.id === message.decisionMakerId);
          if (recipient?.email) {
            const suppressionCheck = (await input.tools.invoke("prospect-store", {
              action: "isSuppressed",
              email: recipient.email,
            })) as { suppressed: boolean };
            if (suppressionCheck.suppressed) {
              await input.tools.invoke("prospect-store", {
                action: "updateOutreachMessageStatus",
                outreachMessageId: input.task.payload.outreachMessageId,
                status: "suppressed",
              });
              await input.memory.write("task", "compliance-check", { outcome: "suppressed", issues: [] });
              return {
                status: "success",
                result: { outcome: "suppressed", issues: [] },
                decisions: [{ summary: "Получатель в suppression list — письмо не будет отправлено." }],
              };
            }
          }
        } catch (error) {
          return { status: "failed", error: error as AgentError };
        }
      }

      const issues = checkMechanics(message);
      if (issues.length > 0) {
        await input.memory.write("task", "compliance-check", { outcome: "revision_needed", issues });
        return { status: "needs_revision", reason: issues.join(" ") };
      }

      try {
        await input.tools.invoke("prospect-store", {
          action: "updateOutreachMessageStatus",
          outreachMessageId: input.task.payload.outreachMessageId,
          status: "pending_approval",
        });
      } catch (error) {
        return { status: "failed", error: error as AgentError };
      }

      await input.memory.write("task", "compliance-check", { outcome: "approved", issues: [] });
      return {
        status: "success",
        result: { outcome: "approved", issues: [] },
        decisions: [{ summary: "Черновик прошёл механический чек-лист, готов к одобрению человеком." }],
      };
    },
  });
}
