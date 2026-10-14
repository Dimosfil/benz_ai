# Architecture And Code Quality

Use this pattern when building, reviewing, or refactoring application code. It
sets the reusable baseline for architecture, maintainability, and code quality
across stacks.

## Core Rule

- Build applications with clear architecture and code-quality boundaries.
- Choose a design approach that fits the problem, stack, and current constraints.
  Apply OOP, SOLID, DRY, and established design and architecture patterns by
  their intent rather than requiring classes or a particular architecture.
- Prefer cohesive domain models, explicit interfaces at integration boundaries,
  dependency inversion for infrastructure, small composable modules, typed or
  validated contracts, low duplication, clear names, focused functions/classes,
  and established framework patterns.
- Keep domain/product logic, orchestration, UI, persistence, filesystem,
  external services, and configuration in separate layers with explicit
  contracts.
- In non-OOP stacks, apply the same separation of responsibilities through
  modules, functions, services, protocols, and data contracts.
- Apply DRY to repeated knowledge and behavior, but do not create premature
  abstractions before the duplication has a clear shared meaning.

## System Mechanism And Responsibility Gate

Correct the cause at the owner of the violated responsibility. Use or extend
the system's intended mechanisms while preserving contracts and invariants.
Justify every bypass. Apply this gate before meaningful implementation, bug
fixes, or refactoring; keep its depth proportional to the affected scenario.

1. Trace the scenario from its entry point through decisions, execution, state
   changes, and observable result. Read current source, relevant contracts,
   and tests; use targeted retrieval. Distinguish implemented mechanisms from
   incomplete scaffolding, disabled paths, and historical notes.
2. Identify the violated or new contract, the invariant to preserve, and the
   component that owns the decision or state transition. Name where callers
   consume that behavior and where side effects occur.
3. Before editing, record a compact mapping in the task plan or relevant local
   contract: scenario -> mechanism -> contract owner -> change location ->
   verification. Use concrete source references. Reuse existing task context
   when it already provides this mapping; do not require another approval,
   a broad audit, or a new document for every small edit.
4. Use or extend the existing mechanism at its owner. If it is incomplete,
   implement the smallest coherent missing contract there. Introduce another
   mechanism only after explaining why the existing one cannot satisfy the
   requirement and who will own the new behavior. An interface or unused
   abstraction alone is not evidence of a working mechanism.
5. Verify the scenario's result, related invariants, and relevant side effects
   through the actual participating components. Keep focused source, tests,
   affected docs, and durable contracts aligned before completing the batch.

- Keep orchestration about sequencing and delegation; keep execution about
  executing its contract. Do not recreate an owner's domain decisions in
  callers, views, adapters, cleanup callbacks, or special-case branches.
- Correct a shared primitive's contract when callers repeatedly compensate
  for its side effects. Preserve legitimate variants through explicit inputs
  or operations rather than changing all callers to an assumed global behavior.
- Make state ownership, handoff, resource acquisition/release, successful
  completion, cancellation, and failure explicit where applicable. Use the
  project's architecture; this rule does not mandate a particular pipeline,
  class hierarchy, framework, or new abstraction layer.
- Do not destroy a valid state and then restore it to simulate success. Such
  compensation can still emit events, release resources, or trigger other work
  between the two operations. Distinguish this from contract-defined rollback
  or recovery, which must also preserve ownership and observable guarantees.
- For an unavoidable bypass, record the concrete constraint, why correction at
  the owner is unavailable, scope, side effects, verification, and the removal
  condition or review trigger. Keep temporary behavior explicit in the relevant
  local contract. Do not call an undocumented bypass the completed system fix.
- Test expected behavior derived from the contract, including representative
  input types and participating components. Do not change expectations merely
  to match the new implementation or treat a final-state assertion as proof
  that intermediate side effects are safe. Report unverified live integrations.

## Principles Across Paradigms

- Apply separation of concerns and single responsibility to units that change
  for different reasons, whether they are classes, modules, functions,
  components, or systems. Keep related behavior together.
- Apply the open-closed principle at proven variation points: extend behavior
  through a stable contract when that avoids changing unrelated working code.
  Do not build extension mechanisms for hypothetical variants.
- Apply the Liskov substitution principle when one implementation replaces
  another: preserve the caller's expected inputs, outputs, errors, side effects,
  and invariants. Test interchangeable implementations against the same contract.
- Keep interfaces and data contracts limited to what their consumers need.
  Depend on abstractions at meaningful boundaries, especially for external
  systems; avoid an interface for every class or function.
- Apply DRY to duplicated knowledge, rules, and behavior with the same meaning.
  Keep the design as simple as the current requirements allow (KISS); defer
  speculative features and abstractions until they have a concrete use (YAGNI).
- Prefer composition for combining independent capabilities. Use inheritance
  when a stable subtype relationship and its behavioral contract make it the
  simpler choice. Keep component responsibilities and interactions explicit.
- Limit a unit's knowledge of other units' internals (Law of Demeter). Review
  navigation through another unit's mutable internals for unnecessary coupling;
  a call chain alone is not proof of a design problem.
- In object-component designs, compose behavior from focused components
  without requiring a deep class hierarchy. In entity-component-system (ECS)
  designs, keep entity identity, component data, and system behavior distinct;
  define data ownership, access, and system ordering according to the framework.
  Apply the principles above to those boundaries without forcing OOP structure.

## Quality And Architecture Evidence

- Record the quality attributes that matter for the product, such as reliability,
  performance, security, usability, and maintainability, as observable criteria
  when they affect an architecture decision. Use
  [ISO/IEC 25010:2023](https://committee.iso.org/standard/78176.html) as a
  reference model for choosing attributes, without claiming conformance.
- For significant decisions, record the relevant stakeholders and concerns,
  chosen boundaries, alternatives, tradeoffs, and verification evidence in the
  project's architecture notes or decision record. Use
  [ISO/IEC/IEEE 42010:2022](https://www.iso.org/standard/74393.html) as a
  reference for describing architecture; scale the detail to the decision.

## Work Type Boundaries

- Treat refactoring as changing structure, names, module boundaries, dependency
  direction, duplication, or internal implementation while preserving
  user-visible behavior and documented API, storage, workflow, and UI
  contracts.
- Treat development as adding or changing behavior: new features, new runtime
  flows, new validation or error behavior, observability, integrations,
  background work, persistence shape changes, or tests that define a new
  contract.
- Treat verification and operations as separate work from both refactoring and
  development. Endpoint discovery, manager or service lifecycle actions,
  smoke-task creation, deploys, restarts, and release checks may support a
  refactor, but they are not themselves code refactors.
- For mixed work, name the refactor, development, verification, and operational
  parts explicitly before editing. Use the stricter rules for any part that
  changes behavior, public contracts, data, secrets, production systems, or
  external services.

## Architecture Boundaries

- Keep domain or product behavior independent from UI widgets, HTTP handlers,
  CLI parsing, filesystem paths, database clients, network clients, and
  provider-specific SDK calls.
- Put infrastructure behind adapters, repositories, gateways, clients, ports,
  interfaces, protocols, or equivalent framework-native boundaries.
- Keep orchestration focused on workflow coordination. Do not let it absorb
  domain rules, persistence details, UI rendering, or external API payload
  construction.
- Keep configuration loading and validation at startup or I/O boundaries. Pass
  validated settings inward through explicit objects or dependency injection.
- Prefer established architecture patterns that fit the stack, such as layered
  architecture, hexagonal/ports-and-adapters, clean architecture,
  domain-driven design, microservices, feature modules, MVC/MVVM, repository
  adapters, command handlers, and explicit service contracts.
- Use GoF, GRASP, and similar design patterns by intent, not by name-dropping:
  identify the force they solve, such as object creation, dependency direction,
  variation, orchestration, state, or responsibility assignment, then choose the
  simplest pattern that preserves clarity.
- Preserve user-visible behavior during refactors unless the user explicitly
  changes the agreement.

## Abstraction Guidance

- Add an abstraction when it removes real duplication, protects a meaningful
  boundary, enables interchangeable infrastructure, or matches an established
  local pattern.
- Avoid abstractions that only rename one implementation, hide simple code,
  encode speculative futures, or make the current behavior harder to verify.
- Keep interfaces small and purpose-driven. Prefer contracts that describe what
  the caller needs, not every method the implementation happens to expose.
- Keep shared helpers about shared meaning, not merely shared syntax.
- When duplication is not yet stable, keep the code clear and local, then
  revisit after a second or third concrete use reveals the real common shape.

## Contract-First Module Boundaries

- When extracting, splitting, or replacing a module, name the public contract
  before relying on the new boundary: caller, callee, input shape, output shape,
  error and empty-state behavior, side-effect ownership, and invariants that
  must not leak across layers.
- Keep contracts visible through names, typed interfaces, validated schemas,
  focused docstrings, tests, or project-memory specs as appropriate for the
  stack and risk.
- Test important boundaries through public module, service, API, CLI, or UI
  entry points instead of private helper internals.
- Do not let API/request handlers know persistence details, persistence know UI
  labels or rendering behavior, parsers know storage writes, UI renderers
  recreate backend aggregation rules, or adapters inspect or mutate data beyond
  their documented boundary.

## Review Checklist

Before finishing architecture-sensitive work, check the changed area for:

- unclear module, class, or function responsibilities;
- oversized functions/classes that mix unrelated concerns;
- domain or business rules duplicated across UI, API, persistence, or
  orchestration layers;
- direct infrastructure dependencies where an interface, adapter, or provider
  boundary is expected;
- hard-coded runtime, environment, product, user, prompt, query, or service
  values that belong in configuration, resources, task data, or adapters;
- UI/request handlers that contain persistence, provider, filesystem, or
  ranking logic;
- tests that only verify implementation details instead of the behavior or
  boundary contract;
- refactor plans that silently include feature work, contract changes,
  integration changes, runtime operations, or data migrations without naming
  those as development or operational work;
- new abstractions that add ceremony without reducing duplication or protecting
  an important boundary.
- design-pattern usage that obscures simple behavior, duplicates framework
  conventions, or exists only because a pattern could be applied.

## Verification

- Run the project's relevant tests, type checks, lint/format checks, or smoke
  checks for the changed area.
- Add or update focused tests when moving behavior behind a contract, adapter,
  service, repository, or module boundary.
- Verify at least one behavior-level path through the public API, UI workflow,
  CLI command, or service operation affected by the change.
- Confirm any new abstraction has more than speculative value: it should reduce
  meaningful duplication, simplify callers, or isolate a real integration
  boundary.
- Update project memory or architecture notes after meaningful feature,
  workflow, business-rule, data-model, integration, or architecture changes.
