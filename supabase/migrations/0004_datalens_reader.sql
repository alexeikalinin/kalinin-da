-- DataLens BI reporting foundation (2026-08-18) — a dedicated, read-only
-- Postgres role for DataLens's native PostgreSQL connector, instead of
-- handing it the service_role/postgres credential. tenant_isolation's RLS
-- policy reads current_setting('app.tenant_id') which DataLens's plain SQL
-- connection never sets, so without an explicit policy this role would see
-- zero rows. Scoped to just this one role (not anon/authenticated) — this
-- is agency-internal reporting access, not a client-facing RLS bypass;
-- only one tenant (owner) exists right now, and future client-facing
-- access is controlled by which dashboard/workbook a client is given, not
-- by DB-level tenant separation for this reporting role.
create policy datalens_read_all on client for select to datalens_reader using (true);
create policy datalens_read_all on client_ad_account for select to datalens_reader using (true);
create policy datalens_read_all on target_conversion for select to datalens_reader using (true);
create policy datalens_read_all on ad_stat for select to datalens_reader using (true);
