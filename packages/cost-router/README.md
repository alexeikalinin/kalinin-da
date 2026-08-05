# @ama/cost-router

Implements: docs/03-architecture/cost-optimization.md

- `tiers.ts` — `ModelTier` (`fast`/`base`/`advanced`, ADR-0003's abstract "model tier," not a provider model name) and `defaultModelSelector`: encodes §1's *qualitative* principle (complexity sets the baseline; Fast Execution Tier and Strategy-gate each nudge the tier down) — the exact calibration table (which complexity/role maps to which tier) is Open Question #1, deliberately left to the caller/practice, not hardcoded here.
- `catalog.ts` — `ModelCatalog`/`createAnthropicModelCatalog`: maps a tier to a real model id and an illustrative per-call cost. Explicitly placeholder pricing — real tariffs are out of Scope per the doc ("быстро устаревающая деталь").
- `estimate.ts` — `estimateProjectCost`/`RunningCostHistory`: the §3 prediction, including the cold-start rule (rough default = tier cost × expected calls, until real per-role history exists) and its own test proving the automatic cutover — record a couple of real costs for a role and the very next estimate uses them, no separate "switch to history" step anywhere in the code.

Not yet implemented: real pricing data, the actual complexity classifier for a given Task (a judgment call made when a Task is created, upstream of this package), wiring `RunningCostHistory` to persistent storage (currently in-memory, resets with the process).
