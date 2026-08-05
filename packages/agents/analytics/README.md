# @ama/agent-analytics

Implements: docs/03-architecture/agent-framework.md (role: Analytics Agent)

Reads live data from the client's analytics tool (Tool Integration §1) via `ToolPort`, then asks the model to turn raw metrics into a report. Depends on PPC and Media Buyer's output in the reference graph (Workflow Engine §1) — reads their **archived** Task Memory from Project Memory (`MemoryStore.archiveTaskIntoProject`, Memory System §1), not their private Task Memory directly, since a Task's memory isn't visible to another Task by default.

`integration.test.ts` chains a real PPC run into a real Analytics run and asserts the archived data actually relocates to the expected Project Memory key — and notes explicitly why it does *not* show up as prompt text: `assemblePrompt`'s project-context block only surfaces string values (it's LLM-facing text, Prompt Architecture §1), while PPC's decision is a structured object. That's a real, intentional limit of the current design, not a bug — a future role wanting textual project context needs to write a string summary, not just structured data.

If the tool call fails, the model is never called (fail fast, no wasted spend) — verified directly in `analytics-agent.test.ts`.
