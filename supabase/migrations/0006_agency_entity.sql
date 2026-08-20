-- Three-entity client hierarchy (memory: project-client-entity-hierarchy).
-- `client.agency_name` (0005) was a free-text label — Медавеню already has
-- agency_name='StarMedia', but nothing stopped a future row from misspelling
-- it or inventing a fourth bucket. This turns it into a real foreign key
-- against a fixed, small set of top-level entities the user has been
-- explicit and repeated about: Astrum Entertainment (games), StarMedia
-- (non-games), and the user's own future personal accounts. These three
-- must never cross-reference each other's data.
--
-- Deliberately NOT a new `tenant` row per entity: `tenant.kind` (0001_init)
-- is 'owner' vs 'white_label' — a different axis (who resells this SaaS),
-- not which agency brand a client belongs to. All three entities live under
-- the single existing owner tenant; isolation between them is enforced at
-- the client/agency_entity level, not RLS tenant_id (see this migration's
-- limitation note at the bottom).

create table agency_entity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  kind text not null check (kind in ('games', 'non_games', 'personal')),
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table agency_entity enable row level security;
create policy tenant_isolation on agency_entity
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Seed the three entities under the existing owner tenant.
insert into agency_entity (tenant_id, name, kind)
select id, 'Astrum Entertainment', 'games' from tenant where kind = 'owner'
union all
select id, 'StarMedia', 'non_games' from tenant where kind = 'owner'
union all
select id, 'Личные клиенты', 'personal' from tenant where kind = 'owner';

alter table client add column agency_entity_id uuid references agency_entity(id);

-- Backfill the one existing row (Медавеню, agency_name='StarMedia') against
-- the new FK by matching the text label — the only row that exists as of
-- this migration.
update client c
set agency_entity_id = e.id
from agency_entity e
where e.tenant_id = c.tenant_id and e.name = c.agency_name;

-- agency_name is kept (not dropped) as a plain display label — harmless,
-- and dropping a populated column is not worth the risk for one row — but
-- agency_entity_id is now the authoritative field for grouping/isolation
-- logic; agency_name should not be trusted alone going forward.
comment on column client.agency_name is
  'Display label only. agency_entity_id is authoritative for grouping/isolation — do not branch logic on this text field.';

comment on table agency_entity is
  'Fixed top-level client groupings (memory: project-client-entity-hierarchy). Astrum Entertainment = all games (Warface first); StarMedia = all non-game clients (Медавеню, DA.by); Личные клиенты = user''s own future direct clients. These three must never share data — always filter/write client rows by agency_entity_id, never assume a shared default.';

-- Known limitation (stated, not hidden): no DB-level trigger blocks a
-- client_ad_account/ad_stat row from being associated with the "wrong"
-- entity's client_id — isolation between entities relies on application
-- code always resolving and filtering by agency_entity_id correctly, same
-- as this repo's existing credential_ref/target_conversion limitations
-- (see 0005's closing comment). A stronger guarantee (e.g. a trigger
-- checking agency_entity_id consistency across client_ad_account's join to
-- client) is future work if cross-entity mistakes actually occur.
