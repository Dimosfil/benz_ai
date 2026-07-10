# Configuration Boundaries

Keep application code focused on logic, constants, and internal defaults. Values
that can change outside the codebase belong in configuration, environment
variables, service discovery, or deployment metadata.

## Rule

- Do not hard-code deploy, user, runtime, host-machine, service, credential,
  filesystem-layout, feature-flag, model-behavior, intent-interpretation,
  translation, query-normalization, prompt, ranking, or operational-policy
  values in source code.
- Do not turn one observed request, selected object, date range, filename,
  local folder, model, index partition, UI label, test case, or screenshot into
  a default configuration value or product policy. Treat concrete incidents as
  evidence for a portable rule; express the rule in neutral terms and store
  changeable selections in config, manifests, adapters, contracts,
  user-selected state, task payloads, or project-local memory.
- Keep project-local config in documented files such as `config/*.json`,
  `.env.example`, `tools/deploy/*.example.json`, or the platform-native config
  location for the stack.
- Keep secrets out of committed config. Commit only redacted examples, secret
  reference names, or environment variable names.
- Treat API keys, access tokens, service-account keys, webhook secrets, and
  signing secrets as credential boundaries. Never place them in source code,
  client-side bundles, public frontend environment variables, logs, traces, or
  generated artifacts; use project-local secret stores, environment variables,
  deployment secret managers, or secret references instead. Follow
  `patterns/API_KEY_SECRET_SAFETY.md`.
- Use service identifiers and config-service records for local development
  HTTP services instead of fixed ports, URLs, dashboard links, runbook examples,
  or stale task-manager records. A local dev port or URL is valid only after it
  is resolved from, assigned by, or written through the documented
  config-service contract. Once recorded, that port is an exclusive runtime
  contract for the service id: if the port is busy, verify the owner and either
  reuse/restart the same documented service through the run contract or stop
  with a port-conflict blocker. Do not take a neighboring free port, overwrite
  the service record, or stop an unverified process as a fallback. Changing the
  port changes browser origin and can make browser-scoped state appear lost.
  Deployed hosting environments follow the hosting or deploy contract for that
  target instead of the local config-service contract, unless project-local
  production instructions explicitly say otherwise.
- Avoid machine-specific absolute paths in source, shared instructions, and
  committed examples unless the file is explicitly a local-only example.
- When a configured value is a path, resolve it to an absolute path at startup
  or at the I/O boundary, validate that it is within the allowed workspace or
  configured data root, and fail with a clear message if it is missing or unsafe.
- Prefer typed config loading and schema validation when the stack supports it.
  At minimum, validate required keys, path shape, URL shape, numeric ranges, and
  enum values before using the config.
- Keep language translation maps, synonym dictionaries, stemming/normalization
  rules, prompt templates, query expansions, ranking thresholds,
  intent-interpretation behavior, and model-specific compatibility rules in
  resource files, documented config, interpretation/translation modules, model
  adapter modules, provider-swappable LLM adapters, or curated data assets.
  Application code may load, validate, compose, and apply them, but should not
  grow ad hoc per-query dictionaries inside request handlers or UI glue.
- If a quick fix, legacy compatibility path, test expectation, or observed
  sample would require hard-coding changeable behavior that this rule sends to
  config, resources, adapters, or project-local memory, do not silently add the
  hard-code. First implement the compliant boundary. Ask one concise
  clarification question only when the correct source of truth, config location,
  or temporary compatibility layer is not documented; name the boundary conflict
  and the exact scoped exception or config choice needed.
- Keep internal constants in code only when they are true invariants of the
  algorithm or protocol and are not expected to differ by deployment, user,
  environment, or operations.
- When moving a changeable value to configuration or an adapter, check every
  layer that can still carry an old copy of the value, including frontend
  defaults, templates, fixtures, demos, generated examples, tests, build
  metadata, documentation, and project-memory specs. A backend config source is
  not authoritative if another runtime layer still owns an independent default.

## Refactoring Existing Projects

When this rule arrives through an accepted instruction-kit migration, treat it
as a refactoring task, not only a documentation update:

- Search targeted code paths for hard-coded ports, URLs, hostnames, credentials,
  private paths, user names, feature toggles, limits, model names, prompt text,
  query expansions, synonym maps, language translations, intent interpretation,
  scoring thresholds, deployment folders, and environment-specific switches.
- Move scoped findings into existing config files, environment variables, or
  service discovery records that match the project architecture.
- Add or update redacted example config files and docs so a new environment can
  supply the values without reading source code.
- Keep the migration low-risk: do not rewrite unrelated modules, do not expose
  secrets, and record deferred hard-code cleanup in project memory when a full
  refactor is too large for the current update.

## Verification

- Run the project's relevant config/schema checks, tests, or smoke checks.
- Confirm committed examples contain no real secrets, private hostnames, private
  folders, tokens, or machine-specific absolute paths.
- Confirm path values from config are resolved to absolute paths before use and
  rejected when outside the allowed project or data boundary.
- Confirm old independent defaults were removed, generated from the same source,
  or recorded as explicit follow-up drift with an owner and verification path.
