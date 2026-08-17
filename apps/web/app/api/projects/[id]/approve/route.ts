import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { approveProjectAndPublish, getProject } from "../../../../../lib/orchestrator.ts";
import { executeProjectWorkflow } from "../../../../../lib/workflows/execute-project.ts";
import { serializeProject } from "../../../../../lib/serialize.ts";

// Workflow Engine §3 — approving a plan awaiting Strategy-gate confirmation.
// This request only flips the plan to "executing" and starts a durable
// Workflow DevKit run (lib/workflows/execute-project.ts) — it returns as
// soon as the run is scheduled, not once the Project finishes. Progress and
// the eventual terminal status ("completed"/"failed"/"blocked") are read
// via GET /api/projects/[id], which polls the same in-process record the
// workflow's steps update as they run.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getProject(id);
  if (!record) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (record.planStatus !== "awaiting_approval") {
    return NextResponse.json(
      { error: `Cannot approve a plan in status "${record.planStatus}"` },
      { status: 409 },
    );
  }

  try {
    await approveProjectAndPublish(record);
    const run = await start(executeProjectWorkflow, [record.projectId]);
    record.workflowRunId = run.runId;
    return NextResponse.json(serializeProject(record));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
