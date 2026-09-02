import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../../lib/supabase.ts";
import { getOutreachMessage } from "../../../../../lib/tools/prospect-store.ts";
import { classifyReply } from "../../../../../lib/prospecting-orchestrator.ts";

// Manual reply-logging fallback (Plan §1.3/§4 — inbound MX routing isn't
// live yet, see docs/05-operations/resend-domain-warmup.md §4). A human
// pastes a reply's text in; this inserts the inbound outreach_message row
// and runs it through the same Reply Classifier agent the future webhook
// path will use — same downstream effect (reply_classification recorded,
// unsubscribe requests suppressed), different trigger.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { replyText?: unknown } | null;
  if (!body || typeof body.replyText !== "string" || !body.replyText.trim()) {
    return NextResponse.json({ error: "replyText is a required non-empty string" }, { status: 400 });
  }

  let original;
  try {
    original = await getOutreachMessage(id);
  } catch {
    return NextResponse.json({ error: "Original outreach message not found" }, { status: 404 });
  }

  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data: inbound, error } = await supabase
    .from("outreach_message")
    .insert({
      tenant_id: tenantId,
      prospect_agency_id: original.prospectAgencyId,
      decision_maker_id: original.decisionMakerId,
      direction: "inbound",
      body_text: body.replyText,
      status: "replied",
      in_reply_to_message_id: id,
    })
    .select("id")
    .single();
  if (error || !inbound) return NextResponse.json({ error: error?.message ?? "Failed to log reply" }, { status: 500 });

  try {
    const classification = await classifyReply(inbound.id as string, body.replyText);
    return NextResponse.json({ inboundMessageId: inbound.id, ...classification });
  } catch (classifyError) {
    return NextResponse.json(
      { inboundMessageId: inbound.id, error: classifyError instanceof Error ? classifyError.message : String(classifyError) },
      { status: 207 },
    );
  }
}
