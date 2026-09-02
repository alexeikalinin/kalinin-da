-- 0001_init.sql created tenant/project/task/session/role_spec/
-- tool_registry_entry/mcp_server/mcp_credential/client_kb_fact/
-- domain_kb_fact/project_memory/task_memory/company_memory/event/
-- fact_proposal/learning_lesson without granting standard Supabase role
-- privileges (only the postgres owner had them) — the exact same bug
-- 0003_grant_client_ad_accounts.sql already fixed for client_ad_account's
-- table family, just never applied to 0001's tables. 0006_agency_entity.sql
-- repeated the same omission for agency_entity. Found for real 2026-09-02
-- verifying the recovered SUPABASE_SERVICE_ROLE_KEY: the key itself
-- authenticates fine (PostgREST returns 42501 permission denied, not an
-- auth error), but service_role bypasses RLS, not GRANT — it still needs
-- one.
grant select, insert, update, delete on
  tenant, project, task, session, role_spec, tool_registry_entry,
  mcp_server, mcp_credential, client_kb_fact, domain_kb_fact,
  project_memory, task_memory, company_memory, event, fact_proposal,
  learning_lesson, agency_entity
to anon, authenticated, service_role;
