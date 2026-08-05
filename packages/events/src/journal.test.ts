import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asRoleId, asTaskId, asTenantId } from "@ama/agent-framework";
import { createEventBus } from "./bus.ts";
import {
  planApproved,
  planReady,
  projectCompleted,
  projectCreated,
  taskFailed,
  taskNeedsRevision,
  taskQueued,
  taskStarted,
  taskSucceeded,
} from "./create.ts";
import { attachLogSink, reconstructJournal } from "./journal.ts";

function projectRef() {
  return { tenantId: asTenantId("tenant-a"), projectId: asProjectId("project-1") };
}
function taskRef(taskId: string, roleId: string) {
  return { ...projectRef(), taskId: asTaskId(taskId), roleId: asRoleId(roleId) };
}

test("Logging/Audit §2/§3: the sink captures every event type unconditionally, nothing skipped", async () => {
  const bus = createEventBus();
  const sink = attachLogSink(bus);

  await bus.publish(projectCreated(projectRef()));
  await bus.publish(planReady(projectRef()));
  await bus.publish(planApproved(projectRef()));
  await bus.publish(taskQueued(taskRef("t1", "research")));
  await bus.publish(taskStarted(taskRef("t1", "research")));
  await bus.publish(taskSucceeded(taskRef("t1", "research")));
  await bus.publish(projectCompleted(projectRef()));

  assert.equal(sink.entries.length, 7);
  assert.deepEqual(
    sink.entries.map((e) => e.event.type),
    [
      "project_created",
      "plan_ready",
      "plan_approved",
      "task_queued",
      "task_started",
      "task_succeeded",
      "project_completed",
    ],
  );
});

// Logging/Audit §5, reproduced closely: Research 10:00-10:14, PPC with a
// recorded decision, QA sends it back once (Needs Revision), then Success.
test("reconstructJournal rebuilds the §5 reference example from raw events", () => {
  const T = (hhmm: string) => new Date(`2026-08-05T${hhmm}:00Z`).getTime();

  const events = [
    { ...taskStarted(taskRef("research-task", "research")), at: T("10:00") },
    { ...taskSucceeded(taskRef("research-task", "research")), at: T("10:14") },
    { ...taskStarted(taskRef("ppc-task", "ppc")), at: T("10:15") },
    {
      ...taskSucceeded(taskRef("ppc-task", "ppc"), [
        { summary: "Бюджет распределён 60/40 между Google Ads и VK Ads, потому что Research показал больше органического трафика из Google" },
      ]),
      at: T("10:22"),
    },
    { ...taskStarted(taskRef("qa-task", "qa")), at: T("10:23") },
    { ...taskNeedsRevision(taskRef("qa-task", "qa"), "не хватает обоснования выбора аудитории"), at: T("10:24") },
    { ...taskSucceeded(taskRef("qa-task", "qa")), at: T("10:30") },
  ];

  const journal = reconstructJournal(events);
  const byTaskId = Object.fromEntries(journal.map((entry) => [entry.taskId, entry]));

  assert.equal(byTaskId["research-task"]?.startedAt, T("10:00"));
  assert.equal(byTaskId["research-task"]?.endedAt, T("10:14"));
  assert.equal(byTaskId["research-task"]?.result, "success");

  assert.equal(byTaskId["ppc-task"]?.decisions[0]?.summary.includes("60/40"), true);

  assert.equal(byTaskId["qa-task"]?.warnings[0], "не хватает обоснования выбора аудитории");
  assert.equal(byTaskId["qa-task"]?.result, "success"); // ends success after the revision, per §5
});

test("a failed task records its error in the journal", () => {
  const events = [
    taskStarted(taskRef("t1", "research")),
    taskFailed(taskRef("t1", "research"), { code: "SITE_UNREACHABLE", message: "timeout", retryable: true }),
  ];
  const [entry] = reconstructJournal(events);
  assert.equal(entry?.result, "failed");
  assert.equal(entry?.errors[0]?.code, "SITE_UNREACHABLE");
});
