// Identifiers used across the platform. Branded so a TenantId can never be
// silently passed where a ProjectId (etc.) is expected — the isolation
// mechanism in Queue §5 depends on tenantId never being mixed up at compile time.

export type TenantId = string & { readonly __brand: "TenantId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };
export type TaskId = string & { readonly __brand: "TaskId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type RoleId = string & { readonly __brand: "RoleId" };

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
}

export function asTenantId(value: string): TenantId {
  assertNonEmpty(value, "TenantId");
  return value as TenantId;
}

export function asProjectId(value: string): ProjectId {
  assertNonEmpty(value, "ProjectId");
  return value as ProjectId;
}

export function asTaskId(value: string): TaskId {
  assertNonEmpty(value, "TaskId");
  return value as TaskId;
}

export function asSessionId(value: string): SessionId {
  assertNonEmpty(value, "SessionId");
  return value as SessionId;
}

export function asRoleId(value: string): RoleId {
  assertNonEmpty(value, "RoleId");
  return value as RoleId;
}
