# Startup Product Engineering

Use this pattern when an agent builds, reviews, refactors, or plans software in
a startup-like environment where business value, delivery speed, technical
quality, and clear communication all matter.

## Core Rule

Deliver working product outcomes, not isolated code fragments. Understand the
business requirement, choose the smallest reliable implementation path, keep
architecture and verification proportional to risk, and communicate decisions
clearly enough that a team can continue the work.

## Delivery Mindset

- Start from the user, stakeholder, business requirement, deadline, and
  acceptance criteria before optimizing implementation details.
- When requirements are incomplete, make conservative assumptions, state them
  briefly, and keep moving unless the missing detail changes scope, data safety,
  external systems, cost, or user-visible behavior.
- Separate must-have delivery from improvements that can safely wait. Do the
  smallest coherent batch that creates a working, reviewable result.
- Prefer a reliable boring solution over a clever abstraction when deadlines or
  product uncertainty are high.
- Keep implementation, verification, documentation, and handoff aligned with the
  actual product outcome.

## Code Design

- Apply SOLID, DRY, KISS, clean-code, maintainability, and extensibility
  principles pragmatically.
- Add abstractions only when they protect a real boundary, remove meaningful
  duplication, simplify change, or match an established local pattern.
- Keep domain behavior, application orchestration, UI, persistence, external
  services, filesystem, and configuration separated by explicit contracts.
- Validate inputs, payloads, configuration, and external responses at system
  boundaries.
- Do not hide product uncertainty behind architecture. Record open decisions,
  risks, and follow-up work when the current batch intentionally stays narrow.

## C# And .NET Expectations

- For C#/.NET work, check project architecture, dependency injection lifetimes,
  configuration, logging, data access, API contracts, background services,
  tests, and runtime behavior before editing.
- Use async/await correctly. Avoid `.Result`, `.Wait()`, sync-over-async, and
  unbounded fire-and-forget work unless the project contract explicitly allows
  the pattern and handles failure.
- Pass and honor `CancellationToken` for request, background, I/O, and long
  running operations where the stack supports it.
- Bound parallelism and resource use. Do not create unbounded fan-out, shared
  mutable state races, duplicate side effects, or retry storms.
- Make concurrency behavior observable and testable enough for the risk:
  logging, idempotency, retries, timeouts, failure handling, and targeted tests
  should match the blast radius.

## Frontend Expectations

- For Angular, React, Vue, or similar frontend work, follow the existing
  project conventions for routing, state, forms, API calls, component
  structure, styling, tests, and build tooling.
- Do not introduce a new framework, state manager, UI kit, router pattern, or
  styling architecture unless the local project already uses it or the user
  explicitly approves the change.
- Preserve user workflows, loading states, error states, accessibility,
  responsive behavior, and visual consistency with the existing design system.
- Verify user-visible changes with the strongest practical check for the task:
  unit/component tests, route/API smoke checks, browser inspection,
  screenshots, or manual interaction notes when automation is unavailable.

## Communication

- Use professional English when the task involves interviews, resumes,
  external stakeholders, commit messages, pull requests, public documentation,
  or English-only team communication.
- Keep status reports business-aware: what outcome was delivered, what was
  verified, what risk remains, and what decision or dependency is next.
- In reviews, lead with defects, delivery risks, missing tests, async/concurrency
  bugs, API contract drift, security exposure, UX regressions, and maintainable
  design concerns before style preferences.

## Related Patterns

- `patterns/AGENT_ROLE_OFFICE.md`
- `patterns/SENIOR_AGENT_ENGINEERING_STANDARD.md`
- `patterns/ARCHITECTURE_AND_CODE_QUALITY.md`
- `patterns/PROJECT_TESTING_STRATEGY.md`
- `patterns/FEATURE_WORKFLOW_CONTRACTS.md`
- `patterns/TECHNOLOGY_STACK_INVENTORY.md`
