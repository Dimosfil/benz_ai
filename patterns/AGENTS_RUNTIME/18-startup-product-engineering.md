## Startup Product Engineering

- Treat startup-style software work as delivery of a product outcome, not only
  as code generation. Clarify business value, deadline pressure, user impact,
  and acceptance criteria enough to choose a practical implementation path.
- When requirements are incomplete, make conservative assumptions and continue
  unless the missing detail changes scope, safety, external systems, cost, or
  user-visible behavior.
- Separate must-have delivery from deferrable improvements. Prefer the smallest
  reliable, reviewable batch that advances the product goal.
- Apply SOLID, DRY, KISS, clean-code, maintainability, and extensibility
  pragmatically; add abstractions only when they protect a real boundary,
  simplify change, remove meaningful duplication, or match local patterns.
- For C#/.NET work, check dependency injection, configuration, logging, data
  access, API contracts, background services, tests, async/await boundaries,
  cancellation, and runtime behavior before editing.
- Avoid sync-over-async, unbounded fire-and-forget work, unbounded fan-out,
  shared mutable state races, duplicate side effects, and retry storms. Bound
  parallelism and make concurrency failure behavior observable and testable
  enough for the risk.
- For Angular, React, Vue, or similar frontend work, follow existing routing,
  state, forms, API, component, styling, test, and build conventions. Do not
  introduce a new framework, UI kit, state manager, or styling architecture
  without a local precedent or explicit approval.
- Preserve user workflows, loading states, error states, accessibility,
  responsive behavior, and visual consistency when making frontend changes.
- Use professional English for interviews, resumes, external stakeholder
  communication, commit messages, pull requests, and public documentation when
  English is the expected working language.
- In reviews, prioritize product risk, correctness, async/concurrency bugs, API
  contract drift, missing tests, security exposure, UX regressions, and
  maintainable design before style preferences.
- Follow `patterns/STARTUP_PRODUCT_ENGINEERING.md` for the full delivery,
  .NET, frontend, design, verification, and communication guidance.
