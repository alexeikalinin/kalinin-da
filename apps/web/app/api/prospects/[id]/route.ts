import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../lib/supabase.ts";
import { getProspectAgency, getResearchFacts, getDecisionMakers } from "../../../../lib/tools/prospect-store.ts";

// Prospect detail — facts + decision makers + latest score + outreach
// messages, everything a human needs to review before approving a draft.
// Reads prospect-store.ts's functions directly rather than going through
// the "prospect-store" tool-invoke wrapper (that indirection exists for
// agents inside a Task; a plain API route has no reason to route through
// AgentToolPort's grant-checking).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let prospect;
  try {
    prospect = await getProspectAgency(id);
  } catch {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  const [facts, decisionMakers, scoreRows, messages] = await Promise.all([
    getResearchFacts(id),
    getDecisionMakers(id),
    getSupabase()
      .from("lead_score")
      .select("score, score_breakdown, scored_at")
      .eq("prospect_agency_id", id)
      .eq("tenant_id", getSupabaseOwnerTenantId())
      .order("scored_at", { ascending: false })
      .limit(1),
    getSupabase()
      .from("outreach_message")
      .select("id, subject, body_text, status, drafted_at, sent_at")
      .eq("prospect_agency_id", id)
      .eq("tenant_id", getSupabaseOwnerTenantId())
      .order("drafted_at", { ascending: false }),
  ]);

  return NextResponse.json({
    prospect,
    facts,
    decisionMakers,
    latestScore: scoreRows.data?.[0] ?? null,
    messages: messages.data ?? [],
  });
}
