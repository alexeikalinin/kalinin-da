import type { RoleId } from "@ama/agent-framework";

export type LessonOutcome = "success" | "problem";
export type LessonConfidence = "observation" | "pattern";

// Learning System §1 — the structured unit every Learning Memory entry is,
// not free text.
export interface Lesson {
  readonly situation: string;
  readonly outcome: LessonOutcome;
  readonly conclusion: string;
  readonly roleId: RoleId;
  // What this lesson is "about" — used to group repeated observations of
  // the same underlying situation (Learning System §3's VK Ads/B2B example).
  // Similarity detection itself is out of scope here; the caller (Reflection)
  // supplies the grouping.
  readonly groupKey: string;
  readonly confidence: LessonConfidence;
}

// Learning System §3 — how many similar observations turn "one time" into
// "a pattern." The doc's own example uses three prior projects; kept as an
// explicit placeholder pending real calibration (same status as the other
// thresholds deferred across this codebase — Open Question #1).
const PATTERN_THRESHOLD = 3;

export function deriveConfidence(observationCount: number): LessonConfidence {
  return observationCount >= PATTERN_THRESHOLD ? "pattern" : "observation";
}
