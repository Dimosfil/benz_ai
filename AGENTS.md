# Agent Instructions

Load only relevant `patterns/AGENTS_RUNTIME/` modules. Prefer project-local
instructions, contracts, memory, and runbooks over shared defaults.

## Project

Benz AI aggregates probable fuel availability for Russian territories.
`server.js` serves station data; `public/` holds the UI. Fetch server-side,
surface source limits, and keep local startup simple.

## Goal And Loading Contract

- Derive a bounded goal and observable success criteria from the request and
  project context. Ask only when missing information materially changes scope;
  continue independent authorized work while waiting.
- For concrete work, load the matching runtime modules.
- For a GI command, run
  `tools/get-gi-context.ps1 -CommandText "<exact user command>"`. It performs the
  staged update check, longest-prefix route resolution, and bounded retrieval.
  Use `COMMANDS.md` directly only for help or command-index requests.
- On the first concrete task in a session, perform the staged update check even
  without a GI command. Equal versions with no explicit skipped migrations mean
  `pending migrations: 0` without reading migration filenames, bodies,
  `CHANGELOG.md`, or `INDEX.md`. When the
  accepted source is newer, enumerate and apply pending accepted migrations if
  enabled; absent `auto_apply_pending_migrations` defaults to `true`. Skip only
  for explicit `false` or a concrete blocker, and report the pending count.
  Never inspect `updates/` during this startup check.
- Follow all loaded rules for explicit strict-GI requests; report blockers
  precisely and continue independent authorized work.
- Before adding a clarification or approval gate, apply
  `patterns/AGENTS_RUNTIME/03-rule-precedence.md` and existing authorization.
- Never run state-changing GI commands from memory. Stop and name any missing
  context builder, route manifest, resolver, or mandatory routed file.

## Core Safety And Boundaries

- Verify the active project root and target identity before writes. Treat this
  root as the normal filesystem boundary; exact external paths and actions need
  explicit authorization. Preserve unrelated dirty changes.
- Never commit secrets, private data, model weights, checkpoints, photos, video,
  audio, datasets, archives, or similar large content payloads. Use approved
  artifact storage and commit compact manifests, checksums, sources, or
  retrieval instructions unless the exact exception is explicitly approved.
- Keep rebuildable build output in dedicated ignored directories and out of
  source Git; version build inputs. Follow
  `patterns/AGENTS_RUNTIME/09-build-and-install.md` for authorized cleanup,
  verification, and explicitly approved project exceptions.
- `tools/` is for durable reusable development and agent tooling. Product code,
  tests, docs, outputs, screenshots, exports, downloaded data, build bundles,
  and one-off probes belong in documented project locations.
  `tools/project-memory/` holds compact implementation-driving knowledge and
  evidence references, not bulk artifacts or a replacement for source/tests.
- During meaningful behavior or architecture work, keep scoped code, tests,
  affected docs, and focused project-memory contracts aligned before the
  implementation task is complete.
- Modular systems: `patterns/MODULAR_SERVICE_ENGINEERING.md`.
- Do not revert user changes without an explicit request. Ask before destructive
  operations, broad formatting churn, dependency replacement, data migration,
  public contract changes, or unrelated expansion.

## Runtime Routing

- Purpose, RAG, memory, summaries, connected projects: `01-purpose.md`
- Repository map: `02-repository-map.md`; precedence/scope: `03-rule-precedence.md`
- Authoring, configuration, quality, inventories: `04-content-and-authoring.md`
- Windows shell/networking: `05-windows-command-policy.md`
- Token economy and info/stack/logic/refactor: `06-tool-usage-and-token-economy.md`
- Startup/restore: `07-startup.md`; scope/evidence/cleanup: `07-scope-and-evidence.md`
- Config: `08-config-service.md`; task manager: `08-task-manager.md`; sprints: `08-sprint.md`
- Publication: `09-production.md`; deploy: `09-deploy-gateway.md`; FTP: `09-ftp.md`
- Runtime/defaults: `09-runtime-and-defaults.md`; tester: `09-testing.md`
- Full tests: `09-full-testing.md`
- Build/install: `09-build-and-install.md`; memory operations: `09-project-memory-operations.md`
- Private/missing context: `10-private-scope-and-missing-context.md`
- Language: `11-language-preferences.md`; UI: `12-ui-and-focus.md`; progress: `13-progress-updates.md`
- Updates: `14-update-intake.md`; verification: `15-verification.md`; Git: `16-git-policy.md`
- Roles: `17-agent-role-office.md`; product engineering: `18-startup-product-engineering.md`
- Game modding: `19-game-modding.md`

All paths above are under `patterns/AGENTS_RUNTIME/`. The legacy combined 07/08/09
files are compatibility indexes only and contain no operational rules.

## Project Memory And Working Areas

- Source: `server.js`, `domain/`, `providers/`, `services/`, `public/`;
  tests: `*.test.js` with the Node test runner. Keep outputs and one-off
  probes outside source and `tools/` in a documented ignored scratch location.
- Summaries: `tools/summary/`; durable project knowledge:
  `tools/project-memory/`; reusable tooling: `tools/`.
- Put product behavior, business rules, workflow contracts, architecture
  decisions, and verified implementation findings in project memory. Put normal
  documentation in `README.md`, `docs/`, and runbooks.
- Preserve text encodings. On Windows, send non-ASCII API/admin write bodies as
  explicit UTF-8 bytes with `charset=utf-8` or via Node `fetch`, then read back
  and check for replacement characters or mojibake.

## Local Commands

Use `npm install`, `npm start`, `npm run dev`, `npm test`, and
`docker compose build` as documented in `README.md` and `package.json`.

## Project-Specific Rules

- Do not treat a script as durable tooling merely because it is executable.
  One-off research, collectors, scrapers, and diagnostics do not belong under
  `tools/`.
- Preserve the distinction between probabilistic availability and price.
  A missing price never means no fuel; a listed price never proves stock.
- Do not run a background crawler over fuel sources. Request data for the
  territory selected by the user and report provider failures explicitly.
