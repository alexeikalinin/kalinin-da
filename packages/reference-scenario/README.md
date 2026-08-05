# @ama/reference-scenario

Implements the Year-1 milestone from `docs/01-vision/business-goals.md`: "референсный сценарий работает end-to-end (Owner, референсный конвейер ролей, включая Recovery и Reflection)."

`full-run.test.ts` is not another agent-pair integration test — it drives all six reference roles through the actual `@ama/workflow-engine` graph/state machinery (`buildGraph`, `getReadyNodes`, `withNodeState`), not a hand-written call sequence:

- Builds the exact graph from Workflow Engine §1 (Research → PPC/Media Buyer in parallel → Analytics → QA → Report Generator).
- Exercises the Strategy-gate pause/approve state machine before any Task runs.
- Confirms PPC and Media Buyer become ready **together** once Research succeeds, and Analytics only becomes ready once **both** finish — read straight off `getReadyNodes`, not asserted by hand.
- Exercises a real Recovery moment: Analytics' tool call fails once with `ToolUnavailableError`, retries, and succeeds — cross-checked against `decideOnFailure`'s policy.
- Runs a real `reflect()` call (`@ama/agent-reflection`) on the completed Project's actual event history once it's done — zero lessons is the correct, honest result for a clean run (nothing was noteworthy), not a sign Reflection was skipped.
- Publishes real events through `@ama/events` and reconstructs the journal at the end, checking nothing was skipped (Logging/Audit §2/§3).
- Ends with a real `ProjectOutput` assembled by Report Generator from five roles' actual archived output.

**A real inconsistency this run surfaced and had to account for (not fixed, documented instead):** roles don't all write their output the same way. Research and PPC write to **Task Memory**, later relocated into Project Memory by `archiveTaskIntoProject` (so their material keys are `${taskId}:field`). Media Buyer, Analytics, and QA write **directly** to Project Memory (plain keys, no archiving step). Report Generator's `materialRefs` has to know which convention applies to which role. This isn't a bug — Task Memory vs. direct Project Memory writes are both valid per Memory System §1 depending on whether a role's own working notes need to be private during execution — but it's easy to get wrong wiring a new role, as this test's first failed run proved. Worth normalizing if a seventh role makes the inconsistency actively confusing.

Not real: the LLM call for each role (see `@ama/agent-ppc`'s README for why — no provider credentials exist in this environment). Everything else — memory, tools, prompt assembly, cost routing, graph/state, events — is the genuine implementation.
