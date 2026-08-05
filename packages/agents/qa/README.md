# @ama/agent-qa

Implements: docs/03-architecture/agent-framework.md (role: QA Agent)

**Known gap, stated rather than papered over:** Memory System §1 documents QA as one of the few roles allowed to read another Task's Task Memory directly ("читает ... QA Agent при проверке"). `@ama/memory`'s `createAgentMemoryPort` doesn't implement cross-task reads — every Task only ever sees its own Task Memory (namespaced by its own `taskId`, see that package's README). Until a real cross-task read exists, the dispatcher hands QA the artifact to review directly in its payload (`artifactToReview`) — the same way a human reviewer is handed a document rather than given raw access to someone else's files.

**QA's own Task status is always `success` once the review completes — never `needs_revision`.** "Needs revision" describes the *reviewed* artifact, not QA's own work; QA's verdict (`{ approved, issues }`) is its `AgentOutput.result`, and turning "not approved" into "send the original Task back" is Workflow Engine's job (not built yet — see `dispatch.ts`'s comment). This is verified directly in `qa-agent.test.ts`.

Declares no tools (`toolIds: []`) — verified in `integration.test.ts` that the injected tool invoker is never called.
