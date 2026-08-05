# @ama/agent-seo

Implements: docs/03-architecture/agent-framework.md (role: SEO Agent)

Not part of the specific reference-scenario graph exercised in `@ama/reference-scenario` (that example task, "настроить рекламные кампании," explicitly excludes SEO — Workflow Engine §1) — but a fully specified role per Glossary's reference conveyor and Tool Integration §1's own table. Calls the `seo-service` tool for keyword/position data before asking the model for recommendations; fails fast without a model call if the tool fails.
