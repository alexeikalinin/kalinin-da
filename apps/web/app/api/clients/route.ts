import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../lib/supabase.ts";
import { serializeClient } from "../../../lib/client-serialize.ts";

// Client ad-account reporting foundation (2026-08-18) — a standing client
// record, independent of any one Project (ProjectRecord/project-store.ts
// is a one-shot Task-graph run; this is the recurring-relationship entity
// that was previously missing entirely, per Backlog #20).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.displayName !== "string") {
    return NextResponse.json({ error: "displayName is a required string" }, { status: 400 });
  }

  const { data, error } = await getSupabase()
    .from("client")
    .insert({
      tenant_id: getSupabaseOwnerTenantId(),
      display_name: body.displayName,
      agency_name: typeof body.agencyName === "string" ? body.agencyName : null,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to create client" }, { status: 500 });
  }
  return NextResponse.json(serializeClient(data), { status: 201 });
}

export async function GET() {
  const { data, error } = await getSupabase()
    .from("client")
    .select()
    .eq("tenant_id", getSupabaseOwnerTenantId());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map(serializeClient));
}
