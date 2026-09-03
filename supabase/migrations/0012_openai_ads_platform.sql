-- Adds "openai-ads" as a third value alongside 'google-ads'/'yandex-direct'
-- (docs/openai-ads-integration-research.md, Phase 4: OpenAI Ads has a real
-- public API — api.ads.openai.com/v1 — so it plugs into the same
-- platform_identity/client_ad_account/ad_stat/campaign_status model instead
-- of a parallel schema). Widens the existing inline CHECK constraints rather
-- than duplicating tables — same normalized-model instruction the research
-- doc followed. Postgres' default-named inline constraints follow the
-- `<table>_<column>_check` convention, confirmed against how 0002/0011
-- declared them (no explicit `constraint <name>` given there).
--
-- Auth model note: platform_identity.credential_ref for an 'openai-ads' row
-- names a single env var holding a static API key (issued per ad account in
-- Ads Manager → Settings), not an OAuth refresh/access-token pair like
-- Google/Yandex — see openai-ads-auth.ts. access_mode is always 'direct' for
-- this platform (no MCC/manager-account concept exists on OpenAI's side —
-- see research doc Phase 2); manager_id stays null.

alter table platform_identity drop constraint platform_identity_platform_check;
alter table platform_identity add constraint platform_identity_platform_check
  check (platform in ('google-ads', 'yandex-direct', 'openai-ads'));

alter table client_ad_account drop constraint client_ad_account_platform_check;
alter table client_ad_account add constraint client_ad_account_platform_check
  check (platform in ('google-ads', 'yandex-direct', 'openai-ads'));

alter table ad_stat drop constraint ad_stat_platform_check;
alter table ad_stat add constraint ad_stat_platform_check
  check (platform in ('google-ads', 'yandex-direct', 'openai-ads'));

alter table campaign_status drop constraint campaign_status_platform_check;
alter table campaign_status add constraint campaign_status_platform_check
  check (platform in ('google-ads', 'yandex-direct', 'openai-ads'));

-- target_conversion is intentionally left untouched: its platform column
-- names the *measurement* platform for an approved conversion
-- ('google-ads' | 'yandex-metrika'), not the ad-serving platform. OpenAI
-- Ads' own conversion tracking is the Conversions API (bzr.openai.com),
-- configured per-campaign via conversion_event_setting_ids directly on the
-- campaign resource, not through this table — see openai-ads.ts.
