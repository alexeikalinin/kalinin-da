import { getSupabase, getSupabaseOwnerTenantId } from "../supabase.ts";

// Track A (client-acquisition agents) — CRUD over the CRM/outreach schema
// added in supabase/migrations/0008_crm_outreach.sql. Same pattern as
// tools/client-context.ts: service-role Supabase client, scoped to the
// owner tenant, no internal try/catch (callers — the "prospect-store" case
// in real-tools.ts — wrap failures as ToolUnavailableError, same convention
// used everywhere else in this file's siblings).
export { isSupabaseConfigured } from "./client-context.ts";

export type ProspectStatus =
  | "new"
  | "researching"
  | "qualified"
  | "disqualified"
  | "contacted"
  | "replied"
  | "partner"
  | "lost";

export interface ProspectAgency {
  readonly id: string;
  readonly name: string;
  readonly websiteUrl: string;
  readonly country: string | null;
  readonly employeeCountEstimate: number | null;
  readonly status: ProspectStatus;
}

export interface CreateProspectAgencyInput {
  readonly name: string;
  readonly websiteUrl: string;
  readonly country?: string;
  readonly employeeCountEstimate?: number;
  readonly source: string;
}

export async function createProspectAgency(input: CreateProspectAgencyInput): Promise<{ readonly id: string }> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("prospect_agency")
    .insert({
      tenant_id: tenantId,
      name: input.name,
      website_url: input.websiteUrl,
      country: input.country ?? null,
      employee_count_estimate: input.employeeCountEstimate ?? null,
      source: input.source,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createProspectAgency failed: ${error?.message ?? "no row returned"}`);
  return { id: data.id as string };
}

export async function getProspectAgency(prospectAgencyId: string): Promise<ProspectAgency> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("prospect_agency")
    .select("id, name, website_url, country, employee_count_estimate, status")
    .eq("id", prospectAgencyId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !data) throw new Error(`prospect_agency "${prospectAgencyId}" not found: ${error?.message ?? "no row"}`);
  return {
    id: data.id as string,
    name: data.name as string,
    websiteUrl: data.website_url as string,
    country: data.country as string | null,
    employeeCountEstimate: data.employee_count_estimate as number | null,
    status: data.status as ProspectStatus,
  };
}

// Short-circuits a graph run when a lead scores too low to continue —
// see lead-scorer's completionCriteria and the orchestrator's dependent-node
// skip logic (Plan §2).
export async function updateProspectStatus(
  prospectAgencyId: string,
  status: ProspectStatus,
  disqualifyReason?: string,
): Promise<void> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { error } = await supabase
    .from("prospect_agency")
    .update({ status, disqualify_reason: disqualifyReason ?? null })
    .eq("id", prospectAgencyId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`updateProspectStatus failed: ${error.message}`);
}

export interface ResearchFactInput {
  readonly factKey: string;
  readonly factValue: string;
  readonly sourceUrl?: string;
  readonly confidence?: "low" | "medium" | "high";
}

export async function addResearchFacts(prospectAgencyId: string, facts: readonly ResearchFactInput[]): Promise<void> {
  if (facts.length === 0) return;
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { error } = await supabase.from("prospect_research_fact").insert(
    facts.map((fact) => ({
      tenant_id: tenantId,
      prospect_agency_id: prospectAgencyId,
      fact_key: fact.factKey,
      fact_value: fact.factValue,
      source_url: fact.sourceUrl ?? null,
      confidence: fact.confidence ?? "medium",
    })),
  );
  if (error) throw new Error(`addResearchFacts failed: ${error.message}`);
}

export interface ResearchFact extends ResearchFactInput {
  readonly id: string;
}

export async function getResearchFacts(prospectAgencyId: string): Promise<readonly ResearchFact[]> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("prospect_research_fact")
    .select("id, fact_key, fact_value, source_url, confidence")
    .eq("prospect_agency_id", prospectAgencyId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`getResearchFacts failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    factKey: row.fact_key as string,
    factValue: row.fact_value as string,
    sourceUrl: (row.source_url as string | null) ?? undefined,
    confidence: row.confidence as "low" | "medium" | "high",
  }));
}

export interface DecisionMakerInput {
  readonly fullName: string;
  readonly title?: string;
  readonly linkedinUrl?: string;
  readonly email?: string;
  readonly emailConfidence: "verified" | "guessed" | "unknown";
  readonly source?: string;
}

export async function addDecisionMaker(
  prospectAgencyId: string,
  input: DecisionMakerInput,
): Promise<{ readonly id: string }> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("decision_maker")
    .insert({
      tenant_id: tenantId,
      prospect_agency_id: prospectAgencyId,
      full_name: input.fullName,
      title: input.title ?? null,
      linkedin_url: input.linkedinUrl ?? null,
      email: input.email ?? null,
      email_confidence: input.emailConfidence,
      source: input.source ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addDecisionMaker failed: ${error?.message ?? "no row returned"}`);
  return { id: data.id as string };
}

export interface DecisionMaker extends DecisionMakerInput {
  readonly id: string;
}

export async function getDecisionMakers(prospectAgencyId: string): Promise<readonly DecisionMaker[]> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("decision_maker")
    .select("id, full_name, title, linkedin_url, email, email_confidence, source")
    .eq("prospect_agency_id", prospectAgencyId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`getDecisionMakers failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    fullName: row.full_name as string,
    title: (row.title as string | null) ?? undefined,
    linkedinUrl: (row.linkedin_url as string | null) ?? undefined,
    email: (row.email as string | null) ?? undefined,
    emailConfidence: row.email_confidence as "verified" | "guessed" | "unknown",
    source: (row.source as string | null) ?? undefined,
  }));
}

export interface RecordLeadScoreInput {
  readonly score: number;
  readonly scoreBreakdown: Record<string, unknown>;
  readonly scoredByRunId?: string;
}

export async function recordLeadScore(prospectAgencyId: string, input: RecordLeadScoreInput): Promise<void> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { error } = await supabase.from("lead_score").insert({
    tenant_id: tenantId,
    prospect_agency_id: prospectAgencyId,
    score: input.score,
    score_breakdown: input.scoreBreakdown,
    scored_by_run_id: input.scoredByRunId ?? null,
  });
  if (error) throw new Error(`recordLeadScore failed: ${error.message}`);
}

export interface CreateOutreachDraftInput {
  readonly prospectAgencyId: string;
  readonly decisionMakerId?: string;
  readonly subject: string;
  readonly bodyText: string;
}

export async function createOutreachDraft(input: CreateOutreachDraftInput): Promise<{ readonly id: string }> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("outreach_message")
    .insert({
      tenant_id: tenantId,
      prospect_agency_id: input.prospectAgencyId,
      decision_maker_id: input.decisionMakerId ?? null,
      direction: "outbound",
      subject: input.subject,
      body_text: input.bodyText,
      status: "drafted",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createOutreachDraft failed: ${error?.message ?? "no row returned"}`);
  return { id: data.id as string };
}

export type OutreachMessageStatus =
  | "drafted"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "sent"
  | "bounced"
  | "replied"
  | "suppressed";

export async function updateOutreachMessageStatus(
  outreachMessageId: string,
  status: OutreachMessageStatus,
  extra?: { readonly approvedBy?: string; readonly resendMessageId?: string },
): Promise<void> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const patch: Record<string, unknown> = { status };
  if (status === "approved") {
    patch.approved_at = new Date().toISOString();
    patch.approved_by = extra?.approvedBy ?? null;
  }
  if (status === "sent") {
    patch.sent_at = new Date().toISOString();
    if (extra?.resendMessageId) patch.resend_message_id = extra.resendMessageId;
  }
  const { error } = await supabase.from("outreach_message").update(patch).eq("id", outreachMessageId).eq("tenant_id", tenantId);
  if (error) throw new Error(`updateOutreachMessageStatus failed: ${error.message}`);
}

export interface OutreachMessage {
  readonly id: string;
  readonly prospectAgencyId: string;
  readonly decisionMakerId: string | null;
  readonly subject: string | null;
  readonly bodyText: string;
  readonly status: OutreachMessageStatus;
}

export async function getOutreachMessage(outreachMessageId: string): Promise<OutreachMessage> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("outreach_message")
    .select("id, prospect_agency_id, decision_maker_id, subject, body_text, status")
    .eq("id", outreachMessageId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !data) throw new Error(`outreach_message "${outreachMessageId}" not found: ${error?.message ?? "no row"}`);
  return {
    id: data.id as string,
    prospectAgencyId: data.prospect_agency_id as string,
    decisionMakerId: data.decision_maker_id as string | null,
    subject: data.subject as string | null,
    bodyText: data.body_text as string,
    status: data.status as OutreachMessageStatus,
  };
}

export async function listOutreachMessagesByStatus(status: OutreachMessageStatus): Promise<readonly OutreachMessage[]> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("outreach_message")
    .select("id, prospect_agency_id, decision_maker_id, subject, body_text, status")
    .eq("status", status)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`listOutreachMessagesByStatus failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    prospectAgencyId: row.prospect_agency_id as string,
    decisionMakerId: row.decision_maker_id as string | null,
    subject: row.subject as string | null,
    bodyText: row.body_text as string,
    status: row.status as OutreachMessageStatus,
  }));
}

// Backs email-provider.ts's DAILY_SEND_CAP enforcement — a real count
// against sent_at, not a policy comment, so a batch-approval UI queuing many
// sends at once can't blow through the cap (Plan §1.3).
export async function countOutreachMessagesSentToday(): Promise<number> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("outreach_message")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "sent")
    .gte("sent_at", startOfToday.toISOString());
  if (error) throw new Error(`countOutreachMessagesSentToday failed: ${error.message}`);
  return count ?? 0;
}

// The mandatory pre-send gate (Plan §1.1/§1.3) — checked by
// email-provider.ts's sendOutreachEmail before every real Resend call, and
// usable standalone by compliance-checker.
export async function isSuppressed(email: string): Promise<boolean> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data, error } = await supabase
    .from("suppression_list")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("email", email)
    .limit(1);
  if (error) throw new Error(`isSuppressed check failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function addToSuppressionList(
  email: string,
  reason: "unsubscribe_request" | "bounced_hard" | "complaint" | "manual",
  addedBy?: string,
): Promise<void> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  // Unique index is (tenant_id, lower(email)) — upsert would need that as
  // the conflict target; a plain insert-if-absent read-then-write is
  // simpler here and this path is low-frequency (one suppression request
  // at a time, never a batch).
  if (await isSuppressed(email)) return;
  const { error } = await supabase.from("suppression_list").insert({
    tenant_id: tenantId,
    email,
    reason,
    added_by: addedBy ?? null,
  });
  if (error) throw new Error(`addToSuppressionList failed: ${error.message}`);
}

export async function recordReplyClassification(
  outreachMessageId: string,
  category: "interested" | "not_interested" | "not_relevant" | "ooo" | "unsubscribe_request" | "question" | "other",
  confidence: "low" | "medium" | "high",
  classifiedByRunId?: string,
): Promise<void> {
  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { error } = await supabase.from("reply_classification").insert({
    tenant_id: tenantId,
    outreach_message_id: outreachMessageId,
    category,
    confidence,
    classified_by_run_id: classifiedByRunId ?? null,
  });
  if (error) throw new Error(`recordReplyClassification failed: ${error.message}`);
  // An unsubscribe request found in a reply must suppress the sender
  // immediately — the classifier agent is the one place this signal first
  // becomes visible, so the gate lives here rather than relying on a
  // separate step remembering to check category afterward.
  if (category === "unsubscribe_request") {
    const message = await getOutreachMessage(outreachMessageId);
    if (message.decisionMakerId) {
      const supabase2 = getSupabase();
      const { data: dm } = await supabase2.from("decision_maker").select("email").eq("id", message.decisionMakerId).single();
      const email = dm?.email as string | undefined;
      if (email) await addToSuppressionList(email, "unsubscribe_request", "reply-classifier");
    }
  }
}
