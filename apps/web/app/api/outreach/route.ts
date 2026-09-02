import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../lib/supabase.ts";

// Lists outreach_message rows for the review dashboard — defaults to
// pending_approval (the queue a human actually needs to act on) but
// accepts ?status= to view any other state.
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") ?? "pending_approval";
  const { data, error } = await getSupabase()
    .from("outreach_message")
    .select("id, prospect_agency_id, decision_maker_id, subject, body_text, status, drafted_at, sent_at")
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .eq("status", status)
    .order("drafted_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
