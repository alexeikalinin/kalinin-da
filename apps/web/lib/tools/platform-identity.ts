import { getSupabase, getSupabaseOwnerTenantId } from "../supabase.ts";

// Client ad-account reporting foundation (2026-08-18) — resolves, for a
// given real client's ad account, which OAuth credential to call with and
// which agency-mode header (if any) to send. Separates "which token" from
// "which account it can act on" (memory: client-ad-account-access-model) —
// one identity (e.g. the StarMedia agency credential) can serve many
// client_ad_account rows.
export interface AccessContext {
  readonly platform: "google-ads" | "yandex-direct";
  readonly externalAccountId: string; // Google Ads customerId, or Yandex Direct Client-Login
  readonly credentialRef: string; // env var name — passed straight into google-oauth.ts/yandex-oauth.ts
  readonly accessMode: "agency_manager" | "direct";
  readonly managerId: string | null; // Google MCC customer_id when accessMode='agency_manager'; unused for Yandex
}

interface ClientAdAccountRow {
  readonly external_account_id: string;
  readonly platform: "google-ads" | "yandex-direct";
  readonly access_mode: "agency_manager" | "direct";
  readonly manager_id: string | null;
  readonly platform_identity: { readonly credential_ref: string } | null;
}

export async function resolveAccessContext(clientAdAccountId: string): Promise<AccessContext> {
  const { data, error } = await getSupabase()
    .from("client_ad_account")
    .select("external_account_id, platform, access_mode, manager_id, platform_identity(credential_ref)")
    .eq("id", clientAdAccountId)
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .single();

  if (error || !data) {
    throw new Error(`client_ad_account "${clientAdAccountId}" not found: ${error?.message ?? "no row"}`);
  }
  const row = data as unknown as ClientAdAccountRow;
  if (!row.platform_identity) {
    throw new Error(`client_ad_account "${clientAdAccountId}" has no linked platform_identity`);
  }

  return {
    platform: row.platform,
    externalAccountId: row.external_account_id,
    credentialRef: row.platform_identity.credential_ref,
    accessMode: row.access_mode,
    managerId: row.manager_id,
  };
}
