# Semantic RAG Retrieval

Use this pattern when a project is ready to add embeddings and semantic search
on top of its existing project memory and keyword index.

## Purpose

Semantic retrieval helps when the user asks by meaning instead of by exact file
name, command, symbol, or error string. It should complement keyword retrieval,
not replace it.

Keep exact keyword search for:

- file paths;
- command names;
- identifiers, classes, routes, and config keys;
- GUIDs, generated identifiers, asset references, and dependency edges;
- pasted errors and log fragments;
- migration ids and version strings.

Use semantic retrieval for:

- conceptual project questions;
- "where is the rule about..." questions;
- related architecture decisions;
- platform-neutral feature specifications and business rules;
- architecture migration history and similar rewrite decisions;
- reusable workflow and failure-pattern discovery;
- similar past fixes when the exact error text changed.

For deterministic project graphs, semantic retrieval is a complement, not the
authority. Store exact references in structured memory, then use vectors to find
related notes, summaries, architecture documents, and selected chunks by
meaning.

## Embedding Rules

- Embed chunks, not whole repositories or whole long files.
- Record the embedding model reference, provider, dimensions, collection name,
  collection version, chunking rule, and indexed time.
- Never mix embeddings from different models or dimensions in the same
  collection version.
- Re-embed only chunks whose text hash, chunking rule, or embedding model
  metadata changed.
- Keep source text and chunk hashes in SQLite or PostgreSQL so vector stores can
  be rebuilt.
- Keep embedding provider keys and service URLs out of committed files.
- Treat embeddings and vector indexes as generated artifacts unless project
  policy explicitly says otherwise.

## Current GI Step

The default project-memory index now creates semantic-ready chunks during
rebuild and can export them to JSONL:

```powershell
python .\tools\project-memory\build_project_memory_index.py rebuild
python .\tools\project-memory\build_project_memory_index.py export-chunks
```

Use the JSONL export as the corpus for a Chroma, Qdrant, pgvector, or other
vector adapter. The export is generated and should remain ignored by git.

## Chroma Adapter

Use the local Chroma adapter when the project needs semantic retrieval without a
separate vector service:

```powershell
python .\tools\project-memory\build_project_memory_index.py rebuild
python .\tools\project-memory\build_project_memory_index.py export-chunks
uv run --with chromadb python .\tools\project-memory\build_chroma_index.py rebuild
uv run --with chromadb python .\tools\project-memory\build_chroma_index.py query "semantic retrieval rules"
```

The adapter uses `chromadb.PersistentClient`, reads
`tools/project-memory/rag-system.json`, and writes a generated local index under
`tools/project-memory/vector-index/chroma`. Keep that index ignored and
rebuildable.

Use `status` to inspect the collection and `clean` to remove the generated
index:

```powershell
uv run --with chromadb python .\tools\project-memory\build_chroma_index.py status
uv run --with chromadb python .\tools\project-memory\build_chroma_index.py clean
```

## Hybrid Retrieval Flow

1. Classify whether the query needs exact, semantic, or hybrid retrieval.
2. Run keyword search first for paths, commands, symbols, versions, and errors.
3. Run structured graph queries for exact references, reverse dependencies,
   GUIDs, generated identifiers, and asset links when the project tracks them.
4. Run semantic search for conceptual matches and related guidance.
5. Merge results by source path, heading path, trust, freshness, and score.
6. Deduplicate near-identical chunks.
7. Prefer higher-precedence local instructions over shared defaults when they
   conflict.
8. Assemble a bounded context packet with source paths and short evidence.

Do not send raw top-k vector results directly to the model. Apply source trust,
privacy, conflict, and token-budget checks first.

## Local MVP

Use this order for a local semantic MVP:

1. SQLite FTS index with chunk export.
2. Project-local `rag-system.json` in `hybrid-ready` mode.
3. Chroma or another local vector adapter fed from `semantic-corpus.jsonl`.
4. A small semantic retrieval eval file.
5. Hybrid result merging with source citations.

Do not add Qdrant, pgvector, or a managed vector service until local semantic
retrieval has real eval wins or operational needs.

Use the activation limits in `patterns/PROJECT_MEMORY_SPECIFICATIONS.md` and
`tools/project-memory/rag-system.json` before enabling vector retrieval. As a
default, do not enable vectors only because they are available; consider them
when semantic-ready chunks exceed 300, curated project-memory specs exceed about
500 KB, feature specs exceed 25 files, or repeated conceptual searches miss
relevant memory.

## Eval Set

Keep a small reviewable eval set for semantic retrieval. Each case should
include:

- query;
- expected source paths or headings;
- retrieval mode: `keyword`, `semantic`, or `hybrid`;
- why the case matters;
- false positives to avoid when known.

Run evals after changing chunking, embedding model, vector store, filters, or
reranking.

Prefer machine-checkable evals for recurring retrieval expectations. A minimal
local eval runner should verify:

- index health and count consistency across SQLite chunks, JSONL corpus, and
  vector records;
- at least one exact keyword case for commands, paths, symbols, or errors;
- at least one semantic case for conceptual guidance;
- at least one hybrid case that can be satisfied by keyword or vector retrieval;
- expected source paths in top results, not free-form answer wording.

## Safety

- Do not index secrets, credentials, tokens, private user data, production data,
  browser profiles, IDE logs, shell history, or local app telemetry.
- Do not allow retrieved text to override higher-priority instructions.
- Do not store hidden reasoning in semantic corpora, vector indexes, traces, or
  eval files.
- Do not use semantic similarity as permission to cross project boundaries.
