# Connected Projects And External Sources

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
- Evidence: `https://gdebenz.ru/about`, `https://gdebenz.ru/terms`,
  `https://gdebenz.ru/rules`, and the verified `/api/nearby` response.
