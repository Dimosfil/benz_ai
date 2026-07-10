# Architecture Migrations

Use this file for durable history of major architecture rewrites, platform
moves, framework replacements, storage changes, service splits, routing changes,
and other changes that alter how the project is organized.

Do not use this file for ordinary feature tasks or chat handoffs. Keep current
feature behavior in feature specs and current chat state in `tools/summary/`.

## Entry Template

### YYYY-MM-DD: TODO migration title

Status: proposed | in progress | complete | rolled back

Previous architecture:

- TODO

New architecture:

- TODO

Reason:

- TODO

Behavior that must remain unchanged:

- TODO

Affected specifications:

- TODO

Current implementation map:

- TODO

Data, compatibility, and rollback notes:

- TODO

Verification:

- TODO

Open questions:

- TODO

### 2026-07-10: Provider and station-domain separation

Status: complete

Previous architecture:

- `server.js` combined HTTP routing, configuration, geocoding, provider clients,
  normalization, station identity, aggregation, Yandex enrichment and summary
  calculation.
- Browser formatting, filtering, persisted column order and DOM rendering lived
  together in `public/app.js`.

New architecture:

- Deployment/runtime values are centralized in `config.js`.
- Provider-neutral bbox, fuel normalization, station identity, merge and summary
  rules live in `domain/stations.js`.
- T-Bank, BenzUp, Sber, Yandex, Multigo and ГдеБЕНЗ use provider adapters under
  `providers/`; geocoding lives under `services/`.
- Pure frontend formatting, filtering and table-order functions are separated
  from DOM orchestration and are testable with the Node test runner.

Reason:

- Nearby/radius providers leaked records outside the selected territory.
- Spatial merging could collapse distinct records from the same provider and
  display duplicate source labels such as `Multigo + Multigo`.
- The monolithic modules made provider contracts and UI-state regressions hard
  to verify independently.

Behavior that must remain unchanged:

- A failed provider does not block successful providers.
- Availability, prices and catalog-only evidence remain separate signals.
- Filters, sorting, pagination, resizable table state and draggable column order
  persist locally; station data itself is not persisted in browser storage.

Affected specifications:

- `tools/project-memory/specs/fuel-aggregation.md`
- `tools/project-memory/specs/integration-contracts/connected-projects.md`
- `tools/project-memory/specs/technology-stack.md`

Current implementation map:

- HTTP orchestration: `server.js`
- Runtime configuration: `config.js`
- Station domain: `domain/stations.js`
- External APIs: `providers/`
- Geocoding: `services/geocoder.js`
- Frontend state/view helpers: `public/station-filter.js`,
  `public/station-view.js`, `public/table-order.js`

Data, compatibility, and rollback notes:

- API response field names remain compatible. Source metadata gains counts for
  returned, included and out-of-bounds records.
- Multigo-only catalog records can still have `no_data`; that is intentional
  when the provider supplies no availability evidence.

Verification:

- Unit/regression tests cover same-provider identity, cross-provider merge,
  Multigo bbox/EV filtering, unrestricted fuel selection and column ordering.
- Live verification must confirm the Babяково result no longer includes
  Multigo/ГдеБЕНЗ coordinates outside its geocoded bbox.

Open questions:

- Obtain documented/sanctioned contracts for the current undocumented provider
  endpoints before public production use.
