import type { TenantId } from "@ama/agent-framework";

// Who is asking to read/write memory — the CRUD table in Memory System §1
// grants different levels different write permissions depending on this.
export type Actor =
  | { readonly kind: "agent"; readonly tenantId: TenantId }
  | { readonly kind: "reflection"; readonly tenantId: TenantId }
  | { readonly kind: "approver"; readonly tenantId: TenantId }
  // Automated confirmation for minor, low-risk facts (Knowledge Base §2.3,
  // e.g. PM Agent / Agent Architect applying an internal rule) — distinct
  // from "approver" so it's always visible in an audit trail which facts a
  // human actually confirmed versus which were auto-approved.
  | { readonly kind: "system"; readonly tenantId: TenantId };
