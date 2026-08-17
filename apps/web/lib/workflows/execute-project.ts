import { FatalError } from "workflow";
import type { ExecutionTier } from "@ama/agent-framework";
import {
  getReadyNodes,
  hasHaltedNode,
  isGraphComplete,
  withNodeState,
  MAX_RETRIES,
  type GraphState,
  type NodeState,
  type WorkflowGraph,
  type WorkflowNode,
} from "@ama/workflow-engine";

// Tool Integration / Recovery §3 — the real durable executor for a Project's
// graph, replacing what used to be a single synchronous executeGraph() call
// inside the approve HTTP request (see api-application-layer.md Decision
// Log, 2026-08-17). Runs as a Vercel Workflow DevKit workflow, started via
// start() from the approve route and returning immediately.
//
// Real, hard-won finding: "use workflow"/"use step" functions run in a
// genuinely separate execution context from the rest of this Next.js app —
// confirmed even under Workflow DevKit's local dev backend ("Local World"),
// not just in a real distributed Vercel deployment. They do NOT share the
// in-process ProjectRecord map (lib/project-store.ts) or MemoryStore
// singletons (lib/singletons.ts) that the app's own HTTP routes use — a
// direct getProject() call from inside this file returns nothing, even
// though the same process's /api/projects/[id] route sees the record fine.
// So every read/write of Project state here goes over real HTTP, into the
// small internal routes under app/api/internal/projects/[id]/*, which run
// as ordinary Next.js route handlers in the app's own process (same
// mechanism the approve/reject/output routes already rely on). This also
// means fetch(), not a direct function call, is the actual data-flow
// boundary Recovery's retry/escalate/block decision has to cross.
const INTERNAL_BASE_URL = process.env.AMA_INTERNAL_BASE_URL ?? "http://localhost:3000";

function internalUrl(path: string): string {
  return `${INTERNAL_BASE_URL}${path}`;
}

interface GraphSnapshot {
  readonly nodes: readonly WorkflowNode[];
  readonly states: ReadonlyArray<readonly [string, NodeState]>;
  readonly executionTier: ExecutionTier;
}

async function fetchGraphSnapshot(projectId: string): Promise<GraphSnapshot> {
  "use step";
  const response = await fetch(internalUrl(`/api/internal/projects/${projectId}/graph`));
  if (!response.ok) {
    throw new FatalError(`Project "${projectId}" not found or has no plan yet`);
  }
  return (await response.json()) as GraphSnapshot;
}

// A real role's LLM call can legitimately take 15-30s+ (research/copywriter
// with real tool calls). No timeout was set explicitly before; found by
// testing that a call in this range could still get aborted client-side —
// signal is set generously here rather than left to whatever ambient
// default fetch() would otherwise pick up.
const RUN_NODE_TIMEOUT_MS = 180_000;

async function runNodeHttp(projectId: string, node: WorkflowNode): Promise<void> {
  const response = await fetch(internalUrl(`/api/internal/projects/${projectId}/run-node`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(node),
    signal: AbortSignal.timeout(RUN_NODE_TIMEOUT_MS),
  });
  const data = (await response.json()) as { status: string; retryable?: boolean; message?: string; error?: string };
  if (!response.ok) {
    throw new FatalError(data.error ?? `run-node request failed for task "${node.taskId}"`);
  }
  if (data.status === "success") return;

  // Recovery §3: non-retryable -> block immediately, no retry attempts.
  // Retryable -> a plain throw lets Workflow DevKit retry per the calling
  // step function's maxRetries; once exhausted, this propagates up as the
  // "escalate" outcome (the workflow body below distinguishes the two by
  // checking `instanceof FatalError`).
  if (!data.retryable) throw new FatalError(data.message ?? "Task failed");
  throw new Error(data.message ?? "Task failed");
}

async function runNodeStepFast(projectId: string, node: WorkflowNode): Promise<void> {
  "use step";
  return runNodeHttp(projectId, node);
}
runNodeStepFast.maxRetries = MAX_RETRIES.fast;

async function runNodeStepStandard(projectId: string, node: WorkflowNode): Promise<void> {
  "use step";
  return runNodeHttp(projectId, node);
}
runNodeStepStandard.maxRetries = MAX_RETRIES.standard;

function runNodeStepForTier(tier: ExecutionTier, projectId: string, node: WorkflowNode): Promise<void> {
  return tier === "fast" ? runNodeStepFast(projectId, node) : runNodeStepStandard(projectId, node);
}

async function finalizeStep(
  projectId: string,
  outcome: "completed" | "blocked" | "failed",
  taskId?: string,
): Promise<void> {
  "use step";
  await fetch(internalUrl(`/api/internal/projects/${projectId}/finalize`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome, taskId }),
  });
}

// The durable workflow itself. Takes only projectId — start() args must be
// serializable, and this function's body can replay as steps resolve — so
// it never touches ProjectRecord directly; it fetches an initial snapshot
// via a step, then tracks graph readiness in a local, workflow-scoped
// GraphState (pure functions from @ama/workflow-engine, no I/O). The
// *live*, pollable progress clients see via GET /api/projects/[id] comes
// from run-node/route.ts mutating the real ProjectRecord.graphState
// directly as each node transitions — this local copy is only for the
// workflow's own loop control.
export async function executeProjectWorkflow(projectId: string): Promise<void> {
  "use workflow";
  const snapshot = await fetchGraphSnapshot(projectId);
  const graph: WorkflowGraph = { nodes: snapshot.nodes };
  let state: GraphState = { states: new Map(snapshot.states) };
  const tier = snapshot.executionTier;

  while (!isGraphComplete(graph, state) && !hasHaltedNode(graph, state)) {
    const ready = getReadyNodes(graph, state);
    if (ready.length === 0) {
      // A true deadlock (cycle/dangling dependency) — buildGraph() already
      // rejects cycles/unknown deps at plan-build time, so reaching this
      // branch would mean a bug elsewhere, not a recoverable condition.
      throw new FatalError("Graph is stuck — no ready nodes but not complete");
    }

    const outcomes = await Promise.all(
      ready.map(async (node) => {
        try {
          await runNodeStepForTier(tier, projectId, node);
          return { taskId: node.taskId, nodeState: "succeeded" as const };
        } catch (error) {
          return {
            taskId: node.taskId,
            nodeState: (error instanceof FatalError ? "blocked" : "failed") as NodeState,
          };
        }
      }),
    );

    for (const outcome of outcomes) {
      state = withNodeState(state, outcome.taskId, outcome.nodeState);
    }
    const halted = outcomes.find((o) => o.nodeState !== "succeeded");
    if (halted) {
      await finalizeStep(projectId, halted.nodeState === "blocked" ? "blocked" : "failed", halted.taskId);
      return;
    }
  }

  await finalizeStep(projectId, "completed");
}
