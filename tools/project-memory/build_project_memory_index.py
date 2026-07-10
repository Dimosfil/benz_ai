#!/usr/bin/env python3
"""Build and query a local SQLite index from git tracked project files."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_DB = Path("tools/project-memory/project_memory.sqlite")
MAX_TEXT_BYTES = 512 * 1024
MAX_CHUNK_CHARS = 4000
TEXT_EXTENSIONS = {
    ".bat",
    ".cmd",
    ".css",
    ".csv",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".ps1",
    ".py",
    ".sql",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
SKIP_PREFIXES = (
    ".git/",
    "node_modules/",
    "dist/",
    "build/",
)
SKIP_SUFFIXES = (
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".7z",
    ".gz",
    ".sqlite",
    ".db",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def run_git(args: list[str], root: Path) -> bytes:
    try:
        return subprocess.check_output(["git", *args], cwd=root)
    except FileNotFoundError:
        raise SystemExit("git is required to build the project memory index.")
    except subprocess.CalledProcessError as exc:
        message = exc.output.decode("utf-8", errors="replace").strip()
        raise SystemExit(message or f"git {' '.join(args)} failed.")


def repo_root() -> Path:
    output = run_git(["rev-parse", "--show-toplevel"], Path.cwd())
    return Path(output.decode("utf-8", errors="replace").strip()).resolve()


def tracked_paths(root: Path) -> list[str]:
    output = run_git(["ls-files", "-z"], root)
    paths = [p for p in output.decode("utf-8", errors="replace").split("\0") if p]
    return sorted(paths)


def should_index(path: str) -> bool:
    normalized = path.replace("\\", "/")
    lower = normalized.lower()
    if any(lower.startswith(prefix) for prefix in SKIP_PREFIXES):
        return False
    if any(lower.endswith(suffix) for suffix in SKIP_SUFFIXES):
        return False
    return Path(lower).suffix in TEXT_EXTENSIONS


def read_text(path: Path) -> tuple[str | None, int, str]:
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > MAX_TEXT_BYTES:
        return None, len(data), digest
    if b"\x00" in data:
        return None, len(data), digest
    try:
        return data.decode("utf-8"), len(data), digest
    except UnicodeDecodeError:
        try:
            return data.decode("utf-8-sig"), len(data), digest
        except UnicodeDecodeError:
            return data.decode("cp1251", errors="replace"), len(data), digest


def estimate_tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def update_heading_stack(stack: list[str], line: str) -> list[str]:
    match = HEADING_RE.match(line.strip())
    if not match:
        return stack
    level = len(match.group(1))
    title = match.group(2).strip()
    return stack[: level - 1] + [title]


def iter_text_chunks(path: str, text: str, indexed_at: str) -> list[dict[str, object]]:
    lines = text.splitlines()
    if not lines:
        return []

    chunks: list[dict[str, object]] = []
    current_lines: list[str] = []
    heading_stack: list[str] = []
    current_heading = ""
    start_line = 1

    def flush(end_line: int) -> None:
        nonlocal current_lines, start_line, current_heading
        chunk_text = "\n".join(current_lines).strip()
        if not chunk_text:
            current_lines = []
            start_line = end_line + 1
            current_heading = " > ".join(heading_stack)
            return
        chunk_index = len(chunks) + 1
        chunks.append(
            {
                "path": path,
                "chunk_index": chunk_index,
                "heading_path": current_heading,
                "start_line": start_line,
                "end_line": end_line,
                "token_estimate": estimate_tokens(chunk_text),
                "sha256": content_hash(chunk_text),
                "indexed_at": indexed_at,
                "content": chunk_text,
            }
        )
        current_lines = []
        start_line = end_line + 1
        current_heading = " > ".join(heading_stack)

    for lineno, line in enumerate(lines, start=1):
        is_heading = path.lower().endswith(".md") and HEADING_RE.match(line.strip())
        if is_heading and current_lines:
            flush(lineno - 1)
        heading_stack = update_heading_stack(heading_stack, line)
        if is_heading:
            current_heading = " > ".join(heading_stack)
            start_line = lineno
        current_lines.append(line)
        if sum(len(item) + 1 for item in current_lines) >= MAX_CHUNK_CHARS:
            flush(lineno)

    if current_lines:
        flush(len(lines))

    return chunks


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    return con


def has_fts5(con: sqlite3.Connection) -> bool:
    try:
        con.execute("CREATE VIRTUAL TABLE temp._fts5_check USING fts5(value)")
        con.execute("DROP TABLE temp._fts5_check")
        return True
    except sqlite3.DatabaseError:
        return False


def create_fts_table(con: sqlite3.Connection) -> None:
    con.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts
        USING fts5(path, content, content='files', content_rowid='rowid')
        """
    )


def ensure_schema(con: sqlite3.Connection) -> bool:
    fts = has_fts5(con)
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS files (
            path TEXT PRIMARY KEY,
            extension TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            line_count INTEGER NOT NULL,
            indexed_at TEXT NOT NULL,
            content TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            topic TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            evidence_paths TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            heading_path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            token_estimate INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            indexed_at TEXT NOT NULL,
            content TEXT NOT NULL,
            UNIQUE(path, chunk_index)
        );
        """
    )
    if fts:
        create_fts_table(con)
    return fts


def set_meta(con: sqlite3.Connection, key: str, value: str) -> None:
    con.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def rebuild(args: argparse.Namespace) -> int:
    root = repo_root()
    db_path = (root / args.db).resolve()
    con = connect(db_path)
    indexed_at = utc_now()
    with con:
        fts = ensure_schema(con)
        if fts:
            con.execute("DROP TABLE IF EXISTS files_fts")
            create_fts_table(con)
        con.execute("DELETE FROM files")
        con.execute("DELETE FROM chunks")

        indexed = 0
        skipped = 0
        chunk_count = 0
        for rel_path in tracked_paths(root):
            if not should_index(rel_path):
                skipped += 1
                continue
            full_path = root / rel_path
            if not full_path.is_file():
                skipped += 1
                continue
            text, size, digest = read_text(full_path)
            if text is None:
                skipped += 1
                continue
            line_count = text.count("\n") + (1 if text else 0)
            con.execute(
                """
                INSERT INTO files(path, extension, size_bytes, sha256, line_count, indexed_at, content)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rel_path.replace("\\", "/"),
                    full_path.suffix.lower(),
                    size,
                    digest,
                    line_count,
                    indexed_at,
                    text,
                ),
            )
            for chunk in iter_text_chunks(rel_path.replace("\\", "/"), text, indexed_at):
                con.execute(
                    """
                    INSERT INTO chunks(
                        path, chunk_index, heading_path, start_line, end_line,
                        token_estimate, sha256, indexed_at, content
                    )
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chunk["path"],
                        chunk["chunk_index"],
                        chunk["heading_path"],
                        chunk["start_line"],
                        chunk["end_line"],
                        chunk["token_estimate"],
                        chunk["sha256"],
                        chunk["indexed_at"],
                        chunk["content"],
                    ),
                )
                chunk_count += 1
            indexed += 1

        if fts:
            con.execute("INSERT INTO files_fts(files_fts) VALUES('rebuild')")

        set_meta(con, "schema_version", "2")
        set_meta(con, "indexed_at", indexed_at)
        set_meta(con, "repo_root", str(root))
        set_meta(con, "source", "git ls-files tracked text files")
        set_meta(con, "fts5", "enabled" if fts else "disabled")
        set_meta(con, "chunking", f"markdown-aware max_chars={MAX_CHUNK_CHARS}")
        set_meta(con, "chunk_count", str(chunk_count))

    print(f"Indexed files: {indexed}")
    print(f"Chunks: {chunk_count}")
    print(f"Skipped files: {skipped}")
    print(f"Database: {db_path}")
    print(f"FTS5: {'enabled' if fts else 'disabled'}")
    return 0


def stats(args: argparse.Namespace) -> int:
    root = repo_root()
    db_path = (root / args.db).resolve()
    if not db_path.exists():
        print(f"No database found at {db_path}")
        return 1
    con = connect(db_path)
    ensure_schema(con)
    file_count = con.execute("SELECT COUNT(*) FROM files").fetchone()[0]
    chunk_count = con.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    total_bytes = con.execute("SELECT COALESCE(SUM(size_bytes), 0) FROM files").fetchone()[0]
    indexed_at = con.execute("SELECT value FROM meta WHERE key = 'indexed_at'").fetchone()
    print(f"Files: {file_count}")
    print(f"Chunks: {chunk_count}")
    print(f"Source bytes: {total_bytes}")
    print(f"Database bytes: {db_path.stat().st_size}")
    print(f"Indexed at: {indexed_at['value'] if indexed_at else 'unknown'}")
    print(f"Database: {db_path}")
    return 0


def search(args: argparse.Namespace) -> int:
    root = repo_root()
    db_path = (root / args.db).resolve()
    if not db_path.exists():
        print(f"No database found at {db_path}")
        return 1
    con = connect(db_path)
    fts = ensure_schema(con)
    limit = max(1, min(args.limit, 50))
    if fts:
        rows = con.execute(
            """
            SELECT files.path, snippet(files_fts, 1, '[', ']', ' ... ', 12) AS excerpt
            FROM files_fts
            JOIN files ON files.rowid = files_fts.rowid
            WHERE files_fts MATCH ?
            ORDER BY bm25(files_fts)
            LIMIT ?
            """,
            (args.query, limit),
        ).fetchall()
    else:
        like = f"%{args.query}%"
        rows = con.execute(
            """
            SELECT path, substr(content, max(1, instr(lower(content), lower(?)) - 80), 240) AS excerpt
            FROM files
            WHERE lower(path) LIKE lower(?) OR lower(content) LIKE lower(?)
            ORDER BY path
            LIMIT ?
            """,
            (args.query, like, like, limit),
        ).fetchall()

    for row in rows:
        excerpt = " ".join(str(row["excerpt"]).split())
        print(f"{row['path']}: {excerpt}")
    if not rows:
        print("No matches.")
    return 0


def note(args: argparse.Namespace) -> int:
    root = repo_root()
    db_path = (root / args.db).resolve()
    con = connect(db_path)
    with con:
        ensure_schema(con)
        con.execute(
            """
            INSERT INTO notes(created_at, topic, title, body, evidence_paths)
            VALUES(?, ?, ?, ?, ?)
            """,
            (utc_now(), args.topic, args.title, args.body, "\n".join(args.evidence)),
        )
    print(f"Added note: {args.title}")
    return 0


def notes(args: argparse.Namespace) -> int:
    root = repo_root()
    db_path = (root / args.db).resolve()
    if not db_path.exists():
        print(f"No database found at {db_path}")
        return 1
    con = connect(db_path)
    ensure_schema(con)
    rows = con.execute(
        """
        SELECT id, created_at, topic, title, evidence_paths
        FROM notes
        ORDER BY id DESC
        LIMIT ?
        """,
        (max(1, min(args.limit, 50)),),
    ).fetchall()
    for row in rows:
        evidence = ", ".join(p for p in row["evidence_paths"].splitlines() if p)
        suffix = f" [{evidence}]" if evidence else ""
        print(f"{row['id']}. {row['created_at']} {row['topic']} - {row['title']}{suffix}")
    if not rows:
        print("No notes.")
    return 0


def export_notes(args: argparse.Namespace) -> int:
    root = repo_root()
    db_path = (root / args.db).resolve()
    output_path = (root / args.output).resolve()
    if not db_path.exists():
        print(f"No database found at {db_path}")
        return 1
    con = connect(db_path)
    ensure_schema(con)
    rows = con.execute(
        """
        SELECT created_at, topic, title, body, evidence_paths
        FROM notes
        ORDER BY id
        """
    ).fetchall()
    lines = [
        "# Project Memory Notes",
        "",
        "SQLite is the local generated search index. This Markdown file is the",
        "human-reviewable long-lived memory export.",
        "",
    ]
    for row in rows:
        lines.extend(
            [
                f"## {row['title']}",
                "",
                f"- Topic: {row['topic']}",
                f"- Created: {row['created_at']}",
            ]
        )
        evidence = [p for p in row["evidence_paths"].splitlines() if p]
        if evidence:
            lines.append(f"- Evidence: {', '.join(evidence)}")
        lines.extend(["", row["body"], ""])
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Exported notes: {output_path}")
    return 0


def export_chunks(args: argparse.Namespace) -> int:
    root = repo_root()
    db_path = (root / args.db).resolve()
    output_path = (root / args.output).resolve()
    if not db_path.exists():
        print(f"No database found at {db_path}")
        return 1
    con = connect(db_path)
    ensure_schema(con)
    rows = con.execute(
        """
        SELECT path, chunk_index, heading_path, start_line, end_line,
               token_estimate, sha256, content
        FROM chunks
        ORDER BY path, chunk_index
        """
    ).fetchall()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            source_id = f"{row['path']}#chunk-{row['chunk_index']}"
            record = {
                "source_id": source_id,
                "path": row["path"],
                "chunk_index": row["chunk_index"],
                "heading_path": [p for p in row["heading_path"].split(" > ") if p],
                "start_line": row["start_line"],
                "end_line": row["end_line"],
                "token_estimate": row["token_estimate"],
                "sha256": row["sha256"],
                "text": row["content"],
            }
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Exported chunks: {len(rows)}")
    print(f"Output: {output_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite database path.")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("rebuild", help="Rebuild the SQLite index from git tracked files.").set_defaults(func=rebuild)
    sub.add_parser("stats", help="Show index statistics.").set_defaults(func=stats)

    search_parser = sub.add_parser("search", help="Search indexed files.")
    search_parser.add_argument("query")
    search_parser.add_argument("--limit", type=int, default=10)
    search_parser.set_defaults(func=search)

    note_parser = sub.add_parser("note", help="Add a durable local note.")
    note_parser.add_argument("topic")
    note_parser.add_argument("title")
    note_parser.add_argument("body")
    note_parser.add_argument("--evidence", action="append", default=[])
    note_parser.set_defaults(func=note)

    notes_parser = sub.add_parser("notes", help="List local notes.")
    notes_parser.add_argument("--limit", type=int, default=20)
    notes_parser.set_defaults(func=notes)

    export_parser = sub.add_parser("export-notes", help="Export local notes to Markdown.")
    export_parser.add_argument("--output", type=Path, default=Path("tools/project-memory/NOTES.md"))
    export_parser.set_defaults(func=export_notes)

    chunks_parser = sub.add_parser("export-chunks", help="Export indexed chunks to JSONL for embeddings.")
    chunks_parser.add_argument("--output", type=Path, default=Path("tools/project-memory/semantic-corpus.jsonl"))
    chunks_parser.set_defaults(func=export_chunks)

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
