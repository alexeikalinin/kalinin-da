import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../lib/supabase.ts";
import { serializeClient } from "../../../../lib/client-serialize.ts";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await getSupabase()
    .from("client")
    .select()
    .eq("id", id)
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .single();
  if (error || !data) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(serializeClient(data));
}
