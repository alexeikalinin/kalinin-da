import type { MemoryLevel, TenantId } from "@ama/agent-framework";
import type { Actor } from "./actor.ts";

// Memory System §1: only these three levels are ever written directly.
const DIRECT_WRITE_LEVELS: readonly MemoryLevel[] = ["session", "task", "project"];

// Company/domain_kb/client_kb: "через утверждённое обновление" — never a bare
// write, always propose -> confirm. Memory System §2 closes this exact
// question: an agent may never write Knowledge Base directly.
const GATED_LEVELS: readonly MemoryLevel[] = ["company", "domain_kb", "client_kb"];

// A shared, non-tenant-scoped bucket for the Domain KB (Memory System §3).
const SHARED_TENANT = "shared" as TenantId;

function isSharedLevel(level: MemoryLevel): boolean {
  return level === "domain_kb";
}

export interface MemoryRef {
  readonly level: MemoryLevel;
  readonly tenantId: TenantId;
  readonly key: string;
}

export interface MemoryRecord extends MemoryRef {
  readonly value: unknown;
  readonly writtenAt: number;
}

export interface Proposal extends MemoryRef {
  readonly id: string;
  readonly value: unknown;
  readonly proposedBy: Actor["kind"];
  readonly proposedAt: number;
}

function recordKey(level: MemoryLevel, tenantId: TenantId, key: string): string {
  const scope = isSharedLevel(level) ? SHARED_TENANT : tenantId;
  return `${level}:${scope}:${key}`;
}

// Isolation is not optional per level (NFR-14) — every read/write not aimed
// at the shared Domain KB must match the actor's own tenant, full stop.
function assertSameTenant(actor: Actor, ref: MemoryRef): void {
  if (isSharedLevel(ref.level)) return;
  if (actor.tenantId !== ref.tenantId) {
    throw new Error(
      `Tenant isolation violation: actor for tenant "${actor.tenantId}" attempted to access memory of tenant "${ref.tenantId}" (level "${ref.level}").`,
    );
  }
}

export class MemoryStore {
  #records = new Map<string, MemoryRecord>();
  #proposals = new Map<string, Proposal>();
  #nextProposalId = 1;

  read(actor: Actor, ref: MemoryRef): unknown {
    return this.readRecord(actor, ref)?.value;
  }

  // Knowledge Base §3 needs the full record (not just the value) to report
  // a conflict — when it was confirmed, not only what it says.
  readRecord(actor: Actor, ref: MemoryRef): MemoryRecord | undefined {
    assertSameTenant(actor, ref);
    return this.#records.get(recordKey(ref.level, ref.tenantId, ref.key));
  }

  // Learning System §2 needs to scan for "relevant lessons," not just fetch
  // one known key — this is the general enumeration primitive that requires
  // (isolation still applies: only the actor's own tenant, or the shared
  // Domain KB, is ever returned).
  listRecords(actor: Actor, level: MemoryLevel): readonly MemoryRecord[] {
    const scope = isSharedLevel(level) ? SHARED_TENANT : actor.tenantId;
    const prefix = `${level}:${scope}:`;
    const results: MemoryRecord[] = [];
    for (const [key, record] of this.#records) {
      if (key.startsWith(prefix)) results.push(record);
    }
    return results;
  }

  // Session/Task/Project: any agent (or Reflection/approver, for symmetry)
  // may write directly, scoped to their own tenant.
  write(actor: Actor, ref: MemoryRef, value: unknown): void {
    assertSameTenant(actor, ref);
    if (!DIRECT_WRITE_LEVELS.includes(ref.level)) {
      throw new Error(
        `Level "${ref.level}" cannot be written directly — propose a fact (company/domain_kb/client_kb) or record a lesson (learning) instead.`,
      );
    }
    this.#records.set(recordKey(ref.level, ref.tenantId, ref.key), {
      ...ref,
      value,
      writtenAt: Date.now(),
    });
  }

  // Company/Domain KB/Client KB: staged, never applied until an approver
  // confirms it (Memory System §2, Knowledge Base §2).
  proposeFact(actor: Actor, ref: MemoryRef, value: unknown): Proposal {
    assertSameTenant(actor, ref);
    if (!GATED_LEVELS.includes(ref.level)) {
      throw new Error(`Level "${ref.level}" is not a gated (propose/confirm) level.`);
    }
    const proposal: Proposal = {
      ...ref,
      id: `proposal-${this.#nextProposalId++}`,
      value,
      proposedBy: actor.kind,
      proposedAt: Date.now(),
    };
    this.#proposals.set(proposal.id, proposal);
    return proposal;
  }

  confirmProposal(actor: Actor, proposalId: string): MemoryRecord {
    if (actor.kind !== "approver" && actor.kind !== "system") {
      throw new Error(
        "Only an approver (or the system, for auto-confirmed minor facts) can confirm a proposed fact.",
      );
    }
    const proposal = this.#proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Unknown proposal "${proposalId}".`);
    }
    assertSameTenant(actor, proposal);
    this.#proposals.delete(proposalId);
    const record: MemoryRecord = {
      level: proposal.level,
      tenantId: proposal.tenantId,
      key: proposal.key,
      value: proposal.value,
      writtenAt: Date.now(),
    };
    this.#records.set(recordKey(record.level, record.tenantId, record.key), record);
    return record;
  }

  rejectProposal(actor: Actor, proposalId: string): void {
    if (actor.kind !== "approver") {
      throw new Error("Only an approver can reject a proposed fact.");
    }
    const proposal = this.#proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Unknown proposal "${proposalId}".`);
    }
    assertSameTenant(actor, proposal);
    this.#proposals.delete(proposalId);
  }

  listProposals(actor: Actor): readonly Proposal[] {
    return [...this.#proposals.values()].filter(
      (p) => isSharedLevel(p.level) || p.tenantId === actor.tenantId,
    );
  }

  // Learning Memory: "Только через Reflection" — no propose/confirm step,
  // Reflection is the trusted source (Memory System §1).
  recordLesson(actor: Actor, ref: MemoryRef, value: unknown): void {
    if (actor.kind !== "reflection") {
      throw new Error("Only Reflection can write to Learning Memory.");
    }
    if (ref.level !== "learning") {
      throw new Error(`recordLesson only applies to the "learning" level.`);
    }
    assertSameTenant(actor, ref);
    this.#records.set(recordKey(ref.level, ref.tenantId, ref.key), {
      ...ref,
      value,
      writtenAt: Date.now(),
    });
  }

  // Memory System §1: Session Memory ends automatically with the Session.
  // Keys are expected to be namespaced "sessionId:field" by convention.
  clearSession(actor: Actor, sessionId: string): void {
    const prefix = recordKey("session", actor.tenantId, `${sessionId}:`);
    for (const key of [...this.#records.keys()]) {
      if (key.startsWith(prefix)) this.#records.delete(key);
    }
  }

  // Memory System §1: Task Memory is archived into Project Memory on
  // completion — "не удаляется полностью", so the task-level copy stays too
  // (Recovery/Reflection need to see it). Keys are namespaced "taskId:field".
  // The archived copy's project-level key is prefixed by projectId, matching
  // the convention createAgentMemoryPort/assemblePrompt use for every other
  // Project Memory read/write — otherwise a project-scoped reader would
  // never find what got archived here.
  archiveTaskIntoProject(actor: Actor, taskId: string, projectId: string): readonly MemoryRecord[] {
    const prefix = recordKey("task", actor.tenantId, `${taskId}:`);
    const archived: MemoryRecord[] = [];
    for (const record of this.#records.values()) {
      const key = recordKey(record.level, record.tenantId, record.key);
      if (!key.startsWith(prefix)) continue;
      const projectKey = `${projectId}:${record.key}`;
      const projectRecord: MemoryRecord = {
        level: "project",
        tenantId: actor.tenantId,
        key: projectKey,
        value: record.value,
        writtenAt: Date.now(),
      };
      this.#records.set(recordKey("project", actor.tenantId, projectKey), projectRecord);
      archived.push(projectRecord);
    }
    return archived;
  }

  // Security §4/§5 — logs and Project Memory are never auto-deleted; the
  // only path to deletion is an explicit tenant request, confirmed by an
  // approver. Domain KB is untouched — it isn't this tenant's data to
  // delete (Memory System §3).
  deleteAllForTenant(actor: Actor): { readonly recordsDeleted: number; readonly proposalsDeleted: number } {
    if (actor.kind !== "approver") {
      throw new Error("Only an approver can request deletion of a tenant's data.");
    }

    let recordsDeleted = 0;
    for (const [key, record] of this.#records) {
      if (record.tenantId === actor.tenantId && !isSharedLevel(record.level)) {
        this.#records.delete(key);
        recordsDeleted += 1;
      }
    }

    let proposalsDeleted = 0;
    for (const [id, proposal] of this.#proposals) {
      if (proposal.tenantId === actor.tenantId && !isSharedLevel(proposal.level)) {
        this.#proposals.delete(id);
        proposalsDeleted += 1;
      }
    }

    return { recordsDeleted, proposalsDeleted };
  }
}
