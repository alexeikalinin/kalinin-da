# @ama/agent-ceo

Implements: docs/03-architecture/agent-framework.md (role: CEO Agent)

Not in Repository Structure's original `packages/agents/` list — added 2026-08-12 (see Repository Structure §2d). Receives the raw Project input (site URL, business description, product, task — Product Specification §1) and turns it into strategic direction, written to Project Memory for PM Agent to read. No tools; no Task decomposition (that's `@ama/agent-pm`).
