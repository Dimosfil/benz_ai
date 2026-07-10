# Feature Workflow Contracts

Use this pattern when a feature has an agreed runtime workflow, loading order,
state machine, background work, branching behavior, or user-visible guarantees.
Also use it when a feature needs a durable implementation plan that can survive
multiple agents, sessions, sprints, or task-manager handoffs.

Use feature contracts as platform-neutral specifications. They should describe
what behavior must remain true even if the project is rewritten in another
language, framework, platform, or UI toolkit. Code is the current implementation;
the contract is the portable behavior record.

## Purpose

Feature workflow contracts preserve product behavior that should not be
rediscovered or accidentally changed during later implementation work.
They also keep the implementation plan tied to the agreed feature idea, so
agents do not complete isolated tasks while losing the workflow the feature was
supposed to deliver.

Examples:

- load UI shell first, then account state, then folders, then the first visible
  message list, then load message bodies in the background;
- accept an order, branch through payment, fraud review, fulfillment, and
  cancellation paths;
- keep an editor usable while assets, previews, or sync state load lazily.

## Rule

- For non-trivial features, record the feature idea, functional description,
  runtime workflow, business rules, state transitions, failure behavior,
  verification rules, current implementation map, and implementation plan before
  or during implementation.
- When the user or team agrees that a feature must work in a specific sequence
  or state flow, record it as a project-local feature workflow contract.
- Store project-specific contracts in project-owned docs such as
  `docs/features/`, `tools/project-memory/`, `AGENTS.md`, or the local runbook.
  Keep shared instructions project-agnostic.
- Before changing a feature with a recorded contract or plan, read it and
  preserve its user-visible guarantees unless the user explicitly changes the
  agreement.
- If implementation requires changing the workflow, update the contract in the
  same scoped change and call out the behavior change in the final response.
- Do not bury product workflow decisions only in chat, commit messages, or code
  comments. Durable contracts should be reviewable by humans and retrievable by
  future agents.
- Do not let sprint or task lists replace the feature contract. Tasks say what
  to change; the contract says what behavior must remain true.
- After meaningful work changes a feature's behavior, business rules, data
  contract, or architecture, update the contract in the same scoped change. A
  handoff summary is not a substitute for the project-memory specification.

## Planning Hierarchy

Use this hierarchy for feature work:

1. Feature idea: the product intent, user problem, and success signal.
2. Functional description: what the feature does and does not do.
3. Workflow contract: how the feature behaves at runtime, including sequence,
   branches, background work, loading states, failures, and terminal states.
4. Implementation plan: technical approach, files or modules likely affected,
   dependencies, risks, rollout, and verification strategy.
5. Sprints: one sprint for small features, several sprints for larger work.
   Each sprint should have a goal, scope, dependencies, exit criteria, and
   verification.
6. Tasks: concrete implementation, test, documentation, migration, and cleanup
   items. Each task should trace back to the feature workflow or implementation
   plan and include a definition of done.

When a project uses a task manager, represent sprints and tasks there, but keep
the durable feature contract in project-local docs or project memory so future
agents can recover the reasoning without relying on stale chat context.

## Contract Contents

Feature workflow contracts should be short, but explicit:

- feature idea and user problem;
- functional scope and non-goals;
- goal and user-visible promise;
- entry points, triggers, and preconditions;
- required order for sequential steps;
- branches, decision points, and terminal states;
- what blocks the user and what runs in the background;
- loading, empty, partial, stale, retry, and error states;
- concurrency, cancellation, debounce, timeout, and backpressure rules when
  relevant;
- data ownership and cache/freshness expectations;
- observability, logs, metrics, or user-visible errors when relevant;
- implementation plan, sprint breakdown, and task traceability when the feature
  is more than a small one-step change;
- verification checks that prove the workflow still behaves as agreed.

Use diagrams only when they make branching clearer. Prefer compact Mermaid
state or flow diagrams over long prose for complex branching workflows.

## Implementation Guidance

- Treat the contract as product behavior, not as an optional note.
- Keep implementation tasks linked to the feature workflow. Before marking a
  task done, confirm it did not break the agreed sequence, branch, loading
  behavior, or background behavior.
- Implement the smallest code path that satisfies the recorded workflow.
- Keep feature flags, endpoints, limits, timeouts, account names, folder names,
  ports, credentials, and environment-specific values in config, not in the
  contract or source code.
- Prefer explicit states over implicit booleans when a workflow has meaningful
  branches or background phases.
- Keep background work observable and failure-tolerant when the contract says it
  must not block the visible workflow.
- Avoid global loading blockers when the contract promises partial rendering or
  region-level progress.

## Verification

For every feature workflow contract, define checks that cover:

- the happy path through the primary workflow;
- every important branch or terminal state;
- slow, failed, cancelled, retried, and partial-load paths;
- ordering guarantees, especially when background work is involved;
- sprint exit criteria and task definitions of done;
- regression areas near the touched code;
- fresh-runtime checks for frontend, backend, API, or full-stack features when
  hot reload is uncertain.

When a check cannot be automated, write a manual checklist with exact inputs,
actions, expected states, and visible non-regression signals.
