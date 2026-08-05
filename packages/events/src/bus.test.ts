import { test } from "node:test";
import assert from "node:assert/strict";
import { asProjectId, asTenantId } from "@ama/agent-framework";
import { createEventBus } from "./bus.ts";
import { projectCompleted, projectCreated } from "./create.ts";

function ref() {
  return { tenantId: asTenantId("tenant-1"), projectId: asProjectId("project-1") };
}

test("a wildcard subscriber receives every event type (Logging/Audit rule, Events §2)", async () => {
  const bus = createEventBus();
  const received: string[] = [];
  bus.subscribe("*", (event) => {
    received.push(event.type);
  });

  await bus.publish(projectCreated(ref()));
  await bus.publish(projectCompleted(ref()));

  assert.deepEqual(received, ["project_created", "project_completed"]);
});

test("a type-specific subscriber only receives that type", async () => {
  const bus = createEventBus();
  const received: string[] = [];
  bus.subscribe("project_completed", (event) => {
    received.push(event.type);
  });

  await bus.publish(projectCreated(ref()));
  await bus.publish(projectCompleted(ref()));

  assert.deepEqual(received, ["project_completed"]);
});

test("unsubscribe stops further delivery", async () => {
  const bus = createEventBus();
  const received: string[] = [];
  const unsubscribe = bus.subscribe("project_completed", (event) => {
    received.push(event.type);
  });

  await bus.publish(projectCompleted(ref()));
  unsubscribe();
  await bus.publish(projectCompleted(ref()));

  assert.deepEqual(received, ["project_completed"]);
});

test("publish awaits async handlers before resolving", async () => {
  const bus = createEventBus();
  let done = false;
  bus.subscribe("project_completed", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    done = true;
  });

  await bus.publish(projectCompleted(ref()));
  assert.equal(done, true);
});
