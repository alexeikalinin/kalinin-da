import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../../lib/supabase.ts";
import { serializeClientAdAccount } from "../../../../../lib/client-serialize.ts";

// Attaches one client_ad_account. Callers must already know platform +
// identityId + accessMode — that decision (agency-manager link vs. direct
// access vs. separate personal login) is a human judgment call made per
// memory feedback-client-onboarding-ask-access-path, not inferred here.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !body ||
    (body.platform !== "google-ads" && body.platform !== "yandex-direct") ||
    typeof body.externalAccountId !== "string" ||
    typeof body.identityId !== "string" ||
    (body.accessMode !== "agency_manager" && body.accessMode !== "direct")
  ) {
    return NextResponse.json(
      {
        error:
          "platform ('google-ads'|'yandex-direct'), externalAccountId, identityId, accessMode ('agency_manager'|'direct') are required",
      },
      { status: 400 },
    );
  }

  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await getSupabase()
    .from("client_ad_account")
    .insert({
      tenant_id: tenantId,
      client_id: clientId,
      platform: body.platform,
      external_account_id: body.externalAccountId,
      identity_id: body.identityId,
      access_mode: body.accessMode,
      manager_id: typeof body.managerId === "string" ? body.managerId : null,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to attach ad account" }, { status: 500 });
  }
  return NextResponse.json(serializeClientAdAccount(data), { status: 201 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const { data, error } = await getSupabase()
    .from("client_ad_account")
    .select()
    .eq("client_id", clientId)
    .eq("tenant_id", getSupabaseOwnerTenantId());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map(serializeClientAdAccount));
}
