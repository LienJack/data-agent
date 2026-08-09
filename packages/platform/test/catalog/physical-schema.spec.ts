import type { PhysicalSchemaSnapshotDraft } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  CatalogContractError,
  createPhysicalSchemaSnapshot,
} from "../../src/catalog/physical-schema.js";

const ids = {
  snapshot: "00000000-0000-4000-8000-000000000001",
  scan: "00000000-0000-4000-8000-000000000002",
} as const;
const fingerprint = `sha256:${"a".repeat(64)}` as const;

function column(name: string, ordinal: number) {
  return {
    column_name: name,
    ordinal_position: ordinal,
    formatted_type: "integer",
    type_identity: {
      type_schema: "pg_catalog",
      type_name: "int4",
      type_kind: "BASE" as const,
      array_dimensions: 0,
    },
    nullable: false,
    default_expression: null,
    identity_generation: null,
    generated_expression: null,
    comment: null,
  };
}

function relation(name: string, columns = [column("id", 1)]) {
  return {
    identity: { schema_name: "public", relation_name: name },
    relation_kind: "TABLE" as const,
    comment: null,
    columns,
    primary_key: {
      constraint_name: `${name}_pkey`,
      columns: ["id"],
      deferrable: false,
      initially_deferred: false,
    },
    foreign_keys: [],
    unique_constraints: [],
    check_constraints: [],
    indexes: [],
  };
}

function draft(): PhysicalSchemaSnapshotDraft {
  return {
    schema_version: "physical-schema-snapshot-draft@1.0.0",
    snapshot_id: ids.snapshot,
    scan_run_id: ids.scan,
    captured_at: "2026-08-08T08:00:00.000Z",
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: "warehouse-primary",
      datasource_fingerprint: fingerprint,
      engine: "postgresql",
      engine_version: { major: 17, minor: 4 },
      database_identity: { database_name: "warehouse", database_oid: 16_384 },
      included_schemas: ["sales", "public"],
      relations: [
        relation("z_orders", [column("total", 2), column("id", 1)]),
        relation("accounts"),
      ],
    },
  };
}

describe("physical schema normalization", () => {
  it("produces one content hash for the same facts regardless of source order and envelope metadata", async () => {
    const first = await createPhysicalSchemaSnapshot(draft());
    const reordered = draft();
    reordered.snapshot_id = "00000000-0000-4000-8000-000000000011";
    reordered.scan_run_id = "00000000-0000-4000-8000-000000000012";
    reordered.captured_at = "2026-08-08T09:00:00.000Z";
    reordered.content.included_schemas.reverse();
    reordered.content.relations.reverse();
    reordered.content.relations[1]?.columns.reverse();
    const second = await createPhysicalSchemaSnapshot(reordered);

    expect(second.snapshot_content_hash).toBe(first.snapshot_content_hash);
    expect(first.content.included_schemas).toEqual(["public", "sales"]);
    expect(first.content.relations.map((item) => item.identity.relation_name)).toEqual([
      "accounts",
      "z_orders",
    ]);
    expect(first.content.relations[1]?.columns.map((item) => item.column_name)).toEqual([
      "id",
      "total",
    ]);
  });

  it("fails closed on duplicate structured identities", async () => {
    const duplicateRelation = draft();
    duplicateRelation.content.relations.push(relation("accounts"));
    await expect(createPhysicalSchemaSnapshot(duplicateRelation)).rejects.toMatchObject({
      code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID",
    });

    const duplicateColumn = draft();
    duplicateColumn.content.relations[0]?.columns.push(column("id", 3));
    await expect(createPhysicalSchemaSnapshot(duplicateColumn)).rejects.toBeInstanceOf(
      CatalogContractError,
    );
  });
});
