# Skill Modules

Use a skill when a reusable capability is too large or too situational for
always-loaded instructions, but should be available to agents when a matching
task appears.

## Decision Guide

- Use a rule in `AGENTS.md` for short constraints that should always apply.
- Use a pattern in `patterns/` for reusable guidance that agents can read when
  planning or implementing a workflow.
- Use a template in `templates/` for a file that should be copied into projects.
- Use a skill for a self-contained capability with its own trigger, workflow,
  references, scripts, or assets.

## Skill Shape

Keep skills small and progressively disclosed:

- `SKILL.md`: required; contains the skill name, trigger description, and core
  workflow.
- `references/`: optional; detailed guidance loaded only when needed.
- `scripts/`: optional; deterministic helpers for repeated or fragile tasks.
- `assets/`: optional; templates or files used as outputs.

Do not put broad repository policy in a skill. Keep global policy in
`AGENTS.md`, reusable playbooks in `patterns/`, and copied project files in
`templates/`.

## When To Create A Skill

Create or propose a skill when:

- the same workflow is repeated across projects;
- the workflow needs more context than belongs in always-loaded rules;
- the capability has a clear trigger phrase or task type;
- bundled scripts, references, or assets would reduce repeated work;
- multiple agents or projects can reuse the same capability.

Do not create a skill for one-off project trivia, secrets, private data, or rules
that should always apply.

## Naming

Use lowercase kebab-case folder names for skills, such as:

```text
skills/git-workflow/
skills/frontend-review/
skills/release-checks/
```

Inside each skill, keep the required file name:

```text
SKILL.md
```

## Trigger Design

Write the skill description so an agent can decide when to use it without
loading the full body. Mention:

- task types;
- relevant file types, tools, or domains;
- when not to use the skill if confusion is likely.

## Relationship To This Library

This repository may store skill guidance and templates, but consuming projects
should copy or install only the skills they actually need. Do not make projects
depend on this repository at runtime unless the user explicitly asks for that.
