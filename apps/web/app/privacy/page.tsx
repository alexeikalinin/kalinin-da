// Required by Google Cloud's OAuth consent screen to switch the app's
// publishing status from "Testing" (7-day forced refresh-token expiry) to
// "In production" (no forced expiry) — Google requires a reachable privacy
// policy URL before "Publish app" is enabled. This is an internal agency
// tool, not a consumer product; the audience here is Google's own review
// plus anyone the agency grants OAuth consent to (its own accounts and, for
// direct-access clients, the client's own Google account).
export default function PrivacyPolicyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem", lineHeight: 1.6 }}>
      <h1>Политика конфиденциальности</h1>
      <p>Kalinin Digital Agency — внутренний инструмент для работы с рекламными аккаунтами клиентов.</p>

      <h2>Что это за приложение</h2>
      <p>
        Это приложение используется агентством для чтения и настройки рекламных кампаний, целей и
        отчётности в аккаунтах клиентов Google Ads, Google Analytics, Google Tag Manager и Яндекс.Директ/Метрика,
        к которым у агентства есть доступ по договорённости с клиентом.
      </p>

      <h2>Какие данные обрабатываются</h2>
      <p>
        Приложение получает доступ только к рекламным/аналитическим данным (кампании, конверсии, статистика),
        не к личным данным конечных пользователей клиентских сайтов. Доступ предоставляется через OAuth
        конкретным аккаунтом клиента или агентства и используется только для формирования отчётности и
        настройки рекламных кампаний по запросу клиента.
      </p>

      <h2>Хранение и передача данных</h2>
      <p>
        Данные не передаются третьим лицам. Учётные данные (refresh/access токены) хранятся в защищённом
        серверном окружении и не раскрываются публично.
      </p>

      <h2>Контакты</h2>
      <p>По вопросам — 1alexeikalinin1@gmail.com.</p>
    </main>
  );
}
