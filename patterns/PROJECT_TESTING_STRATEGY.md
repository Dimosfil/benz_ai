# Project Testing Strategy

Use this pattern when planning or running verification for a project, new
feature, bug fix, migration, or release check.

## Goals

- Prefer project-local test commands, scripts, runbooks, and CI configuration.
- Start with the fastest relevant checks before broad suites.
- Match verification depth to risk, blast radius, and user request.
- State clearly what was checked, what was not checked, and why.
- Avoid printing large logs, full diffs, generated output, or whole reports by
  default.

## Discovery

Inspect only task-relevant local context first:

- `AGENTS.md`, runbook, working agreements, and project memory;
- package or build files such as `package.json`, `pyproject.toml`, `.csproj`,
  `Cargo.toml`, `go.mod`, or equivalent;
- CI configs and local helper scripts;
- test directories and naming conventions;
- README commands when local instructions are missing.

When recommending or running a command, verify the exact current contract:

- CLI entry points and flags;
- default host and port;
- health, API, and UI routes;
- request method, headers, and JSON payload field names;
- required environment variables and local service discovery records.

Treat handoff summaries, task notes, screenshots, and old chat examples as
evidence of what happened, not as the source of truth for commands. If a summary
names a check but local README, manifests, or source code disagree, follow the
current project-local contract and call out the mismatch briefly.

Identify the project type before recommending checks:

- web frontend or full-stack app;
- backend/API/service;
- CLI/tooling project;
- library/package;
- game, Unity, or interactive app;
- documentation-only repository.

## Test Ladder

Build verification from narrow to broad:

- Syntax or static checks that are cheap and deterministic.
- Focused unit tests for touched code or nearby behavior.
- Integration checks for contracts, storage, network boundaries, or CLI flows.
- Smoke checks for app startup, health endpoints, or critical workflows.
- Manual checks for UI, visual behavior, accessibility, or external systems.
- Full test suite, build, or release checks only when justified by risk or
  requested by the user.

For refactors and behavior changes:

- For pure mechanical moves or responsibility splits with existing coverage,
  first run or identify the focused current checks that protect the behavior,
  then move the code, then rerun the same checks.
- For behavior or contract changes, first add or identify a focused guarding
  test for the intended behavior when practical, then implement the change, then
  rerun the focused test and the wider checks justified by risk.
- Tests that preserve existing behavior support a refactor. Tests that define
  new behavior, validation, observability, data shape, or workflow semantics are
  development work and should be planned as such.

For documentation-only changes, prefer `git diff --check`, targeted rereads,
link/path sanity checks, and index consistency.

## Feature Verification

For each new feature or behavior change, cover:

- expected behavior and happy path;
- changed user or API workflows;
- regression areas near the touched code;
- failure paths, validation errors, empty states, and permission failures;
- edge cases and boundary values;
- migration, rollback, or fallback behavior when relevant;
- observability, logs, metrics, or user-visible errors when relevant.

For frontend, backend, API, or full-stack features, verify against a fresh
runtime:

- restart the affected dev server or backend process when local run instructions
  provide a restart command or hot reload is uncertain;
- refresh the browser, client, or API caller before checking behavior;
- probe changed API endpoints or route contracts after restart when they feed
  the UI;
- mention any restart or refresh that was skipped and why.

## UI And Visual Checks

Follow local project instructions first. If the project says the user will
inspect UI manually, do not open browsers, screenshots, or visual inspection
tools unless the user explicitly asks.

When automatic UI verification is appropriate, prefer targeted checks:

- run the app in the background;
- restart the affected dev server or backend process after code changes when
  hot reload is uncertain;
- check key DOM states or route responses programmatically;
- inspect screenshots only for the changed workflow;
- include mobile and desktop viewports when layout risk is meaningful.

When automatic UI verification is not appropriate, produce a manual checklist
with exact flows, inputs, expected states, and regression areas.

## Running Checks

Before running checks:

- choose the smallest command that can catch likely failures;
- avoid destructive commands and broad environment changes;
- explain any expensive, slow, or external check before running it;
- request approval when sandbox, network, or destructive actions require it.

After running checks:

- summarize command names and outcomes;
- quote only the important error lines when a check fails;
- suggest the next smallest useful check or fix;
- do not hide unrun checks behind vague confidence language.

## Reporting

Use concise sections when useful:

- Scope;
- Project Signals;
- Fast Checks;
- Focused Automated Tests;
- Manual Checks;
- Regression Areas;
- Not Checked;
- Confidence.

Final responses should distinguish:

- `Checked`: commands or manual reasoning actually completed;
- `Not checked`: checks skipped, unavailable, or left for the user;
- `Risk`: remaining uncertainty and likely failure modes.

## GI Command

Treat `gi тест-план`, `gi test plan`, `gi проверить фичу`,
`gi feature check`, `gi план проверки`, and `gi test strategy` as requests to
produce a project-aware verification plan in the current project root.

By default, this command plans checks and does not run them automatically. Run
checks only when the user explicitly asks, or when the current implementation
task already requires verification.

Treat `gi test task`, `gi testing task`, `gi тест таск`, `ги тест таск`,
`gi задача теста`, and equivalent wording as requests to set the active
release/full-system verification workload for the current project. The supplied
task text is the user-selected test scenario for the next `gi test`; it is not
evidence that the scenario already passed. Record it in the project-local test
task location when local instructions define one, otherwise keep it as current
chat context and report where it is tracked.

Treat `gi test`, `ги тест`, `gi full test`, `gi release test`,
`gi system test`, and equivalent full-project test wording as requests to run,
not merely plan, the current project's documented verification flow against the
active test task. Do not confuse this with `gi test plan`, which remains
plan-only by default.

For `gi test`, dry-run mode is retired as a validity path. Do not use
`--dry-run`, simulation mode, dispatcher-only execution, replayed logs,
mock-only runs, or compile/unit-only checks as the test result. These checks may
not be run for `gi test` at all unless the user explicitly asks for that
diagnostic mode in addition to or instead of the live test. If explicitly
requested, their result must stay under `Diagnostic` or `Not checked`, never
`Passed`.
If the project-local instructions expose only a dry-run command, or the live
services/apps/workers/UI cannot be started or reached, report `gi test` as
blocked or not checked and name the missing live contract.

For `gi test`, first load the active test task from the current message or
project-local memory. If no active task exists, ask one short question for the
test task before running. Then reread project-local instructions, README,
manifests, runbooks, test configs, and source entry points needed to identify
the current commands, services, app set, ports, routes, payloads, environment,
storage, auth, queues, workers, and health checks. Start or restart documented
apps when needed, run the appropriate ladder through the broadest documented
suite justified by the command, and report the task used, commands run,
results, blockers, and unverified areas.

A full-system `gi test` must exercise the documented live runtime surface for
the selected task: application processes, API/backend, storage, queues or
workers, UI/auth flows, service discovery, orchestrator or agent handoff loops,
and health/contract endpoints when the project defines them. Local static,
compile, unit, or isolated integration checks are useful fast checks, but they
do not replace the live system run.

Old handoff summaries, screenshots, completed demo artifacts, previous task
statuses, and old chat snippets are evidence only. They may explain what was
tested before, but they do not satisfy a fresh `gi test` request. Rerun the
current documented checks or report the exact blocker that prevents a rerun.
