-- 0002_client_ad_accounts.sql created tables without granting standard
-- Supabase role privileges (only the postgres owner had them) — found for
-- real 2026-08-18 when the /api/clients/*/sync route hit "permission
-- denied for table client_ad_account" using the service_role key, which
-- should bypass RLS but still needs a plain GRANT to touch the table at
-- all. RLS policies (tenant_isolation) remain the real access control for
-- anon/authenticated; service_role bypasses RLS but not GRANT.
grant select, insert, update, delete on
  platform_identity, client, client_ad_account, target_conversion, ad_stat
to anon, authenticated, service_role;
