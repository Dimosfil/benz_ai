# Technology Stack

## Runtime

| Layer | Technology | Evidence |
| --- | --- | --- |
| Server | Node.js ES modules, built-in HTTP server and Fetch API | `server.js`, `package.json` |
| Frontend | Static HTML, CSS and browser JavaScript | `public/` |
| Browser integration | Headless Chrome/Edge via Chrome DevTools Protocol | `providers/sber-browser.js` |
| Package manager | npm | `package.json` |
| Tests | Node.js test runner | `npm test` |
| Build | No build step | `package.json`, `tools/AGENT_RUNBOOK.md` |

## External services

| Service | Role | Access |
| --- | --- | --- |
| OpenStreetMap Nominatim | Territory geocoding | Public endpoint with identifying User-Agent and rate limit |
| T-Bank Fuel | Stations and probabilistic availability | Public, undocumented endpoint |
| BenzUp | Station catalog and prices | Bearer token |
| Yandex Maps | Station card links and optional prices | Optional HTML lookup; disabled by default |
| Sber AZS | Station catalog and availability | JSON verified in Chromium session; direct requests receive JS challenge |
| ГдеБЕНЗ | Crowdsourced availability, queues and limits | User-triggered request with 60-second cache |

## Commands

- Install: `npm install`
- Run: `npm start`
- Development: `npm run dev`
- Test: `npm test`

## Open gaps

- Obtain and verify the BenzUp response contract with a real token.
- Obtain a documented Sber AZS partner API.
- Replace optional Yandex HTML parsing with written API permission or a
  documented price endpoint before public deployment.
- Monitor Sber browser-worker resource use and anti-bot contract stability.
