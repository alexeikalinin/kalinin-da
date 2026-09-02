import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../lib/supabase.ts";
import { runLeadDiscovery } from "../../../lib/prospecting-orchestrator.ts";

// Track A — POST triggers a discovery run (Lead Finder agent, real
// Perplexity search + real prospect_agency writes); GET lists what's been
// discovered so far. Deliberately synchronous, not a durable Workflow
// DevKit run like /api/projects/[id]/approve — a discovery batch is a
// handful of search queries + LLM calls, not a long multi-role graph, so
// there's no retry/escalate machinery worth the complexity here yet.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { countries?: unknown; seedQueries?: unknown } | null;
  if (!body || !Array.isArray(body.countries) || body.countries.some((c) => typeof c !== "string")) {
    return NextResponse.json({ error: "countries is a required string[]" }, { status: 400 });
  }
  const seedQueries = Array.isArray(body.seedQueries) ? body.seedQueries.filter((q): q is string => typeof q === "string") : undefined;

  try {
    const result = await runLeadDiscovery({ countries: body.countries as readonly string[], seedQueries });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  let query = getSupabase().from("prospect_agency").select().eq("tenant_id", getSupabaseOwnerTenantId());
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("discovered_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
