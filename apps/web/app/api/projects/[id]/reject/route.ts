import { NextResponse } from "next/server";
import { getProject, rejectAndReplan } from "../../../../../lib/orchestrator.ts";
import { serializeProject } from "../../../../../lib/serialize.ts";

// Workflow Engine §3 — rejecting sends control back to PM Agent to rebuild
// the plan; it does not cancel the Project.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getProject(id);
  if (!record) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (record.planStatus !== "awaiting_approval") {
    return NextResponse.json(
      { error: `Cannot reject a plan in status "${record.planStatus}"` },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const comment = typeof body.comment === "string" ? body.comment : "";

  try {
    await rejectAndReplan(record, comment);
    return NextResponse.json(serializeProject(record));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
