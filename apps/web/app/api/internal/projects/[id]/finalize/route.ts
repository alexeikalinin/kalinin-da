import { NextResponse } from "next/server";
import { projectCompleted } from "@ama/events";
import { reflect } from "@ama/agent-reflection";
import type { ProjectOutput } from "@ama/agent-report-generator";
import { withNodeState } from "@ama/workflow-engine";
import { AGENT_ACTOR, OWNER_TENANT_ID, getSingletons } from "../../../../../../lib/singletons.ts";
import { getProject } from "../../../../../../lib/project-store.ts";

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
    return NextResponse.json({ status: outcome });
  }

  const { bus, store, log } = getSingletons();
  const output = store.read(AGENT_ACTOR, {
    level: "project",
    tenantId: OWNER_TENANT_ID,
    key: `${record.projectId}:project-output`,
  });
  record.output = output as ProjectOutput | undefined;
  record.planStatus = "completed";
  await bus.publish(projectCompleted({ tenantId: OWNER_TENANT_ID, projectId: record.projectId }));

  const projectEvents = log.entries
    .map((e) => e.event)
    .filter((e) => "projectId" in e && e.projectId === record.projectId);
  reflect(store, { kind: "reflection", tenantId: OWNER_TENANT_ID }, OWNER_TENANT_ID, record.projectId, projectEvents);

  return NextResponse.json({ status: "completed" });
}
