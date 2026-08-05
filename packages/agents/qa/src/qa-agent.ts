import { defineAgent, type AgentInput, type AgentOutput } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Agent Framework §4/Workflow Engine §4 — QA does not edit anything itself;
// it produces a verdict, and Workflow Engine (not built yet) is what turns
// "not approved" into the *reviewed* Task going back for revision. QA's own
// Task status is "success" once the review itself completed — "needs
// revision" as a concept applies to the artifact being reviewed, not to
// QA's own work.
//
// Memory System §1 documents QA as one of the few roles allowed to read
// another Task's Task Memory directly ("читает ... QA Agent при
// проверке") — @ama/memory's agent-port doesn't implement cross-task reads
// yet (each Task only sees its own Task Memory, see its README). Until it
// does, the dispatcher hands QA the artifact to review directly as part of
// its payload, the same way a human reviewer would be handed a document
// rather than given raw access to someone else's workspace.
export interface QaVerdict {
  readonly approved: boolean;
  readonly issues: readonly string[];
}

export interface QaTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly artifactToReview: unknown;
  readonly checklistId: string;
}

export type QaModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  artifact: unknown,
  checklistId: string,
) => Promise<{ readonly verdict: QaVerdict; readonly decisionSummary: string }>;

export function createQaAgent(callModel: QaModelCaller) {
  return defineAgent<QaTaskPayload, QaVerdict>({
    roleId: "qa",
    displayName: "QA Agent",
    purpose: "Проверить результат другой роли по чек-листу качества.",
    responsibility:
      "Только проверка качества — исправление делает исходный агент, не QA (Agent Framework §4).",
    completionCriteria: "Вердикт (approved / issues) сформирован.",
    memoryLevels: ["task", "project"],
    toolIds: [],

    async handler(input: AgentInput<QaTaskPayload>): Promise<AgentOutput<QaVerdict>> {
      let outcome: Awaited<ReturnType<QaModelCaller>>;
      try {
        outcome = await callModel(
          input.task.payload.prompt,
          input.task.payload.modelId,
          input.task.payload.artifactToReview,
          input.task.payload.checklistId,
        );
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      await input.memory.write("project", "qa-verdict", outcome.verdict);

      return {
        status: "success",
        result: outcome.verdict,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
