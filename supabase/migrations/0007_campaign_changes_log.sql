-- Campaign changes log (ported 2026-08-30 from PPC Master Tool's
-- supabase_campaign_changes_log.sql — the pattern, not the historical
-- rows: that project logged manual Медавеню optimizations against a
-- different tracking system, not this one's schema).
--
-- Fills a real gap: today, nothing records "we changed X, we expected Y"
-- for a client's live campaigns — an optimization action (adding a
-- negative keyword set, changing a bidding strategy, tightening a match
-- type) leaves no trail to check the outcome against later. This is the
-- write side of the same anti-silent-wrong instinct behind ad_stat/
-- data-actuality-check: verified_at/actual_effect stay null until a human
-- or an agent (see .claude/agents/medavenue-analyst.md's Шаг 5) comes
-- back and checks whether the expected effect actually happened.
--
-- Same conventions as 0001_init.sql/0002_client_ad_accounts.sql: uuid pk,
-- tenant_id + RLS, references client_ad_account (not a free-text
-- client/login pair like the ported version) since that table already
-- carries platform + external_account_id per real client account.

create table campaign_changes_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  client_ad_account_id uuid not null references client_ad_account(id),
  campaign_id text,
  campaign_name text,
  change_type text not null, -- e.g. 'negative_added', 'bidding_strategy_changed', 'keyword_added', 'budget_changed'
  change_description text not null,
  expected_effect text,
  actual_effect text, -- filled in on the next audit pass, not at creation time
  verified_at timestamptz, -- null until actual_effect has been checked against real data
  period_analyzed text, -- the reporting period the decision to change was based on, e.g. '2026-08'
  created_at timestamptz not null default now(),
  created_by text -- 'agent:medavenue-analyst', a human's name, etc. — free text, no user table to reference yet
);

create index campaign_changes_log_account_idx on campaign_changes_log (client_ad_account_id, created_at desc);
create index campaign_changes_log_unverified_idx on campaign_changes_log (client_ad_account_id) where verified_at is null;

alter table campaign_changes_log enable row level security;
create policy tenant_isolation on campaign_changes_log
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Same GRANT fix 0003_grant_client_ad_accounts.sql had to apply after 0002 —
-- service_role bypasses RLS but still needs a plain GRANT to touch a table
-- at all. Added here directly (this migration was never applied until
-- 2026-08-30, alongside 0008/0009) instead of as a follow-up patch.
grant select, insert, update, delete on campaign_changes_log to anon, authenticated, service_role;

-- Known limitation (stated, not hidden): no shared_set_id/phrases columns
-- like the ported version had — those were Yandex Direct-specific
-- (negative keyword shared sets). change_description is free text for
-- now; if per-platform structured fields turn out to matter, add them
-- later rather than guessing the full shape today.
