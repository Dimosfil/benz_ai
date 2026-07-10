# Technology Stack

Last reviewed: 2026-06-21

This file is the repository's canonical project documentation for stack facts.
Business rules, feature algorithms, workflow contracts, and verification
guarantees belong in project memory specs, not in this stack inventory.

## Summary

- Primary stack: Markdown instruction library with PowerShell and Python helper
  scripts for project-memory and update workflows.
- Runtime model: source repository for reusable GI rules, templates, migrations,
  and project-memory tooling.
- Current confidence: confirmed from repository files.

## Components

| Layer | Technology | Evidence | Notes |
| --- | --- | --- | --- |
| Documentation/runtime | Markdown instruction kit | `AGENTS.md`, `COMMANDS.md`, `patterns/`, `templates/`, `migrations/` | This repository is the canonical GI source. |
| Agent tooling | PowerShell | `templates/agent-start.template.ps1`, `templates/check-instruction-kit-updates.template.ps1` | Templates are copied into consuming projects. |
| Project memory tooling | Python | `tools/project-memory/build_project_memory_index.py`, `tools/project-memory/build_chroma_index.py`, `tools/project-memory/rag_check.py` | Used for optional SQLite, semantic corpus, Chroma, and RAG checks. |
| Storage/indexes | SQLite, JSONL, Chroma-compatible local vector index | `tools/project-memory/project_memory.sqlite`, `tools/project-memory/semantic-corpus.jsonl`, `tools/project-memory/vector-index/` | Generated/rebuildable local project-memory artifacts. |
| Templates | Markdown, JSON, PowerShell | `templates/` | Source templates for copied instruction kits. |
| Versioning | Git, migration files | `VERSION.md`, `CHANGELOG.md`, `migrations/` | Accepted instruction-kit updates are migration-driven. |

## Commands

| Purpose | Command | Evidence |
| --- | --- | --- |
| Check git state | `git status --short --branch` | Repository workflow rules |
| Validate JSON metadata | `Get-Content -Raw .\tools\project-memory\instruction-kit.json \| ConvertFrom-Json` | Instruction-kit metadata |
| Validate whitespace | `git diff --check` | Coherent batch verification |

## External Services

| Service | Role | Evidence | Boundary |
| --- | --- | --- | --- |
| GitHub repository | Canonical shared instruction distribution | `tools/project-memory/instruction-kit.json` `source_repo` | Public source of GI artifacts; do not store secrets in instructions. |

## Gaps

- No application runtime is expected for this repository; app stack fields are
  intentionally scoped to instruction-kit tooling.
