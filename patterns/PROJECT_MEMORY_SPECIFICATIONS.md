# Project Memory Specifications

Use this pattern when project memory should preserve how the product works, not
only what the last agent did.

## Purpose

Treat `README.md`/`docs/`, `tools/summary/`, and `tools/project-memory/` as
different layers:

- `README.md`, `docs/`, and runbooks are project documentation for overview,
  visible functionality, stack, commands, operations, and troubleshooting.
- `tools/summary/` is a compact handoff for the current or recent chat.
- `tools/project-memory/` is implementation-driving product and project
  knowledge: algorithms, business rules, workflows, invariants, architecture
  contracts, and verification guarantees.

Handoff summaries should capture user intent, decisions, code or architecture
changes, business logic, verification evidence, blockers, and next useful
context as a thematic handoff, not as a short chronological retelling. Break the
thread into meaningful topic sections, list the key theses under each topic,
briefly describe each thesis, and add details only when a complex topic would
lose necessary context without them. Include links to code files, URLs, media,
images, logs, screenshots, or exact artifacts only when those references are
needed to understand or verify the context. For architecture or research
conversations, especially when the user evaluates an external project, article,
pattern, or tool as a possible integration target, summaries must explicitly
preserve the user's exploration intent and map external concepts to current
project components. State whether the discussion was informational or
preparation for implementation, what external item was considered, which local
components it maps to, what a future agent must not miss, and which conclusions
are decisions versus hypotheses. Do not use summaries as a routine command
ledger for successful `gi push`, staging counts, git directives, branch names,
push targets, or commit hashes that are already recoverable from git logs or
command history. Keep any needed step-by-step protocol in a separate `Thread
Timeline` section or file.

Project documentation should orient people and agents. Project memory should
let a future agent understand and rebuild the product behavior even when the
current code, language, framework, platform, or UI stack changes. Code is the
current implementation. Project-memory specifications are the portable
behavioral source of truth. Follow `patterns/PROJECT_DOCUMENTATION_LAYERS.md`
when deciding which layer to update.

## Required Scope

For every non-trivial feature or business workflow, record a platform-neutral
specification in project memory. Split files by meaning instead of creating one
large document.

Recommended structure:

```text
tools/project-memory/
  README.md
  architecture-migrations.md
  specs/
    features/
      <feature-name>.md
    business-rules/
      <domain-or-rule-set>.md
    data-model/
      <entity-or-aggregate>.md
    integration-contracts/
      connected-projects.md
      <service-or-boundary>.md
```

Use the structure that fits the project, but keep feature behavior, business
logic, architecture history, and implementation mapping separable and
searchable. Keep user-facing overview, visible feature descriptions, stack
inventory, and operational commands in `README.md`, `docs/`, and runbooks unless
local instructions choose a compatibility path and link it clearly.

Project memory stores specifications and compact evidence references, not raw
work products or product source trees. Do not place product runtime/source
packages, product plugin implementations, product tests, full product
documentation, generated applications, product outputs, screenshots, photos,
crawled/downloaded data, model outputs, large logs, build artifacts, export
bundles, or run datasets under `tools/project-memory/`. Store source code in the
project source/package tree, tests in the test tree, product documentation in
`README.md`, `docs/`, or runbooks, and generated/evidence files in a
project-local artifact/evidence/output/data/build/release location. Keep only
the minimal manifest, summary, checksum, or path/URL reference needed to explain
a decision, contract, failure, or verification result.

## Connected Projects Register

When a project depends on, researches, vendors, or regularly interacts with
external repositories, cloned examples, service projects, libraries, docs sites,
upstream tools, or sibling workspaces, keep a connected-projects register in the
business/integration layer:

```text
tools/project-memory/specs/integration-contracts/connected-projects.md
```

The register should let any future agent answer what each connected project is,
where to find it, why it matters, and what boundaries apply before reading files
or changing integration behavior.

For each connected project, record:

- stable project name and short description;
- business or architectural role in the current project;
- local folder path when it is an approved workspace dependency;
- canonical Git, package, documentation, dashboard, or issue-tracker URLs;
- service ID, contract endpoint, API base, or discovery record when applicable;
- owner, source of truth, update cadence, and version or branch policy;
- data exchanged, API contract, generated artifacts, and runtime dependencies;
- setup, sync, build, test, or update commands that are safe to run;
- privacy, secret, license, and cross-repository access boundaries;
- current status, known caveats, and the reason the dependency still exists.

Agents should read this register before touching integrations, nested
repositories, cloned examples, or external project folders. Update it in the
same scoped change when adding, removing, replacing, relocating, or materially
changing the role of a connected project. Do not use the register as permission
to inspect arbitrary external folders; project-local scope and explicit user
requests still govern filesystem access.

## Feature Specification Content

Each feature specification should include:

- product intent and success signal;
- actors, roles, permissions, and preconditions;
- user-visible workflow and terminal states;
- business rules and invariants;
- inputs, outputs, validation, and data freshness rules;
- background work, ordering, retries, cancellation, and failure behavior;
- Mermaid flowcharts or state diagrams when the workflow has branches;
- verification rules that prove the behavior still works after a rewrite;
- implementation map to current files, routes, commands, schemas, or services.

The implementation map is evidence for the current codebase, not the behavioral
source of truth. If code and specification disagree, inspect the current code and
tests, then update the spec or report the conflict before changing behavior.

## Architecture Migration History

Keep a separate `tools/project-memory/architecture-migrations.md` file for major
architecture rewrites, platform moves, storage changes, service splits, routing
changes, framework replacements, and other changes that alter how the project is
organized.

Each entry should include:

- date or version;
- previous architecture;
- new architecture;
- reason for the migration;
- behavior that must remain unchanged;
- compatibility, rollback, and data migration notes;
- affected feature specs and implementation-map references;
- verification evidence.

Do not hide architecture migrations only in chat, commit messages, pull request
text, or code comments.

## Code Index Versus Specification Index

Keep logical separation between:

- code/source memory: paths, symbols, exact references, commands, schemas,
  errors, dependency edges, generated identifiers, and current implementation
  evidence;
- specification memory: product behavior, business rules, feature algorithms,
  workflow contracts, architecture migrations, and verification guarantees.

Small projects may store both logical layers in one generated SQLite database
with source metadata. Larger projects should split them into separate databases,
schemas, or source groups such as `code_memory.sqlite` and `spec_memory.sqlite`,
or equivalent service-backed stores. Keep vector collections separated by source
type when code chunks and specification chunks have different trust or freshness.

## Activation Limits

Start with Markdown specifications and targeted text search. Add generated
databases only when project size or retrieval failures justify them.

Use SQLite or another structured/FTS index when any of these are true:

- tracked text sources to search exceed 50 files;
- project-memory Markdown/JSON exceeds 25 files or about 200 KB;
- feature specifications exceed 10 files;
- agents repeatedly fail to find exact paths, commands, symbols, or feature
  specs with targeted search;
- startup restore regularly needs more than a few focused file reads.

Use vector retrieval only after curated specs or notes exist and SQLite/keyword
retrieval is not enough. Enable a local vector adapter when any of these are
true:

- semantic-ready chunks exceed 300;
- curated project-memory specs exceed about 500 KB;
- feature specifications exceed 25 files;
- conceptual queries such as "similar workflow", "where is the rule about...",
  or "past fix like this" miss relevant memory at least three times;
- multiple agents need conceptual retrieval over the same project memory.

Move to service-grade PostgreSQL, pgvector, Qdrant, or another managed retrieval
service only when measured needs justify it, such as concurrent agents, shared
remote access, permission filtering, backups/snapshots, or corpora above roughly
10,000 chunks.

## Diagnostic Commands

Treat `gi sql`, `gi sqlite`, `gi vector`, and equivalent Russian forms as
requests to inspect project-memory retrieval readiness and current metrics.

For `gi sql`, the agent should:

1. Read project-local `tools/project-memory/rag-system.json` when present.
2. Run the project memory index stats command when available, for example
   `python .\tools\project-memory\build_project_memory_index.py stats`.
3. Count reviewable project-memory Markdown/JSON files and feature spec files.
4. Compare current numbers with the SQLite activation limits.
5. Report whether SQLite/FTS is absent, current, stale, or recommended.

For `gi vector`, the agent should:

1. Read `rag-system.json` vector and embedding metadata.
2. Check semantic corpus size and chunk count.
3. Run vector adapter status when available, for example
   `uv run --with chromadb python .\tools\project-memory\build_chroma_index.py status`.
4. Compare current numbers with the vector activation limits.
5. Report collection name, record count, index path, freshness caveats, and
   whether vector retrieval is absent, current, stale, or recommended.

These commands are inspection commands by default. Do not create external
services, install heavy dependencies, upload data, or index private sources
unless the user explicitly asks and project-local rules allow it.

## Writeback Rule

After meaningful work on a feature, workflow, business rule, or architecture,
update the relevant project-memory specification in the same scoped change.
Also write a handoff summary when the chat state itself needs to be handed to a
future session. A summary does not replace project memory.

Do not treat `pending-tasks.md`, task-manager notes, commit messages, or chat
summaries as the durable record for changed behavior or architecture. They may
track execution status, but the portable specification should describe the rule,
workflow, state transition, data contract, failure behavior, verification
guarantee, and current implementation map.

When a batch intentionally does not update project memory, the final report
should say why at the behavior level, for example because the change only
renamed private helpers, refreshed tests, or removed dead code without changing
an agreed contract.
