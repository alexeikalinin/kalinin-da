import { NextResponse } from "next/server";
import { getProject, requestRework } from "../../../../../lib/orchestrator.ts";
import { serializeProject } from "../../../../../lib/serialize.ts";

// FR-5 — available only once Completed. Simplified implementation: re-runs
// only Report Generator against current materials, rather than figuring
// out which upstream Tasks the comment actually affects (real PM-driven
// re-decomposition — see orchestrator.ts's own comment on this function).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getProject(id);
  if (!record) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const comment = typeof body.comment === "string" ? body.comment : "";
  if (!comment) {
    return NextResponse.json({ error: "comment is required" }, { status: 400 });
  }

  try {
    await requestRework(record, comment);
    return NextResponse.json(serializeProject(record));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
