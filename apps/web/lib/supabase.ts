import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Client ad-account reporting foundation (2026-08-18) — the first real use
// of Supabase in this codebase (Database migration 0001_init.sql existed
// but was never wired into anything; 0002_client_ad_accounts.sql is the
// first schema this file actually talks to). Uses the service_role key —
// bypasses RLS, backend-only, never sent to the browser. Cached on
// globalThis for the same reason as lib/singletons.ts (Next.js dev-mode
// re-evaluates route modules on every request but keeps the process alive).
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const globalForSupabase = globalThis as unknown as { __amaSupabase__?: SupabaseClient };

export function getSupabase(): SupabaseClient {
  if (!globalForSupabase.__amaSupabase__) {
    globalForSupabase.__amaSupabase__ = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
  }
  return globalForSupabase.__amaSupabase__;
}

// Bridges the existing in-process OWNER_TENANT_ID (a plain string,
// lib/singletons.ts) to the real Supabase tenant.id (uuid) the new
// client-reporting tables use for RLS/FKs — see memory
// reference_supabase_project.md for the row this points to.
export function getSupabaseOwnerTenantId(): string {
  return requiredEnv("SUPABASE_OWNER_TENANT_ID");
}
