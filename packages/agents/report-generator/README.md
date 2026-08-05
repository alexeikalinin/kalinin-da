# @ama/agent-report-generator

Implements: docs/03-architecture/agent-framework.md (role: Report Generator Agent)

Implements FR-6's decision literally: the assembled `ProjectOutput` only includes materials that were actually produced by roles that actually ran in this Project — a missing `materialRef` (a role that never ran) is silently skipped, not filled with an empty slot. Verified directly in `report-generator-agent.test.ts`.

`integration.test.ts` is the capstone of the reference pipeline built so far: a real PPC run → archived into Project Memory → assembled by a real Report Generator run into the final output, no shortcuts or fakes except the model call itself (see `@ama/agent-ppc`'s README for why).
