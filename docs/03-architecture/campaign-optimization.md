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

## 9. Обогащение `recommend` (2026-09-03) — один агент на всех клиентов, не агент на клиента

Сравнение: тот же аудит Медавеню прогнали дважды — один раз через `.claude/agents/medavenue-analyst.md` (клиент-специфичный, вручную написанные GAQL/Reports-запросы под этого клиента), второй раз через дженерик-инструментарий (только `google-ads.ts`/`yandex-direct.ts`, без клиентского контекста). Дженерик проиграл не из-за нехватки данных вообще, а из-за отсутствия конкретных функций в общих tools — то есть решалось на уровне инструментария, а не на уровне "нужен более умный агент под каждого клиента". Владелец явно попросил вместо размножения клиент-специфичных агентов один раз закрыть эти пробелы в общем `recommend`.

Что было добавлено в `google-ads.ts`/`yandex-direct.ts` (параметризовано только account id/goal id — работает для любого клиента без кода под клиента):
- `getSearchTermsReport` в обоих файлах — ни одна общая функция не отдавала фактические поисковые запросы (только keyword-бинды), без этого невозможен ни подбор минус-слов, ни матрица канибилизации между кампаниями.
- `getImpressionShareReport` (Google Ads) — `search_budget_lost_impression_share` vs `search_rank_lost_impression_share`. Без этого разделения дженерик-прогон рекомендовал поднять бюджет там, где реальная причина — качество объявления/ставка, а бюджет бы не помог. Это тот самый сигнал, который раньше был только в ручной методологии `medavenue-analyst.md`.
- Retry-логика на `201`/`202` от Yandex Reports API (`fetchDirectReport` в `yandex-direct.ts`) — оба независимых прогона (специализированный и дженерик) наткнулись на этот баг вживую при `SEARCH_QUERY_PERFORMANCE_REPORT`; без ретрая функция тихо возвращает 0 строк вместо ошибки. Пофикшено один раз в общем месте вместо повторного обхода в каждом будущем прогоне.

`handleRecommend` в `packages/agents/ppc/src/ppc-agent.ts` теперь параллельно с `listCampaigns`/`getCampaignReport` вызывает `getSearchTermsReport` (обе платформы, окно 14 дней — не 30, поисковые запросы за месяц слишком шумные для минус-слов) и, в зависимости от платформы, `getImpressionShareReport` (Google) или `getWeeklySpendLimit` на каждую активную кампанию (Yandex — сигнал "упирается в лимит" там, где Impression Share недоступен). Каждый вызов independent best-effort (`.catch()`, не валит весь recommend) — на PMax-only аккаунте эти отчёты законно почти пустые.

Итог: `.claude/agents/medavenue-analyst.md` остаётся быстрым ручным путём для разового прогона (см. §7), но его методологическое преимущество больше не привязано к этому одному агенту — то же обогащение данных доступно любому клиенту через `recommend`, только по `externalAccountId`/`conversionActionIdsOrGoalIds` в payload. Новых клиент-специфичных `.claude/agents/*.md` заводить не планируется — только конфигурация (account id, goal id, approved-конверсии, пороги CPA), не код.

**Принцип разделения (Owner, 2026-09-03):** то, что может быть захардкожено в клиент-специфичном агенте (goal ID Метрики, approved-список конверсий Google Ads, пороги CPA) — у каждого клиента своё, это конфигурация/payload, не код. То, КАК извлекаются и анализируются данные (какие отчёты запрашивать, как считать Impression Share, как проверять бюджетный лимит, как искать минус-слова и канибилизацию) — специфика одна и та же для любого клиента на этой платформе. Это разделение и определяет, что уходит в общий `google-ads.ts`/`yandex-direct.ts`/`ppc-agent.ts` (специфика извлечения/анализа), а что остаётся параметром вызова (`externalAccountId`, `conversionActionIdsOrGoalIds`, approved-список).

**Повторный прогон (2026-09-03), два оставшихся пробела закрыты:**
- `getWeeklySpendLimit` проверял только `Search`-ветку `BiddingStrategy` — РСЯ-кампании (реальная автостратегия в `Network`) выглядели как "нет автостратегии". Теперь проверяет обе ветки, возвращает `scope: "Search" | "Network"`. См. `docs/05-operations/yandex-direct-api-known-issues.md` #3b.
- Не было функции, читающей `DailyBudget` существующей кампании (только запись при создании) — кампании на фиксированном дневном бюджете (не автостратегия) нельзя было сверить с лимитом расхода вообще. Добавлена `getDailyBudget(campaignId)`, комплементарна `getWeeklySpendLimit` (кампания использует ровно один из двух механизмов). См. `docs/05-operations/yandex-direct-api-known-issues.md` #3.
- Заодно повторный прогон нашёл и исправил реальный краш в `getImpressionShareReport` (Google Ads не возвращает `metrics` вовсе, если ни одна запрошенная метрика не задана — не 0, а отсутствие поля; было ~половина активных кампаний Медавеню) — `r.metrics ?? {}`.
- `handleRecommend` для Yandex теперь параллельно вызывает `getWeeklySpendLimit` И `getDailyBudget` на каждую активную кампанию — какое из двух полей непустое, то и есть реальный бюджетный сигнал этой кампании.

Оставшиеся честные ограничения (не тулинг, а данные/логика — не поддаются такому же простому фиксу): у Yandex `getSearchTermsReport` отдаёт `---autotargeting` вместо реального запроса для значительной доли кликов (ограничение самого API); наивный фильтр «0 конверсий» для минус-слов даёт много ложных срабатываний — нужен смысловой фильтр поверх данных, это остаётся LLM-суждением, а не отдельной функцией; нормализации валют между платформами по-прежнему нет.
