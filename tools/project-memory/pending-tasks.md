# Pending Tasks

Use this file for active project-wide plans and multi-step work.

Keep entries concise and task-relevant. Do not store full diffs, large logs,
generated outputs, secrets, credentials, or private production data.

## Status Markers

- `[ ]` not started
- `[~]` in progress
- `[x]` done
- `[!]` blocked or needs attention

## Tasks

### GI optional configuration audit (2026-10-03)

- [x] Copy accepted guidance for optional capability failures.
- [!] Migration `2026.09.28.1__isolate_optional_config_failures` remains pending:
  `config.js` calls `loadSubscriptionConfig()` at import; malformed optional
  subscription settings throw before core startup. Telegram polling explicitly
  enabled without a valid token also aborts `startServer()`. Repairing these
  unrelated integrations would expand the current station-evidence task.
- [x] Other seven startup migrations applied and locally checked. The accepted
  source routing regression fails on its own AGENTS.md budget (6519 > 6500);
  bootstrap regression passes. Local routing and size checks run separately.
- [x] Tester migrations `2026.10.03.2` and `2026.10.03.3` applied before Git
  finish. Local aliases, required files and budgets pass; bootstrap passes.
  The accepted source routing regression still fails on its own entrypoint
  budget (6570 > 6500). No product scenarios or runtime resets were executed.

### Station evidence during fuel unloading (2026-10-03)

Goal: verify the reported operation at AZS №298 and avoid presenting it as proof
of current dispensing or showing an undated queue estimate.

- [x] Query only the selected station area; document provider timestamps and
  verification limits in `docs/station-298-availability-2026-10-03.md`.
- [x] Remove the single-payment green override in backend and frontend; show
  operation source/time beside the status and queue report age.
- [x] Align focused tests, aggregation spec, index and user documentation.
- [x] All 196 Node tests and `git diff --check` pass; a combined recent-bank,
  stale-Alfa and old-queue scenario is yellow on both server and client,
  preserves the price and hides the old numeric wait estimate.
- [!] Dev restart requires config-service discovery (legacy integration enabled,
  no explicit toggle); configured `http://127.0.0.1:4100` refused connection.
  Live UI refresh and deployment are unverified.

### Two purchases at the same station (2026-10-03)

Goal: support a green probable station status from two different operations at
one station through any banks, both inside the last 30 minutes, with fresh stop
reports taking priority.

- [x] Preserve two canonical timestamps per bank/station in bounded process memory
  across requested snapshots, without collecting unselected territories.
- [x] Share window and service-report policy between backend and browser; reject
  duplicate instants across banks, future events and newer negatives. Accept
  distinct operations from the same or different banks at the merged station.
- [x] Show contributing banks and both times; let stop reports suppress green availability
  without claiming there is no fuel. Recalculate UI age without network calls.
- [x] Add provider/history/stream/popup regressions and align the aggregation spec
  and README with the implemented workflow and restart limitations.
- [x] All 208 Node tests passed, including same-bank and cross-bank pairs,
  duplicate instants, exact window expiry, source separation,
  repeated/cached snapshots, stream history, service-report priority and popup
  age refresh without network calls. Syntax, whitespace and spec-link checks pass.
- [!] Dev restart remains blocked: the configured config-service at
  `http://127.0.0.1:4100` refused connection. Live UI and deployment are unverified.

### Show availability composition in map clusters

Goal: make every clustered map marker communicate the availability statuses of
its grouped stations instead of using a misleading fixed green treatment.

Planned changes:

- [x] Compute the status distribution from the cluster's child station markers.
- [x] Render that distribution as a proportional circular chart with the count
  kept legible in the center.
- [x] Update the aggregation contract and focused tests.

Execution order:

- [x] Add a deterministic status-gradient helper and attach status metadata to
  each Leaflet marker.
- [x] Apply the generated chart to cluster markup and styling.
- [x] Run focused and full verification.

Risks or dependencies:

- [x] Cluster colors must respect the same selected-fuel calculation and active
  filters as individual markers.
- [x] Existing responsive cluster sizing and click-to-zoom behavior must remain
  unchanged.

Verification:

- [x] Unit tests cover uniform, mixed, and invalid/missing status sets.
- [x] `npm test` and `git diff --check` pass.

### Correct territory and Telegram summary output

Goal: make city/region results geographically accurate, make every station status visible in Telegram, and never expose placeholder build metadata.

Planned changes:

- [x] Request and apply the Nominatim administrative boundary when filtering stations.
- [x] Show all four aggregate availability statuses in Telegram.
- [x] Render only known build metadata and keep the software version visible.
- [x] Update product contracts and focused tests.

Execution order:

- [x] Add boundary containment logic and connect it to the shared summary use case.
- [x] Update Telegram formatting and build metadata fallbacks.
- [~] Focused/full verification passed; complete `gi push`.

Risks or dependencies:

- [x] Nominatim may omit GeoJSON for some place types; bbox filtering remains the safe fallback.
- [x] Existing provider failures remain isolated and visible.

Verification:

- [x] Unit tests cover polygon/multipolygon boundaries, summary status completeness, and unknown build metadata.
- [x] `npm test` and `git diff --check` pass.
