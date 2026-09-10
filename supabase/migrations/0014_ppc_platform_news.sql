-- PPC platform news digest (2026-09-10) — keeps the PPC agent's knowledge
-- of ad-platform capabilities (new ad formats, deprecations, bidding
-- changes) from going stale between training cutoffs. Trigger: PPC agent
-- didn't know Google Ads RSAs had been replaced by combinatorial ads.
--
-- No tenant_id: this is shared platform knowledge, not client data — same
-- reasoning as domain_kb_fact in 0001_init.sql (Database §4).

create table ppc_platform_news (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('google-ads', 'yandex-direct', 'vk-ads', 'meta-ads')),
  title text not null,
  summary text not null,
  category text not null, -- e.g. 'new_ad_format', 'bidding_change', 'deprecation', 'targeting_change', 'policy_change'
  source_url text,
  detected_at timestamptz not null default now(),
  -- Dedupe across runs: the same news item found again in a later biweekly
  -- run (still within its recency window) upserts instead of duplicating.
  unique (platform, title)
);

create index ppc_platform_news_recent_idx on ppc_platform_news (detected_at desc);

-- One row per sync attempt (found 0 items or many) — decouples the
-- biweekly cadence gate (apps/web/app/api/cron/sync-ppc-platform-news)
-- from whether any news actually existed that run, since Vercel cron has
-- no native >1-week interval and the route self-gates against this table.
create table ppc_platform_news_sync_run (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  items_found integer not null default 0
);

grant select, insert, update, delete on ppc_platform_news, ppc_platform_news_sync_run
to anon, authenticated, service_role;
