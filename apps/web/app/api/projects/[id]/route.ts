import { NextResponse } from "next/server";
import { getProject } from "../../../../lib/orchestrator.ts";
import { serializeProject } from "../../../../lib/serialize.ts";

// FR-3 — progress, periodic pull (NFR-8: no realtime channel needed).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getProject(id);
  if (!record) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(serializeProject(record));
}
