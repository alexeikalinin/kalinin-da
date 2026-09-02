# Campaign Optimization (Track B)

Статус: Implemented v1 (MVP) — 2026-08-30
Назначение: описать, как агентство контролирует и оптимизирует уже живые рекламные кампании клиентов — не только настраивает новые (это уже умел PPC Agent), но и рекомендует, применяет (с одобрения) и проверяет эффект изменений.

Простыми словами: это регулярный "аудитор" рекламных кабинетов клиентов, который умеет не только писать отчёт с рекомендациями (как раньше делал `.claude/agents/medavenue-analyst.md` вручную для одного клиента), но и — по явному одобрению человека — сам нажать нужные кнопки в Google Ads/Yandex Direct, записать, что именно сделал, и через время вернуться проверить, помогло ли.

Использует термины из [[Glossary]]. Расширяет существующую роль PPC Agent из [[Agent-Framework]] (не новая роль — решение пользователя, 2026-08-30, зафиксировано в памяти `feedback_extend_existing_agents`). Опирается на [[Memory-System]]/[[Learning-System]]. См. также [[Lead-Generation]] — сестринский трек на том же фундаменте.

---

## Purpose

Зафиксировать recommend→approve→apply→verify цикл: как формируются рекомендации на основе реальных данных, как человек их одобряет, как применяются изменения, и как измеряется их фактический эффект — чтобы следующий цикл рекомендаций был обоснован реальной историей, а не только текущим снимком метрик.

## Scope

Описывает: почему это расширение существующего PPC Agent, а не новая роль; схему `campaign_changes_log`; четыре действия PPC Agent; человеческий гейт одобрения; безопасность (никогда не применять неодобренное, никогда не автоповторять провалившееся применение). Не описывает: содержание конкретных промптов (реализация — `apps/web/lib/real-models.ts`'s `realPpcRecommend`), правила прогрева/безопасного тестирования (см. план реализации).

---

## 1. Почему расширение, а не новый агент

Изначальный план предлагал три новые роли (`campaign-analyst`, `campaign-optimizer`, `change-verifier`). Пользователь явно попросил вместо этого расширить существующий `packages/agents/ppc` — функциональность "настройка/контроль/оптимизация PPC-кампаний" концептуально одна ответственность, разделённая на этапы жизненного цикла, а не разные роли. `PpcTaskPayload`/`PpcResult` теперь дискриминированы полем `action`: `"setup"` (было изначально, поле опционально для обратной совместимости) | `"recommend"` | `"apply"` | `"verify"`.

## 2. Четыре действия

| action | Что делает | Модель? | Кто вызывает |
|---|---|---|---|
| `setup` | Создаёт новые кампании (как раньше) | Да (`PpcSetupModelCaller`) | `apps/web/lib/orchestrator.ts`'s `runNode` |
| `recommend` | Читает живые данные кампаний (список, отчёт за 30 дней, историю прошлых изменений), предлагает изменения с вердиктом (🟢 scale/🟡 optimize/🔴 cut/⛔ pause/⏳ watch — обобщение классификации `medavenue-analyst.md`), пишет в `campaign_changes_log` со `status:'proposed'` | Да (`PpcRecommendModelCaller`) | `apps/web/lib/campaign-optimization-orchestrator.ts`'s `runRecommend()` |
| `apply` | Применяет **только** уже `status:'approved'` строку через новые write-функции Google Ads/Yandex Direct, логирует `apply_result` | Нет (детерминированное исполнение) | `runApply()`, вызывается из `POST /api/campaign-changes/[id]/approve` |
| `verify` | Тянет свежие данные, пишет `actual_effect`/`after_metrics`, записывает наблюдение в Learning | Нет (детерминированное сравнение) | `runVerify()`, вызывается из cron `verify-campaign-changes` |

Каждое действие — отдельная точка входа в `packages/agents/ppc/src/dispatch.ts` (`preparePpcRecommendInvocation`/`preparePpcApplyInvocation`/`preparePpcVerifyInvocation`), не через граф `buildGraph()` — это одноузловые операции, не многошаговый workflow.

## 3. Безопасность

`apply` **никогда** не применяет строку, чей `status` не `'approved'` — проверка внутри `handleApply` (`packages/agents/ppc/src/ppc-agent.ts`), не только на уровне UI. Провал применения (`apply_failed`) **никогда не повторяется автоматически** — живой аккаунт требует, чтобы человек увидел причину провала прежде, чем что-либо попробует снова.

## 4. Данные

`supabase/migrations/0007_campaign_changes_log.sql`, расширенная `0009_campaign_changes_log_v2.sql` (добавлены `status`, `proposed_by_run_id`, `approved_by`/`approved_at`, `before_metrics`/`after_metrics` jsonb, `apply_result` jsonb). Инструмент — `apps/web/lib/tools/campaign-changes-store.ts`, toolId `"campaign-changes"`.

Новые write-функции существующих кампаний (раньше можно было только создавать новые, всегда `PAUSED`):
- `google-ads.ts`: `adjustCampaignBudget`, `addNegativeKeywordsToExistingCampaign`, `adjustAdGroupCriterionBid`, `setCampaignStatus`
- `yandex-direct.ts`: сначала закрыты два задокументированных пробела чтения (`getWeeklySpendLimit` — не `DailyBudget`, `getKeywordBids` — не `keywordbids.get`, см. `docs/05-operations/yandex-direct-api-known-issues.md` #3/#4), затем `adjustWeeklySpendLimit`, `addNegativeKeywords`, `setCampaignStatus`

Оба набора функций вызываются через отдельные toolId `"google-ads-optimize"`/`"yandex-direct-optimize"` — намеренно отдельно от `"google-ads"`/`"yandex-direct"` (которые использует `setup`), чтобы grep по toolIds сразу показывал, какая роль может писать в живую кампанию.

## 5. Human approval

`campaign_changes_log.status`: `proposed` → человек одобряет через `apps/web/app/campaign-changes/page.tsx` → `POST /api/campaign-changes/[id]/approve` → сразу вызывает `runApply()` (по явному пожеланию пользователя: "с одобрения сказать агенту чтоб он выполнил их самостоятельно") → `applied`/`apply_failed`.

## 6. Проверка эффекта и обучение

`apps/web/app/api/cron/verify-campaign-changes/route.ts` (Vercel Cron, тот же паттерн авторизации что `sync-ad-stats`) периодически находит строки `status:'applied'`, `verified_at is null`, старше 7 дней, вызывает `runVerify()` для каждой. После успешной верификации записывается наблюдение через `@ama/learning`'s `recordObservation()` — первый реальный caller этого пакета вместе с [[Lead-Generation]]'s outcome-роутом. См. [[Learning-System]].

## 7. medavenue-analyst.md

`.claude/agents/medavenue-analyst.md` остаётся отдельным read-only инструментом ручного разового аудита для одного конкретного клиента — не переключён автоматически на `apply`. Его логика вердиктов обобщена в `recommend`-действие, но сам subagent продолжает существовать как более лёгкий/быстрый ручной путь.

## 8. Известные ограничения (Phase 2, backlog #34)

Подключение `getKeywordIdeas`/Wordstat к `recommend`-логике (сейчас рекомендации не используют реальные данные объёма/ставок ключевых слов); Bid Robot (правило-базированный автобиддинг, backlog #32) — вне scope, `apply` применяет только точечные одобренные изменения.
