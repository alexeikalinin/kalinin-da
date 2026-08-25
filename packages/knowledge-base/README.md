# @ama/knowledge-base

Implements: docs/03-architecture/knowledge-base.md

Builds on `@ama/memory`'s propose→confirm mechanism for the `domain_kb`/`client_kb` levels and adds the three rules that are specific to Knowledge Base:

- `direct.ts` — `recordFactDirectly`: a fact you state yourself is confirmed immediately (§2, source 1) — still runs through the same conflict check as everything else.
- `review.ts` — `reviewProposal`: given a significance classification (`"minor"` / `"significant"`) supplied by the caller, either auto-confirms via a `system` actor or leaves the proposal pending for a human approver (§2, sources 2–3). The classification rule itself is Knowledge Base Open Question #1 — deliberately not hardcoded here; PM Agent/Agent Architect supply the judgment call.
- `resolve.ts` — `resolveProposal`: the shared conflict check both of the above use (§3). "Conflict" is defined narrowly and honestly: an already-confirmed value at the same key that differs from the new proposal. It does not attempt semantic contradiction detection across different keys — that's out of scope.

Required a small, explicitly-justified extension to `@ama/memory`: an `Actor` kind `"system"` (auto-confirmation, distinct from a human `"approver"` for audit purposes) and `readRecord` (returns the full record, not just the value, so a conflict report can show *when* the existing fact was confirmed).

- `domain/yandex-direct-reach-campaigns.ts` — `seedYandexDirectReachCampaignFacts`: initial Domain KB population (Open Question #2), for one channel. 14 facts covering охватные/медийные кампании Яндекс.Директа (Баннеры, Видеобаннеры, Видео, Непропускаемое видео, Прайм-баннер, Connected TV, Баннер под поисковой строкой, форматы по fixCPM, Пост в мессенджерах, Наружная реклама) plus overview/metrics/strategy facts and a format-selection guide. `YANDEX_DIRECT_REACH_CAMPAIGN_FACT_KEYS` (full set, for PPC Agent) and `YANDEX_DIRECT_REACH_CAMPAIGN_ANALYTICS_FACT_KEYS` (the overview/metrics/strategy subset, for Analytics Agent) are the keys a caller passes as `domainFactKeys` into `preparePpcInvocation` / `prepareAnalyticsInvocation` — dispatch itself stays a thin wrapper and doesn't guess which facts a task needs.

Not yet implemented: the significance classifier itself (Open Question #1); Domain KB population for any other channel (Google Ads formats, Meta Ads formats, etc. — Yandex Direct reach campaigns is the first slice, not the whole domain).
