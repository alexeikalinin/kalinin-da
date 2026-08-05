import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@ama/agent-framework";
import { MemoryStore } from "./store.ts";
import type { Actor } from "./actor.ts";

function agent(tenant: string): Actor {
  return { kind: "agent", tenantId: asTenantId(tenant) };
}
function reflection(tenant: string): Actor {
  return { kind: "reflection", tenantId: asTenantId(tenant) };
}
function approver(tenant: string): Actor {
  return { kind: "approver", tenantId: asTenantId(tenant) };
}

test("session/task/project can be written and read directly by an agent", () => {
  const store = new MemoryStore();
  const a = agent("tenant-a");
  store.write(a, { level: "project", tenantId: asTenantId("tenant-a"), key: "brief" }, "settings");
  assert.equal(
    store.read(a, { level: "project", tenantId: asTenantId("tenant-a"), key: "brief" }),
    "settings",
  );
});

test("NFR-14: an agent for tenant A cannot read tenant B's project memory", () => {
  const store = new MemoryStore();
  store.write(
    agent("tenant-b"),
    { level: "project", tenantId: asTenantId("tenant-b"), key: "brief" },
    "secret",
  );
  assert.throws(() =>
    store.read(agent("tenant-a"), {
      level: "project",
      tenantId: asTenantId("tenant-b"),
      key: "brief",
    }),
  );
});

test("NFR-14: an agent for tenant A cannot write into tenant B's memory", () => {
  const store = new MemoryStore();
  assert.throws(() =>
    store.write(
      agent("tenant-a"),
      { level: "task", tenantId: asTenantId("tenant-b"), key: "x" },
      "value",
    ),
  );
});

test("company/client_kb cannot be written directly, even by an agent", () => {
  const store = new MemoryStore();
  assert.throws(() =>
    store.write(
      agent("tenant-a"),
      { level: "company", tenantId: asTenantId("tenant-a"), key: "tone" },
      "formal",
    ),
  );
});

test("Memory System §2: a proposed fact only becomes real once an approver confirms it", () => {
  const store = new MemoryStore();
  const a = agent("tenant-a");
  const proposal = store.proposeFact(
    a,
    { level: "client_kb", tenantId: asTenantId("tenant-a"), key: "past-vk-ads" },
    "unsuccessful in 2025",
  );

  assert.equal(
    store.read(a, { level: "client_kb", tenantId: asTenantId("tenant-a"), key: "past-vk-ads" }),
    undefined,
  );

  store.confirmProposal(approver("tenant-a"), proposal.id);
  assert.equal(
    store.read(a, { level: "client_kb", tenantId: asTenantId("tenant-a"), key: "past-vk-ads" }),
    "unsuccessful in 2025",
  );
});

test("an approver from a different tenant cannot confirm someone else's proposal", () => {
  const store = new MemoryStore();
  const proposal = store.proposeFact(
    agent("tenant-a"),
    { level: "client_kb", tenantId: asTenantId("tenant-a"), key: "k" },
    "v",
  );
  assert.throws(() => store.confirmProposal(approver("tenant-b"), proposal.id));
});

test("Learning Memory can only be written by Reflection", () => {
  const store = new MemoryStore();
  assert.throws(() =>
    store.recordLesson(
      agent("tenant-a"),
      { level: "learning", tenantId: asTenantId("tenant-a"), key: "lesson-1" },
      "insight",
    ),
  );

  store.recordLesson(
    reflection("tenant-a"),
    { level: "learning", tenantId: asTenantId("tenant-a"), key: "lesson-1" },
    "insight",
  );
  assert.equal(
    store.read(agent("tenant-a"), {
      level: "learning",
      tenantId: asTenantId("tenant-a"),
      key: "lesson-1",
    }),
    "insight",
  );
});

test("Domain KB is shared across tenants once confirmed", () => {
  const store = new MemoryStore();
  const proposal = store.proposeFact(
    agent("tenant-a"),
    { level: "domain_kb", tenantId: asTenantId("tenant-a"), key: "seo-basics" },
    "meta description ~120 chars",
  );
  store.confirmProposal(approver("tenant-a"), proposal.id);

  // A completely different tenant can read it — it's not tenant data.
  const readByOtherTenant = store.read(agent("tenant-b"), {
    level: "domain_kb",
    tenantId: asTenantId("tenant-b"),
    key: "seo-basics",
  });
  assert.equal(readByOtherTenant, "meta description ~120 chars");
});

test("clearSession removes only that session's keys", () => {
  const store = new MemoryStore();
  const a = agent("tenant-a");
  const tenantId = asTenantId("tenant-a");
  store.write(a, { level: "session", tenantId, key: "session-1:scratch" }, "temp");
  store.write(a, { level: "session", tenantId, key: "session-2:scratch" }, "other");

  store.clearSession(a, "session-1");

  assert.equal(store.read(a, { level: "session", tenantId, key: "session-1:scratch" }), undefined);
  assert.equal(store.read(a, { level: "session", tenantId, key: "session-2:scratch" }), "other");
});

test("archiveTaskIntoProject copies task memory into project without deleting it", () => {
  const store = new MemoryStore();
  const a = agent("tenant-a");
  const tenantId = asTenantId("tenant-a");
  store.write(a, { level: "task", tenantId, key: "task-1:findings" }, "competitor list");

  const archived = store.archiveTaskIntoProject(a, "task-1", "project-1");
  assert.equal(archived.length, 1);

  assert.equal(
    store.read(a, { level: "project", tenantId, key: "project-1:task-1:findings" }),
    "competitor list",
  );
  // Task-level copy must still be readable — Recovery/Reflection need it.
  assert.equal(
    store.read(a, { level: "task", tenantId, key: "task-1:findings" }),
    "competitor list",
  );
});

test("Security §4/§5: only an approver can request deletion of a tenant's data", () => {
  const store = new MemoryStore();
  const tenantId = asTenantId("tenant-a");
  store.write(agent("tenant-a"), { level: "project", tenantId, key: "brief" }, "x");

  assert.throws(() => store.deleteAllForTenant(agent("tenant-a")));
});

test("deleteAllForTenant removes that tenant's data everywhere, leaves other tenants and the shared Domain KB untouched", () => {
  const store = new MemoryStore();
  const tenantIdA = asTenantId("tenant-a");
  const tenantIdB = asTenantId("tenant-b");

  store.write(agent("tenant-a"), { level: "project", tenantId: tenantIdA, key: "brief" }, "a-data");
  store.write(agent("tenant-a"), { level: "task", tenantId: tenantIdA, key: "t1:notes" }, "a-notes");
  store.proposeFact(agent("tenant-a"), { level: "client_kb", tenantId: tenantIdA, key: "tone" }, "formal");

  store.write(agent("tenant-b"), { level: "project", tenantId: tenantIdB, key: "brief" }, "b-data");

  const domainProposal = store.proposeFact(
    agent("tenant-a"),
    { level: "domain_kb", tenantId: tenantIdA, key: "seo-basics" },
    "meta ~120 chars",
  );
  store.confirmProposal(approver("tenant-a"), domainProposal.id);

  const result = store.deleteAllForTenant(approver("tenant-a"));
  assert.equal(result.recordsDeleted, 2); // project brief + task notes
  assert.equal(result.proposalsDeleted, 1); // the pending client_kb proposal

  assert.equal(store.read(agent("tenant-a"), { level: "project", tenantId: tenantIdA, key: "brief" }), undefined);
  assert.equal(store.listProposals(agent("tenant-a")).length, 0);

  // Tenant B is untouched.
  assert.equal(store.read(agent("tenant-b"), { level: "project", tenantId: tenantIdB, key: "brief" }), "b-data");

  // Shared Domain KB survives — it wasn't tenant-a's data to delete.
  assert.equal(
    store.read(agent("tenant-b"), { level: "domain_kb", tenantId: tenantIdB, key: "seo-basics" }),
    "meta ~120 chars",
  );
});
