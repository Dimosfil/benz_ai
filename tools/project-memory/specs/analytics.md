# Analytics contract

## Purpose

Benz AI records privacy-preserving usage counts for the web interface and the
Telegram interface in deployment-provided PostgreSQL storage. Analytics must
never make fuel search or bot responses unavailable.

## Events

- `web/page_view`: one event when the server returns the main HTML page.
- `web/search`: one event after a successful summary or cache-refresh search.
- `telegram/telegram_command`: an incoming text command.
- `telegram/telegram_search`: an incoming non-command text message.
- Static assets, health checks, viewport requests, and provider requests are not
  visits.

## Privacy and access

- Web visitors receive a random, HTTP-only, same-site identifier cookie.
- Telegram user IDs and web identifiers are HMAC-SHA256 hashed before storage.
- Raw IP addresses, user agents, Telegram IDs, usernames, and search text are
  not stored.
- Common web robots are marked using their user agent and excluded from human
  totals.
- Aggregate statistics are available only through bearer-token authentication
  at `GET /api/admin/stats`; `/admin.html` keeps the token in session storage.

## Failure behavior

- Missing configuration disables analytics without affecting the product.
- Database initialization creates only the prefixed `benz_analytics_events`
  table and indexes with idempotent DDL.
- Database failures are reported in health status without credentials, and
  event writes fail closed without interrupting the user request.
