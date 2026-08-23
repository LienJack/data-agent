import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type PhysicalSchemaSnapshot,
  type SemanticGraphSource,
  type SemanticRelationship,
  type SemanticSourceBundle,
  semanticSourceBundleSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { adaptPgCatalogPool, createPostgresCatalogScanner } from "@data-agent/platform";
import { createSemanticOntologyCoverageReceipt } from "@data-agent/semantic/authoring";
import {
  compileSemanticGraphV2,
  type SemanticGraphCompilation,
} from "@data-agent/semantic/governance";
import type { Pool } from "pg";
import { buildEcommerceGraphV2, type EcommerceGraphJoinEvidence } from "./ecommerce-graph-v2";

export const ECOMMERCE_GRAPH_V2_IDS = Object.freeze({
  graph: "00000000-0000-4000-8000-00000000ec40",
  snapshot: "00000000-0000-4000-8000-00000000ec41",
  scanRun: "00000000-0000-4000-8000-00000000ec42",
  release: "00000000-0000-4000-8000-00000000ec45",
  sourceRevision: "00000000-0000-4000-8000-00000000ec49",
  graphProjection: "00000000-0000-4000-8000-00000000ec4a",
});

const DATASOURCE_ID = "00000000-0000-4000-8000-00000000ec01";
const SCHEMA_NAME = "demo_adb_ecommerce_mart";
const CAPTURED_AT = "2026-08-16T00:00:00.000Z";

function repositoryRoot(): string {
  const cwd = resolve(process.cwd());
  return basename(cwd) === "web" && basename(resolve(cwd, "..")) === "apps"
    ? resolve(cwd, "../..")
    : cwd;
}

export async function loadEcommerceSemanticBundle(): Promise<SemanticSourceBundle> {
  const path = resolve(
    repositoryRoot(),
    "infra/agenticdatabench/ecommerce-v1/semantic/ecommerce-source-bundle.json",
  );
  return semanticSourceBundleSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(value)) {
    throw new Error("ECOMMERCE_GRAPH_IDENTIFIER_INVALID");
  }
  return `"${value}"`;
}

function relationshipColumns(relationship: SemanticRelationship): {
  readonly left_table: string;
  readonly left_column: string;
  readonly right_table: string;
  readonly right_column: string;
} {
  if (relationship.left_column_ids.length !== 1 || relationship.right_column_ids.length !== 1) {
    throw new Error(`ECOMMERCE_GRAPH_JOIN_ARITY_UNSUPPORTED:${relationship.relationship_id}`);
  }
  const left = relationship.left_column_ids[0]?.split(".");
  const right = relationship.right_column_ids[0]?.split(".");
  if (
    left?.length !== 2 ||
    right?.length !== 2 ||
    left[0] !== relationship.left_table_id ||
    right[0] !== relationship.right_table_id
  ) {
    throw new Error(`ECOMMERCE_GRAPH_JOIN_LOCATOR_INVALID:${relationship.relationship_id}`);
  }
  return {
    left_table: left[0],
    left_column: left[1] ?? "",
    right_table: right[0],
    right_column: right[1] ?? "",
  };
}

interface JoinObservationRow {
  readonly left_non_null_rows: string;
  readonly orphan_rows: string;
  readonly right_duplicate_keys: string;
}

async function certifyJoin(
  pool: Pool,
  relationship: SemanticRelationship,
  snapshot: PhysicalSchemaSnapshot,
): Promise<EcommerceGraphJoinEvidence> {
  const columns = relationshipColumns(relationship);
  const schema = identifier(SCHEMA_NAME);
  const leftTable = `${schema}.${identifier(columns.left_table)}`;
  const rightTable = `${schema}.${identifier(columns.right_table)}`;
  const leftColumn = identifier(columns.left_column);
  const rightColumn = identifier(columns.right_column);
  const result = await pool.query<JoinObservationRow>(
    `with right_keys as (
       select ${rightColumn} as join_key, count(*)::bigint as row_count
         from ${rightTable}
        where ${rightColumn} is not null
        group by ${rightColumn}
     ), left_observation as (
       select count(*) filter (where left_row.${leftColumn} is not null)::bigint as left_non_null_rows,
              count(*) filter (
                where left_row.${leftColumn} is not null and right_row.join_key is null
              )::bigint as orphan_rows
         from ${leftTable} as left_row
         left join right_keys as right_row on right_row.join_key = left_row.${leftColumn}
     )
     select left_observation.left_non_null_rows::text,
            left_observation.orphan_rows::text,
            coalesce((select count(*) from right_keys where row_count > 1), 0)::text
              as right_duplicate_keys
       from left_observation`,
  );
  const observation = result.rows[0];
  if (!observation) throw new Error("ECOMMERCE_GRAPH_JOIN_OBSERVATION_MISSING");
  if (observation.right_duplicate_keys !== "0") {
    throw new Error(
      `ECOMMERCE_GRAPH_JOIN_NOT_CERTIFIED:${relationship.relationship_id}:duplicate=${observation.right_duplicate_keys}`,
    );
  }
  const observationPayload = {
    relationship_id: relationship.relationship_id,
    snapshot_content_hash: snapshot.snapshot_content_hash,
    left_non_null_rows: observation.left_non_null_rows,
    orphan_rows: observation.orphan_rows,
    right_duplicate_keys: observation.right_duplicate_keys,
  };
  return {
    content_hash: await sha256ContentHash(observationPayload),
    description: `${relationship.name}: left_non_null=${observation.left_non_null_rows}, orphan=${observation.orphan_rows}, right_duplicate_keys=0; preserve left rows with LEFT JOIN`,
  };
}

export interface PreparedEcommerceGraphV2 {
  readonly bundle: SemanticSourceBundle;
  readonly snapshot: PhysicalSchemaSnapshot;
  readonly source_graph: SemanticGraphSource;
  readonly compilation: SemanticGraphCompilation;
  readonly coverage_receipt: Awaited<ReturnType<typeof createSemanticOntologyCoverageReceipt>>;
}

export async function prepareEcommerceGraphV2(input: {
  readonly pool: Pool;
  readonly scope: SemanticGraphSource["metadata"]["scope"];
  readonly base_release_id: string;
}): Promise<PreparedEcommerceGraphV2> {
  const bundle = await loadEcommerceSemanticBundle();
  const datasourceFingerprint = await sha256ContentHash({
    datasource_id: DATASOURCE_ID,
    database: "data_agent",
    schema_name: SCHEMA_NAME,
  });
  const scan = await createPostgresCatalogScanner(adaptPgCatalogPool(input.pool)).scan({
    request: {
      schema_version: "schema-scan-request@1.0.0",
      datasource_id: DATASOURCE_ID,
      include_schemas: [SCHEMA_NAME],
      page_size: 100,
      statement_timeout_ms: 60_000,
      idempotency_key: randomUUID(),
    },
    datasource_fingerprint: datasourceFingerprint,
    snapshot_id: ECOMMERCE_GRAPH_V2_IDS.snapshot,
    scan_run_id: ECOMMERCE_GRAPH_V2_IDS.scanRun,
    captured_at: CAPTURED_AT,
  });
  if (!scan.ok) throw new Error(scan.error.code);

  const joinEvidence = Object.fromEntries(
    await Promise.all(
      bundle.relationships.map(async (relationship) => [
        relationship.relationship_id,
        await certifyJoin(input.pool, relationship, scan.value),
      ]),
    ),
  );
  const sourceGraph = await buildEcommerceGraphV2({
    bundle,
    snapshot: scan.value,
    graph_id: ECOMMERCE_GRAPH_V2_IDS.graph,
    base_release_id: input.base_release_id,
    scope: input.scope,
    created_at: CAPTURED_AT,
    join_evidence: joinEvidence,
  });
  const compilation = await compileSemanticGraphV2(sourceGraph);
  const coverageReceipt = await createSemanticOntologyCoverageReceipt(sourceGraph, CAPTURED_AT);
  if (!coverageReceipt.valid) throw new Error("ECOMMERCE_GRAPH_ONTOLOGY_COVERAGE_INVALID");
  return Object.freeze({
    bundle,
    snapshot: scan.value,
    source_graph: sourceGraph,
    compilation,
    coverage_receipt: coverageReceipt,
  });
}
