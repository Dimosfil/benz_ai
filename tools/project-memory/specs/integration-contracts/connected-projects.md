# Connected Projects And External Sources

## Telegram Bot Template / gateway logic source

- Local source: `D:\AI\telegram_bot_template`.
- Purpose: source of the Telegram long-polling gateway contract used to expose
  Benz AI through Telegram alongside the existing web interface.
- Adopted scope: token validation, `getUpdates` offset handling, text-message
  normalization, `sendMessage`, retry state, safe health status and shutdown.
- Excluded scope: Fastify, React admin panel, TypeScript monorepo structure,
  SQLite sessions, guide delivery, subscription checks, leads, uploads,
  callback buttons and template-specific business commands.
- Runtime relationship: design/source reference only. Benz AI owns a native
  JavaScript adaptation and does not load the sibling repository at runtime.
- Access boundary: inspect only gateway, configuration, DTO and focused test
  files; never read its local `.env`, databases, archives, logs or bot data.

## LLM Providers / DeepSeek logic source

- Local source: `D:\AI\llm_providers`.
- Purpose: source of the narrow, reusable DeepSeek chat-completions transport
  adopted by Benz AI.
- Integration role: design/source reference only; Benz AI owns its local
  `providers/deepseek.js` adaptation and does not depend on the sibling project
  at runtime.
- Adopted scope: DeepSeek server-side configuration, OpenAI-compatible request
  shape, Bearer authentication, response validation and provider tests.
- Excluded scope: Codex, mock and generic provider selection, local runtime
  configuration, secrets and generated artifacts.
- Access boundary: inspect only DeepSeek-relevant source files when updating
  this adapter. Never copy or read source-project secrets or runtime data.
- Detailed contract: `tools/project-memory/specs/deepseek-integration.md`.

## Multigo

- Purpose: nearest-place catalog for the automotive fueling category; the raw
  response can include EV charging stations.
- Candidate API: `POST https://multigo.ru/api/9/near/list` with JSON body
  `{"lat": <latitude>, "lng": <longitude>, "limit": <integer>}`.
- Verified on 2026-07-10: HTTP 200 with `err: 0` and `data.list`; each item
  included an ID, name, coordinates in `loc`, address, category, status,
  services and `fuels`.
- Integration role: catalog enrichment only. The generic object status and an
  absent/empty `fuels` array must not be shown as fuel availability or price.
- Territory boundary: normalize the response, keep only coordinates inside the
  requested bbox, and exclude pure EV charging records without fuels before
  aggregation. Distinct Multigo IDs must remain distinct records.
- Access boundary: one user-triggered request per search-area centre, cached
  for 60 seconds; no background crawling.

## Sber AZS

- Purpose: каталог АЗС и вероятностные статусы доступности на основе платежных
  операций и пользовательских сигналов.
- Canonical URL: `https://sberazs.ru/`.
- Verified endpoint:
  `GET /api/stations?bbox=<minLon>,<minLat>,<maxLon>,<maxLat>`.
- Access behavior: прямой HTTP-клиент получает HTML JavaScript-проверки. В
  настоящем headless Chromium-сеансе после штатного выполнения страницы и
  установки cookies endpoint вернул HTTP 200 JSON.
- Verified on 2026-07-10 for Voronezh: 197 returned stations, zero hidden,
  `lastErrorPresent: false`; 48 overall `available`, 128 `unknown`, 21 `stale`.
- Verified top-level fields: `version`, `stationCount`, `hiddenStationCount`,
  `lastSuccessfulPullAt`, `lastErrorPresent`, `stations`.
- Verified station fields include ID, name, address, location, overall
  availability, payment/update timestamps, operation count, per-fuel statuses,
  external 2GIS ID and crowd state.
- Fuel types observed: `ai80`, `ai92`, `ai95`, `ai98`, `ai98_100`, `ai100`,
  `diesel`, `propane`, `methane`.
- Statuses observed: `available`, `unknown`, `stale`; per-fuel status may be
  absent/null and must not be promoted to availability.
- Session boundary: the diagnostic profile and cookies are temporary and are
  deleted after each test. Do not store browser cookies in source, project
  memory or ordinary configuration.
- Operational workflow: one hidden Chromium-worker starts lazily on the first
  Sber-backed search, refreshes active bounding boxes every 60 seconds, keeps at
  most 10 areas and expires inactive areas after 15 minutes. Health is exposed
  through `/api/health`. The worker remains a brittle external contract and
  should be replaced with sanctioned API access when available.
- Evidence: live Chromium/CDP request performed from this project on
  2026-07-10.

## Alfa AZS

- Purpose: общероссийский каталог АЗС, опубликованные цены и вероятностные
  статусы топлива на основе транзакционной активности.
- Canonical URL: `https://alfabank.ru/`.
- Verified endpoint:
  `GET /api/v1/azs-stations/public/stations?g=[<lon>,<lat>]&z=<zoom>`.
- Verified on 2026-07-14: HTTP 200 JSON после защитного ответа 307 и повторного
  запроса с выданными cookies; массив содержал 16 537 станций.
- Verified station fields: `_id`, `station_id`, `brand`, `address`, `fuels`,
  `partner_stations`; координаты находятся в `address.location`.
- Fuel categories: `AI92`, `AI95`, `AI98_100`, `DIESEL`. Наблюдавшиеся статусы:
  `available`, `probably_unavailable`, `unknown`, `unavailable`, `closed`.
- Access behavior: браузероподобный Node HTTP-клиент получает cookies `spid` и
  `spsc` из первого 307-ответа и повторяет запрос. Chromium не требуется;
  cookies остаются только в памяти процесса.
- Territory boundary: параметры `g` и `z` не доказали серверную фильтрацию —
  запрос с центром Воронежа вернул общероссийский снимок. Приложение кэширует
  один снимок и фильтрует его по bbox, а итоговую выдачу — по административному
  контуру.
- Data semantics: цена не подтверждает остаток; время последней транзакции
  относится к availability-наблюдению и не подменяет время публикации цены.
- Access boundary: только пользовательские поиски, глобальный кэш 60 секунд,
  без фонового обхода регионов. Контракт публично не документирован и требует
  согласованного доступа перед production-публикацией.
- Evidence: контролируемые PowerShell и Node.js запросы из этого проекта от
  2026-07-14.

## ГдеБЕНЗ

- Purpose: бесплатная краудсорсинговая карта пользовательских отметок о
  наличии топлива, очередях и лимитах на АЗС России.
- Canonical URL: `https://gdebenz.ru/`.
- Backup URL advertised by the service: `https://gdebenz.org/`.
- Contact: Telegram `@gdebenzru`.
- Candidate API:
  `GET https://gdebenz.ru/api/nearby?lat=<latitude>&lon=<longitude>&radius_km=<km>`.
- Verified on 2026-07-10: HTTP 200 JSON with top-level fields `stations` and
  `updated`; 149 records within 20 km of `51.65,39.20`.
- Verified station fields: `osm_id`, `brand`, `name`, `addr`, `lat`, `lon`,
  `distance_km`, `status`, `detail`, `fuels_now`, `confirmations`, `last_at`,
  `confidence_base`.
- Observed statuses: `yes`, `queue`, `low`, `no`.
- Observed `fuels_now`: comma-separated grades such as `92`, `95`, `98`, `100`
  and `ДТ`.
- Detail text may include queue size, per-vehicle litre limits, temporary
  breaks and station closure reports.
- Price gap: `/api/nearby`, including `full=1`, did not expose price fields in
  the verified response. The website has a user price UI, but its read contract
  was not established.
- Data semantics: subjective user reports, not verified facts. Freshness,
  confirmation count and confidence must remain visible and must not be
  presented as official station inventory.
- Access boundary: the terms updated 2026-07-02 prohibit mass automated
  collection. Current integration performs only user-triggered nearby requests,
  caches each area for 60 seconds and does not crawl regions in the background.
  Preserve low request volume and seek provider guidance before broader use.
- Integration role: independent availability evidence alongside T-Bank and
  Sber, preserving its own status, detail, timestamp, confirmations and
  confidence instead of collapsing them into another provider's claim.
- Territory boundary: the radius response is broader than some geocoded
  settlements; only coordinates inside the requested bbox enter aggregation.
- Evidence: `https://gdebenz.ru/about`, `https://gdebenz.ru/terms`,
  `https://gdebenz.ru/rules`, and the verified `/api/nearby` response.
