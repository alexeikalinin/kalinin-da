-- Client ad-account reporting foundation (Tool Integration / Backlog #18,
-- #20; docs/07-planning/backlog.md #21-23; memory: client-ad-account-access-model).
-- Adds a standing "which real clients do we manage, on which ad platforms,
-- with which approved conversions, and what did we actually measure"
-- layer — previously there was no persistence for any of this (every
-- Project in 0001_init.sql is a one-shot Task-graph run, not a standing
-- client record).
--
-- Same conventions as 0001_init.sql: uuid pk via gen_random_uuid(),
-- tenant_id on every tenant-scoped table, RLS + tenant_isolation policy.

create table platform_identity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  platform text not null check (platform in ('google-ads', 'yandex-direct')),
  label text not null,
  external_user_id text,
  -- Secrets stay in env vars (Tool Integration §1 pattern used throughout
  -- apps/web/lib/tools/*.ts) — this only names which pair of env vars a
  -- given identity's OAuth credential lives under, e.g.
  -- 'GOOGLE_ADS_AGENCY_REFRESH_TOKEN'. A real secret store is future work
  -- (see this migration's own limitation note at the bottom).
  credential_ref text not null,
  created_at timestamptz not null default now()
);

create table client (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  display_name text not null,
  agency_name text,
  created_at timestamptz not null default now()
);

-- One client_ad_account row per real ad account we've connected to (Backlog
-- #20's "ask which access path" — access_mode records that decision).
-- One identity can serve many rows (agency_manager case, e.g. one StarMedia
-- credential across every StarMedia client) or just one (direct case).
create table client_ad_account (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  client_id uuid not null references client(id),
  platform text not null check (platform in ('google-ads', 'yandex-direct')),
  external_account_id text not null, -- Google Ads customerId, or Yandex Direct Client-Login
  identity_id uuid not null references platform_identity(id),
  access_mode text not null check (access_mode in ('agency_manager', 'direct')),
  manager_id text, -- Google MCC customer_id when access_mode='agency_manager'; null for Yandex (Client-Login carries this instead) and for 'direct'
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (client_id, platform, external_account_id)
);

-- The human-approved "these conversions count" decision from the manual
-- Медавеню workflow (2026-08-18) — one active set per (client, platform),
-- overwritten on re-approval (no version history, a known limitation).
create table target_conversion (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  client_id uuid not null references client(id),
  platform text not null check (platform in ('google-ads', 'yandex-metrika')),
  external_conversion_id text not null,
  name text not null,
  approved_at timestamptz not null default now(),
  unique (client_id, platform, external_conversion_id)
);

-- Single fact table serving two purposes at once: (1) the source DataLens
-- connects to natively (Postgres connector) so a new client needs no new
-- DataLens wiring, just new rows here; (2) the history anomaly/trend
-- detection queries against later. conversions is jsonb (external_conversion_id
-- -> count for that day) rather than fixed columns, since each client's
-- approved conversion set differs (see target_conversion) — matches this
-- schema's existing jsonb-value convention (project_memory etc. in 0001_init.sql).
create table ad_stat (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  client_id uuid not null references client(id),
  platform text not null check (platform in ('google-ads', 'yandex-direct')),
  account_id text not null,
  date date not null,
  campaign_id text not null,
  campaign_name text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost numeric not null default 0,
  conversions jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  unique (client_id, platform, campaign_id, date)
);

create index ad_stat_client_date_idx on ad_stat (client_id, date);

alter table platform_identity enable row level security;
alter table client enable row level security;
alter table client_ad_account enable row level security;
alter table target_conversion enable row level security;
alter table ad_stat enable row level security;

create policy tenant_isolation on platform_identity
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on client
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on client_ad_account
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on target_conversion
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on ad_stat
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Known limitation (stated, not hidden — matches this repo's established
-- pattern): credential_ref is just an env-var name, not a real secret
-- store; target_conversion has no approval history (overwrite on
-- re-approve); no automated duplicate-conversion detection lives here —
-- that judgment call stays human (see docs/07-planning/backlog.md).
