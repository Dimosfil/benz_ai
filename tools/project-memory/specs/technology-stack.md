# Technology Stack

## Runtime

| Layer | Technology | Evidence |
| --- | --- | --- |
| Server | Node.js ES modules, built-in HTTP server and Fetch API | `server.js`, `config.js`, `package.json` |
| Domain | Provider-neutral normalization, merge and summary rules | `domain/stations.js` |
| External adapters | One module per station/price provider | `providers/` |
| Frontend | Static HTML/CSS with modular browser JavaScript | `public/` |
| Map UI | Leaflet 1.9.4 and Leaflet.markercluster 1.5.3 loaded from pinned CDN URLs; browser Geolocation API; bounded viewport bbox loading; OpenStreetMap tiles | `public/index.html`, `public/station-map.js`, `server.js` |
| Browser integration | Headless Chrome/Edge via Chrome DevTools Protocol | `providers/sber-browser.js` |
| Telegram interface | Telegram Bot API long polling over built-in Fetch API | `services/telegram-gateway.js`, `services/telegram-bot.js` |
| Analytics storage | PostgreSQL through `pg`; privacy-preserving event hashes and aggregate admin reporting | `services/analytics.js`, `tools/project-memory/specs/analytics.md` |
| Package manager | npm | `package.json` |
| Tests | Node.js test runner | `npm test` |
| Build | Docker/Compose produces the release OCI image | `Dockerfile`, `compose.yaml`, `tools/AGENT_RUNBOOK.md` |
| Container | Docker image based on Node.js 22 Debian slim with Chromium; Compose runtime | `Dockerfile`, `compose.yaml`, `.dockerignore` |

## External services

| Service | Role | Access |
| --- | --- | --- |
| OpenStreetMap Nominatim | Territory geocoding | Public endpoint with identifying User-Agent and rate limit |
| OpenStreetMap tiles | Interactive station-map baselayer | Public tile endpoint with visible attribution |
| T-Bank Fuel | Stations and probabilistic availability | Public, undocumented endpoint |
| Alfa AZS | Nationwide station snapshot, probabilistic availability and prices | Public, undocumented endpoint with in-memory HTTP cookie challenge |
| BenzUp | Station catalog and prices | Bearer token |
| Yandex Maps | Price-card check for probable-availability stations | HTML lookup by T-Bank Yandex card ID; does not confirm fuel stock |
| Sber AZS | Station catalog and availability | JSON verified in Chromium session; direct requests receive JS challenge |
| ГдеБЕНЗ | Crowdsourced availability, queues and limits | User-triggered request with 60-second cache |
| Multigo | Nearby fuel-category place catalog | POST request with 60-second cache; does not assert fuel availability |
| Telegram Bot API | Secondary client interface for the shared fuel-search workflow | Optional server-side bot token and long polling |
| DeepSeek | Prepared server-side AI adapter for future bot workflows | Optional API key; not called by current search |
| PostgreSQL | Optional persistent web and Telegram usage analytics | Private `DATABASE_URL`; idempotent application-managed schema |

## Commands

- Install: `npm install`
- Run: `npm start`
- Development: `npm run dev`
- Test: `npm test`
- Container build: `docker compose build`
- Container run: `docker compose up -d`

## Open gaps

- Obtain and verify the BenzUp response contract with a real token.
- Obtain a documented Sber AZS partner API.
- Obtain documented or sanctioned Alfa AZS access before public production use.
- Replace optional Yandex HTML parsing with written API permission or a
  documented price endpoint before public deployment.
- Monitor Sber browser-worker resource use and anti-bot contract stability.
