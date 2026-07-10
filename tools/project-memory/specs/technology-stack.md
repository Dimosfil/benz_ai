# Technology Stack

## Runtime

| Layer | Technology | Evidence |
| --- | --- | --- |
| Server | Node.js ES modules, built-in HTTP server and Fetch API | `server.js`, `config.js`, `package.json` |
| Domain | Provider-neutral normalization, merge and summary rules | `domain/stations.js` |
| External adapters | One module per station/price provider | `providers/` |
| Frontend | Static HTML/CSS with modular browser JavaScript | `public/` |
| Browser integration | Headless Chrome/Edge via Chrome DevTools Protocol | `providers/sber-browser.js` |
| Telegram interface | Telegram Bot API long polling over built-in Fetch API | `services/telegram-gateway.js`, `services/telegram-bot.js` |
| Package manager | npm | `package.json` |
| Tests | Node.js test runner | `npm test` |
| Build | Docker/Compose produces the release OCI image | `Dockerfile`, `compose.yaml`, `tools/AGENT_RUNBOOK.md` |
| Container | Docker image based on Node.js 22 Debian slim with Chromium; Compose runtime | `Dockerfile`, `compose.yaml`, `.dockerignore` |

## External services

| Service | Role | Access |
| --- | --- | --- |
| OpenStreetMap Nominatim | Territory geocoding | Public endpoint with identifying User-Agent and rate limit |
| T-Bank Fuel | Stations and probabilistic availability | Public, undocumented endpoint |
| BenzUp | Station catalog and prices | Bearer token |
| Yandex Maps | Price-card check for probable-availability stations | HTML lookup by T-Bank Yandex card ID; does not confirm fuel stock |
| Sber AZS | Station catalog and availability | JSON verified in Chromium session; direct requests receive JS challenge |
| ГдеБЕНЗ | Crowdsourced availability, queues and limits | User-triggered request with 60-second cache |
| Multigo | Nearby fuel-category place catalog | POST request with 60-second cache; does not assert fuel availability |
| Telegram Bot API | Secondary client interface for the shared fuel-search workflow | Optional server-side bot token and long polling |
| DeepSeek | Prepared server-side AI adapter for future bot workflows | Optional API key; not called by current search |

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
- Replace optional Yandex HTML parsing with written API permission or a
  documented price endpoint before public deployment.
- Monitor Sber browser-worker resource use and anti-bot contract stability.
