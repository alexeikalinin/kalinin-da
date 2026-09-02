import { asRoleId } from "@ama/agent-framework";
import { recordObservation } from "@ama/learning";
import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../../lib/supabase.ts";
import { getProspectAgency, updateProspectStatus } from "../../../../../lib/tools/prospect-store.ts";
import { OWNER_TENANT_ID, REFLECTION_ACTOR, getSingletons } from "../../../../../lib/singletons.ts";

// Marks a prospect's terminal outcome (the human decides this — it isn't
// something any agent in the pipeline can observe on its own) and records
// the learning observation Track A's lead-scorer was built to eventually
// benefit from (Plan §1.5): does the score this prospect got actually
// predict whether it became a partner? No API route surfaces this signal
// until a human closes the loop here.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { outcome?: unknown } | null;
  if (!body || (body.outcome !== "partner" && body.outcome !== "lost")) {
    return NextResponse.json({ error: "outcome must be 'partner' or 'lost'" }, { status: 400 });
  }

  try {
    await getProspectAgency(id);
  } catch {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  await updateProspectStatus(id, body.outcome);

  const { data: scoreRows } = await getSupabase()
    .from("lead_score")
    .select("score, score_breakdown")
    .eq("prospect_agency_id", id)
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .order("scored_at", { ascending: false })
    .limit(1);
  const latestScore = scoreRows?.[0];

  if (latestScore) {
    try {
      const { store } = getSingletons();
      recordObservation(store, REFLECTION_ACTOR, OWNER_TENANT_ID, `lead-outcome-${id}`, {
        situation: `score=${latestScore.score}; breakdown=${JSON.stringify(latestScore.score_breakdown)}`,
        outcome: body.outcome === "partner" ? "success" : "problem",
        conclusion:
          body.outcome === "partner"
            ? `Прогноз оправдался: score ${latestScore.score} привёл к партнёрству.`
            : `Прогноз не оправдался: score ${latestScore.score}, но партнёрство не состоялось.`,
        roleId: asRoleId("lead-scorer"),
        groupKey: latestScore.score >= 75 ? "high-score" : latestScore.score >= 40 ? "mid-score" : "low-score",
      });
    } catch {
      // Best-effort — must never fail the outcome-recording request itself.
    }
  }

  return NextResponse.json({ status: body.outcome });
}
