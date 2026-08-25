import { NextResponse } from "next/server";
import type { ProjectId } from "@ama/agent-framework";
import { projectCompleted } from "@ama/events";
import { reflect } from "@ama/agent-reflection";
import type { ProjectOutput } from "@ama/agent-report-generator";
import { withNodeState } from "@ama/workflow-engine";
import { AGENT_ACTOR, OWNER_TENANT_ID, getSingletons } from "../../../../../../lib/singletons.ts";
import { getProject } from "../../../../../../lib/project-store.ts";

// Reflection §2 treats a failure as the *most* informative outcome
// ("problem" is one of the two values recordObservation stores), but this
// used to run only on the completed branch — the blocked/failed branch
// returned before reaching it, so the system learned exclusively from
// projects that went well. Shared by both terminal paths now.
function reflectOnProject(projectId: ProjectId): void {
  const { store, log } = getSingletons();
  const projectEvents = log.entries
    .map((e) => e.event)
    .filter((e) => "projectId" in e && e.projectId === projectId);
  reflect(store, { kind: "reflection", tenantId: OWNER_TENANT_ID }, OWNER_TENANT_ID, projectId, projectEvents);
}

// Internal-only endpoint, called from a "use step" function once the
// executeProjectWorkflow's main loop exits (graph fully succeeded, or a
// node landed in "blocked"/"failed") — sets the Project's terminal
// planStatus. Runs in this app's own process for the same reason
// run-node/route.ts does (see that file's comment).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getProject(id);
  if (!record) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { outcome, taskId } = (await request.json()) as {
    outcome: "completed" | "blocked" | "failed";
    taskId?: string;
  };

  if (outcome === "blocked" || outcome === "failed") {
    // run-node/route.ts leaves the halted node's graphState entry at
    // "running" (that's the last state it set before the error propagated
    // past retries) — persist the real terminal state here so polling
    // clients don't see a node stuck "running" forever after the Project
    // itself has already moved to a terminal status.
    if (taskId && record.graphState) {
      record.graphState = withNodeState(record.graphState, taskId, outcome);
    }
    record.planStatus = outcome;
    // No projectCompleted event here — the Project did not complete; only
    // the learning pass is shared with the success path.
    reflectOnProject(record.projectId);
    return NextResponse.json({ status: outcome });
  }

  const { bus, store } = getSingletons();
  const output = store.read(AGENT_ACTOR, {
    level: "project",
    tenantId: OWNER_TENANT_ID,
    key: `${record.projectId}:project-output`,
  });
  record.output = output as ProjectOutput | undefined;
  record.planStatus = "completed";
  await bus.publish(projectCompleted({ tenantId: OWNER_TENANT_ID, projectId: record.projectId }));

  reflectOnProject(record.projectId);

  return NextResponse.json({ status: "completed" });
}
