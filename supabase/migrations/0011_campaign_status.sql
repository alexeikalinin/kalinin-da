-- Live campaign run-state (Google Ads + Yandex Direct), generalized from
-- Astrum Analyzer's Warface-specific campaign_status table (same name/shape
-- there: platform, campaign_id, campaign_name, is_running, raw_status,
-- synced_at — see ~/Documents/VibeCoding/Astrum Analyzer/supabase/migrations/
-- 0005_campaign_status.sql). Ported here as a generic, tenant-scoped table
-- serving every client_ad_account, not one client's own local database.
--
-- Why this exists: the weekly trend-degradation detector (campaign-trends.ts)
-- needs to tell "this campaign's CPA has been climbing for 3 weeks — real
-- problem" apart from "this campaign was paused two weeks ago and the last
-- few days are just the tail end draining out" — a CPA climb on a dead
-- campaign isn't something to act on. Separate from ad_stat (which is
-- period-scoped, one row per campaign+day) because status isn't
-- period-scoped — it's "is this campaign live right now", refreshed on
-- every sync and overwritten in place, not appended.

create table campaign_status (
  tenant_id uuid not null references tenant(id),
  client_id uuid not null references client(id),
  platform text not null check (platform in ('google-ads', 'yandex-direct')),
  campaign_id text not null,
  campaign_name text,
  is_running boolean not null,
  raw_status text, -- Google Ads: campaign.status (ENABLED/PAUSED/REMOVED); Yandex: Status+State (e.g. "ACCEPTED"+"ON")
  synced_at timestamptz not null default now(),
  primary key (client_id, platform, campaign_id)
);

alter table campaign_status enable row level security;

create policy tenant_isolation on campaign_status
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 0010_grant_owner_tables.sql found this exact class of bug for 0001/0006's
-- tables: service_role authenticates fine over PostgREST but still needs an
-- explicit GRANT (RLS bypass alone isn't enough) — granting it here up
-- front so this table doesn't repeat that omission.
grant select, insert, update, delete on campaign_status to anon, authenticated, service_role;
