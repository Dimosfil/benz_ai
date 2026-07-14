# Agent Instructions

This is the runtime entrypoint for the Benz AI project.

## Project

Benz AI is a minimal Node.js web aggregator for gasoline availability at fuel
stations. The user enters a city or Russian region, and the app shows a regional
summary plus station data. The server-side entrypoint is `server.js`; static UI
assets live under `public/`.

## Project Goal

Keep the app useful, small, and evidence-backed: fetch station data server-side,
avoid browser CORS issues, clearly surface source limitations, and preserve a
simple local run workflow.

## Loading Contract

- Start with this file.
- Read only the modules needed for the current request.
- Before acting on a concrete task, select and read the matching module(s);
  this entrypoint alone is enough only for greetings or status-neutral replies.
- Treat user wording such as "do by GI", "follow GI", "strictly by GI", and
  equivalent local-language forms as a request for strict compliance with all
  loaded GI rules.
- On the first concrete task in a new chat/session, run a quiet GI update check:
  read `tools/project-memory/instruction-kit.json` and the accepted source
  `VERSION.md`/`migrations/`, then apply pending accepted migrations. Treat
  `update_check.enabled: true` as authorization to check and apply; when
  `auto_apply_pending_migrations` is absent, default it to `true` for backward
  compatibility. Do not stop at “update available” or defer to `gi update`.
  Skip application only for an explicit `false` setting or a concrete blocker,
  name that blocker, and report the pending migration count. Do not read
  `updates/` for this startup check.
- If the request contains a GI chat command such as `gi ...`, `ги ...`, `init`,
  or `инит`, first read `COMMANDS.md` when present, then read every runtime
  module routed to that command before acting.
- Prefer project-local instructions, runbooks, contracts, project memory, and
  service guides over shared defaults when they are more specific.

## Restore Context

For concrete restore/start tasks:

```powershell
.\tools\agent-start.ps1
```

If the script is unavailable, read only the smallest useful slices of this file,
the latest handoff summary in `tools/summary/`, `tools/AGENT_RUNBOOK.md`,
`tools/AGENT_WORKING_AGREEMENTS.md`, and task-relevant notes under
`tools/project-memory/`.

## Runtime Module Routing

- Repository purpose, RAG startup, project memory, summaries, connected
  projects, and shared-rule propagation:
  `patterns/AGENTS_RUNTIME/01-purpose.md`
- Repository map: `patterns/AGENTS_RUNTIME/02-repository-map.md`
- Rule precedence and scope arbitration:
  `patterns/AGENTS_RUNTIME/03-rule-precedence.md`
- Authoring reusable rules, configuration boundaries, code quality, project
  info/stack inventory, and batch verification:
  `patterns/AGENTS_RUNTIME/04-content-and-authoring.md`
- Windows shell and networking policy:
  `patterns/AGENTS_RUNTIME/05-windows-command-policy.md`
- Token economy, verification command lookup, `gi info`, `gi stack`,
  `gi logic`, `gi refactor`, feature contracts, and large-output handling:
  `patterns/AGENTS_RUNTIME/06-tool-usage-and-token-economy.md`
- Startup, restore, project goal, bug evidence, PDF inspection, repository
  cleanup, filesystem boundaries, and first-message handling:
  `patterns/AGENTS_RUNTIME/07-startup-and-scope.md`
- Config-service, service guide/contract lookup, task manager commands,
  manager-backed and local sprint commands, and web-service port registration:
  `patterns/AGENTS_RUNTIME/08-config-service-and-task-manager.md`
- Dev/prod publication, FTP deploy, build/rebuild, restart/reboot, Docker,
  first test, full test, default reset, installer packaging, SQL/vector
  inspection, and project/RAG rebuild commands:
  `patterns/AGENTS_RUNTIME/09-project-operation-commands.md`
- Nested repositories, private local app data, `gi logic` external sources,
  product-plan intent signals, and missing required entities:
  `patterns/AGENTS_RUNTIME/10-private-scope-and-missing-context.md`
- Project, commit, task, and response language preferences:
  `patterns/AGENTS_RUNTIME/11-language-preferences.md`
- UI focus, app launch focus, and frontend verification expectations:
  `patterns/AGENTS_RUNTIME/12-ui-and-focus.md`
- Progress-update style: `patterns/AGENTS_RUNTIME/13-progress-updates.md`
- Update intake and `updates/` handling:
  `patterns/AGENTS_RUNTIME/14-update-intake.md`
- Verification policy: `patterns/AGENTS_RUNTIME/15-verification.md`
- Git policy: `patterns/AGENTS_RUNTIME/16-git-policy.md`
- Agent role office, specialist role routing, and narrow professional scopes:
  `patterns/AGENTS_RUNTIME/17-agent-role-office.md`
- Startup product engineering, business-first delivery, frontend expectations,
  and professional communication:
  `patterns/AGENTS_RUNTIME/18-startup-product-engineering.md`
- Game modding projects, `gi mod`, and selected game install path handling:
  `patterns/AGENTS_RUNTIME/19-game-modding.md`

## Durable Memory

Durable project knowledge lives in `tools/project-memory/`. Put product
behavior, business rules, workflow contracts, implementation-driving
specifications, architecture decisions, and verified findings there.

General project documentation lives in `README.md`, `docs/`, and the runbook.
Keep overview, visible functionality, stack, commands, operations, and
troubleshooting there.

## Common Commands

Install dependencies:

```powershell
npm install
```

Run:

```powershell
npm start
```

Development run:

```powershell
npm run dev
```

Test:

```powershell
npm test
```

Build:

```powershell
# No build step is currently defined.
```

## Working Areas

- Source: `server.js` and `public/`
- Tests: Node test runner via `npm test` when tests exist
- Tools: `tools/` for durable development and agent tooling only
- Outputs/evidence/build artifacts: keep out of source unless documented
- Summaries: `tools/summary/`
- Project memory: `tools/project-memory/`

Do not classify a script as durable tooling merely because it is executable.
Single-task research probes, exploratory scripts, ad hoc collectors, scrapers,
and throwaway diagnostics do not belong in `tools/`, including new
`tools/research`, `tools/probes`, or `tools/scratch` subtrees. Prefer an inline
command or a documented ignored scratch/temp location outside `tools`; remove
temporary scripts after use and retain only necessary evidence or outputs.

## Local Rules

- Do not revert user changes unless explicitly requested.
- Treat dirty worktrees as normal.
- Keep changes scoped to the current task.
- Ask before destructive operations, broad formatting-only churn, dependency
  replacements, data migrations, public API or storage contract changes, or
  unrelated scope expansion.
- Treat `D:\AI\benz_ai` as the filesystem boundary for normal work unless the
  user gives an explicit concrete path and action.
- Preserve text encodings when editing files.
