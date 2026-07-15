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
