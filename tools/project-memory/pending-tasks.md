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
