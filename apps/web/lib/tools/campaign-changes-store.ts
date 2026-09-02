import { getSupabase, getSupabaseOwnerTenantId } from "../supabase.ts";

// Track B (campaign optimization) — CRUD over campaign_changes_log
// (0007_campaign_changes_log.sql, extended by 0009_campaign_changes_log_v2.sql
// with status/approval/before-after-metrics columns). Same direct-Supabase-
// client pattern as tools/prospect-store.ts. This is the single source of
// truth ppc-agent's "recommend"/"apply"/"verify" actions read from and
// write to — see packages/agents/ppc/src/ppc-agent.ts.
export { isSupabaseConfigured } from "./client-context.ts";

export type CampaignChangeStatus = "proposed" | "approved" | "rejected" | "applied" | "apply_failed";

export interface ProposeChangeInput {
  readonly clientAdAccountId: string;
  readonly campaignId?: string;
  readonly campaignName?: string;
  readonly changeType: string;
  readonly changeDescription: string;
  readonly expectedEffect?: string;
  readonly beforeMetrics?: Record<string, unknown>;
  readonly periodAnalyzed?: string;
  readonly proposedByRunId?: string;
  readonly createdBy?: string;
}

export async function proposeCampaignChange(input: ProposeChangeInput): Promise<{ readonly id: string }> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("campaign_changes_log")
    .insert({
      tenant_id: tenantId,
      client_ad_account_id: input.clientAdAccountId,
      campaign_id: input.campaignId ?? null,
      campaign_name: input.campaignName ?? null,
      change_type: input.changeType,
      change_description: input.changeDescription,
      expected_effect: input.expectedEffect ?? null,
      before_metrics: input.beforeMetrics ?? null,
      period_analyzed: input.periodAnalyzed ?? null,
      proposed_by_run_id: input.proposedByRunId ?? null,
      created_by: input.createdBy ?? "agent:ppc",
      status: "proposed",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`proposeCampaignChange failed: ${error?.message ?? "no row returned"}`);
  return { id: data.id as string };
}

export interface CampaignChange {
  readonly id: string;
  readonly clientAdAccountId: string;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly changeType: string;
  readonly changeDescription: string;
  readonly expectedEffect: string | null;
  readonly actualEffect: string | null;
  readonly status: CampaignChangeStatus;
  readonly beforeMetrics: Record<string, unknown> | null;
  readonly afterMetrics: Record<string, unknown> | null;
  readonly verifiedAt: string | null;
  readonly createdAt: string;
}

function toCampaignChange(row: Record<string, unknown>): CampaignChange {
  return {
    id: row.id as string,
    clientAdAccountId: row.client_ad_account_id as string,
    campaignId: row.campaign_id as string | null,
    campaignName: row.campaign_name as string | null,
    changeType: row.change_type as string,
    changeDescription: row.change_description as string,
    expectedEffect: row.expected_effect as string | null,
    actualEffect: row.actual_effect as string | null,
    status: row.status as CampaignChangeStatus,
    beforeMetrics: row.before_metrics as Record<string, unknown> | null,
    afterMetrics: row.after_metrics as Record<string, unknown> | null,
    verifiedAt: row.verified_at as string | null,
    createdAt: row.created_at as string,
  };
}

export async function getCampaignChange(id: string): Promise<CampaignChange> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("campaign_changes_log")
    .select()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !data) throw new Error(`campaign_changes_log "${id}" not found: ${error?.message ?? "no row"}`);
  return toCampaignChange(data);
}

export async function listCampaignChanges(
  clientAdAccountId: string,
  status?: CampaignChangeStatus,
  limit = 20,
): Promise<readonly CampaignChange[]> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  let query = supabase
    .from("campaign_changes_log")
    .select()
    .eq("client_ad_account_id", clientAdAccountId)
    .eq("tenant_id", tenantId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`listCampaignChanges failed: ${error.message}`);
  return (data ?? []).map(toCampaignChange);
}

// Rows ready for change-verifier's periodic pass: applied, not yet
// verified, and old enough that a post-change performance window actually
// exists to compare against.
export async function listUnverifiedAppliedChanges(olderThanDays: number): Promise<readonly CampaignChange[]> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("campaign_changes_log")
    .select()
    .eq("tenant_id", tenantId)
    .eq("status", "applied")
    .is("verified_at", null)
    .lte("created_at", cutoff);
  if (error) throw new Error(`listUnverifiedAppliedChanges failed: ${error.message}`);
  return (data ?? []).map(toCampaignChange);
}

export async function updateCampaignChangeStatus(
  id: string,
  status: CampaignChangeStatus,
  extra?: { readonly approvedBy?: string; readonly applyResult?: unknown },
): Promise<void> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const patch: Record<string, unknown> = { status };
  if (status === "approved") {
    patch.approved_at = new Date().toISOString();
    patch.approved_by = extra?.approvedBy ?? null;
  }
  if (status === "applied" || status === "apply_failed") {
    patch.apply_result = extra?.applyResult ?? null;
  }
  const { error } = await supabase.from("campaign_changes_log").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw new Error(`updateCampaignChangeStatus failed: ${error.message}`);
}

export async function recordVerification(id: string, actualEffect: string, afterMetrics: Record<string, unknown>): Promise<void> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { error } = await supabase
    .from("campaign_changes_log")
    .update({ actual_effect: actualEffect, after_metrics: afterMetrics, verified_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`recordVerification failed: ${error.message}`);
}
