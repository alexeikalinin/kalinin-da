import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../../lib/supabase.ts";
import { serializeTargetConversionSet } from "../../../../../lib/client-serialize.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");

  let query = getSupabase().from("target_conversion").select().eq("client_id", clientId);
  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(serializeTargetConversionSet(clientId, data ?? []));
}

// Replaces the approved set for one (client, platform) — no version
// history kept, per the plan's known limitations. approved_at is stamped
// fresh on every call, marking this as a human re-approval, not an upsert
// of individual rows.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !body ||
    (body.platform !== "google-ads" && body.platform !== "yandex-metrika") ||
    !Array.isArray(body.conversions)
  ) {
    return NextResponse.json(
      { error: "platform ('google-ads'|'yandex-metrika') and conversions: [{externalConversionId, name}] are required" },
      { status: 400 },
    );
  }
  const conversions = body.conversions as ReadonlyArray<Record<string, unknown>>;
  if (!conversions.every((c) => typeof c.externalConversionId === "string" && typeof c.name === "string")) {
    return NextResponse.json(
      { error: "each conversion needs a string externalConversionId and name" },
      { status: 400 },
    );
  }

  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();

  const { error: deleteError } = await supabase
    .from("target_conversion")
    .delete()
    .eq("client_id", clientId)
    .eq("platform", body.platform);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  if (conversions.length === 0) {
    return NextResponse.json(serializeTargetConversionSet(clientId, []));
  }

  const approvedAt = new Date().toISOString();
  const { data, error: insertError } = await supabase
    .from("target_conversion")
    .insert(
      conversions.map((c) => ({
        tenant_id: tenantId,
        client_id: clientId,
        platform: body.platform,
        external_conversion_id: c.externalConversionId,
        name: c.name,
        approved_at: approvedAt,
      })),
    )
    .select();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json(serializeTargetConversionSet(clientId, data ?? []));
}
