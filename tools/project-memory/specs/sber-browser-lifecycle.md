# Sber browser-worker lifecycle

Sber AZS station data requires a Chromium session because direct server-side
requests are challenged. The worker therefore starts Chromium lazily for the
first Sber request and shares one session across cached active areas.

## Resource policy

- `SBER_REFRESH_MS` controls freshness refreshes; default: 60000.
- `SBER_ACTIVE_AREA_TTL_MS` controls when an untouched area is removed;
  default: 900000.
- `SBER_MAX_ACTIVE_AREAS` bounds cached areas; default: 10.
- `SBER_BROWSER_IDLE_MS` is the grace period after the last area expires;
  default: 30000.

When no active area, request, or refresh remains after the idle grace period,
the worker closes Chromium and its temporary profile. The next Sber request
starts a new verified browser session. This saves container RAM without
changing the search result or treating Sber data as available before a browser
JSON response succeeds.

## Observability

`GET /api/health` exposes only safe worker metadata: lifecycle, active area and
operation counts, configured timing, last start/stop timestamps, stop reason,
and the latest error. It never exposes browser cookies, DevTools URLs, tokens,
or request content.
