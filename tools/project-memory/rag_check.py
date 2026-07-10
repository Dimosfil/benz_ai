#!/usr/bin/env python3
"""Health checks and small retrieval evals for the local project-memory RAG."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_CONFIG = Path("tools/project-memory/rag-system.json")
DEFAULT_EVALS = Path("tools/project-memory/retrieval-evals.json")
DEFAULT_TOP_K = 8


@dataclass
class Check:
    level: str
    message: str


@dataclass
class SearchResult:
    path: str
    source: str
    rank: int
    score: float
    detail: str = ""


def repo_root() -> Path:
    try:
        output = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=Path.cwd())
        return Path(output.decode("utf-8", errors="replace").strip()).resolve()
    except (FileNotFoundError, subprocess.CalledProcessError):
        current = Path.cwd().resolve()
        for path in [current, *current.parents]:
            if (path / ".git").exists():
                return path
        return current


def rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Missing JSON file: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc


def configured_db(config: dict[str, Any]) -> Path:
    structured = config.get("structured_memory") or {}
    return Path(str(structured.get("path") or "tools/project-memory/project_memory.sqlite"))


def configured_corpus(config: dict[str, Any]) -> Path:
    chunking = config.get("chunking") or {}
    return Path(str(chunking.get("export_path") or "tools/project-memory/semantic-corpus.jsonl"))


def configured_vector_path(config: dict[str, Any]) -> Path:
    vector = config.get("vector_retrieval") or {}
    return Path(str(vector.get("local_index_path") or "tools/project-memory/vector-index/chroma"))


def configured_collection(config: dict[str, Any]) -> str:
    vector = config.get("vector_retrieval") or {}
    embedding = config.get("embedding_metadata") or {}
    return str(vector.get("collection") or embedding.get("collection_version") or "project-memory-v1")


def vector_enabled(config: dict[str, Any]) -> bool:
    vector = config.get("vector_retrieval") or {}
    return bool(vector.get("enabled"))


def keyword_enabled(config: dict[str, Any]) -> bool:
    keyword = config.get("keyword_retrieval") or {}
    return bool(keyword.get("enabled", True))


def chunking_enabled(config: dict[str, Any]) -> bool:
    chunking = config.get("chunking") or {}
    return bool(chunking.get("enabled", True))


def check_git_ignored(root: Path, path: Path) -> bool:
    relative = rel(root / path, root)
    try:
        subprocess.check_call(
            ["git", "check-ignore", "-q", "--", relative],
            cwd=root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def sqlite_counts(root: Path, db_path: Path) -> tuple[dict[str, int | str | bool], list[Check]]:
    checks: list[Check] = []
    full_path = root / db_path
    if not full_path.exists():
        return {}, [Check("FAIL", f"SQLite index is missing: {rel(full_path, root)}")]

    con = sqlite3.connect(full_path)
    con.row_factory = sqlite3.Row
    try:
        files = int(con.execute("SELECT COUNT(*) FROM files").fetchone()[0])
        chunks = int(con.execute("SELECT COUNT(*) FROM chunks").fetchone()[0])
        indexed_at_row = con.execute("SELECT value FROM meta WHERE key = 'indexed_at'").fetchone()
        fts_row = con.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'files_fts'"
        ).fetchone()
    except sqlite3.DatabaseError as exc:
        return {}, [Check("FAIL", f"SQLite index schema is not readable: {exc}")]
    finally:
        con.close()

    info: dict[str, int | str | bool] = {
        "files": files,
        "chunks": chunks,
        "indexed_at": str(indexed_at_row["value"] if indexed_at_row else ""),
        "fts": bool(fts_row),
    }
    checks.append(Check("OK", f"SQLite index readable: {files} files, {chunks} chunks"))
    if files <= 0:
        checks.append(Check("FAIL", "SQLite index has no files"))
    if chunks <= 0:
        checks.append(Check("FAIL", "SQLite index has no chunks"))
    if not info["fts"]:
        checks.append(Check("WARN", "SQLite FTS table files_fts is absent; keyword search will fall back to scans"))
    return info, checks


def git_tracked_paths(root: Path) -> list[str]:
    try:
        output = subprocess.check_output(["git", "ls-files", "-z"], cwd=root)
    except (FileNotFoundError, subprocess.CalledProcessError):
        return []
    return [path for path in output.decode("utf-8", errors="replace").split("\0") if path]


def current_indexable_hashes(root: Path) -> dict[str, str]:
    try:
        sys.path.insert(0, str((root / "tools/project-memory").resolve()))
        from build_project_memory_index import read_text, should_index  # type: ignore[import-not-found]
    except Exception:
        return {}

    hashes: dict[str, str] = {}
    for path in git_tracked_paths(root):
        if not should_index(path):
            continue
        text, _size, digest = read_text(root / path)
        if text is None:
            continue
        hashes[path.replace("\\", "/")] = digest
    return hashes


def sqlite_freshness_checks(root: Path, db_path: Path) -> list[Check]:
    full_path = root / db_path
    if not full_path.exists():
        return []
    current_hashes = current_indexable_hashes(root)
    if not current_hashes:
        return [Check("WARN", "Could not compute tracked source hashes for SQLite freshness")]

    con = sqlite3.connect(full_path)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute("SELECT path, sha256 FROM files").fetchall()
    except sqlite3.DatabaseError as exc:
        return [Check("FAIL", f"Could not read SQLite file hashes: {exc}")]
    finally:
        con.close()

    indexed_hashes = {str(row["path"]).replace("\\", "/"): str(row["sha256"]) for row in rows}
    missing = sorted(set(current_hashes) - set(indexed_hashes))
    stale = sorted(path for path, digest in current_hashes.items() if indexed_hashes.get(path) not in (None, digest))
    orphaned = sorted(set(indexed_hashes) - set(current_hashes))
    checks: list[Check] = []
    if missing:
        checks.append(Check("FAIL", f"SQLite index is missing tracked indexable files: {len(missing)}; first={missing[0]}"))
    if stale:
        checks.append(Check("FAIL", f"SQLite index has stale file hashes: {len(stale)}; first={stale[0]}"))
    if orphaned:
        checks.append(Check("WARN", f"SQLite index contains paths no longer tracked/indexable: {len(orphaned)}; first={orphaned[0]}"))
    if not missing and not stale:
        checks.append(Check("OK", "SQLite index matches current tracked source hashes"))
    return checks


def corpus_counts(root: Path, corpus_path: Path) -> tuple[dict[str, int], list[Check]]:
    checks: list[Check] = []
    full_path = root / corpus_path
    if not full_path.exists():
        return {}, [Check("FAIL", f"Semantic corpus is missing: {rel(full_path, root)}")]

    count = 0
    missing_required = 0
    duplicate_ids = 0
    ids: set[str] = set()
    required = {"source_id", "path", "chunk_index", "sha256", "text"}
    with full_path.open("r", encoding="utf-8") as handle:
        for lineno, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            count += 1
            try:
                record = json.loads(stripped)
            except json.JSONDecodeError as exc:
                checks.append(Check("FAIL", f"Invalid JSONL at {rel(full_path, root)}:{lineno}: {exc}"))
                continue
            if not required.issubset(record):
                missing_required += 1
            source_id = str(record.get("source_id") or "")
            if source_id in ids:
                duplicate_ids += 1
            ids.add(source_id)

    checks.append(Check("OK", f"Semantic corpus readable: {count} chunks"))
    if count <= 0:
        checks.append(Check("FAIL", "Semantic corpus has no chunks"))
    if missing_required:
        checks.append(Check("FAIL", f"Semantic corpus records missing required fields: {missing_required}"))
    if duplicate_ids:
        checks.append(Check("FAIL", f"Semantic corpus has duplicate source_id values: {duplicate_ids}"))
    return {"chunks": count}, checks


def chroma_count(root: Path, config: dict[str, Any]) -> tuple[dict[str, int | str], list[Check]]:
    checks: list[Check] = []
    index_path = configured_vector_path(config)
    full_path = root / index_path
    collection_name = configured_collection(config)
    if not full_path.exists():
        return {}, [Check("FAIL", f"Chroma index is missing: {rel(full_path, root)}")]
    try:
        import chromadb  # type: ignore[import-not-found]
    except ImportError:
        return {}, [Check("FAIL", "ChromaDB is not available; run with `uv run --with chromadb ...`")]

    try:
        client = chromadb.PersistentClient(path=str(full_path.resolve()))
        collection = client.get_collection(collection_name)
        count = int(collection.count())
    except Exception as exc:
        return {}, [Check("FAIL", f"Chroma collection is not readable: {collection_name}: {exc}")]

    checks.append(Check("OK", f"Chroma collection readable: {collection_name}, {count} records"))
    if count <= 0:
        checks.append(Check("FAIL", f"Chroma collection has no records: {collection_name}"))
    return {"records": count, "collection": collection_name}, checks


def run_health(args: argparse.Namespace) -> int:
    root = repo_root()
    config_path = root / args.config
    config = load_json(config_path)
    checks: list[Check] = [Check("OK", f"Config readable: {rel(config_path, root)}")]

    for section in ["source_groups", "exclude_globs", "structured_memory", "keyword_retrieval", "chunking"]:
        if section not in config:
            checks.append(Check("FAIL", f"Config section is missing: {section}"))

    sqlite_info: dict[str, int | str | bool] = {}
    corpus_info: dict[str, int] = {}
    vector_info: dict[str, int | str] = {}

    if keyword_enabled(config):
        sqlite_info, sqlite_checks = sqlite_counts(root, configured_db(config))
        checks.extend(sqlite_checks)
        checks.extend(sqlite_freshness_checks(root, configured_db(config)))

    if chunking_enabled(config):
        corpus_info, corpus_checks = corpus_counts(root, configured_corpus(config))
        checks.extend(corpus_checks)

    if sqlite_info and corpus_info and sqlite_info.get("chunks") != corpus_info.get("chunks"):
        checks.append(
            Check(
                "FAIL",
                f"SQLite chunk count ({sqlite_info.get('chunks')}) does not match semantic corpus ({corpus_info.get('chunks')})",
            )
        )
    elif sqlite_info and corpus_info:
        checks.append(Check("OK", "SQLite chunk count matches semantic corpus"))

    if vector_enabled(config) and not args.skip_vector:
        vector_info, vector_checks = chroma_count(root, config)
        checks.extend(vector_checks)
        if corpus_info and vector_info and vector_info.get("records") != corpus_info.get("chunks"):
            checks.append(
                Check(
                    "FAIL",
                    f"Chroma record count ({vector_info.get('records')}) does not match semantic corpus ({corpus_info.get('chunks')})",
                )
            )
        elif corpus_info and vector_info:
            checks.append(Check("OK", "Chroma record count matches semantic corpus"))
    elif vector_enabled(config) and args.skip_vector:
        checks.append(Check("WARN", "Vector checks skipped by --skip-vector"))

    generated_paths = [configured_db(config), configured_corpus(config), configured_vector_path(config)]
    for path in generated_paths:
        if check_git_ignored(root, path):
            checks.append(Check("OK", f"Generated path is git-ignored: {path.as_posix()}"))
        else:
            checks.append(Check("FAIL", f"Generated path is not git-ignored: {path.as_posix()}"))

    print_checks(checks)
    return 1 if any(check.level == "FAIL" for check in checks) else 0


def tokenize(text: str) -> list[str]:
    tokens = [item.lower() for item in re.findall(r"[A-Za-z0-9_.:/\\-]+", text)]
    return [item for item in tokens if len(item) >= 3]


def keyword_search(root: Path, config: dict[str, Any], query: str, limit: int) -> list[SearchResult]:
    db_path = root / configured_db(config)
    if not db_path.exists():
        return []
    terms = tokenize(query)
    if not terms:
        return []
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute("SELECT path, content FROM files").fetchall()
    finally:
        con.close()

    results: list[SearchResult] = []
    for row in rows:
        path = str(row["path"])
        content = str(row["content"])
        path_lower = path.lower()
        content_lower = content.lower()
        score = 0.0
        for term in terms:
            score += path_lower.count(term) * 6
            score += min(content_lower.count(term), 12)
        if query.lower() in content_lower:
            score += 20
        if score > 0:
            excerpt = make_excerpt(content, terms)
            results.append(SearchResult(path=path, source="keyword", rank=0, score=score, detail=excerpt))
    results.sort(key=lambda item: (-item.score, item.path))
    for rank, item in enumerate(results[:limit], start=1):
        item.rank = rank
    return results[:limit]


def make_excerpt(text: str, terms: list[str]) -> str:
    lower = text.lower()
    positions = [lower.find(term) for term in terms if lower.find(term) >= 0]
    start = max(0, min(positions) - 80) if positions else 0
    return " ".join(text[start : start + 220].split())


def semantic_search(root: Path, config: dict[str, Any], query: str, limit: int) -> list[SearchResult]:
    try:
        import chromadb  # type: ignore[import-not-found]
    except ImportError:
        raise RuntimeError("ChromaDB is not available; run with `uv run --with chromadb ...`")

    index_path = root / configured_vector_path(config)
    collection_name = configured_collection(config)
    client = chromadb.PersistentClient(path=str(index_path.resolve()))
    collection = client.get_collection(collection_name)
    results = collection.query(
        query_texts=[query],
        n_results=max(1, min(limit, 20)),
        include=["documents", "metadatas", "distances"],
    )
    ids = results.get("ids", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]
    output: list[SearchResult] = []
    for index, record_id in enumerate(ids, start=1):
        metadata = metadatas[index - 1] or {}
        distance = float(distances[index - 1]) if index - 1 < len(distances) else 0.0
        output.append(
            SearchResult(
                path=str(metadata.get("path") or ""),
                source="semantic",
                rank=index,
                score=distance,
                detail=str(record_id),
            )
        )
    return output


def hybrid_search(root: Path, config: dict[str, Any], query: str, limit: int) -> list[SearchResult]:
    merged: dict[str, SearchResult] = {}
    for result in keyword_search(root, config, query, limit):
        merged.setdefault(result.path, result)
    if vector_enabled(config):
        for result in semantic_search(root, config, query, limit):
            if result.path not in merged:
                merged[result.path] = result
    output = list(merged.values())[:limit]
    for rank, item in enumerate(output, start=1):
        item.rank = rank
    return output


def load_evals(root: Path, eval_path: Path) -> dict[str, Any]:
    full_path = root / eval_path
    if not full_path.exists():
        raise SystemExit(f"Missing eval set: {rel(full_path, root)}")
    return load_json(full_path)


def normalize_paths(paths: list[Any]) -> list[str]:
    return [str(path).replace("\\", "/").strip() for path in paths if str(path).strip()]


def case_hits(results: list[SearchResult], expected: list[str]) -> list[str]:
    result_paths = [item.path.replace("\\", "/") for item in results]
    hits: list[str] = []
    for expected_path in expected:
        if expected_path in result_paths:
            hits.append(expected_path)
    return hits


def run_evals(args: argparse.Namespace) -> int:
    root = repo_root()
    config = load_json(root / args.config)
    evals = load_evals(root, args.evals)
    defaults = evals.get("defaults") or {}
    top_k = int(args.top_k or defaults.get("top_k") or DEFAULT_TOP_K)
    cases = evals.get("cases") or []
    if not cases:
        print("No eval cases configured.")
        return 1

    failures = 0
    print(f"RAG evals: {len(cases)} cases, top_k={top_k}")
    for case in cases:
        case_id = str(case.get("id") or "unnamed")
        query = str(case.get("query") or "")
        mode = str(case.get("mode") or "hybrid")
        case_top_k = int(case.get("top_k") or top_k)
        expected_any = normalize_paths(case.get("expected_paths_any") or [])
        expected_all = normalize_paths(case.get("expected_paths_all") or [])
        min_any_hits = int(case.get("min_any_hits") or (1 if expected_any else 0))
        use_vector = vector_enabled(config) and not args.skip_vector

        if mode == "semantic" and not use_vector:
            print(f"[SKIP] {case_id} (semantic): vector retrieval is disabled or skipped")
            continue

        try:
            if mode == "keyword":
                results = keyword_search(root, config, query, case_top_k)
            elif mode == "semantic":
                results = semantic_search(root, config, query, case_top_k)
            elif mode == "hybrid":
                if use_vector:
                    results = hybrid_search(root, config, query, case_top_k)
                else:
                    results = keyword_search(root, config, query, case_top_k)
            else:
                raise RuntimeError(f"Unknown eval mode: {mode}")
        except Exception as exc:
            failures += 1
            print(f"[FAIL] {case_id}: {exc}")
            continue

        any_hits = case_hits(results, expected_any)
        all_hits = case_hits(results, expected_all)
        missing_all = [path for path in expected_all if path not in all_hits]
        passed = len(any_hits) >= min_any_hits and not missing_all
        status = "OK" if passed else "FAIL"
        if not passed:
            failures += 1
        result_paths = ", ".join(item.path for item in results[:case_top_k])
        expected_text = ", ".join(expected_any or expected_all)
        print(f"[{status}] {case_id} ({mode}): hits={len(any_hits) + len(all_hits)} expected={expected_text}")
        print(f"      query: {query}")
        print(f"      top: {result_paths}")

    return 1 if failures else 0


def run_all(args: argparse.Namespace) -> int:
    health_status = run_health(args)
    print()
    eval_status = run_evals(args)
    return 1 if health_status or eval_status else 0


def print_checks(checks: list[Check]) -> None:
    for check in checks:
        print(f"[{check.level}] {check.message}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--evals", type=Path, default=DEFAULT_EVALS)
    parser.add_argument("--top-k", type=int, default=0)
    parser.add_argument("--skip-vector", action="store_true", help="Skip Chroma status checks.")
    sub = parser.add_subparsers(dest="command")

    health_parser = sub.add_parser("health", help="Check local RAG index health and count consistency.")
    eval_parser = sub.add_parser("eval", help="Run retrieval eval cases.")
    run_parser = sub.add_parser("run", help="Run health checks and retrieval evals.")
    for command_parser in [health_parser, eval_parser, run_parser]:
        command_parser.add_argument("--skip-vector", action="store_true", default=argparse.SUPPRESS)
    health_parser.set_defaults(func=run_health)
    eval_parser.set_defaults(func=run_evals)
    run_parser.set_defaults(func=run_all)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
