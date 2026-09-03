-- Standalone table for the agency's own US self-promo leads
-- (docs: project_self_promo_us_launch / project_client_entity_hierarchy
-- memory — "Kalinin Digital Agency — self-promo" is its own top-level
-- entity, confirmed explicitly by the user, never a client). Deliberately
-- NOT part of the client/client_ad_account/ad_stat family (0002_client_ad_accounts.sql):
-- those model real ad accounts run FOR clients (StarMedia, Astrum
-- Entertainment); this table has no foreign key into that family at all,
-- so it structurally cannot be joined with StarMedia/Astrum client data —
-- the same "never cross-reference" boundary already enforced between
-- Astrum and StarMedia (project_client_entity_hierarchy), applied here by
-- keeping the table itself separate rather than adding a discriminator
-- column to a shared table.
--
-- Single-tenant reality check: this schema still has one tenant_id
-- (OWNER_TENANT_ID, see api-application-layer.md) — this table doesn't
-- introduce real multi-tenant isolation, it just never references the
-- client-scoped tables, which is the isolation this codebase actually has
-- today between its top-level entities.

create table self_promo_lead (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  email text not null,
  message text not null,
  -- names which self-promo surface the lead came from — only one exists
  -- today (landing-pages/self-promo-us), but kept a free text column
  -- rather than hardcoding a single-value assumption.
  source text not null default 'self_promo_us_landing',
  created_at timestamptz not null default now()
);

alter table self_promo_lead enable row level security;

create policy tenant_isolation on self_promo_lead
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 0010_grant_owner_tables.sql found this exact class of bug for earlier
-- tables: service_role authenticates fine over PostgREST but still needs
-- an explicit GRANT (RLS bypass alone isn't enough) — granting it here up
-- front so this table doesn't repeat that omission.
grant select, insert, update, delete on self_promo_lead to anon, authenticated, service_role;
