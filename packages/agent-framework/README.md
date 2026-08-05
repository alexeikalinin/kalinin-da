# @ama/agent-framework

Implements: docs/03-architecture/agent-framework.md

The shared contract every agent role is built on: `AgentInput` / `AgentOutput`,
the three-way status protocol (`success` / `needs_revision` / `failed`), the
immutable per-invocation `InvocationContext` (Queue §5 isolation fix), and
`defineAgent()`, which turns a role's declarative spec (purpose,
responsibility, completion criteria, memory levels, tool ids) plus a handler
function into a runnable `Agent`.

Not yet implemented here: the real `MemoryPort`/`ToolPort` implementations
(owned by `@ama/memory` and `@ama/tools` respectively — this package only
defines the interfaces agents are called through) and the Cost Optimization
model-selection wiring.

Do not change contents without checking the document above first
(Single Source of Truth, see Glossary).
