import { NextResponse } from "next/server";
import { getProject } from "../../../../../../lib/project-store.ts";

// Internal-only endpoint (see lib/workflows/execute-project.ts's top comment
// for why this exists): "use step" functions run in a genuinely separate
// execution context from the rest of this Next.js app — even in local dev
// — so they cannot read the in-process ProjectRecord map directly. Steps
// reach it over real HTTP instead, into this normal route handler, which
// runs in the app's own process and shares state with the approve/reject/
// output routes exactly as it always has.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getProject(id);
  if (!record || !record.graph || !record.graphState) {
    return NextResponse.json({ error: "Project not found or has no plan yet" }, { status: 404 });
  }
  return NextResponse.json({
    nodes: record.graph.nodes,
    states: [...record.graphState.states.entries()],
    executionTier: record.executionTier,
  });
}
