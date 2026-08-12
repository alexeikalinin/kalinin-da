import { NextResponse } from "next/server";
import { getProject } from "../../../../../lib/orchestrator.ts";

// FR-6 — a separate, dedicated request, not the same as progress (§4a):
// progress returns status, this returns the finished materials.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getProject(id);
  if (!record) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (record.planStatus !== "completed" || !record.output) {
    return NextResponse.json({ error: "Project is not completed yet" }, { status: 409 });
  }
  return NextResponse.json(record.output);
}
