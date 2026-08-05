-- Database (docs/03-architecture/database.md) — concептуальная ER-схема §2,
-- переведённая в реальные таблицы. Stage 2, первая реализация.
--
-- tenant_id обязателен везде, кроме domain_kb_fact / role_spec /
-- tool_registry_entry / mcp_server (Database §1, §4).
--
-- RLS: policies reference current_setting('app.tenant_id', true) as a
-- testable GUC. In production (Supabase-hosted, ADR-0001) this value is set
-- per-request from the authenticated tenant (auth.jwt() claim) rather than
-- a literal SET — the policy shape itself does not change.

create extension if not exists pgcrypto;

create table tenant (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('owner', 'white_label')),
  created_at timestamptz not null default now()
);

create table project (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  approval_level text not null check (approval_level in ('output-only', 'strategy-gate')),
  execution_tier text not null check (execution_tier in ('fast', 'standard')),
  status text not null default 'building',
  created_at timestamptz not null default now()
);

create table task (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  project_id uuid not null references project(id),
  role_id text not null,
  depends_on uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table session (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  project_id uuid not null references project(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Memory System §1 — Project/Task/Company/Client KB all share the same
-- key/value/written_at shape our @ama/memory reference implementation
-- already uses; the ER diagram keeps them as separate entities (per-level
-- access rules differ), so the tables stay separate too.

create table project_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  project_id uuid not null references project(id),
  key text not null,
  value jsonb not null,
  written_at timestamptz not null default now(),
  unique (project_id, key)
);

create table task_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  task_id uuid not null references task(id),
  key text not null,
  value jsonb not null,
  written_at timestamptz not null default now(),
  unique (task_id, key)
);

create table company_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  key text not null,
  value jsonb not null,
  written_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table client_kb_fact (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  key text not null,
  value jsonb not null,
  written_at timestamptz not null default now(),
  unique (tenant_id, key)
);

-- Database §4 — no tenant_id: shared across all tenants (Memory System §3).
create table domain_kb_fact (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  written_at timestamptz not null default now()
);

-- Implementation addition, not a separate box in the §2 ER diagram: staging
-- for the propose->confirm flow required by Knowledge Base §2 / Memory
-- System §2 (an agent's finding is never applied directly). Kept as its own
-- table rather than a status column on the target tables, since a pending
-- proposal is not yet a fact of any kind.
create table fact_proposal (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  level text not null check (level in ('company', 'domain_kb', 'client_kb')),
  key text not null,
  value jsonb not null,
  proposed_by text not null,
  proposed_at timestamptz not null default now()
);

-- Learning System §1/§4 — tenant-scoped by default; a generalized lesson
-- lives in domain_kb_fact once confirmed, not here.
create table learning_lesson (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  role_id text not null,
  group_key text not null,
  confidence text not null check (confidence in ('observation', 'pattern')),
  situation text not null,
  outcome text not null check (outcome in ('success', 'problem')),
  conclusion text not null,
  written_at timestamptz not null default now()
);

-- Events §1 — append-only.
create table event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  project_id uuid not null references project(id),
  task_id uuid references task(id),
  role_id text,
  type text not null,
  payload jsonb not null default '{}',
  at timestamptz not null default now()
);

-- Database §4 — no tenant_id: the role contract itself is shared; the data
-- a role works with is tenant-specific, the spec is not.
create table role_spec (
  role_id text primary key,
  display_name text not null,
  purpose text not null,
  responsibility text not null,
  completion_criteria text not null,
  memory_levels text[] not null default '{}',
  tool_ids text[] not null default '{}'
);

-- Database §4 — no tenant_id: "this tool type exists and is approved" is
-- global (Tool Integration, Open Question #1).
create table tool_registry_entry (
  tool_id text primary key,
  display_name text not null,
  approved_at timestamptz not null default now()
);

create table mcp_server (
  id uuid primary key default gen_random_uuid(),
  tool_id text not null references tool_registry_entry(tool_id),
  endpoint text not null
);

-- Tenant-specific credentials ARE tenant data (Database §3 example, MCP
-- Integration §3).
create table mcp_credential (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  tool_id text not null references tool_registry_entry(tool_id),
  credential jsonb not null,
  issued_at timestamptz not null default now(),
  unique (tenant_id, tool_id)
);

-- ---------------------------------------------------------------------
-- Row-level security (NFR-1, NFR-2, NFR-14; Database §1)
-- ---------------------------------------------------------------------

alter table project enable row level security;
alter table task enable row level security;
alter table session enable row level security;
alter table project_memory enable row level security;
alter table task_memory enable row level security;
alter table company_memory enable row level security;
alter table client_kb_fact enable row level security;
alter table fact_proposal enable row level security;
alter table learning_lesson enable row level security;
alter table event enable row level security;
alter table mcp_credential enable row level security;

create policy tenant_isolation on project
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on task
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on session
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on project_memory
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on task_memory
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on company_memory
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on client_kb_fact
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on fact_proposal
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on learning_lesson
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on event
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenant_isolation on mcp_credential
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- domain_kb_fact, role_spec, tool_registry_entry, mcp_server: intentionally
-- NOT row-level-secured — they have no tenant_id because they are shared
-- (Database §4), not because isolation was forgotten.
