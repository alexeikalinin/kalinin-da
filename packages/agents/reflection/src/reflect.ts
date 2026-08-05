import type { ProjectId, TenantId } from "@ama/agent-framework";
import type { Actor, MemoryStore } from "@ama/memory";
import type { WorkflowEvent } from "@ama/events";
import { recordObservation, type Lesson } from "@ama/learning";
import { analyzeProjectEvents, type TaskAnalysis } from "./analyze.ts";

// Reflection §5 example: "Media Buyer Agent дважды за Project" is the
// threshold for "worth a lesson." A placeholder — same calibration status
// as every other threshold deferred across this codebase (Open Question #2).
const NOTEWORTHY_REVISION_COUNT = 2;

export interface SystemicFinding {
  // A lesson whose confidence reached "pattern" (Learning System §3) as a
  // direct result of this reflection — Reflection §4: this is the signal
  // for Risk Register/Backlog, not a second threshold invented here.
  readonly lesson: Lesson;
}

export interface ReflectionResult {
  readonly lessons: readonly Lesson[];
  readonly systemicFindings: readonly SystemicFinding[];
}

// Reflection §2/§4 — only noteworthy Task outcomes become an observation:
// an outright failure, a fix that took at least one revision to land (worth
// remembering what worked), or a Task that needed several revisions. A
// clean first-try success isn't logged as its own lesson — Purpose
// explicitly warns against "шум из случайных наблюдений."
function isNoteworthy(analysis: TaskAnalysis): boolean {
  return (
    analysis.outcome === "failed" ||
    analysis.outcome === "needs_revision_then_success" ||
    analysis.revisionCount >= NOTEWORTHY_REVISION_COUNT
  );
}

export function reflect(
  store: MemoryStore,
  reflectionActor: Actor, // must be actor.kind === "reflection"
  tenantId: TenantId,
  projectId: ProjectId,
  events: readonly WorkflowEvent[],
): ReflectionResult {
  const analyses = analyzeProjectEvents(events);
  const lessons: Lesson[] = [];

  for (const analysis of analyses) {
    if (!isNoteworthy(analysis)) continue;

    const lesson = recordObservation(store, reflectionActor, tenantId, `${projectId}:${analysis.taskId}`, {
      situation: `Task "${analysis.taskId}" (role "${analysis.roleId}") needed ${analysis.revisionCount} revision(s); outcome: ${analysis.outcome}.`,
      outcome: analysis.outcome === "failed" || analysis.revisionCount > 0 ? "problem" : "success",
      conclusion: `Role "${analysis.roleId}" may need a clearer Task specification or a contract review.`,
      roleId: analysis.roleId,
      groupKey: `${analysis.roleId}:high-revision`,
    });
    lessons.push(lesson);
  }

  const systemicFindings: SystemicFinding[] = lessons
    .filter((lesson) => lesson.confidence === "pattern")
    .map((lesson) => ({ lesson }));

  return { lessons, systemicFindings };
}
