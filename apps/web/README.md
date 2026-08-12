# @ama/web

Implements: `docs/03-architecture/api-application-layer.md` — real Next.js Route Handlers, not a skeleton anymore.

- `POST /api/projects` — FR-1/FR-2/FR-2a: create a Project (runs CEO Agent then PM Agent for real, pauses for Strategy-gate approval by default).
- `GET /api/projects` / `GET /api/projects/[id]` — FR-3: list / progress (periodic pull, NFR-8).
- `POST /api/projects/[id]/approve` — Workflow Engine §3: approves the plan and **synchronously runs the entire graph** to completion through the real role packages.
- `POST /api/projects/[id]/reject` — rejects the plan with a comment; PM Agent rebuilds it (Workflow Engine §3).
- `GET /api/projects/[id]/output` — FR-6: the finished `ProjectOutput`, 409 until the Project is completed.
- `POST /api/projects/[id]/rework` — FR-5.

`lib/orchestrator.ts` is the one place in the codebase that knows about every role package at once — it's the real implementation of what Workflow Engine's dispatch step will eventually be. Verified end to end with real `curl` requests against `next dev` (not just unit tests): create → Strategy-gate pause → approve → all 6 Tasks execute in the correct order (PPC/Media Buyer in parallel) → real `ProjectOutput`; separately verified reject/replan and rework.

**Known simplifications, stated rather than hidden:**
- Auth is a single hardcoded Owner tenant (`lib/singletons.ts`) — API/Application Layer §1's own decision, not an oversight.
- `MemoryStore`/tool registry/event log are in-process singletons stashed on `globalThis` to survive Next.js dev's module re-evaluation — a dev convenience, not persistence. Real deployment replaces this with the Supabase-backed store the Database migration already models (`supabase/migrations/0001_init.sql`).
- Model calls go to the real Anthropic API (`lib/anthropic.ts` + `lib/real-models.ts`) when `ANTHROPIC_API_KEY` is set in `apps/web/.env.local` (gitignored, never committed); otherwise `lib/orchestrator.ts` falls back to its `fake*` callers so the app still runs without credentials (e.g. CI, a fresh clone). Verified end to end with a real `next dev` run and a real key: full graph execution through genuine Claude responses.
- Three tools are real: `site-reader` (`lib/tools/site-reader.ts`, plain HTTP fetch, no credentials), `web-search` (`lib/tools/web-search.ts`, Perplexity `sonar`, needs `PERPLEXITY_API_KEY`), and `google-ads` (`lib/tools/google-ads.ts`, real Google Ads API v25 REST, needs `GOOGLE_ADS_*` vars — client id/secret, developer token, refresh token, login/customer id, all in `.env.local`). Dispatched via `lib/real-tools.ts`. `google-ads` creates real campaigns but always leaves them in `PAUSED` status — nothing in this system ever turns spend on — and is idempotent by campaign name so repeated runs don't create duplicates. The per-channel daily budget is a placeholder default × the model's `budgetShare`, not yet the project's real budget. Every other tool (`seo-service`, `vk-ads`, `google-analytics`, `design-tool`, `deployment-tool`) is still a placeholder, so downstream roles still get thin real context about the actual client — expect generic output there until those are wired in too.
- `approve` runs the whole graph **synchronously inside the HTTP request** — there is no background job runner yet. `@ama/reference-scenario` already proves the retry/escalate/block Recovery policy works; wiring it into an actual async executor is the next real piece of work.
- `rework` re-runs only Report Generator against current materials rather than having PM Agent figure out which upstream Tasks the comment actually affects (real FR-5 behavior, not built yet).
