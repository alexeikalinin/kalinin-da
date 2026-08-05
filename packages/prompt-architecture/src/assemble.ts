import type { ExecutionTier, InvocationContext } from "@ama/agent-framework";
import type { Actor, MemoryStore } from "@ama/memory";
import { findRelevantLessons } from "@ama/learning";
import type { PromptBlocks } from "./blocks.ts";
import type { RoleTemplate } from "./template-registry.ts";

// Prompt Architecture §2 — Execution Tier changes depth, never structure:
// how many facts/lessons make it in, not which blocks exist. Placeholder
// numbers — same calibration status as every other threshold deferred
// across this codebase.
const DEPTH_LIMITS: Record<ExecutionTier, { readonly facts: number; readonly lessons: number }> = {
  fast: { facts: 3, lessons: 2 },
  standard: { facts: 10, lessons: 5 },
};

export interface AssemblePromptInput {
  readonly context: Readonly<InvocationContext>;
  readonly template: RoleTemplate;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  readonly domainFactKeys: readonly string[];
  readonly projectContextKeys: readonly string[];
}

function readStrings(
  store: MemoryStore,
  actor: Actor,
  level: "client_kb" | "domain_kb" | "project",
  tenantId: InvocationContext["tenantId"],
  keys: readonly string[],
): readonly string[] {
  return keys
    .map((key) => store.read(actor, { level, tenantId, key }))
    .filter((value): value is string => typeof value === "string");
}

// Prompt Architecture §1 — assembles the 7 blocks from their documented
// sources. Model selection and the provider-specific call format happen
// after this, in Cost Optimization / a provider adapter (§5) — this
// function never sees or depends on either.
export function assemblePrompt(
  store: MemoryStore,
  actor: Actor,
  input: AssemblePromptInput,
): PromptBlocks {
  const limits = DEPTH_LIMITS[input.context.executionTier];
  const tenantId = input.context.tenantId;

  const clientFacts = readStrings(store, actor, "client_kb", tenantId, input.clientFactKeys).slice(
    0,
    limits.facts,
  );
  const domainKnowledge = readStrings(store, actor, "domain_kb", tenantId, input.domainFactKeys);
  // Project Memory keys are namespaced by projectId — same convention as
  // @ama/memory's createAgentMemoryPort, so a second concurrent Project for
  // this tenant can never collide with this one on the same key.
  const projectContext = readStrings(
    store,
    actor,
    "project",
    tenantId,
    input.projectContextKeys.map((key) => `${input.context.projectId}:${key}`),
  );

  const pastExperience = findRelevantLessons(store, actor, input.context.roleId)
    .slice(0, limits.lessons)
    .map((lesson) => `${lesson.conclusion} [${lesson.confidence}]`);

  return {
    role: `${input.template.purpose} ${input.template.responsibility}`.trim(),
    task: input.taskDescription,
    clientFacts,
    domainKnowledge,
    pastExperience,
    projectContext,
    constraints: `Execution Tier: ${input.context.executionTier}.`,
  };
}
