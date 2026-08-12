import { NextResponse } from "next/server";
import { createProject, listProjects, type ProjectInput } from "../../../lib/orchestrator.ts";
import { serializeProject } from "../../../lib/serialize.ts";

// FR-1, FR-2, FR-2a — Project creation. Auth is deliberately simplified to
// a single Owner tenant (API/Application Layer §1) — no session/token
// check here on purpose, not an oversight.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.siteUrl !== "string" ||
    typeof body.businessDescription !== "string" ||
    typeof body.product !== "string" ||
    typeof body.marketingTask !== "string"
  ) {
    return NextResponse.json(
      { error: "siteUrl, businessDescription, product, marketingTask are required strings" },
      { status: 400 },
    );
  }

  const input: ProjectInput = {
    siteUrl: body.siteUrl,
    businessDescription: body.businessDescription,
    product: body.product,
    marketingTask: body.marketingTask,
  };
  const approvalLevel = body.approvalLevel === "output-only" ? "output-only" : "strategy-gate";
  const executionTier = body.executionTier === "fast" ? "fast" : "standard";

  try {
    const record = await createProject(input, approvalLevel, executionTier);
    return NextResponse.json(serializeProject(record), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(listProjects().map(serializeProject));
}
