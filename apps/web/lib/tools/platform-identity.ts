import { getSupabase, getSupabaseOwnerTenantId } from "../supabase.ts";

// Client ad-account reporting foundation (2026-08-18) — resolves, for a
// given real client's ad account, which OAuth credential to call with and
// which agency-mode header (if any) to send. Separates "which token" from
// "which account it can act on" (memory: client-ad-account-access-model) —
// one identity (e.g. the StarMedia agency credential) can serve many
// client_ad_account rows.
export interface AccessContext {
  readonly platform: "google-ads" | "yandex-direct" | "openai-ads";
  readonly externalAccountId: string; // Google Ads customerId, Yandex Direct Client-Login, or OpenAI Ads account id
  // env var name — passed straight into google-oauth.ts/yandex-oauth.ts, or
  // (for 'openai-ads') openai-ads-auth.ts's static API key, not an OAuth pair.
  readonly credentialRef: string;
  readonly accessMode: "agency_manager" | "direct";
  // Google MCC customer_id when accessMode='agency_manager'; unused for Yandex
  // and always null for 'openai-ads' (no manager-account concept exists there
  // — see docs/openai-ads-integration-research.md Phase 2).
  readonly managerId: string | null;
}

interface ClientAdAccountRow {
  readonly external_account_id: string;
  readonly platform: "google-ads" | "yandex-direct" | "openai-ads";
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
