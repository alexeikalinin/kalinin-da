# @ama/agent-media-buyer

Implements: docs/03-architecture/agent-framework.md (role: Media Buyer Agent)

A deliberately narrow role: overall media budget planning, explicitly separated from PPC Agent's campaign configuration (Agent Framework §3: "не медиапланирование бюджета (это Media Buyer Agent)"). Declares no tools (`toolIds: []`) — this is a pure planning role, same category as Copywriter likely needing nothing but the model itself (Tool Integration §1). Its plan is written to **Project Memory**, not Task Memory, since it's meant to be visible to the rest of the Project (Analytics/Report Generator later), not just this one Task.

Runs in parallel with PPC in the reference graph (Workflow Engine §1) — deliberately no dependency between the two here either.

Uses `@ama/workflow-engine`'s shared `prepareAgentInvocation` for dispatch (see `@ama/agent-ppc`'s README for why that's shared rather than duplicated).
