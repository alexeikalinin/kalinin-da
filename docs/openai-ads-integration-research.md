# OpenAI Ads Integration — Research

Дата: 2026-09-03. Цель: определить, есть ли у OpenAI Ads (реклама в ChatGPT) официальный
публичный API, и спроектировать интеграцию в текущую архитектуру, если да.

---

## Phase 1 — Аудит текущей архитектуры

### Frontend / apps/web
- Next.js 15 (`"next": "^15.0.0"`), React 19, App Router (`apps/web/app/*`, нет каталога `pages/`).
- UI-роуты по доменам: `apps/web/app/{clients,prospects,campaign-changes,privacy}`.
- API-роуты по доменам: `apps/web/app/api/{clients,prospects,projects,internal,campaign-changes,agent-architect,webhooks,outreach,cron}`.
- Отдельной страницы `Settings → Advertising Platforms` (или аналога `Connections`/`Integrations`) в проекте пока нет.

### Backend / API routes
Стандартные Route Handlers (`route.ts`, `export async function GET/POST`).
`apps/web/app/api/cron/sync-ad-stats/route.ts`:
- авторизация — `isAuthorizedCronRequest` (`Authorization: Bearer $CRON_SECRET`);
- читает активные аккаунты из `client_ad_account` (`status = 'active'`);
- для каждого параллельно (`Promise.allSettled`) вызывает `syncAdStats()` и `syncCampaignStatus()`;
- окно синка — последние 3 дня + сегодня (`TRAILING_WINDOW_DAYS = 3`, компенсация задержки атрибуции).

Аналогичный `apps/web/app/api/cron/detect-trend-alerts/route.ts` дергает `runTrendAlerts` из
`campaign-optimization-orchestrator.ts` тем же паттерном чтения `client_ad_account`.

### База данных (Supabase Postgres)
Миграции: `0001_init.sql` → `0011_campaign_status.sql` (последняя ещё не применена).
Ключевые таблицы под рекламные платформы (`0002_client_ad_accounts.sql`):
`platform_identity`, `client`, `client_ad_account`, `target_conversion`, `ad_stat`; плюс новая
`campaign_status` (0011).

**Все они жёстко ограничены CHECK-constraint'ом на ровно 2 платформы:**
- `platform_identity.platform` — `check (platform in ('google-ads', 'yandex-direct'))`
- `client_ad_account.platform` — тот же check
- `ad_stat.platform` — тот же check
- `campaign_status.platform` — тот же check
- `target_conversion.platform` — `check (platform in ('google-ads', 'yandex-metrika'))` (это про метрику конверсий, не рекламную платформу)

Все таблицы tenant-scoped: RLS-политика `tenant_isolation` по `current_setting('app.tenant_id', true)::uuid`
+ явные `grant ... to anon, authenticated, service_role` (обязательно даже при RLS — иначе
`service_role` не проходит через PostgREST, найдено в 0010).

`ad_stat` уникален по `(client_id, platform, campaign_id, date)` — период-скопирован.
`campaign_status` уникален по `(client_id, platform, campaign_id)` без даты — перезаписывается, не история.

### Существующие адаптеры платформ
`apps/web/lib/tools/google-ads.ts` (Google Ads REST API v25, `https://googleads.googleapis.com/v25`):
- `isGoogleAdsConfigured()`, `listCampaigns()`, `listConversionActions()`, `getAccountCurrency()`,
  `getCampaignReport()`, `getSearchTermsReport()`, `getImpressionShareReport()`, `getKeywordIdeas()`,
  `createOrReusePausedCampaign()`, `buildPausedSearchCampaign()`, `buildMultiGroupSearchCampaign()`,
  `adjustCampaignBudget()`, `adjustAdGroupCriterionBid()`, `setCampaignStatus()`,
  `addNegativeKeywordsToExistingCampaign()`.
- Auth: OAuth refresh-token flow (`google-oauth.ts::getGoogleAccessToken(refreshTokenEnv)`), access-токен
  кэшируется в памяти (`Map`). ENV: `GOOGLE_ADS_CLIENT_ID/SECRET/REFRESH_TOKEN/DEVELOPER_TOKEN/LOGIN_CUSTOMER_ID`.
- Каждая созданная кампания всегда остаётся `PAUSED` — по дизайну (комментарий в шапке файла).

`apps/web/lib/tools/yandex-direct.ts` (Yandex Direct API v5 JSON, `https://api.direct.yandex.com/json/v5`):
- Тот же набор операций (`listCampaigns`, `getCampaignReport`, `getSearchTermsReport`,
  `createOrReusePausedCampaign`, `buildMultiGroupSearchCampaign`, `setCampaignStatus`,
  `addNegativeKeywords`, `getWeeklySpendLimit`/`getDailyBudget`/`getKeywordBids`), но с другими
  сигнатурами (`clientLogin` вместо `customerId`, `accessTokenEnv` вместо `refreshTokenEnv`).
- Auth: долгоживущий OAuth-токен читается напрямую из env (`yandex-oauth.ts::getYandexAccessToken`),
  без refresh-цикла.
- Каждая созданная кампания сразу `suspend`.

**Важно: общего TypeScript-интерфейса/абстракции `AdvertisingPlatform` нет.** Оба модуля — независимые
наборы экспортированных функций с разными сигнатурами (не implements одного контракта). Диспетчеризация
по платформе везде реализована вручную через `if/else` или `switch` по строковому литералу
`"google-ads" | "yandex-direct"`, а не через полиморфный вызов.

### Credential resolution
`apps/web/lib/tools/platform-identity.ts::resolveAccessContext(clientAdAccountId)`:
- джойнит `client_ad_account` → `platform_identity(credential_ref)`;
- возвращает `AccessContext { platform, externalAccountId, credentialRef, accessMode, managerId }`;
- `platform` типизирован как union-литерал `"google-ads" | "yandex-direct"` — жёстко ограничен, требует
  расширения для новой платформы.

`platform_identity.credential_ref` хранит **имя env-переменной**, а не сам секрет:
```sql
-- Secrets stay in env vars ... this only names which pair of env vars a
-- given identity's OAuth credential lives under, e.g.
-- 'GOOGLE_ADS_AGENCY_REFRESH_TOKEN'. A real secret store is future work
```
Т.е. секреты **не хранятся в БД** — только в `.env.local`/окружении деплоя. Разрешённое имя env-переменной
передаётся напрямую в `getGoogleAccessToken(refreshTokenEnv)` / `getYandexAccessToken(accessTokenEnv)`.
Отдельный `packages/tools/src/credentials.ts::CredentialStore` — in-memory `Map` для agent-framework слоя
(issue/get по Actor+toolId), не связан с реальными API-ключами платформ.

### AI-агенты / registry инструментов
`apps/web/lib/singletons.ts` — держит `ToolRegistry`/`CredentialStore` в `globalThis` (dev-singleton).
Регистрация инструмента — добавление строкового `toolId` в массив (уже содержит незадействованные
заглушки `"vk-ads"`, `"meta-ads"`) + `registry.register()` + `credentials.issue(..., "dev-placeholder-token")`.

`apps/web/lib/real-tools.ts` (819 строк) — `realToolInvoker: ToolInvoker`, единый `switch(toolId)` с явными
`case "google-ads":`, `case "yandex-direct":`, `case "google-ads-optimize":`, `case "yandex-direct-optimize":`.
Паттерн добавления новой платформы = новый `case` в этом switch + импорт нового адаптер-модуля.

`packages/agents/ppc/src/ppc-agent.ts` и `dispatch.ts` — платформа жёстко типизирована как
`"google-ads" | "yandex-direct"` минимум в 4 payload-интерфейсах каждый (`PpcRecommendPayload`,
`PpcApplyPayload`, `PpcVerifyPayload`, `PpcTrendAlertsPayload`). PPC-агент по своей природе
keyword-ориентирован (Google/Yandex — поисковая реклама с ключевыми словами); OpenAI Ads таргетируется
иначе (custom audiences, context hints, без keyword-таргетинга) — прямое расширение keyword-логики PPC
агента на OpenAI Ads семантически не подходит без отдельной ветки.

### Weekly trend detection / campaign status sync
`apps/web/lib/campaign-trends.ts` — детектор устойчивой деградации CPA/CVR по ISO-неделям, читает
`ad_stat`+`campaign_status` generic-полями (сама агрегация платформо-агностична), но тип
`CampaignWeeklySeries.platform` всё ещё `"google-ads" | "yandex-direct"`.

`apps/web/lib/sync-campaign-status.ts` — синхронизирует live campaign-статус в `campaign_status`,
использует `resolveAccessContext()` и бинарный `if (access.platform === "google-ads") {...} else {...}`.

### Cron/background jobs
`apps/web/vercel.json`:
```json
"crons": [
  { "path": "/api/cron/sync-ad-stats", "schedule": "0 3 * * *" },
  { "path": "/api/cron/detect-trend-alerts", "schedule": "0 4 * * 1" }
]
```
Оба защищены `isAuthorizedCronRequest` (Bearer `CRON_SECRET`).

### Вывод по Phase 1
Архитектурно добавление N-й рекламной платформы — не новая концепция, а повторение уже дуального
паттерна. Переиспользуется без изменений: credential-resolution (`platform_identity`/`client_ad_account`),
фактовые таблицы (`ad_stat`/`campaign_status`), cron-инфраструктура, `ToolRegistry`. Требует расширения:
4 SQL CHECK-constraint'а, ~6 мест с жёстким TS union-типом `"google-ads" | "yandex-direct"`, `real-tools.ts`
switch, PPC-агент (частично — не для keyword-таргетинга).

---

## Phase 2 — OpenAI Ads: платформа и API

### Что такое OpenAI Ads
Реклама внутри ChatGPT (`ads.openai.com`, Ads Manager Beta). Self-serve запуск — **5 мая 2026**:
OpenAI открыла self-serve доступ всем US-рекламодателям, убрала прежний порог входа $50K минимального
спенда, добавила CPC-биддинг в дополнение к CPM. До этого был только managed/pilot-режим через
партнёрства. За первые ~200 дней self-serve платформа вышла на $1B ARR.

- **Биддинг**: CPM (Reach objective, оплата за 1000 показов) и CPC (Clicks objective, оплата за
  валидный клик).
- **Гео**: рынок пока US-центричен; доступность по странам расширяется поэтапно — актуальный список
  нужно проверять в Ads Manager на момент подключения конкретного клиента (не документировано
  фиксированным списком в исследованных источниках).
- **Аккаунт-модель (критично для агентства)**: единого "агентского"/MCC-аккаунта, как в Google Ads
  Manager Accounts или Meta Business Manager, **нет**. Каждый рекламодатель создаёт свой собственный
  ad account сам (email владельца, верификация, привязка биллинга). Затем владелец приглашает
  участников (агентство) с ролью:
  - **Admin** — полный доступ включая billing;
  - **Campaign Manager** — создание/редактирование кампаний, без billing;
  - **Viewer** — только просмотр отчётов.

  Один email агентства может быть приглашён в несколько клиентских ad account'ов и переключаться между
  ними — но это N независимых аккаунтов, не единая иерархия. Компания также может иметь несколько
  собственных ad account'ов (для разных брендов/юрлиц), каждый — на отдельный email владельца.

  Для официальной программной работы от имени клиентских аккаунтов существует отдельный трек **"API
  Partner Setup"** — по всей видимости, требует отдельного обращения в OpenAI ("contact us"); детали
  прав/масштаба партнёрского доступа не задокументированы публично в исследованных источниках.

### Официальный публичный API — СУЩЕСТВУЕТ
Источник: `developers.openai.com/ads` (первичная документация OpenAI Developers).

**Advertiser API** — управление campaigns/ad_groups/ads/files/reporting из одного API,
CRUD-подобные операции, JSON. Дополнительно заявлены: custom audiences, conversion tracking,
product feeds, bulk operations.

- **Base URL**: `https://api.ads.openai.com/v1`
- **Аутентификация**: только API key. Выпускается в Ads Manager → Settings, привязан к **одному**
  ad account. Передаётся как `Authorization: Bearer $OPENAI_ADS_API_KEY` на каждый запрос.
  **OAuth для рекламодателей отсутствует** — только статический API key per account.
- **Версия**: `v1`. Есть скачиваемая OpenAPI-спецификация.
- **Rate limits**: 600 req/min на endpoint, 1200 req/min суммарно (учитываются лимиты и по ad account,
  и по IP); bulk job creation — отдельно, 10 req/10 сек на ad account.
- **SDK**: официального SDK не найдено — только REST + OpenAPI spec.

**Campaign resource** (`/campaigns`):
- Поля: `id`, `created_at`, `updated_at`, `name`, `description`, `status`, `start_time`, `end_time`,
  `budget`, `bidding_type`, `targeting`, `conversion_event_setting_ids`, `mode`.
- `mode`: `"product_feed"` либо `null` (обычная кампания).
- `bidding_type`: `"impressions"` (default), `"clicks"`, `"conversions"` (для последнего нужен ровно
  один активный `conversion_event_setting_id`).
- `budget`: `lifetime_spend_limit_micros` (минимум 1,000,000 micros); время/валюта наследуются из
  настроек аккаунта.
- `status`: `"active" | "paused" | "archived"` (archive необратим).
- `targeting`: `locations.include` (гео), `custom_audiences.ids` (включение), `excluded_custom_audiences.ids`
  (исключение). **Нет keyword-таргетинга** — принципиальное отличие от Google/Yandex Search.
- Операции: `GET /campaigns` (list, пагинация `limit/after/before/order`), `GET /campaigns/{id}`,
  `POST /campaigns` (create), `POST /campaigns/{id}` (update), `POST /campaigns/{id}/activate`,
  `POST /campaigns/{id}/pause`, `POST /campaigns/{id}/archive`.

**Quickstart flow** (`developers.openai.com/ads/api-quickstart`):
1. `GET /ad_account` — проверка, что bearer token работает.
2. `POST /upload` — загрузка креативов (изображений).
3. `POST /campaigns` — создание кампании.
4. `POST /ad_groups` — создание ad group внутри кампании (поля: `campaign_id`, `name`, `status`,
   `context_hints`, `bidding_config`).
5. `POST /ads` — создание объявления (поля: `ad_group_id`, `name`, `status`, `creative` — `type`,
   `title`, `body`, `target_url`).
6. `GET /ads/{id}/insights` — получение метрик performance.

Все ответы — JSON с `id`, `created_at`, `updated_at` + ресурс-специфичные поля; списки — пагинация
через `data`, `count`, `has_more`.

**Conversions API** (`developers.openai.com/ads/conversions-api`) — отдельный домен и хост:
- **Endpoint**: `https://bzr.openai.com/v1/events?pid=<PIXEL-ID>`
- Аутентификация: `Authorization: Bearer`, `Content-Type: application/json`.
- Батч до 1000 событий за запрос; **при ошибке в одном событии весь батч отклоняется**.
- Поддерживаемые типы событий: `appointment_scheduled`, `checkout_started`, `contents_viewed`, `custom`,
  `items_added`, `lead_created`, `order_created`, `page_viewed`, `registration_completed`,
  `subscription_created`, `trial_started`, `app_installed`, `app_opened`.
- Server-side (Conversions API) даёт более надёжную атрибуцию, чем только pixel — но, в отличие от
  pixel, сервер **не захватывает автоматически click-ID/attribution** — его нужно самостоятельно
  прокинуть в событии, если он доступен.
- Обязательные поля события: `id`, `type`, `timestamp_ms` (не старше 7 дней). Web-события требуют
  `source_url` и `action_source`. `data` — специфичен для типа события (`amount`, `currency`, `contents`
  и т.п.).
- **Дедупликация**: переиспользовать одинаковый `id` между pixel- и server-событиями с одним Pixel ID —
  OpenAI обработает только первое полученное.

### Что НЕ задокументировано / не является публичным API
- OAuth для рекламодателей — не найдено, только статический API key.
- Полный список поддерживаемых стран/гео — не найден фиксированным списком, нужно проверять в
  Ads Manager на момент подключения.
- Точная схема `/ad_groups`, `/ads`, `/files`, `/upload` — задокументирована частично (см. Quickstart
  выше), полную схему полей нужно смотреть в OpenAPI spec на момент реализации (спецификация меняется
  вместе с платформой, которая всё ещё в статусе Beta).
- MCC/agency-master-account API — **NOT AVAILABLE AS AN OFFICIAL PUBLIC API** (агентство работает как
  приглашённый участник в каждом клиентском аккаунте отдельно, включая отдельный API-ключ на аккаунт).
- Ad format / creative asset requirements (image specs, video) — не покрыты в собранных источниках
  этого research'а; уточнить в Ads Manager UI/Help Center при первой реальной интеграции.

---

## Phase 3 — Сторонние/неофициальные интеграции

- **Improvado** (`improvado.io/integrations/openai-ads`) — заявляет 200+ метрик/измерений по
  кампаниям/ad groups/keywords/аудиториям/гео/устройствам, обновление каждые 15 минут; плюс MCP-сервер
  для доступа AI-агентов (Claude/ChatGPT/Cursor) к данным. Судя по описанию (метрики на уровне keywords,
  которых в самой OpenAI Ads campaign-схеме нет) и по общей практике таких агрегаторов — вероятно,
  сочетание официального API для части данных и собственной ETL-прослойки; точный метод (Official API
  vs unofficial scraping) не подтверждён из публичного описания, требует отдельной проверки перед любым
  использованием.
- **Zapier MCP** — общий MCP-коннектор к ~9000 приложениям, вызываемый через OpenAI Responses API/
  Anthropic Messages API; не специфичен для OpenAI Ads, отдельного "OpenAI Ads action" не подтверждено.
- Ни один найденный источник не предлагает CSV import/export как признанный OpenAI workflow — сама
  OpenAI предоставляет REST API напрямую, так что задача "CSV vs API" (Option B промпта) не актуальна:
  API уже есть (Option A).

**Вывод**: сторонние агрегаторы существуют, но ни один не заменяет прямую интеграцию через официальный
`api.ads.openai.com` — для нашей архитектуры (собственное хранилище `ad_stat`, собственные агенты) прямая
интеграция через официальный API — правильный путь, third-party решения тут не нужны.

---

## Phase 4 — Решение по архитектуре: **Option A**

Официальный API существует и достаточно полнофункционален (campaigns/ad_groups/ads/reporting/conversions).
Реализуем `OpenAIAdsAdapter` по образцу `google-ads.ts`/`yandex-direct.ts`, с оговорками:

1. **Аутентификация — не OAuth**, а статический API key per ad account (в отличие от Google/Yandex).
   `platform_identity.credential_ref` в этом случае указывает на env-переменную с самим API-ключом,
   а не на refresh/access-токен пару.
2. **Нет keyword-таргетинга** — прямая интеграция в PPC-агента (который оперирует keywords/ad groups
   по интентам) не переносится 1:1; для OpenAI Ads на первом этапе реализуем адаптер и низкоуровневые
   операции (list/create/pause/report/conversion), без автогенерации campaign-структуры моделью —
   это отдельная будущая работа, если появится реальный клиент с бюджетом на ChatGPT Ads.
3. **Нет живого API-ключа** (у агентства пока нет собственного/клиентского ad account в OpenAI Ads
   Manager) — адаптер реализуется по документированной схеме, но не протестирован против реального
   аккаунта (тот же честный disclosed-статус, что у части функций `yandex-direct.ts`, например
   `getWeeklySpendLimit`/`adjustWeeklySpendLimit`, помеченных "built and unit-tested against a mocked
   fetch only — NOT yet exercised against a real account").
