# OpenAI Ads (ChatGPT Ads) — Integration

Дата: 2026-09-03. Полное research-обоснование — в
[`docs/openai-ads-integration-research.md`](./openai-ads-integration-research.md). Этот документ —
справочник по тому, что реализовано.

## 1. Текущие возможности OpenAI Ads

Self-serve платформа (`ads.openai.com`, Ads Manager Beta), открыта всем US-рекламодателям с 5 мая 2026.
CPM/CPC биддинг, own-account-only модель (нет MCC/агентского мастер-аккаунта — агентство приглашается
как участник в каждый клиентский аккаунт отдельно). Подробности — research doc Phase 2.

## 2. Доступность API

**Официальный публичный API существует**: `https://api.ads.openai.com/v1` (Advertiser API) +
`https://bzr.openai.com/v1/events` (Conversions API). Первоисточник: `developers.openai.com/ads`.

## 3. Аутентификация

Статический API key, выпускается в Ads Manager → Settings, привязан к одному ad account.
`Authorization: Bearer $OPENAI_ADS_API_KEY`. Нет OAuth. См. `apps/web/lib/tools/openai-ads-auth.ts`.

## 4. Поддерживаемые операции (реализовано)

Модуль `apps/web/lib/tools/openai-ads.ts`:

| Функция | API-операция |
|---|---|
| `verifyAdAccountAccess()` | `GET /ad_account` |
| `listCampaigns()` | `GET /campaigns` |
| `getCampaign(id)` | `GET /campaigns/{id}` |
| `createOrReusePausedCampaign(input)` | `POST /campaigns` (всегда `status: "paused"`, идемпотентно по имени) |
| `setCampaignStatus(id, "activate"｜"pause"｜"archive")` | `POST /campaigns/{id}/activate｜pause｜archive` |
| `adjustCampaignBudget(id, micros)` | `POST /campaigns/{id}` (обновление `budget.lifetime_spend_limit_micros`) |
| `getAdInsights(adId)` | `GET /ads/{id}/insights` |
| `sendConversionEvents(pixelId, events)` | `POST bzr.openai.com/v1/events?pid=...` |

Зарегистрировано как инструменты агентского фреймворка: `"openai-ads"` (создание пустой paused-кампании)
и `"openai-ads-optimize"` (action-dispatch: `verifyAdAccountAccess`/`listCampaigns`/`setCampaignStatus`/
`adjustCampaignBudget`/`getAdInsights`/`sendConversionEvents`) — см. `apps/web/lib/real-tools.ts`,
`apps/web/lib/singletons.ts`.

`campaign_status` синк (`apps/web/lib/sync-campaign-status.ts`) поддерживает `openai-ads` наравне с
Google/Yandex — читает `listCampaigns()`, статус "active" = is_running.

## 5. Неподдерживаемые/нереализованные операции

- **Ad groups / ads / creative upload** (`POST /ad_groups`, `POST /ads`, `POST /upload`) — задокументированы
  в Quickstart, но не реализованы в адаптере: OpenAI Ads не имеет keyword-таргетинга, и PPC-агент
  (`packages/agents/ppc`) целиком построен вокруг keyword/ad-group структуры Google/Yandex — переносить
  его логику на custom-audience таргетинг OpenAI Ads без отдельного проектирования преждевременно (нет
  реального клиента с задачей под ChatGPT Ads).
- **`syncAdStats` (per-campaign/per-day отчёт в `ad_stat`) для `openai-ads` — намеренно НЕ реализован.**
  Единственный задокументированный reporting-эндпоинт — `GET /ads/{id}/insights` (per-**ad**, не
  per-campaign/per-day). Вызов `syncAdStats()` для аккаунта с `platform = 'openai-ads'` явно бросает
  ошибку с пояснением, вместо того чтобы гадать несуществующую агрегацию.
- **UI-страница подключения** (`Settings → Advertising Platforms`) — не создана. В проекте нет такой
  страницы вообще ни для одной платформы (ни Google Ads, ни Yandex Direct не подключаются через UI);
  подключение клиента сегодня — это ручная вставка строк в `platform_identity`/`client_ad_account`
  напрямую в Supabase. Городить отдельную UI-страницу только для OpenAI Ads было бы непоследовательным
  относительно остального проекта; когда появится реальная задача сделать такую страницу — она должна
  сразу покрывать все три платформы одинаково.
- **PPC-агент (`packages/agents/ppc`) не расширен** под `openai-ads` — его payload-типы (`platform:
  "google-ads" | "yandex-direct"`) не тронуты. `campaign-trends.ts` (детектор деградации) — расширен
  (агностичен по структуре, читает `ad_stat`/`campaign_status` generic-полями), но раз `syncAdStats`
  не пишет `openai-ads`-строки в `ad_stat`, реального трафика данных для тренд-детектора по этой
  платформе пока не будет, пока кто-то не реализует альтернативный источник (например, регулярный обход
  `getAdInsights` по всем `ads` аккаунта).
- **OAuth-подключение рекламодателя** — платформа его не предоставляет вообще (см. research doc Phase 2).
- **Полная схема `/ad_groups`/`/ads`/`/upload`** — не реализована: задокументирована частично, точные
  поля нужно сверять по актуальному OpenAPI spec на момент реальной работы (платформа в статусе Beta).

## 6. Известные ограничения

- **Не протестировано против реального аккаунта.** У агентства пока нет собственного/клиентского OpenAI
  Ads ad account — весь адаптер построен по документации и покрыт только mock-fetch юнит-тестами
  (`apps/web/lib/tools/openai-ads.test.ts`, 13 тестов). Та же дисклоузд-позиция, что у части функций
  `yandex-direct.ts` (`getWeeklySpendLimit`/`adjustWeeklySpendLimit`) до их первого реального прогона.
- **Модель доступа для агентства**: нет MCC — на каждого клиента нужен отдельный API-ключ, выпущенный
  внутри его собственного ad account, после того как владелец пригласит агентство участником.
- **`createOrReusePausedCampaign` создаёт только пустой campaign-контейнер** (без ad group/ad/креатива) —
  аналогично тому, как `google-ads.ts`/`yandex-direct.ts`'s одноимённые функции начинали, до того как
  появились `buildMultiGroupSearchCampaign`. Для OpenAI Ads такого билдера пока нет.

## 7. Архитектура

```
AI Agent (будущий, не packages/agents/ppc)
   ↓
apps/web/lib/real-tools.ts ("openai-ads" / "openai-ads-optimize" tool ids)
   ↓
apps/web/lib/tools/openai-ads.ts (адаптер)
   ↓
api.ads.openai.com/v1  +  bzr.openai.com/v1/events (Conversions API)
```

Общего типизированного интерфейса `AdvertisingPlatform` (класс/контракт) в проекте намеренно не
вводили: существующий стиль (`google-ads.ts`, `yandex-direct.ts`) — независимые модули с экспортированными
функциями, а не implementations одного интерфейса, и диспетчеризация везде идёт через `real-tools.ts`'s
`switch(toolId)`, а не полиморфный вызов. `openai-ads.ts` следует этому же стилю ради консистентности,
а не вводит параллельную архитектуру. Общий "контракт" де-факто — это одинаковый набор функций-конвенций
(`isXConfigured`, `listCampaigns`, `createOrReusePausedCampaign`, `setCampaignStatus`,
`adjustCampaignBudget`) с платформо-специфичными сигнатурами, а не единый TypeScript `interface`.

Credential resolution переиспользован без изменений: `platform_identity` + `client_ad_account` +
`resolveAccessContext()` — просто `AccessContext.platform` расширен до
`"google-ads" | "yandex-direct" | "openai-ads"`, и `credentialRef` для `openai-ads`-строки называет
env-переменную со статическим API-ключом вместо OAuth-пары.

## 8. Переменные окружения

- `OPENAI_ADS_API_KEY` — дефолтный API-ключ (single-tenant случай). Для нескольких клиентских аккаунтов
  каждый получает свою переменную (например `OPENAI_ADS_MEDAVENUE_API_KEY`), имя которой прописывается
  в `platform_identity.credential_ref` для соответствующей строки.

Секрет **не** хранится в БД — только имя переменной, тот же паттерн, что у Google Ads/Yandex Direct
(`docs/openai-ads-integration-research.md`, Phase 1, "Credential resolution").

## 9. Изменения в БД

`supabase/migrations/0012_openai_ads_platform.sql` — расширяет 4 CHECK-constraint'а
(`platform_identity`, `client_ad_account`, `ad_stat`, `campaign_status`), добавляя `'openai-ads'` к
списку допустимых значений `platform`. `target_conversion` не тронут (его `platform` — про
измерительную платформу конверсий, не про рекламную).

Применить: `supabase db push` (или через Supabase MCP `apply_migration`) — миграция ещё не применена
к проекту `vrarckhispnfytgxlqtm` на момент написания этого документа.

## 10. Инструкции по настройке (когда появится реальный клиент)

1. Клиент сам регистрирует ad account на `ads.openai.com`, проходит верификацию и биллинг.
2. Клиент приглашает агентство (email) участником — роль `Campaign Manager` или `Admin`.
3. В Ads Manager → Settings клиент (или агентство, если роль это позволяет) выпускает API key.
4. Ключ кладётся в `.env.local` (или переменные окружения деплоя) под уникальным именем, например
   `OPENAI_ADS_<CLIENT>_API_KEY`.
5. В Supabase создаются строки: `platform_identity` (`platform='openai-ads'`, `credential_ref` = имя
   этой переменной), `client_ad_account` (`platform='openai-ads'`, `access_mode='direct'`,
   `external_account_id` = id аккаунта из `GET /ad_account`, `identity_id` → строка выше).
6. Применить миграцию `0012_openai_ads_platform.sql`, если ещё не применена.
7. Проверить доступ: вызвать tool `"openai-ads-optimize"` с `action: "verifyAdAccountAccess"` и
   `apiKeyEnv: "OPENAI_ADS_<CLIENT>_API_KEY"`.

## 11. Инструкции по тестированию

```bash
cd apps/web
node --experimental-strip-types --test lib/tools/openai-ads.test.ts
```

Полный прогон `lib`-тестов (проверка, что интеграция не сломала существующие адаптеры):

```bash
node --experimental-strip-types --test lib/tools/*.test.ts lib/*.test.ts
```

Тайпчек:

```bash
npx tsc --noEmit -p .
```

## 12. Ручной workflow (пока PPC-агент не расширен)

Полноценной автоматической генерации кампании AI-агентом под OpenAI Ads пока нет (см. п.5).
До появления реального клиента с бюджетом на ChatGPT Ads рабочий процесс:
1. Человек вручную формулирует таргетинг (гео/custom audiences) и бюджет.
2. Через tool `"openai-ads"` или напрямую `createOrReusePausedCampaign()` создаётся пустая
   paused-кампания.
3. Ad groups/ads/креативы — вручную через Ads Manager UI (нет билдера в коде, см. п.5).
4. Активация — отдельное осознанное человеческое действие (`setCampaignStatus(id, "activate")`,
   отдельно, никогда не автоматически).

## 13. Путь миграции к более полной интеграции

Когда появится реальный клиент/аккаунт:
1. Прогнать текущий адаптер против реального API-ключа, зафиксировать реальные ответы (по аналогии с
   тем, как `yandex-direct.ts`'s `getWeeklySpendLimit` дошёл от "unverified" до "verified live").
2. Уточнить точную схему `/ad_groups`/`/ads`/`/upload` по актуальному OpenAPI spec и реализовать
   билдер (аналог `buildMultiGroupSearchCampaign`), спроектированный под custom-audience/context_hints
   таргетинг, а не под keywords.
3. Решить, нужен ли per-ad `getAdInsights` roll-up в `ad_stat` (обход всех ads аккаунта) как временная
   замена отсутствующему per-campaign report endpoint — или дождаться, добавит ли OpenAI такой endpoint.
4. Если появится 3+ реальных клиента на разных платформах одновременно и `real-tools.ts`'s switch
   вырастет ощутимо — тогда стоит вернуться к вопросу выделения формального `AdvertisingPlatform`
   TS-интерфейса (см. п.7) вместо повторяющегося паттерна функций.
