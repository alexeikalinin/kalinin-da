import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId } from "@ama/agent-framework";
import { taskFailed, taskNeedsRevision, taskQueued, taskStarted, taskSucceeded } from "@ama/events";
import { analyzeProjectEvents } from "./analyze.ts";

function ref(taskId: string, roleId: string) {
  return {
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId(taskId),
    roleId: asRoleId(roleId),
  };
}

test("a task with no revisions that succeeds is analyzed as a clean success", () => {
  const events = [
    taskQueued(ref("t1", "ppc")),
    taskStarted(ref("t1", "ppc")),
    taskSucceeded(ref("t1", "ppc")),
  ];
  const [analysis] = analyzeProjectEvents(events);
  assert.equal(analysis?.outcome, "success");
  assert.equal(analysis?.revisionCount, 0);
});

test("a task that needed revision before succeeding is tracked with its revision count", () => {
  const events = [
    taskQueued(ref("t1", "media-buyer")),
    taskStarted(ref("t1", "media-buyer")),
    taskNeedsRevision(ref("t1", "media-buyer"), "budget unclear"),
    taskNeedsRevision(ref("t1", "media-buyer"), "budget still unclear"),
    taskSucceeded(ref("t1", "media-buyer")),
  ];
  const [analysis] = analyzeProjectEvents(events);
  assert.equal(analysis?.outcome, "needs_revision_then_success");
  assert.equal(analysis?.revisionCount, 2);
});

test("a task that ultimately fails is tracked as failed", () => {
  const events = [
    taskQueued(ref("t1", "research")),
    taskStarted(ref("t1", "research")),
    taskFailed(ref("t1", "research"), { code: "SITE_UNREACHABLE", message: "timeout", retryable: true }),
  ];
  const [analysis] = analyzeProjectEvents(events);
  assert.equal(analysis?.outcome, "failed");
});

test("non-task events (Project Created, Plan Ready) are ignored", () => {
  const events = [
    { type: "project_created" as const, tenantId: asTenantId("tenant-a"), projectId: asProjectId("project-1"), at: Date.now() },
  ];
  assert.equal(analyzeProjectEvents(events).length, 0);
});
