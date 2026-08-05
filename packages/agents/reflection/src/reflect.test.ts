import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId } from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { findRelevantLessons } from "@ama/learning";
import {
  taskNeedsRevision,
  taskQueued,
  taskStarted,
  taskSucceeded,
  type WorkflowEvent,
} from "@ama/events";
import { reflect } from "./reflect.ts";

function reflection(): Actor {
  return { kind: "reflection", tenantId: asTenantId("tenant-a") };
}

// Reflection §5 — the reference scenario example, almost verbatim: Media
// Buyer needed revision twice in one Project over a budget misunderstanding.
function mediaBuyerProjectEvents(taskId: string): readonly WorkflowEvent[] {
  const ref = {
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId(taskId),
    roleId: asRoleId("media-buyer"),
  };
  return [
    taskQueued(ref),
    taskStarted(ref),
    taskNeedsRevision(ref, "budget unclear"),
    taskNeedsRevision(ref, "budget still unclear"),
    taskSucceeded(ref),
  ];
}

test("a task with two revisions in one Project produces a single observation, not yet a systemic finding", () => {
  const store = new MemoryStore();
  const result = reflect(
    store,
    reflection(),
    asTenantId("tenant-a"),
    asProjectId("project-1"),
    mediaBuyerProjectEvents("mb-1"),
  );

  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0]?.confidence, "observation");
  assert.equal(result.systemicFindings.length, 0);
});

test("the same problem across three Projects becomes a systemic finding (Learning System §3 threshold)", () => {
  const store = new MemoryStore();
  const actor = reflection();
  const tenantId = asTenantId("tenant-a");

  reflect(store, actor, tenantId, asProjectId("project-1"), mediaBuyerProjectEvents("mb-1"));
  reflect(store, actor, tenantId, asProjectId("project-2"), mediaBuyerProjectEvents("mb-2"));
  const third = reflect(
    store,
    actor,
    tenantId,
    asProjectId("project-3"),
    mediaBuyerProjectEvents("mb-3"),
  );

  assert.equal(third.systemicFindings.length, 1);
  assert.equal(third.systemicFindings[0]?.lesson.confidence, "pattern");
});

test("a clean first-try success is not recorded as a lesson (avoids noise, Reflection Purpose)", () => {
  const store = new MemoryStore();
  const ref = {
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("t1"),
    roleId: asRoleId("ppc"),
  };
  const events: WorkflowEvent[] = [taskQueued(ref), taskStarted(ref), taskSucceeded(ref)];

  const result = reflect(store, reflection(), asTenantId("tenant-a"), asProjectId("project-1"), events);
  assert.equal(result.lessons.length, 0);
});

test("recorded lessons are retrievable by the role they concern", () => {
  const store = new MemoryStore();
  const actor = reflection();
  reflect(store, actor, asTenantId("tenant-a"), asProjectId("project-1"), mediaBuyerProjectEvents("mb-1"));

  const relevant = findRelevantLessons(store, actor, asRoleId("media-buyer"));
  assert.equal(relevant.length, 1);
});
