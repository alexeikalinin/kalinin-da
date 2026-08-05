import { defineAgent, type AgentInput, type AgentOutput, type MemoryLevel, type RoleId } from "@ama/agent-framework";
import type { PromptBlocks } from "@ama/prompt-architecture";

// Agent Framework §4a — a service role, like Reflection, not a marketing
// role in the reference conveyor. Proposes a new role's spec by the same
// 11-element contract every role uses (Agent Framework §1); does not
// register or activate it — that step requires the user's explicit
// approval and lives outside this package entirely (there is nowhere in
// this codebase a proposal from here could even be written to without a
// human step in between, by design).
export interface ProposedRoleSpec {
  readonly roleId: RoleId;
  readonly displayName: string;
  readonly purpose: string;
  readonly responsibility: string;
  readonly completionCriteria: string;
  readonly memoryLevels: readonly MemoryLevel[];
  readonly toolIds: readonly string[];
  // Agent Framework §1: responsibility boundaries "проверяются на
  // пересечение с другими ролями" — surfaced explicitly rather than
  // silently assumed clean.
  readonly overlapWarnings: readonly string[];
}

export interface AgentArchitectTaskPayload {
  readonly prompt: PromptBlocks;
  readonly modelId: string;
  readonly roleDescription: string;
  readonly existingRoleIds: readonly RoleId[];
}

export type AgentArchitectModelCaller = (
  prompt: PromptBlocks,
  modelId: string,
  roleDescription: string,
  existingRoleIds: readonly RoleId[],
) => Promise<{ readonly proposal: ProposedRoleSpec; readonly decisionSummary: string }>;

export function createAgentArchitect(callModel: AgentArchitectModelCaller) {
  return defineAgent<AgentArchitectTaskPayload, ProposedRoleSpec>({
    roleId: "agent-architect",
    displayName: "Agent Architect",
    purpose: "Предложить спецификацию новой роли по единому контракту Agent Framework.",
    responsibility:
      "Только предложение — активация новой роли требует явного утверждения пользователя (Agent Framework §4a).",
    completionCriteria: "Черновик спецификации сформирован и передан на утверждение.",
    memoryLevels: [],
    toolIds: [],

    async handler(
      input: AgentInput<AgentArchitectTaskPayload>,
    ): Promise<AgentOutput<ProposedRoleSpec>> {
      let outcome: Awaited<ReturnType<AgentArchitectModelCaller>>;
      try {
        outcome = await callModel(
          input.task.payload.prompt,
          input.task.payload.modelId,
          input.task.payload.roleDescription,
          input.task.payload.existingRoleIds,
        );
      } catch (error) {
        return {
          status: "failed",
          error: { code: "MODEL_CALL_FAILED", message: String(error), retryable: true },
        };
      }

      // No memory.write here on purpose (§4a) — the proposal is not
      // persisted or activated by this role; it's only ever the
      // AgentOutput.result, for a human to review and act on.
      return {
        status: "success",
        result: outcome.proposal,
        decisions: [{ summary: outcome.decisionSummary }],
      };
    },
  });
}
