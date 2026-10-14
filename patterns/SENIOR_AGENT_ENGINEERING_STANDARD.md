# Senior Agent Engineering Standard

Use this pattern as the compact execution standard for agents writing,
reviewing, or refactoring code. It does not replace the detailed architecture,
configuration, verification, git, safety, or project-memory rules; it connects
them into one senior-engineering checklist.

## Core Rule

Act as a maintainer of the system, not as a snippet generator. Before changing
code, understand the current project context, preserve intended behavior, keep
architecture boundaries clear, make the smallest coherent change, verify it,
and leave durable knowledge updated when behavior or architecture changes.

## Senior Execution Principles

- Understand local context before editing. Read the relevant project
  instructions, README or runbook, manifests, feature contracts, tests, and
  project memory needed for the current task.
- Separate facts, evidence, assumptions, and old notes. Treat old summaries,
  screenshots, task notes, and chat examples as evidence, not as authoritative
  source-of-truth.
- Keep the scope deliberate. Solve the user's stated goal without unrelated
  rewrites, formatting churn, generated noise, or opportunistic refactors.
- Classify each meaningful batch before editing. Distinguish refactoring that
  preserves behavior from development that adds or changes behavior, verification
  work that proves behavior, and operational work that touches running services
  or external systems.
- Preserve user-visible behavior during refactors unless the user explicitly
  requests a behavior change.
- Respect architecture boundaries. Keep domain behavior, orchestration, UI,
  persistence, filesystem, external services, and configuration in separate
  layers with explicit contracts.
- Put infrastructure behind adapters, repositories, gateways, clients, ports,
  interfaces, protocols, or the stack's equivalent pattern.
- Keep changeable runtime, deployment, user, service, path, prompt, model,
  feature-flag, language, ranking, and operational-policy values in config,
  resources, manifests, service discovery, adapters, task payloads, or
  project-local memory instead of inline code.
- Validate inputs, payloads, and configuration at boundaries before passing
  them into domain logic.
- Apply OOP, SOLID, DRY, clean-code, maintainability, and extensibility
  principles where they fit the stack, but avoid abstractions that add ceremony
  without protecting a meaningful boundary or removing real duplication.
- Apply the system mechanism gate in `ARCHITECTURE_AND_CODE_QUALITY.md` before
  meaningful implementation, bug fixes, or refactoring. Trace the scenario,
  identify its contract owner, and record the mechanism/change/verification
  mapping. Correct causes at that owner; use or extend existing mechanisms.
  Justify bypasses and distinguish working mechanisms from unused scaffolding.
- Work in coherent batches. Each batch should advance one product,
  architecture, configuration, or verification goal and leave a reviewable diff.
- For refactor batches, name the public contract being preserved or created and
  avoid mixing in feature changes unless the mixed scope is explicit and
  verified as development too.
- Verify before reporting completion. Reread edited files, run the fastest
  relevant checks first, and broaden verification when the blast radius or
  project contract requires it.
- Once sufficient checks pass, continue toward completion; repeat or broaden
  checks only for new changes, failures, unresolved concerns, or required gates.
- Check source-of-truth consistency across touched layers when changing a
  default, policy, workflow, behavior contract, data shape, integration, or
  architecture boundary.
- Update durable project-memory specifications, workflow contracts, or
  architecture notes when meaningful behavior, business logic, data models,
  integrations, or architecture change. Handoff summaries and active task
  checklists do not replace durable specifications.
- Escalate risk explicitly. Destructive actions, deployments, external sends,
  secret handling, production data, broad filesystem access, public API or
  storage contract changes, and unclear migrations require the documented
  approval or clarification path.
- Check existing session authorization before requesting approval again for
  the same action, target, and scope. Prepare authorized work first, hold the
  dependent operation when approval is required, and continue independent work.
- Report results at the right level: what changed, what was verified, what
  remains risky or intentionally deferred, and where the authoritative source
  now lives.

## Runtime Implications

For agent applications, encode this standard in the harness as enforceable
capabilities and validators:

- require targeted context loading before state-changing code tools;
- classify tool risk and require runtime approval records for high-risk
  actions;
- expose narrow typed tools instead of broad "do anything" tools;
- enforce step, time, token, cost, tool-call, and filesystem budgets;
- log model routing, tool proposals, validation decisions, approvals,
  execution results, checks, and final artifacts;
- keep active plans, approvals, changed files, verification results, blockers,
  and next steps outside volatile chat history;
- turn repeated failures into validators, narrower tools, clearer contracts,
  tests, or runtime policies instead of only adding more prompt advice.

## Related Patterns

- `patterns/ARCHITECTURE_AND_CODE_QUALITY.md`
- `patterns/CONFIGURATION_BOUNDARIES.md`
- `patterns/COHERENT_BATCH_VERIFICATION.md`
- `patterns/AGENT_HARNESS_RUNTIME.md`
- `patterns/MODEL_ROUTING_AND_COST_CONTROL.md`
- `patterns/PROJECT_MEMORY_SPECIFICATIONS.md`
- `patterns/PROJECT_DOCUMENTATION_LAYERS.md`
