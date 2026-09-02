# Lead Generation (Track A)

Статус: Implemented v1 (MVP) — 2026-08-30
Назначение: описать, как агентство находит, изучает, оценивает и связывается с потенциальными white-label PPC-партнёрами — агентствами, для которых Google Ads/PPC не основная услуга.

Простыми словами: это "отдел продаж" агентства, только его первые шаги (поиск и первый контакт) выполняют агенты, а решение "отправлять или нет" всегда остаётся за человеком. Ни одно письмо не уходит без явного одобрения.

Использует термины из [[Glossary]]. Реализует роли по контракту [[Agent-Framework]], опирается на [[Workflow-Engine]] (граф без PM-планирования — см. раздел 2) и [[Memory-System]]/[[Learning-System]] (обучение на исходах). См. также [[Campaign-Optimization]] — сестринский трек, построенный на том же фундаменте.

---

## Purpose

Зафиксировать, как устроен весь путь "нашли агентство → изучили → оценили → написали письмо → человек одобрил → отправили → классифицировали ответ", чтобы новая роль в этом треке добавлялась по тому же контракту, что и остальные агенты.

## Scope

Описывает: бизнес-модель и ICP (идеальный профиль клиента), роли-агенты и их границы, схему данных (CRM), точку входа в оркестрацию, гейт human-approval, интеграцию с Resend. Не описывает: содержание конкретных промптов (реализация — `apps/web/lib/real-models-track-a.ts`), UI-детали дашборда (реализация — `apps/web/app/prospects/page.tsx`).

---

## 1. Бизнес-модель и ICP

Агентство предлагает **white-label Google Ads/PPC fulfillment** другим digital-агентствам: партнёр продаёт клиенту услугу за $1500–2000/мес, мы выполняем работу за $700–800/мес/аккаунт, партнёр сохраняет отношения с клиентом.

Идеальный профиль (ICP), сейчас конфигурируется через входные параметры Lead Finder (страны/seed-запросы), не хранится как отдельная сущность:
- 2–20 сотрудников
- PPC/Google Ads предлагается, но не основная услуга (SEO/web-design/lead-gen — основные)
- Гео: США приоритетно, затем UK/NL/DE/Скандинавия

## 2. Архитектура оркестрации

Track A **не использует** `createProject()`/CEO/PM (`apps/web/lib/orchestrator.ts`) — тот путь рассчитан на одноразовый "вот сайт, прогони референсный конвейер" Project. Вместо этого:

- `apps/web/lib/prospecting-orchestrator.ts` строит `WorkflowGraph` напрямую через `@ama/workflow-engine`'s `buildGraph()`/`getReadyNodes()` — без шага PM-планирования (форма графа фиксирована, потому что для находки/квалификации/скоринга/драфта/compliance-проверки шаги всегда одни и те же).
- `runLeadDiscovery()` — отдельная точка входа (не часть графа): один прогон Lead Finder на пачку стран/запросов, создаёт строки `prospect_agency`.
- `runProspectPipeline(prospectAgencyId, websiteUrl)` — граф на одного проспекта: `agency-researcher` → `decision-maker-finder` → `lead-scorer` → `outreach-copywriter` → `compliance-checker`. Короткое замыкание при дисквалификации (низкий score) — `lead-scorer` сам переводит проспект в `disqualified`, граф не продолжает.

## 3. Роли

| roleId | Пакет | Отвечает за | Не отвечает за |
|---|---|---|---|
| `lead-finder` | `packages/agents/lead-finder` | Поиск кандидатов через web-search (Perplexity), запись в `prospect_agency` | Глубокую квалификацию, скоринг |
| `agency-researcher` | `packages/agents/agency-researcher` | Изучение сайта проспекта (site-first → grounded search, тот же паттерн что и Research Agent), запись фактов в `prospect_research_fact` | Оценку пригодности |
| `decision-maker-finder` | `packages/agents/decision-maker-finder` | Поиск decision maker + публичного email, никогда не выдумывает email | Написание письма |
| `lead-scorer` | `packages/agents/lead-scorer` | Объяснимый скоринг 0-100 (`score_breakdown`), решение о дисквалификации | Сбор новых фактов |
| `outreach-copywriter` | `packages/agents/outreach-copywriter` | Черновик персонализированного письма | Отправку, проверку compliance |
| `compliance-checker` | `packages/agents/compliance-checker` | Детерминированный (без LLM) чек-лист + проверка suppression list перед одобрением | Написание/переписывание письма |
| `reply-classifier` | `packages/agents/reply-classifier` | Классификация входящего ответа | Follow-up, автоматическую отправку |

`compliance-checker` — единственная роль без `callModel`: её решение должно быть детерминированным, не убеждаемым моделью.

## 4. Данные (CRM)

`supabase/migrations/0008_crm_outreach.sql`: `prospect_agency`, `prospect_research_fact`, `decision_maker`, `lead_score`, `outreach_message`, `reply_classification`, `suppression_list`. Инструмент доступа — `apps/web/lib/tools/prospect-store.ts`, зарегистрирован как toolId `"prospect-store"` (единая точка, action-based диспетчеризация в `real-tools.ts`).

`prospect_agency.agency_entity_id` — хук конверсии: когда проспект становится реальным партнёром, сюда пишется ссылка на существующую иерархию [[project_client_entity_hierarchy]] (Astrum/StarMedia/личные), без создания параллельной сущности клиента.

## 5. Human approval и отправка

`outreach_message.status` — гейт: `drafted` → (`compliance-checker`) → `pending_approval` → человек одобряет/отклоняет через `apps/web/app/prospects/page.tsx` → `POST /api/outreach/[id]/approve`. Одобрение **сразу** вызывает `sendOutreachEmail()` (`apps/web/lib/tools/email-provider.ts`, реальный Resend).

`email-provider.ts` жёстко отказывается слать, пока `EMAIL_FROM_ADDRESS` не задан на реальный верифицированный адрес (не плейсхолдер) — см. [[reference_data_actuality_skill]]-подобный принцип "не деградировать молча". Прогрев домена и `DAILY_SEND_CAP` — см. `docs/05-operations/resend-domain-warmup.md`.

Suppression list проверяется перед каждой отправкой внутри `sendOutreachEmail()` — обойти это, вызвав Resend напрямую, невозможно, потому что все реальные вызовы идут только через эту функцию.

## 6. Входящие ответы

Два пути к одному и тому же: реальный webhook `apps/web/app/api/webhooks/resend/route.ts` (Svix-подпись, статусы delivered/bounced/complained) — не покрывает разбор реальных ответов адресатов, это требует отдельной настройки MX-записей (не готово на MVP). До тех пор — ручной fallback `POST /api/outreach/[id]/reply` (человек вставляет текст ответа), который прогоняет его через тот же `reply-classifier`.

## 7. Обучение

`lead-scorer`'s score явно устроен так, чтобы через `apps/web/app/api/prospects/[id]/outcome/route.ts` (человек отмечает `partner`/`lost`) записывалось наблюдение через `@ama/learning`'s `recordObservation()` — первый реальный caller этого пакета (2026-08-30). Читающая сторона (`findRelevantLessons` через `pastExperience`) была подключена в `assemblePrompt` с самого начала фреймворка, просто не имела данных для чтения. См. [[Learning-System]].

## 8. Известные ограничения (Phase 2, backlog #34)

Многострановые compliance-профили (GDPR за пределами базового CAN-SPAM-чек-листа), A/B-варианты писем, автоматизированные follow-up-цепочки, платный email-finder API, автоматизация inbound MX-роутинга.
