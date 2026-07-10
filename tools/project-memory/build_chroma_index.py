#!/usr/bin/env python3
"""Build and query a local Chroma index from exported project-memory chunks."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any


DEFAULT_CONFIG = Path("tools/project-memory/rag-system.json")
DEFAULT_CORPUS = Path("tools/project-memory/semantic-corpus.jsonl")
DEFAULT_INDEX_PATH = Path("tools/project-memory/vector-index/chroma")
DEFAULT_COLLECTION = "project-memory-v1"
BATCH_SIZE = 300


def load_chroma():
    try:
        import chromadb  # type: ignore[import-not-found]
    except ImportError as exc:
        raise SystemExit(
            "ChromaDB is required for this adapter. Install it in the active "
            "environment or run with a temporary dependency, for example: "
            "uv run --with chromadb python .\\tools\\project-memory\\build_chroma_index.py status"
        ) from exc
    return chromadb


def repo_root() -> Path:
    current = Path.cwd().resolve()
    for path in [current, *current.parents]:
        if (path / ".git").exists():
            return path
    return current


def load_config(root: Path, config_path: Path) -> dict[str, Any]:
    full_path = (root / config_path).resolve()
    if not full_path.exists():
        return {}
    return json.loads(full_path.read_text(encoding="utf-8"))


def configured_collection(config: dict[str, Any]) -> str:
    vector = config.get("vector_retrieval") or {}
    embedding = config.get("embedding_metadata") or {}
    return str(vector.get("collection") or embedding.get("collection_version") or DEFAULT_COLLECTION)


def configured_index_path(config: dict[str, Any]) -> Path:
    vector = config.get("vector_retrieval") or {}
    return Path(str(vector.get("local_index_path") or DEFAULT_INDEX_PATH))


def configured_corpus_path(config: dict[str, Any]) -> Path:
    chunking = config.get("chunking") or {}
    return Path(str(chunking.get("export_path") or DEFAULT_CORPUS))


def collection_metadata(config: dict[str, Any]) -> dict[str, str]:
    embedding = config.get("embedding_metadata") or {}
    chunking = config.get("chunking") or {}
    return {
        "source": "tools/project-memory/semantic-corpus.jsonl",
        "adapter": "chroma",
        "collection_version": str(embedding.get("collection_version") or ""),
        "embedding_model_ref": str(embedding.get("model_ref") or ""),
        "embedding_provider": str(embedding.get("provider") or ""),
        "chunking": str(chunking.get("kind") or ""),
    }


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise SystemExit(
            f"No semantic corpus found at {path}. Run: "
            "python .\\tools\\project-memory\\build_project_memory_index.py export-chunks"
        )
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for lineno, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"Invalid JSONL at {path}:{lineno}: {exc}") from exc
            records.append(record)
    return records


def to_metadata(record: dict[str, Any]) -> dict[str, str | int | float | bool]:
    heading = record.get("heading_path") or []
    if isinstance(heading, list):
        heading_text = " > ".join(str(item) for item in heading)
    else:
        heading_text = str(heading)
    return {
        "path": str(record.get("path") or ""),
        "chunk_index": int(record.get("chunk_index") or 0),
        "heading_path": heading_text,
        "start_line": int(record.get("start_line") or 0),
        "end_line": int(record.get("end_line") or 0),
        "token_estimate": int(record.get("token_estimate") or 0),
        "sha256": str(record.get("sha256") or ""),
    }


def get_client(root: Path, index_path: Path):
    chromadb = load_chroma()
    full_path = (root / index_path).resolve()
    full_path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(full_path))


def get_collection(client: Any, name: str, metadata: dict[str, str]):
    return client.get_or_create_collection(name=name, metadata=metadata)


def batched(records: list[dict[str, Any]], size: int):
    for index in range(0, len(records), size):
        yield records[index : index + size]


def rebuild(args: argparse.Namespace) -> int:
    root = repo_root()
    config = load_config(root, args.config)
    corpus_path = (root / (args.corpus or configured_corpus_path(config))).resolve()
    index_path = args.index_path or configured_index_path(config)
    collection_name = args.collection or configured_collection(config)
    records = read_jsonl(corpus_path)
    client = get_client(root, index_path)
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass
    collection = get_collection(client, collection_name, collection_metadata(config))

    for batch in batched(records, BATCH_SIZE):
        collection.add(
            ids=[str(item["source_id"]) for item in batch],
            documents=[str(item["text"]) for item in batch],
            metadatas=[to_metadata(item) for item in batch],
        )

    print(f"Collection: {collection_name}")
    print(f"Records: {len(records)}")
    print(f"Index path: {(root / index_path).resolve()}")
    return 0


def update(args: argparse.Namespace) -> int:
    root = repo_root()
    config = load_config(root, args.config)
    corpus_path = (root / (args.corpus or configured_corpus_path(config))).resolve()
    index_path = args.index_path or configured_index_path(config)
    collection_name = args.collection or configured_collection(config)
    records = read_jsonl(corpus_path)
    client = get_client(root, index_path)
    collection = get_collection(client, collection_name, collection_metadata(config))

    for batch in batched(records, BATCH_SIZE):
        collection.upsert(
            ids=[str(item["source_id"]) for item in batch],
            documents=[str(item["text"]) for item in batch],
            metadatas=[to_metadata(item) for item in batch],
        )

    print(f"Collection: {collection_name}")
    print(f"Upserted records: {len(records)}")
    print(f"Index path: {(root / index_path).resolve()}")
    return 0


def query(args: argparse.Namespace) -> int:
    root = repo_root()
    config = load_config(root, args.config)
    index_path = args.index_path or configured_index_path(config)
    collection_name = args.collection or configured_collection(config)
    client = get_client(root, index_path)
    collection = get_collection(client, collection_name, collection_metadata(config))
    results = collection.query(
        query_texts=[args.query],
        n_results=max(1, min(args.limit, 20)),
        include=["documents", "metadatas", "distances"],
    )

    ids = results.get("ids", [[]])[0]
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]
    if not ids:
        print("No matches.")
        return 0

    for index, record_id in enumerate(ids, start=1):
        metadata = metadatas[index - 1] or {}
        document = " ".join(str(documents[index - 1]).split())
        excerpt = document[:240]
        distance = distances[index - 1] if index - 1 < len(distances) else ""
        path = metadata.get("path", "")
        start = metadata.get("start_line", "")
        heading = metadata.get("heading_path", "")
        suffix = f" ({heading})" if heading else ""
        print(f"{index}. {path}:{start}{suffix} distance={distance}")
        print(f"   {record_id}: {excerpt}")
    return 0


def status(args: argparse.Namespace) -> int:
    root = repo_root()
    config = load_config(root, args.config)
    index_path = args.index_path or configured_index_path(config)
    collection_name = args.collection or configured_collection(config)
    full_index_path = (root / index_path).resolve()
    if not full_index_path.exists():
        print(f"No Chroma index found at {full_index_path}")
        return 1
    client = get_client(root, index_path)
    try:
        collection = client.get_collection(collection_name)
    except Exception:
        print(f"No collection named {collection_name} at {full_index_path}")
        return 1
    print(f"Collection: {collection_name}")
    print(f"Records: {collection.count()}")
    print(f"Index path: {full_index_path}")
    return 0


def clean(args: argparse.Namespace) -> int:
    root = repo_root()
    config = load_config(root, args.config)
    index_path = args.index_path or configured_index_path(config)
    full_index_path = (root / index_path).resolve()
    if not full_index_path.exists():
        print(f"No Chroma index found at {full_index_path}")
        return 0
    if full_index_path == root or root not in full_index_path.parents:
        raise SystemExit(f"Refusing to remove path outside repository: {full_index_path}")
    shutil.rmtree(full_index_path)
    print(f"Removed Chroma index: {full_index_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--corpus", type=Path)
    parser.add_argument("--index-path", type=Path)
    parser.add_argument("--collection")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("rebuild", help="Rebuild the Chroma collection from JSONL chunks.").set_defaults(func=rebuild)
    sub.add_parser("update", help="Upsert JSONL chunks into the Chroma collection.").set_defaults(func=update)
    sub.add_parser("status", help="Show local Chroma collection status.").set_defaults(func=status)
    sub.add_parser("clean", help="Remove the generated local Chroma index directory.").set_defaults(func=clean)

    query_parser = sub.add_parser("query", help="Run semantic search through Chroma.")
    query_parser.add_argument("query")
    query_parser.add_argument("--limit", type=int, default=5)
    query_parser.set_defaults(func=query)

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
