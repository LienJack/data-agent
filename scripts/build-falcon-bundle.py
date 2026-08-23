#!/usr/bin/env python3
"""Build the fixed Falcon PostgreSQL seed bundle from an audited local snapshot."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import shutil
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Iterable

SOURCE_COMMIT = "8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5"
DATASET_VERSION = "falcon-fixed-8ff29caa-postgres-v1"
CASE_NAMESPACE = uuid.UUID("078ef908-a35d-58e8-af75-184ed7cf26a7")
EXPECTED_FILE_HASHES = {
    "LICENSE": "ead5038abadd0e0a158cb11a084002da5f88621c54261d2a9964ca36a4d9b42c",
    "LEGAL.md": "adba50d9794b9ef3f7ec8cbc680f7f1fa3fbf9df0ac8d1f9b9ccab6d941bc11b",
    "dev_data/dev.json": "673a0d7a014139bcfbec3b65f582066ec4d5bd2ba6e913377990edea5ab21c8b",
    "dev_data/tables.json": "9d76594b6aaf2305f6d6fe98e3d2ed302d1674f3f677276f0524a98d64d2ac77",
}
NULL_MARKER = "__FALCON_NULL_8FF29CAA__"


def sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def content_hash(value: Any) -> str:
    return sha256_bytes(canonical_bytes(value))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def quote_identifier(value: str) -> str:
    if not value or "\x00" in value:
        raise ValueError("FALCON_IDENTIFIER_INVALID")
    return f'"{value.replace(chr(34), chr(34) * 2)}"'


def postgres_type(declared: str) -> str:
    normalized = declared.strip().upper()
    if "INT" in normalized:
        return "bigint"
    if any(token in normalized for token in ("REAL", "FLOA", "DOUB")):
        return "double precision"
    if "BLOB" in normalized or normalized == "":
        return "bytea" if "BLOB" in normalized else "text"
    if any(token in normalized for token in ("NUM", "DEC")):
        return "numeric"
    return "text"


def normalize_cell(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float)):
        return value
    if isinstance(value, bytes):
        return f"hex:{value.hex()}"
    return str(value)


def csv_cell(value: Any) -> str:
    if value is None:
        return NULL_MARKER
    if isinstance(value, bytes):
        return f"\\x{value.hex()}"
    rendered = str(value)
    if rendered == NULL_MARKER:
        raise ValueError("FALCON_NULL_MARKER_COLLISION")
    return rendered


def table_names(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name"
    ).fetchall()
    return [str(row[0]) for row in rows]


def render_database_bundle(sqlite_path: Path, db_id: int) -> tuple[bytes, dict[str, Any]]:
    schema_name = f"falcon_db_{db_id:02d}"
    connection = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    statements: list[str] = [
        "\\set ON_ERROR_STOP on",
        "begin;",
        f"create schema if not exists {quote_identifier(schema_name)};",
    ]
    digest_material: list[Any] = []
    total_rows = 0
    total_columns = 0
    total_nulls = 0
    tables = table_names(connection)

    for table_name in tables:
        pragma_table = quote_identifier(table_name)
        columns = connection.execute(f"pragma table_info({pragma_table})").fetchall()
        if not columns:
            raise ValueError(f"FALCON_TABLE_WITHOUT_COLUMNS:{db_id}:{table_name}")
        total_columns += len(columns)
        column_definitions = []
        primary_columns: list[tuple[int, str]] = []
        for column in columns:
            name = str(column["name"])
            definition = f"{quote_identifier(name)} {postgres_type(str(column['type']))}"
            if int(column["notnull"]) == 1:
                definition += " not null"
            column_definitions.append(definition)
            if int(column["pk"]) > 0:
                primary_columns.append((int(column["pk"]), name))
        if primary_columns:
            ordered_primary = ", ".join(
                quote_identifier(name) for _, name in sorted(primary_columns)
            )
            column_definitions.append(f"primary key ({ordered_primary})")
        qualified = f"{quote_identifier(schema_name)}.{quote_identifier(table_name)}"
        statements.append(f"drop table if exists {qualified} cascade;")
        statements.append(f"create table {qualified} ({', '.join(column_definitions)});")
        column_names = [str(column["name"]) for column in columns]
        rendered_columns = ", ".join(quote_identifier(name) for name in column_names)
        statements.append(
            f"copy {qualified} ({rendered_columns}) from stdin with (format csv, null '{NULL_MARKER}');"
        )

        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        query = f"select * from {quote_identifier(table_name)} order by rowid"
        try:
            rows: Iterable[sqlite3.Row] = connection.execute(query)
        except sqlite3.OperationalError:
            rows = connection.execute(f"select * from {quote_identifier(table_name)}")
        table_rows = 0
        for row in rows:
            values = [row[index] for index in range(len(column_names))]
            writer.writerow([csv_cell(value) for value in values])
            normalized = [normalize_cell(value) for value in values]
            total_nulls += sum(value is None for value in values)
            digest_material.append([table_name, normalized])
            table_rows += 1
        total_rows += table_rows
        statements.append(output.getvalue().rstrip("\n"))
        statements.append("\\.")
        statements.append(f"analyze {qualified};")
    statements.extend(["commit;", ""])
    connection.close()
    sql_bytes = "\n".join(statements).encode("utf-8")
    compressed = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=compressed, mtime=0, compresslevel=9) as handle:
        handle.write(sql_bytes)
    return compressed.getvalue(), {
        "db_id": db_id,
        "schema_name": schema_name,
        "relative_path": f"bundles/{schema_name}.sql.gz",
        "source_sqlite_sha256": sha256_file(sqlite_path),
        "bundle_sha256": sha256_bytes(compressed.getvalue()),
        "bundle_bytes": len(compressed.getvalue()),
        "table_count": len(tables),
        "column_count": total_columns,
        "row_count": total_rows,
        "null_count": total_nulls,
        "content_digest": content_hash(digest_material),
    }


def convert_schema(source: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "name": table["table_name"],
            "columns": [
                {
                    "name": column["column_name"],
                    "data_type": postgres_type(str(column.get("column_type", ""))),
                    "nullable": True,
                    "primary_key": False,
                }
                for column in table["columns"]
            ],
        }
        for table in source["tables"]
    ]


def case_difficulty(case: dict[str, Any], table_count: int) -> str:
    sql = "\n".join(str(value) for value in case.get("SQL", []))
    advanced = sum(
        token in sql.upper()
        for token in (" JOIN ", " GROUP BY ", " HAVING ", " OVER ", "WITH ", " UNION ", "CASE ")
    )
    if advanced >= 4 or table_count >= 7:
        return "challenging"
    if advanced >= 2 or table_count >= 3:
        return "moderate"
    return "simple"


def source_answer_to_expected(answer: dict[str, list[Any]], ordered: bool) -> dict[str, Any]:
    columns = list(answer.keys())
    lengths = {len(answer[column]) for column in columns}
    if len(lengths) > 1:
        raise ValueError("FALCON_EXPECTED_COLUMN_LENGTH_MISMATCH")
    row_count = next(iter(lengths), 0)
    return {
        "columns": columns,
        "rows": [
            [normalize_cell(answer[column][row_index]) for column in columns]
            for row_index in range(row_count)
        ],
        "ordered": ordered,
    }


def build_cases(
    dev_cases: list[dict[str, Any]],
    test_cases: list[dict[str, Any]],
    table_catalog: dict[int, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    demo_keys = {
        (int(case["db_id"]), int(case["question_id"]))
        for case in [item for item in dev_cases if int(item["db_id"]) == 24][:10]
    }
    holdout_candidates = [
        case
        for case in dev_cases
        if (int(case["db_id"]), int(case["question_id"])) not in demo_keys
    ][-5:]
    holdout_keys = {
        (int(case["db_id"]), int(case["question_id"])) for case in holdout_candidates
    }
    public_cases: list[dict[str, Any]] = []
    sealed_cases: list[dict[str, Any]] = []
    public_test_cases: list[dict[str, Any]] = []

    for ordinal, (split, case) in enumerate(
        [("dev", value) for value in dev_cases] + [("test", value) for value in test_cases]
    ):
        db_id = int(case["db_id"])
        question_id = int(case["question_id"])
        key = (db_id, question_id)
        if split == "test":
            registry = "OFFICIAL_TEST_BLIND"
        elif key in demo_keys:
            registry = "DEMO"
        elif key in holdout_keys:
            registry = "LOCAL_HOLDOUT"
        else:
            registry = "TUNING"
        schema = convert_schema(table_catalog[db_id])
        public_draft = {
            "case_id": str(uuid.uuid5(CASE_NAMESPACE, f"falcon:{split}:{db_id}:{question_id}")),
            "suite_id": "falcon",
            "suite_version": "1.0.0",
            "dataset_version": DATASET_VERSION,
            "ordinal": ordinal,
            "database_id": f"falcon_db_{db_id:02d}",
            "question": str(case["question"]),
            "evidence": (
                f"Falcon 固定快照 {SOURCE_COMMIT[:8]}；db_id={db_id}；"
                f"question_id={question_id}；{len(schema)} 张表。"
            ),
            "difficulty": case_difficulty(case, len(schema)),
            "capabilities": ["TEXT_TO_SQL", "DATA_AGENT_END_TO_END"],
            "registry": registry,
            "schema": schema,
            "runnable": True,
            "status_reason": None,
        }
        public_case = {**public_draft, "public_case_hash": content_hash(public_draft)}
        public_cases.append(public_case)
        if split == "test":
            public_test_cases.append(public_case)
            continue
        answers = case.get("answer") or []
        if not answers:
            raise ValueError(f"FALCON_DEV_CASE_WITHOUT_EXPECTED:{db_id}:{question_id}")
        sealed_draft = {
            "public_case": public_case,
            "expected_results": [
                source_answer_to_expected(answer, str(case.get("is_order", "0")) == "1")
                for answer in answers
            ],
            "source_gold_sql": [str(sql) for sql in case.get("SQL", [])],
        }
        sealed_cases.append({**sealed_draft, "sealed_case_hash": content_hash(sealed_draft)})
    return public_cases, sealed_cases, public_test_cases


def compatibility_fixtures(sealed_cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    predicates = [" WHERE ", "COUNT(", " JOIN ", "ORDER BY", "WITH "]
    fixtures: list[dict[str, Any]] = []
    used: set[str] = set()
    for predicate in predicates:
        for case in sealed_cases:
            sql = "\n".join(case["source_gold_sql"]).upper()
            case_id = case["public_case"]["case_id"]
            if predicate in sql and case_id not in used:
                fixtures.append(
                    {
                        "fixture_kind": predicate.strip(),
                        "public_case": case["public_case"],
                        "expected_results": case["expected_results"],
                        "is_order": case["expected_results"][0]["ordered"],
                    }
                )
                used.add(case_id)
                break
    if len(fixtures) != 5:
        raise ValueError("FALCON_COMPATIBILITY_FIXTURE_COUNT_INVALID")
    return fixtures


def verify_fixed_source(source: Path) -> None:
    for relative_path, expected in EXPECTED_FILE_HASHES.items():
        actual = sha256_file(source / relative_path)
        if actual != f"sha256:{expected}":
            raise ValueError(f"FALCON_SOURCE_DIGEST_MISMATCH:{relative_path}:{actual}")
    if not (source / "test_data/test.json").is_file():
        raise ValueError("FALCON_TEST_MANIFEST_MISSING")


def discover_sqlite(source: Path) -> dict[int, Path]:
    paths = list(source.glob("dev_data/dev_databases/*/*.sqlite")) + list(
        source.glob("test_data/test_databases/*/*.sqlite")
    )
    result = {int(path.stem): path for path in paths}
    if sorted(result) != list(range(1, 29)) or len(paths) != 28:
        raise ValueError("FALCON_SQLITE_SET_INVALID")
    return result


def build(source: Path, output: Path) -> None:
    verify_fixed_source(source)
    dev_cases = json.loads((source / "dev_data/dev.json").read_text(encoding="utf-8"))
    test_cases = json.loads((source / "test_data/test.json").read_text(encoding="utf-8"))
    if len(dev_cases) != 309 or len(test_cases) != 191:
        raise ValueError("FALCON_CASE_COUNT_INVALID")
    tables = json.loads((source / "dev_data/tables.json").read_text(encoding="utf-8")) + json.loads(
        (source / "test_data/tables.json").read_text(encoding="utf-8")
    )
    table_catalog = {
        int(item["db_id"]): item for item in tables if str(item.get("db_id", "")).strip()
    }
    if sorted(table_catalog) != list(range(1, 29)):
        raise ValueError("FALCON_TABLE_CATALOG_INVALID")

    output.mkdir(parents=True, exist_ok=True)
    (output / "bundles").mkdir(exist_ok=True)
    shutil.copyfile(source / "LICENSE", output / "LICENSE")
    shutil.copyfile(source / "LEGAL.md", output / "LEGAL.md")
    bundle_files = []
    for db_id, sqlite_path in sorted(discover_sqlite(source).items()):
        compressed, receipt = render_database_bundle(sqlite_path, db_id)
        bundle_path = output / receipt["relative_path"]
        bundle_path.write_bytes(compressed)
        bundle_files.append(receipt)

    public_cases, sealed_cases, public_test_cases = build_cases(
        dev_cases, test_cases, table_catalog
    )
    fixtures = compatibility_fixtures(sealed_cases)
    write_json(output / "public-cases.json", public_cases)
    write_json(output / "sealed" / "dev-cases.json", sealed_cases)
    write_json(output / "test-cases.json", public_test_cases)
    write_json(output / "compatibility-fixtures.json", fixtures)
    source_material = [
        *(f"{item['relative_path']}:{item['bundle_sha256']}" for item in bundle_files),
        f"public-cases.json:{sha256_file(output / 'public-cases.json')}",
        f"sealed/dev-cases.json:{sha256_file(output / 'sealed' / 'dev-cases.json')}",
        f"test-cases.json:{sha256_file(output / 'test-cases.json')}",
        f"compatibility-fixtures.json:{sha256_file(output / 'compatibility-fixtures.json')}",
    ]
    manifest = {
        "manifest_version": "falcon-source-manifest@1.0.0",
        "suite_version": "1.0.0",
        "dataset_version": DATASET_VERSION,
        "repository_url": "https://github.com/eosphoros-ai/Falcon",
        "source_commit": SOURCE_COMMIT,
        "license_spdx_id": "Apache-2.0",
        "dev_case_count": 309,
        "test_case_count": 191,
        "case_count": 500,
        "database_count": 28,
        "demo_case_count": 10,
        "tuning_case_count": 294,
        "local_holdout_case_count": 5,
        "official_test_case_count": 191,
        "main_demo_db_id": 24,
        "smoke_db_id": 14,
        "files": bundle_files,
        "public_cases_sha256": sha256_file(output / "public-cases.json"),
        "sealed_cases_sha256": sha256_file(output / "sealed" / "dev-cases.json"),
        "test_cases_sha256": sha256_file(output / "test-cases.json"),
        "compatibility_fixtures_sha256": sha256_file(output / "compatibility-fixtures.json"),
        "source_digest": sha256_bytes("\n".join(source_material).encode("utf-8")),
    }
    write_json(output / "source-manifest.json", manifest)
    checksum_paths = [
        Path("LICENSE"),
        Path("LEGAL.md"),
        Path("source-manifest.json"),
        Path("public-cases.json"),
        Path("sealed/dev-cases.json"),
        Path("test-cases.json"),
        Path("compatibility-fixtures.json"),
        *(Path(item["relative_path"]) for item in bundle_files),
    ]
    (output / "bundle-checksums.sha256").write_text(
        "".join(
            f"{sha256_file(output / relative_path).removeprefix('sha256:')}  {relative_path.as_posix()}\n"
            for relative_path in checksum_paths
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "terminal": "SUCCEEDED",
                "reason_code": "FALCON_BUNDLE_BUILT",
                "source_digest": manifest["source_digest"],
                "database_count": 28,
                "case_count": 500,
                "bundle_bytes": sum(item["bundle_bytes"] for item in bundle_files),
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("infra/falcon/v1"))
    arguments = parser.parse_args()
    build(arguments.source.resolve(), arguments.output.resolve())


if __name__ == "__main__":
    main()
