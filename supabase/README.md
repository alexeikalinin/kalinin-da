# supabase/

Implements: `docs/03-architecture/database.md`.

- `migrations/0001_init.sql` — the §2 ER diagram translated into real tables: every entity from the diagram, `tenant_id` required everywhere except `domain_kb_fact`/`role_spec`/`tool_registry_entry`/`mcp_server` (§4), and row-level security enabled on every tenant-scoped table. One addition beyond the diagram, called out in the migration's comments: `fact_proposal`, needed to implement the propose→confirm flow from Knowledge Base §2 (a pending proposal isn't yet a fact of any kind, so it isn't a status column on the target tables).
- RLS policies check `current_setting('app.tenant_id', true)`. In production (Supabase-hosted, ADR-0001) this is set per-request from the authenticated tenant rather than a literal `SET` — the policy shape itself doesn't change, only how the session variable gets its value.
- `tests/rls_isolation_test.sh` — not a manual check: spins up a disposable Postgres container (reuses the already-pulled Supabase Postgres image), applies the migration, seeds two tenants, and asserts — as a non-superuser role, since RLS doesn't apply to table owners — that each tenant sees only its own rows, that a session with **no** tenant context set sees **nothing** (fail-closed, not fail-open), and that the genuinely shared tables (`tool_registry_entry`) remain visible regardless. Cleans up after itself. Run it with:

  ```
  ./supabase/tests/rls_isolation_test.sh
  ```

This is the same claim `@ama/memory`'s tests make (NFR-1/NFR-2/NFR-14 isolation) — verified independently, at the real database layer, not just in the in-memory TypeScript reference implementation.

Not yet implemented: Supabase Auth wiring (how `app.tenant_id` actually gets set from a real session, Deployment's job), the `fact_proposal`→confirmed-record transition as a stored procedure (currently only exists as application logic in `@ama/knowledge-base`), migrations beyond this first one.
