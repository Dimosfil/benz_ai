# Instruction Kit Migrations

Use migrations to update copied project instruction kits in small, ordered,
reviewable steps.

This is the accepted update path for consuming projects. Do not use `updates/`
for project refreshes; `updates/` is maintenance-only intake for this shared
library.

Accepted RAG, startup, command, workflow, and agent-safety rules must be
self-applied in the shared source repository and propagated to consuming
projects. For the source repository, update live files such as `AGENTS.md`,
`COMMANDS.md`, `patterns/`, `templates/`, `VERSION.md`, `CHANGELOG.md`,
accepted migration files, and local instruction-kit metadata as applicable. For
consuming projects, `gi обновить` applies the accepted migrations and updates
their project-local metadata. Never leave an accepted rule only in `updates/`,
only in source-only files, or only in copied templates.

## Model

- `VERSION.md`: latest accepted shared instruction-kit version.
- `CHANGELOG.md`: human-readable accepted changes.
- `migrations/`: ordered accepted upgrade steps.
- `tools/project-memory/instruction-kit.json`: project-local installed version,
  canonical `source_repo`, optional checkout/cache path, copied files, and
  applied migrations.

Fresh bootstraps should treat the copied version as a baseline and record all
migrations included in that version as already applied.

## Project Command

When the user says:

```text
check instruction updates
```

or:

```text
Обновись из general-instructions
```

or:

```text
Обновись из https://github.com/Dimosfil/general-instructions.git
```

or:

```text
проверь обновления инструкций
```

the agent should:

1. Check whether `tools/project-memory/instruction-kit.json` exists.
2. If it does not exist, treat the command as a first-time instruction kit
   bootstrap/init from the requested shared source repo, then record the copied
   kit baseline with included migrations marked as applied.
3. If it exists, read it.
4. Resolve the shared instruction source from the user's URL, `source_repo` /
   `update_check.source_repo`, the current shared checkout/cache,
   `GENERAL_INSTRUCTIONS_HOME`, or optional local cache metadata. Use
   `https://github.com/Dimosfil/general-instructions.git` as the canonical
   default repo. Do not require a machine-specific local folder.
5. Clone or fetch the source repo into a local cache/checkout when no usable
   checkout is already available. If git, network, or repo access is blocked,
   stop with that blocker instead of falling back to stale absolute paths.
6. Read only accepted release artifacts from the checkout/cache: `VERSION.md`,
   `CHANGELOG.md`, `INDEX.md`, and relevant files under `migrations/`.
7. Do not read `updates/`.
8. Identify migrations that are not listed in `applied_migrations`.
9. Apply pending migrations in filename order.
10. Merge project-owned files carefully; do not overwrite project-specific
   content without review.
11. Update `instruction-kit.json` only after successful application.
12. Treat successfully applied local instructions as active immediately. Before
    the next concrete task in the same chat/session, reread the updated local
    `AGENTS.md` and every routed runtime module needed for that task instead of
    continuing from pre-update context.
13. Summarize changed files, skipped files, conflicts, and checks.
14. If migrations were applied successfully and the current project is a git
    repository with a configured remote, commit and push only the instruction-kit
    update changes.
15. If unrelated/user changes are present, no git repository or remote exists,
    push fails, or a conflict remains, do not force it; stop and explain the
    blocker.

Use quiet progress for this command. Do not narrate step-by-step reasoning,
repeat "reading/applying/checking" updates, print command transcripts, or read
broad files during a normal successful update. Surface only blockers,
correctness-affecting warnings, or the final compact summary.

The final summary should include only:

- installed version before and after;
- pending and applied migration count;
- applied migration IDs;
- changed instruction-kit files;
- checks run;
- commit/push result when applicable;
- blocker or skipped step, if any.

Use verbose/debug output only when the user asks for it or a failure needs
diagnosis.

`gi` means `general-instructions`, not `git`. A missing `.git` directory blocks
only the automatic commit/push step; it does not block checking or applying
instruction-kit file updates. If there is no git repository, apply the GI update
when possible, then report that commit/push was skipped because the current
project is not a git repository.

Run these steps against the current project root. Do not change into another
project or the shared instruction library to apply consuming-project updates
unless the user explicitly asks.

## Metadata Recording Safety

Project helper scripts may list pending migrations, but they must not mark
migrations as applied before file changes are actually made.

- Default or planning mode should list pending migrations only.
- `-Apply` must not be a metadata-only shortcut. If an older script still uses
  `-Apply` to record metadata before file changes, stop and update the script or
  apply the files first and then correct metadata.
- Use an explicit metadata command such as `-RecordApplied` only after the agent
  has applied the migration instructions, reread the changed files, and run the
  relevant checks.
- If metadata was advanced too early, compare local instruction files against
  the migration requirements, apply missing changes, and correct
  `tools/project-memory/instruction-kit.json` before reporting the project up to
  date.

## Migration File Format

Name migrations with an ordered version prefix:

```text
migrations/2026.05.16.2__add_git_commit_preferences.md
```

Each migration should include:

- purpose;
- source files in the shared library;
- project files to create or update;
- merge rules;
- verification steps;
- rollback or conflict notes when useful.

## Idempotency

Write migrations so applying them twice is harmless:

- create missing files from templates;
- update only clearly owned sections when possible;
- skip files that already contain the accepted content;
- record conflicts instead of forcing overwrites.

## Failure Handling

If a migration cannot be applied cleanly:

- stop at the failing migration;
- leave later migrations unapplied;
- record the blocked item in `tools/project-memory/pending-tasks.md`;
- explain the conflict and ask the user how to proceed.
