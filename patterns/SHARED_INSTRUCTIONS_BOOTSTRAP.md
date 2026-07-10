# Shared Instructions Bootstrap

Use this when a user starts a new project by giving the canonical
shared-instruction Git repository or a local checkout/cache, for example:

```text
Connect shared instructions: https://github.com/Dimosfil/general-instructions.git
gi init https://github.com/Dimosfil/general-instructions.git
gi init Dimosfil/general-instructions.git
```

Also use this when the user asks to update from a shared instruction library but
the current project does not yet have `tools/project-memory/instruction-kit.json`,
for example:

```text
Обновись из https://github.com/Dimosfil/general-instructions.git
```

## Meaning

This command means: read the canonical shared instruction source repo, using a
local checkout/cache when needed, and deploy a local instruction kit into the
current project. The source may be the full GitHub URL, the shorter
`Dimosfil/general-instructions.git` repo form, a Markdown link to either form,
or an existing local checkout/cache.

It does not mean:

- add the shared repo or checkout as a dependency
- add it as a package
- add it as a submodule
- create a symlink
- create a runtime reference
- create only a thin `AGENTS.md` that points back to the shared source
- run ordinary `git init`
- replace, add, or reconfigure the current project's git remote

## Required Behavior

1. Resolve the shared source from the command URL, `source_repo` metadata,
   `GENERAL_INSTRUCTIONS_HOME`, or an existing checkout/cache. Use
   `https://github.com/Dimosfil/general-instructions.git` as the canonical
   default source repo.
2. Read the shared source's `AGENTS.md`, `USER_GUIDE.md`, `INDEX.md`, and
   relevant templates from the checkout/cache.
3. Create or adapt local project files from templates:
   - root `AGENTS.md`
   - `tools/AGENT_WORKING_AGREEMENTS.md`
   - `tools/AGENT_RUNBOOK.md`
   - `tools/project-memory/README.md`
   - `tools/project-memory/architecture-migrations.md` from
     `templates/ARCHITECTURE_MIGRATIONS.template.md`
   - `tools/project-memory/STUDY_PLAN.md`
   - `tools/project-memory/git-preferences.json`
   - `tools/project-memory/system-preferences.json`
   - optional `tools/project-memory/rag-system.json` from
     `templates/rag-system.template.json` when retrieval may grow into semantic
     RAG
   - optional semantic retrieval evals from
     `templates/semantic-retrieval-evals.template.md` when vector retrieval is
     enabled
   - optional `tools/project-memory/build_chroma_index.py` when local Chroma
     semantic retrieval is enabled
   - `tools/summary/`
   - `tools/agent-start.ps1`
   - `tools/select-project-language.ps1`
   - `tools/select-git-commit-languages.ps1`
   - `tools/select-system-language.ps1`
4. Ask whether the project should connect task-manager plan sync. Offer the
   available adapters from `skills/task-manager-plans/references/managers/` plus
   a `none` option. If the user chooses a manager, copy the
   `task-manager-plans` skill and create
   `tools/project-memory/task-managers.json` from the template.
5. Add agent-memory ignore rules to the local `.gitignore` when appropriate.
6. Keep the local files project-owned and editable.
7. Mention the shared source only as the source used for bootstrapping, not as a
   live dependency.
8. Record the copied baseline in `tools/project-memory/instruction-kit.json`
   with included migrations marked as already applied. Store
   `update_check.source_repo` as
   `https://github.com/Dimosfil/general-instructions.git`. Store a local path
   only as optional checkout/cache metadata, not as the canonical source.
9. Stop after setup and ask what the user wants to do next.

## Token Rules

- Do not copy every shared document into the project.
- Use the templates and checklist, not a full dump of the library.
- Do not read `updates/`; it is maintenance-only for `general-instructions`.
- Do not run broad checks, builds, UI inspection, or zip packaging unless the
  user asks.

## If Files Already Exist

If local instruction files already exist:

- preserve project-specific content
- merge missing rules carefully
- avoid overwriting without reading the target file first
- summarize what was created or updated
