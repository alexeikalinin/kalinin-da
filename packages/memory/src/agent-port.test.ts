import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { MemoryStore } from "./store.ts";
import { createAgentMemoryPort } from "./agent-port.ts";

function context() {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("ppc"),
    executionTier: "fast",
    approvalLevel: "strategy-gate",
  });
}

test("a role can read/write levels it declared access to", async () => {
  const store = new MemoryStore();
  const port = createAgentMemoryPort(store, context(), ["task", "project"]);

  await port.write("task", "task-1:notes", "draft");
  assert.equal(await port.read("task", "task-1:notes"), "draft");
});

test("a role is blocked from touching a memory level it did not declare (Agent Framework §1)", async () => {
  const store = new MemoryStore();
  const port = createAgentMemoryPort(store, context(), ["task"]);

  await assert.rejects(() => port.read("company", "tone"));
  await assert.rejects(() => port.write("company", "tone", "formal"));
});

test("writing to a gated level through the agent port creates a proposal, not a direct write (Memory System §4)", async () => {
  const store = new MemoryStore();
  const port = createAgentMemoryPort(store, context(), ["client_kb"]);

  await port.write("client_kb", "past-vk-ads", "unsuccessful in 2025");

  // Not visible yet — only a pending proposal exists until an approver confirms it.
  assert.equal(await port.read("client_kb", "past-vk-ads"), undefined);

  const proposals = store.listProposals({ kind: "agent", tenantId: asTenantId("tenant-a") });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.value, "unsuccessful in 2025");
});

test("an agent can never write Learning Memory, even if the role declares it", async () => {
  const store = new MemoryStore();
  const port = createAgentMemoryPort(store, context(), ["learning"]);

  await assert.rejects(() => port.write("learning", "lesson-1", "insight"));
});

test("two concurrent Projects for the same tenant never collide on the same Project Memory key", async () => {
  const store = new MemoryStore();
  const projectA = createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-a"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("media-buyer"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });
  const projectB = createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-b"),
    taskId: asTaskId("task-2"),
    roleId: asRoleId("media-buyer"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  const portA = createAgentMemoryPort(store, projectA, ["project"]);
  const portB = createAgentMemoryPort(store, projectB, ["project"]);

  await portA.write("project", "media-budget-plan", { totalBudget: 100 });
  await portB.write("project", "media-budget-plan", { totalBudget: 999 });

  assert.deepEqual(await portA.read("project", "media-budget-plan"), { totalBudget: 100 });
  assert.deepEqual(await portB.read("project", "media-budget-plan"), { totalBudget: 999 });
});

test("two Tasks in the same Project never collide on the same Task Memory key", async () => {
  const store = new MemoryStore();
  const taskA = createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("ppc-task"),
    roleId: asRoleId("ppc"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });
  const taskB = createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("research-task"),
    roleId: asRoleId("research"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  const portA = createAgentMemoryPort(store, taskA, ["task"]);
  const portB = createAgentMemoryPort(store, taskB, ["task"]);

  await portA.write("task", "summary", "PPC summary");
  await portB.write("task", "summary", "Research summary");

  assert.equal(await portA.read("task", "summary"), "PPC summary");
  assert.equal(await portB.read("task", "summary"), "Research summary");
});
