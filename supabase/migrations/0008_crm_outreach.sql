-- CRM/outreach foundation for Track A ("AI SDR" — find, research, score and
-- contact prospective white-label PPC partner agencies). Previously there
-- was no persistence for any of this — 0001_init.sql's `project` is a
-- one-shot Task-graph run, and 0002's `client` only covers already-won
-- clients (post-sale). This adds the pre-sale prospect pipeline.
--
-- Same conventions as 0001_init.sql/0002_client_ad_accounts.sql: uuid pk via
-- gen_random_uuid(), tenant_id + RLS tenant_isolation on every table.

create table prospect_agency (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  website_url text not null,
  country text,
  employee_count_estimate int,
  source text not null, -- e.g. 'perplexity-search', 'manual'
  discovered_at timestamptz not null default now(),
  status text not null default 'new'
    check (status in ('new', 'researching', 'qualified', 'disqualified', 'contacted', 'replied', 'partner', 'lost')),
  disqualify_reason text,
  -- Conversion hook: when a prospect becomes a real paying white-label
  -- client, this is where it links into the existing three-way
  -- agency_entity hierarchy (0006_agency_entity.sql) rather than a parallel
  -- client concept. Null until conversion.
  agency_entity_id uuid references agency_entity(id),
  created_at timestamptz not null default now()
);

-- Structured findings from the Agency Researcher agent (services offered,
-- PPC-is-secondary evidence, team size signal, notable clients). Mirrors
-- client_kb_fact's "fact with provenance" shape (0001_init.sql), but scoped
-- to a prospect rather than a client — a prospect has no client row yet.
create table prospect_research_fact (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  prospect_agency_id uuid not null references prospect_agency(id),
  fact_key text not null,
  fact_value text not null,
  source_url text,
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  created_at timestamptz not null default now()
);

create table decision_maker (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  prospect_agency_id uuid not null references prospect_agency(id),
  full_name text not null,
  title text,
  linkedin_url text,
  email text,
  email_confidence text not null default 'unknown' check (email_confidence in ('verified', 'guessed', 'unknown')),
  source text,
  found_at timestamptz not null default now()
);

-- Explainable scoring — score_breakdown holds the sub-scores (company-size
-- fit, PPC-secondary-service fit, geography fit) so the number is never a
-- bare unexplained int.
create table lead_score (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  prospect_agency_id uuid not null references prospect_agency(id),
  score int not null,
  score_breakdown jsonb not null default '{}',
  scored_at timestamptz not null default now(),
  scored_by_run_id text
);

-- direction/status/self-reference model a single-touch send + reply for
-- MVP without a separate outreach_campaign/thread table (multi-touch
-- sequencing is explicitly deferred — see the plan's Phase 2 list).
create table outreach_message (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  prospect_agency_id uuid not null references prospect_agency(id),
  decision_maker_id uuid references decision_maker(id),
  direction text not null check (direction in ('outbound', 'inbound')),
  subject text,
  body_text text not null,
  status text not null default 'drafted'
    check (status in ('drafted', 'pending_approval', 'approved', 'rejected', 'sent', 'bounced', 'replied', 'suppressed')),
  drafted_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  sent_at timestamptz,
  resend_message_id text,
  in_reply_to_message_id uuid references outreach_message(id)
);

create table reply_classification (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  outreach_message_id uuid not null references outreach_message(id),
  category text not null
    check (category in ('interested', 'not_interested', 'not_relevant', 'ooo', 'unsubscribe_request', 'question', 'other')),
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  classified_at timestamptz not null default now(),
  classified_by_run_id text
);

-- Mandatory gate — every send path must check this table first (enforced in
-- code inside the EmailProvider wrapper, apps/web/lib/tools/email-provider.ts,
-- never left to the caller's discipline).
create table suppression_list (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  email text not null,
  reason text not null check (reason in ('unsubscribe_request', 'bounced_hard', 'complaint', 'manual')),
  added_at timestamptz not null default now(),
  added_by text
);

create unique index suppression_list_tenant_email_idx on suppression_list (tenant_id, lower(email));

create index prospect_research_fact_agency_idx on prospect_research_fact (prospect_agency_id);
create index decision_maker_agency_idx on decision_maker (prospect_agency_id);
create index lead_score_agency_idx on lead_score (prospect_agency_id);
create index outreach_message_agency_idx on outreach_message (prospect_agency_id);
create index outreach_message_status_idx on outreach_message (status);

alter table prospect_agency enable row level security;
alter table prospect_research_fact enable row level security;
alter table decision_maker enable row level security;
alter table lead_score enable row level security;
alter table outreach_message enable row level security;
alter table reply_classification enable row level security;
alter table suppression_list enable row level security;

create policy tenant_isolation on prospect_agency
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on prospect_research_fact
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on decision_maker
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on lead_score
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on outreach_message
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on reply_classification
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on suppression_list
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Same GRANT fix 0003_grant_client_ad_accounts.sql had to apply after
-- 0002 — service_role bypasses RLS but still needs a plain GRANT to touch
-- a table at all. Doing it in the same migration this time instead of a
-- follow-up patch.
grant select, insert, update, delete on
  prospect_agency, prospect_research_fact, decision_maker, lead_score,
  outreach_message, reply_classification, suppression_list
to anon, authenticated, service_role;

-- Known limitation (stated, not hidden, matches this repo's established
-- pattern): no multi-touch sequencing model (in_reply_to_message_id is
-- enough for single-touch + reply, not a wait-days/branching scheduler);
-- no structured compliance-consent tracking beyond the suppression list;
-- decision_maker.email has no independent verification step in MVP beyond
-- what web-search/site-reader surfaces.
