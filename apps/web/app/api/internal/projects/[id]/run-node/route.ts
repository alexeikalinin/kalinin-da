import { NextResponse } from "next/server";
import { asRoleId, asTaskId, type AgentError } from "@ama/agent-framework";
import type { QaVerdict } from "@ama/agent-qa";
import { withNodeState } from "@ama/workflow-engine";
import { taskFailed, taskStarted, taskSucceeded } from "@ama/events";
import { AGENT_ACTOR, OWNER_TENANT_ID, getSingletons } from "../../../../../../lib/singletons.ts";
import { ROLE_OUTPUT, getProject } from "../../../../../../lib/project-store.ts";
import { runNode } from "../../../../../../lib/orchestrator.ts";

// Internal-only endpoint, called from inside a "use step" function (see
// lib/workflows/execute-project.ts) via fetch, since steps can't reach the
// in-process ProjectRecord map directly. Runs one Task node to completion —
// the same work the old synchronous executeGraph() used to do inline —
// entirely inside this app's own process, which is where getSingletons()'s
// MemoryStore/ToolRegistry and the ProjectRecord map actually live.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getProject(id);
  if (!record) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const node = (await request.json()) as { taskId: string; roleId: string; dependsOn: readonly string[] };
  const { bus, store } = getSingletons();
  const taskRef = {
    tenantId: OWNER_TENANT_ID,
    projectId: record.projectId,
    taskId: asTaskId(node.taskId),
    roleId: asRoleId(node.roleId),
  };

  record.graphState = withNodeState(record.graphState!, node.taskId, "running");
  await bus.publish(taskStarted(taskRef));

  const output = await runNode(record, node);

  if (output.status === "success") {
    record.graphState = withNodeState(record.graphState!, node.taskId, "succeeded");
    if (ROLE_OUTPUT[node.roleId]?.level === "task") {
      store.archiveTaskIntoProject(AGENT_ACTOR, node.taskId, record.projectId);
    }
    await bus.publish(taskSucceeded(taskRef, output.decisions));

    // QA §: the review itself succeeding and the artifact passing are two
    // different things. A rejecting verdict used to end here as a plain
    // "success" and the graph moved on to Report Generator regardless —
    // QA's own README flagged this. Now a rejection is reported upward so
    // executeProjectWorkflow can send the reviewed Task back for revision.
    if (node.roleId === "qa") {
      const verdict = output.result as QaVerdict | undefined;
      const reviewedTaskId = node.dependsOn[0];
      if (verdict?.approved === false && reviewedTaskId) {
        // Stored as text, not the raw array: assemblePrompt's readStrings
        // only surfaces string-valued Project Memory entries, so an array
        // here would silently never reach the reviewed role's prompt.
        store.write(
          AGENT_ACTOR,
          { level: "project", tenantId: OWNER_TENANT_ID, key: `${record.projectId}:${reviewedTaskId}:qa-issues` },
          `QA вернул задачу на доработку. Замечания:\n${verdict.issues.map((i) => `- ${i}`).join("\n")}`,
        );
        return NextResponse.json({ status: "needs_revision", reviewedTaskId, issues: verdict.issues });
      }
    }

    return NextResponse.json({ status: "success" });
  }

  // "failed" or "needs_revision" — Agent Framework §4's error/retryable
  // signal drives Recovery §3's decision. There is no separate revision
  // loop built yet, so "needs_revision" is treated the same as a retryable
  // failure (matches the old synchronous executeGraph's behavior — an
  // explicit, known gap, not a hidden decision).
  const error: AgentError =
    output.status === "failed"
      ? output.error
      : { code: "NEEDS_REVISION", message: "Task returned needs_revision", retryable: true };
  await bus.publish(taskFailed(taskRef, error));
  return NextResponse.json({ status: "failed", retryable: error.retryable, message: error.message });
}
