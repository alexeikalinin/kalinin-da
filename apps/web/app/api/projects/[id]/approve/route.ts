import { NextResponse } from "next/server";
import { approveAndExecute, getProject } from "../../../../../lib/orchestrator.ts";
import { serializeProject } from "../../../../../lib/serialize.ts";

// Workflow Engine §3 — approving a plan awaiting Strategy-gate confirmation.
// This request runs the whole graph synchronously (no background job
// runner exists yet — see this file's README note) and only returns once
// the Project is fully completed or a Task fails.
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
    await approveAndExecute(record);
    return NextResponse.json(serializeProject(record));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
