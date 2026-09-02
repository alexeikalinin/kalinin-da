import { NextResponse } from "next/server";
import { runProspectPipeline } from "../../../../../lib/prospecting-orchestrator.ts";
import { getProspectAgency } from "../../../../../lib/tools/prospect-store.ts";

// Runs one prospect through research -> decision-maker search -> scoring
// -> (if qualified) drafting -> compliance check. Synchronous, same
// reasoning as POST /api/prospects (a handful of role calls, not a long
// multi-hour graph) — the response only comes back once the whole pipeline
// (or its disqualification short-circuit) has finished.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let prospect;
  try {
    prospect = await getProspectAgency(id);
  } catch {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  try {
    const result = await runProspectPipeline(id, prospect.websiteUrl);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
