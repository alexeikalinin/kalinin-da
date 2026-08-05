import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId } from "@ama/agent-framework";
import { createEventBus } from "./bus.ts";
import { taskQueued, taskSucceeded, projectCompleted } from "./create.ts";
import {
  NOTIFICATION_EVENT_TYPES,
  PROGRESS_EVENT_TYPES,
  RECOVERY_EVENT_TYPES,
  subscribeToTypes,
} from "./subscriptions.ts";

function taskRef() {
  return {
    tenantId: asTenantId("tenant-1"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("ppc"),
  };
}

test("Events §2 rule: progress subscribes to queued/started/succeeded/failed only, not project_completed", () => {
  assert.equal(PROGRESS_EVENT_TYPES.includes("task_succeeded"), true);
  assert.equal(PROGRESS_EVENT_TYPES.includes("project_completed"), false);
});

test("Events §2 rule: notification subscribes only to project_completed", () => {
  assert.deepEqual(NOTIFICATION_EVENT_TYPES, ["project_completed"]);
});

test("Events §2 rule: Recovery subscribes to task_stuck and task_failed", () => {
  assert.deepEqual([...RECOVERY_EVENT_TYPES].sort(), ["task_failed", "task_stuck"]);
});

test("subscribeToTypes delivers only the listed types and can be unsubscribed as one group", async () => {
  const bus = createEventBus();
  const received: string[] = [];
  const unsubscribe = subscribeToTypes(bus, PROGRESS_EVENT_TYPES, (event) => {
    received.push(event.type);
  });

  await bus.publish(taskQueued(taskRef()));
  await bus.publish(taskSucceeded(taskRef()));
  await bus.publish(projectCompleted({ tenantId: asTenantId("tenant-1"), projectId: asProjectId("project-1") }));

  assert.deepEqual(received, ["task_queued", "task_succeeded"]);

  unsubscribe();
  await bus.publish(taskQueued(taskRef()));
  assert.deepEqual(received, ["task_queued", "task_succeeded"]);
});
