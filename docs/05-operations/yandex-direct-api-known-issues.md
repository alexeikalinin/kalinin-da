# Yandex Direct API v5 — known issues

Статус: Reference — портировано из другого моего проекта (PPC Master Tool /
Astrum Analyzer, найдено и исправлено там 2026-07-21/22 при сверке цифр с
живым интерфейсом Директа), 2026-08-30.

Назначение: список задокументированных багов интеграции с Yandex Direct API,
на которые стоит проверять любой новый код, читающий или пишущий в
`apps/web/lib/tools/yandex-direct.ts`. Формат каждого пункта: **Симптом →
Причина → Фикс → Статус в этом репозитории**.

---

## 1. Reports API молча портит одну строку, если `skipReportSummary` не
согласован с обрезкой ответа

**Симптом:** сумма расхода/конверсий по кампаниям не сходится с интерфейсом
Директа — либо не хватает одной кампании, либо появляется одна "лишняя"
строка с мусорными значениями.

**Причина:** Reports API по умолчанию (`skipReportSummary` не задан или
`"false"`) добавляет к TSV-ответу дополнительную строку-итог по всему
диапазону. Код, который парсит TSV, должен либо (а) не задавать
`skipReportSummary` и обрезать последнюю строку, либо (б) задать
`skipReportSummary: "true"` и не обрезать ничего. Любая другая комбинация
даёт либо потерю реальной строки, либо мусорную "итоговую" строку,
принятую за данные.

**Статус здесь:** ✅ `getCampaignReport` в `yandex-direct.ts` явно ставит
`skipReportSummary: "true"` и обрезает только заголовочную строку и footer
`"Total rows: N"` — согласовано верно.

---

## 2. `Client-Login` для прямого (не агентского) токена → ошибка 8800

**Симптом:** `error_code: "8800"`, `"В HTTP-заголовке Client-Login указан
несуществующий логин"`, хотя токен точно рабочий.

**Причина:** заголовок `Client-Login` нужен только когда токен принадлежит
агентству и запрос идёт от имени суб-клиента. Для прямого токена его
отправлять нельзя вообще.

**Статус здесь:** ✅ `callDirect` в `yandex-direct.ts` шлёт `Client-Login`
только если `clientLogin` передан вызывающим кодом — уже условно корректно
для обоих режимов.

---

## 3. `DailyBudget` пуст для автостратегий — реальный бюджет живёт в
`BiddingStrategy`

**Симптом:** `campaigns.get` → `DailyBudget` возвращает `null` для части
кампаний, хотя в интерфейсе бюджет явно виден ("Средняя цена конверсии",
"Бюджет в неделю").

**Причина:** `DailyBudget` — только для кампаний с классическим дневным
лимитом. Кампании на автостратегиях (`AVERAGE_CPA`, `AVERAGE_CPC`,
`WB_MAXIMUM_CONVERSION_RATE`) хранят бюджет внутри
`TextCampaign.BiddingStrategy.Search.<StrategyTypeName>.WeeklySpendLimit`
(микроединицы), целевую цену — в `AverageCpa`/`AverageCpc` рядом. Нужно
запрашивать `TextCampaignFieldNames: ["BiddingStrategy"]`.

**Статус здесь:** ✅ Живой прогон 2026-09-03 (аудит Медавеню через generic
tooling) подтвердил обе стороны: `getWeeklySpendLimit` реально читает
`WeeklySpendLimit` на живых автостратегиях, а для кампаний БЕЗ автостратегии
(фиксированный `DailyBudget`) до этого прогона не было НИКАКОЙ функции,
читающей `DailyBudget` для уже существующей кампании — `yandex-direct.ts`
мог только записать его при создании. Добавлена `getDailyBudget(campaignId)`
(top-level поле `DailyBudget`, `FieldNames: ["Id", "DailyBudget"]`, без
`TextCampaignFieldNames`) — комплементарна `getWeeklySpendLimit`: кампания
использует ровно один из двух механизмов, никогда оба сразу.

---

## 3b. `getWeeklySpendLimit` проверял только `Search`-ветку `BiddingStrategy`
— РСЯ-кампании выглядели как "нет автостратегии"

**Симптом:** сетевая (РСЯ) кампания на реальной автостратегии (например,
`AVERAGE_CPC` с `WeeklySpendLimit`) возвращала `weeklySpendLimitMicros: null`
— как будто у неё вообще нет бюджетного сигнала, хотя лимит явно виден в
интерфейсе.

**Причина:** РСЯ-кампания обычно имеет `Search.BiddingStrategyType =
SERVING_OFF` (поиск выключен), а реальная стратегия/`WeeklySpendLimit`
живёт в `Network`-ветке того же `BiddingStrategy`. Код проверял только
`Search`.

**Фикс (2026-09-03):** `getWeeklySpendLimit` теперь проверяет `Search`, а
если там нет вложенного `WeeklySpendLimit` — `Network`, и возвращает поле
`scope: "Search" | "Network" | undefined`, показывающее, какая ветка
сработала. `adjustWeeklySpendLimit` пишет обратно в ту же ветку, а не
хардкодит `Search`.

**Статус здесь:** ✅ Найдено и исправлено 2026-09-03 при живом прогоне
против реального аккаунта Медавеню (4 РСЯ-кампании ранее не проходили
проверку бюджетного лимита вообще). Покрыто юнит-тестами
(`yandex-direct.test.ts`).

---

## 3c. `campaigns.get` с `FieldNames: ["Id", "DailyBudget"]` без
`TextCampaignFieldNames` молча возвращает `DailyBudget: null` даже когда
бюджет реально задан

**Симптом:** `getDailyBudget(campaignId)` возвращало `dailyBudgetMicros:
null` для нескольких кампаний Медавеню (`Дерматология // Поиск`, `ЛОР //
Поиск`, `Невролог // Поиск`, `Андрология`, `Интимная пластика ж`,
`Лазерное обрезание` — все с `HIGHEST_POSITION` в интерфейсе, явно
показывающем дневной бюджет), из-за чего аудит бюджетных ограничителей
(2026-09-03) едва не сделал вывод "у 6 кампаний нет бюджетного лимита
вообще" — ложь, они просто не читались.

**Причина:** живая проверка показала, что `DailyBudget` populated
корректно ТОЛЬКО когда запрос одновременно включает
`TextCampaignFieldNames: ["BiddingStrategy"]` — без этого параметра поле
`DailyBudget` возвращается `null` независимо от порядка/состава
`FieldNames` (проверено: `["Id","DailyBudget"]`,
`["Id","DailyBudget","Currency"]`, `["Id","DailyBudget","Name"]` — все
`null`; `["Id","DailyBudget"]` + `TextCampaignFieldNames: ["BiddingStrategy"]`
— работает). Не задокументировано в Direct API v5 доках, воспроизведено
дважды на одном и том же `campaignId` (707005501) для изоляции причины.

**Фикс (2026-09-03):** `getDailyBudget` теперь всегда отправляет
`TextCampaignFieldNames: ["BiddingStrategy"]` вместе с `FieldNames`, даже
хотя сама функция это поле не использует — только чтобы заставить API
реально вернуть `DailyBudget`.

**Статус здесь:** ✅ Исправлено, проверено против живого аккаунта Медавеню
(все 6 ранее ложно-`null` кампаний теперь возвращают реальную сумму).

---

## 4. Ставки по ключевым фразам — не в `keywordbids.get`, а в `keywords.get`

**Симптом:** `keywordbids.get` возвращает только `ServingStatus`/
`StrategyPriority`, без самой ставки.

**Причина:** реальная ставка — поле `Bid` (и `ContextBid` для сетей) в
`keywords.get`, тоже в микроединицах.

**Статус здесь:** ⚠️ `getKeywordBids` в `yandex-direct.ts` добавлена
2026-08-30 (Track B) — читает `Bid`/`ContextBid` из `keywords.get`, как и
положено. Как и пункт 3 — код написан и юнит-тестирован на моках, живой
проверки против реального аккаунта ещё не было.

---

## 5. Средняя ставка по кампании — считать взвешенно по кликам

**Симптом:** "% от ставки" по кампании получается выше 100–120%.

**Причина:** невзвешенное среднее по ставкам всех фраз не отражает
реальную структуру трафика.

**Фикс:** `sum(bid[kw] * clicks[kw]) / sum(clicks[kw])`, клики — из
`CRITERIA_PERFORMANCE_REPORT` с фильтром `CriteriaType == "KEYWORD"`.

**Статус здесь:** неприменимо — то же самое, актуально только вместе с
пунктом 4.

---

## 6. Кампания создавалась только в одном виде — `search_only` /
`HIGHEST_POSITION`, без выбора стратегии или типа кампании

**Симптом:** запрос кампании под CPA/ROI-цель или под РСЯ (сетевую)
выдачу тихо создавал обычную поисковую кампанию с ручной ставкой
"Наивысшая позиция" — не то, что просили.

**Причина:** `createOrReusePausedCampaign` жёстко хардкодил
`TextCampaign.BiddingStrategy = { Search: HIGHEST_POSITION, Network:
SERVING_OFF }`. PPC Master Tool (`draft_campaigns_setup.py`) умел как
минимум `search_only` и `network_only` варианты TextCampaign.

**Фикс (2026-09-02):** `yandex-direct.ts` теперь поддерживает весь
документированный Direct API v5 набор: Search-стратегии
(`HIGHEST_POSITION`, `MAXIMUM_CLICKS`, `AVERAGE_CPA`, `AVERAGE_CPC`,
`AVERAGE_ROI`, `AVERAGE_CRR`, `PAY_FOR_CONVERSION`,
`PAY_FOR_CONVERSION_CRR`, `WEEKLY_CLICK_PACKAGE`, `WB_MAXIMUM_CLICKS`,
`WB_MAXIMUM_CONVERSION_RATE`, `SERVING_OFF`), Network-стратегии
(`MAXIMUM_COVERAGE`, `NETWORK_DEFAULT`, `AVERAGE_CPA`, `AVERAGE_CPC`,
`AVERAGE_CRR`, `PAY_FOR_CONVERSION`, `PAY_FOR_CONVERSION_CRR`,
`WEEKLY_CLICK_PACKAGE`, `WB_MAXIMUM_CLICKS`, `WB_MAXIMUM_CONVERSION_RATE`,
`SERVING_OFF`), и селектор типа кампании (`TEXT_CAMPAIGN`,
`DYNAMIC_TEXT_CAMPAIGN`, `MOBILE_APP_CAMPAIGN` — те же
`BiddingStrategy.{Search,Network}`, что и TextCampaign; `CPM_BANNER_CAMPAIGN`,
`SMART_CAMPAIGN` — другая, НЕ проверенная против реального аккаунта форма
`BiddingStrategy`, требует явного `campaignTypeFields` от вызывающего кода).

**Второй проход (2026-09-02, тот же день):** первая версия этого фикса
(написана одним фоновым агентом) была cross-checked против двух
независимых живых WebFetch-запросов к
`yandex.ru/dev/direct/doc/ref-v5/campaigns/add-text-campaign.html` вторым
агентом в этом же чате — нашлись реальные пробелы и один
close-to-production баг:
- Search и Network изначально не включали `AVERAGE_CRR`,
  `PAY_FOR_CONVERSION`, `PAY_FOR_CONVERSION_CRR`, `WEEKLY_CLICK_PACKAGE` —
  все четыре реально документированы, добавлены.
- Network изначально не включал `WB_MAXIMUM_CLICKS`/
  `WB_MAXIMUM_CONVERSION_RATE` вообще — а реальные кампании на этих
  автостратегиях используют одну и ту же стратегию под Search И Network
  одновременно, так что без этого Network-часть такой кампании была
  невозможна.
- `AVERAGE_CPA` тихо не отправляла `GoalId`, хотя API документирует его
  как обязательный для этой стратегии (только `AverageCpa`/
  `PayForConversionEnabled` уходили) — реальный API скорее всего отклонил
  бы такой запрос. Исправлено: `GoalId` теперь общий для всех
  стратегий-получателей, не только `AVERAGE_ROI`/`WB_MAXIMUM_CONVERSION_RATE`.
- `NETWORK_DEFAULT.LimitPercent` не был проброшен вообще (поле
  игнорировалось, отправлялся только `BiddingStrategyType`) — добавлено.

**Статус здесь:** ✅ TextCampaign + все Search/Network-стратегии — покрыто
юнит-тестами на замоканный `fetch` (`yandex-direct.test.ts`, 26 тестов), но
НЕ проверено против живого аккаунта. ⚠️ DynamicTextCampaign/MobileAppCampaign
контейнер создаётся, но ad group/keyword-логика этого файла рассчитана
только на TextCampaign — для остальных типов нужен отдельный ad-group
пайплайн (фид/сторы), которого в этом кодбейзе пока нет. ⚠️
CpmBannerCampaign/SmartCampaign — только raw passthrough,
`BiddingStrategy`-форма не смоделирована и не проверена.
