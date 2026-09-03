# OpenAI Ads — Research Sources

Собрано 2026-09-03 для `docs/openai-ads-integration-research.md`. Первоисточники OpenAI — в приоритете.

## Первоисточники (OpenAI)

| Title | URL | Тип | Дата обращения | Что подтверждает |
|---|---|---|---|---|
| Overview – Ads \| OpenAI Developers | https://developers.openai.com/ads/api-overview | Официальная разработческая документация | 2026-09-03 | Advertiser API существует; auth = API key per ad account, Bearer token; rate limits (600/1200 req/min, 10 req/10s bulk); v1, OpenAPI spec доступен |
| Quickstart – Ads \| OpenAI Developers | https://developers.openai.com/ads/api-quickstart | Официальная разработческая документация | 2026-09-03 | Base URL `api.ads.openai.com/v1`; полный quickstart-флоу (ad_account → upload → campaigns → ad_groups → ads → insights); формат запросов/ответов |
| Campaigns – Ads \| OpenAI Developers | https://developers.openai.com/ads/api-reference/campaigns | Официальный API reference | 2026-09-03 | Полная схема campaign resource (поля, bidding_type, targeting, status values, CRUD + activate/pause/archive операции) |
| Conversions API – Ads \| OpenAI Developers | https://developers.openai.com/ads/conversions-api | Официальный API reference | 2026-09-03 | Отдельный хост `bzr.openai.com`, batch events, типы событий, дедупликация, server vs pixel различие |
| Ads \| OpenAI Developers (index) | https://developers.openai.com/ads | Официальная разработческая документация | 2026-09-03 | Точка входа в документацию Ads API |
| Advertise in ChatGPT \| OpenAI Ads | https://ads.openai.com/ | Официальный продуктовый сайт | 2026-09-03 | Существование self-serve Ads Manager |
| ChatGPT Ads \| OpenAI Help Center | https://help.openai.com/en/collections/20001223-chatgpt-ads | Официальный Help Center | 2026-09-03 | Общая структура помощи по ChatGPT Ads |
| Ads Manager Beta Overview \| OpenAI Help Center | https://help.openai.com/en/articles/20001206-ads-manager-beta-overview | Официальный Help Center | 2026-09-03 | Ads Manager Beta как продукт для запуска/управления кампаниями |
| Ads Manager Beta Account Setup \| OpenAI Help Center | https://help.openai.com/en/articles/20001213-ads-manager-beta-account-setup | Официальный Help Center | 2026-09-03 | Процесс создания аккаунта (5 шагов), множественные аккаунты на компанию, разные email на аккаунт |
| Managing identity and access for Ads Manager \| OpenAI Help Center | https://help.openai.com/en/articles/20001273-managing-identity-and-access-for-ads-manager | Официальный Help Center | 2026-09-03 | Роли Admin/Campaign Manager/Viewer; приглашение участников; один email — несколько аккаунтов |
| New ways to buy ChatGPT ads \| OpenAI | https://openai.com/index/new-ways-to-buy-chatgpt-ads/ | Официальный анонс | 2026-09-03 | Self-serve запуск, CPC-биддинг, снятие порога $50K |
| A milestone in expanding access to AI \| OpenAI | https://openai.com/index/expanding-access-to-ai-with-chatgpt-ads/ | Официальный анонс | 2026-09-03 | Контекст расширения доступа к рекламной платформе |
| Our approach to advertising and expanding access \| OpenAI | https://openai.com/index/our-approach-to-advertising-and-expanding-access/ | Официальная позиция компании | 2026-09-03 | Общий подход OpenAI к рекламе в ChatGPT |

## Вторичные источники (независимая журналистика/индустрия)

| Title | URL | Тип | Дата обращения | Что подтверждает |
|---|---|---|---|---|
| OpenAI launches self-serve ad platform — Axios | https://www.axios.com/2026/05/05/openai-self-serve-ad-platform | Независимая журналистика | 2026-09-03 | Дата запуска self-serve (5 мая 2026), контекст рынка |
| Will OpenAI's New Measurement Tools And Ads Manager Prove Its Worth — AdExchanger | https://www.adexchanger.com/ai/will-openais-new-measurement-tools-and-ads-manager-prove-its-worth-as-an-ad-channel/ | Индустриальное издание | 2026-09-03 | Запуск Conversions API + self-serve Ads Manager, $1B ARR за ~200 дней |
| OpenAI opens ChatGPT Ads Manager to all US businesses with CPC bidding — PPC Land | https://ppc.land/openai-opens-chatgpt-ads-manager-to-all-us-businesses-with-cpc-bidding/ | Индустриальное издание | 2026-09-03 | US-only рынок на момент открытия, CPC-биддинг |
| OpenAI Ads Manager Explained: Hands-On Testing — We Are ROAST | https://weareroast.com/news/openai-ads-manager-explained-hands-on-testing-of-chatgpt-advertising/ | Независимый практический разбор (агентство) | 2026-09-03 | Нет MCC-style мастер-аккаунта; агентства не могут создавать аккаунты за клиента |
| ChatGPT Ads Manager: What Advertisers Need to Know — WebFX | https://www.webfx.com/blog/ai/chatgpt-ads-manager/ | Индустриальный блог | 2026-09-03 | Общий обзор self-serve платформы |

## Сторонние интеграторы (для Phase 3, помечены как неофициальные/непроверенные)

| Title | URL | Тип | Дата обращения | Что подтверждает |
|---|---|---|---|---|
| OpenAI Ads Documentation — Improvado | https://improvado.io/docs/openai-ads | Продукт стороннего агрегатора данных | 2026-09-03 | Заявленная интеграция с OpenAI Ads (200+ метрик); метод (official API vs собственный ETL) не подтверждён из публичного описания — использовать с осторожностью, не проверено напрямую |
| OpenAI Ads Data Integration — Improvado | https://improvado.io/integrations/openai-ads | Продукт стороннего агрегатора данных | 2026-09-03 | То же |

**Важно**: список сторонних интеграторов приведён только для полноты картины Phase 3 промпта. Ни один
из них не использовался и не рекомендуется как основа реализации — весь код в этом репозитории
(`apps/web/lib/tools/openai-ads.ts`) построен исключительно на первоисточниках OpenAI из первой таблицы.
