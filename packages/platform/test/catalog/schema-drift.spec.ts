import type { PhysicalRelation, PhysicalSchemaSnapshotDraft } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPhysicalSchemaSnapshot } from "../../src/catalog/physical-schema.js";
import { comparePhysicalSchemaSnapshots } from "../../src/catalog/schema-drift.js";

const fingerprint = `sha256:${"a".repeat(64)}` as const;
const ids = {
  baseSnapshot: "00000000-0000-4000-8000-000000000001",
  currentSnapshot: "00000000-0000-4000-8000-000000000002",
  baseScan: "00000000-0000-4000-8000-000000000003",
  currentScan: "00000000-0000-4000-8000-000000000004",
  drift: "00000000-0000-4000-8000-000000000005",
} as const;

function column(name: string, ordinal: number, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function orders(): PhysicalRelation {
  return {
    identity: { schema_name: "public", relation_name: "orders" },
    relation_kind: "TABLE",
    comment: null,
    columns: [column("id", 1), column("customer_id", 2), column("legacy", 3)],
    primary_key: {
      constraint_name: "orders_pkey",
      columns: ["id"],
      deferrable: false,
      initially_deferred: false,
    },
    foreign_keys: [],
    unique_constraints: [],
    check_constraints: [
      { constraint_name: "orders_id_check", expression: "id > 0", no_inherit: false },
    ],
    indexes: [
      {
        index_name: "orders_customer_idx",
        access_method: "btree",
        unique: false,
        valid: true,
        ready: true,
        key_expressions: ["customer_id"],
        included_columns: [],
        predicate: null,
      },
    ],
  };
}

function relation(name: string): PhysicalRelation {
  return {
    ...orders(),
    identity: { schema_name: "public", relation_name: name },
    columns: [column("id", 1)],
    primary_key: null,
    check_constraints: [],
    indexes: [],
  };
}

function draft(
  snapshotId: string,
  scanRunId: string,
  relations: PhysicalRelation[],
): PhysicalSchemaSnapshotDraft {
  return {
    schema_version: "physical-schema-snapshot-draft@1.0.0",
    snapshot_id: snapshotId,
    scan_run_id: scanRunId,
    captured_at: "2026-08-08T08:00:00.000Z",
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: "warehouse-primary",
      datasource_fingerprint: fingerprint,
      engine: "postgresql",
      engine_version: { major: 17, minor: 4 },
      database_identity: { database_name: "warehouse", database_oid: 16_384 },
      included_schemas: ["public"],
      relations,
    },
  };
}

describe("schema drift", () => {
  it("detects exhaustive physical changes with stable ordering and no rename guess", async () => {
    const base = await createPhysicalSchemaSnapshot(
      draft(ids.baseSnapshot, ids.baseScan, [orders(), relation("legacy_table")]),
    );
    const changedOrders = orders();
    changedOrders.columns = [
      column("id", 1),
      column("customer_id", 2, {
        formatted_type: "bigint",
        type_identity: {
          type_schema: "pg_catalog",
          type_name: "int8",
          type_kind: "BASE",
          array_dimensions: 0,
        },
        nullable: true,
      }),
      column("renamed", 3),
    ];
    const primaryKey = changedOrders.primary_key;
    const checkConstraint = changedOrders.check_constraints[0];
    const index = changedOrders.indexes[0];
    if (!primaryKey || !checkConstraint || !index) throw new Error("invalid fixture");
    changedOrders.primary_key = { ...primaryKey, columns: ["id", "customer_id"] };
    changedOrders.foreign_keys = [
      {
        constraint_name: "orders_customer_fkey",
        referenced_relation: { schema_name: "public", relation_name: "customers" },
        column_pairs: [{ column_name: "customer_id", referenced_column_name: "id" }],
        match_type: "SIMPLE",
        on_update: "NO_ACTION",
        on_delete: "RESTRICT",
        deferrable: false,
        initially_deferred: false,
      },
    ];
    changedOrders.unique_constraints = [
      {
        constraint_name: "orders_customer_key",
        columns: ["customer_id"],
        nulls_not_distinct: false,
        deferrable: false,
        initially_deferred: false,
      },
    ];
    checkConstraint.expression = "id >= 0";
    index.predicate = "customer_id IS NOT NULL";
    const current = await createPhysicalSchemaSnapshot(
      draft(ids.currentSnapshot, ids.currentScan, [relation("replacement_table"), changedOrders]),
    );

    const drift = comparePhysicalSchemaSnapshots(base, current, {
      drift_event_id: ids.drift,
      observed_at: "2026-08-08T08:01:00.000Z",
    });
    expect(drift.operations.map((operation) => operation.operation_kind)).toEqual([
      "CHECK_CONSTRAINT_CHANGED",
      "COLUMN_ADDED",
      "COLUMN_NULLABILITY_CHANGED",
      "COLUMN_REMOVED",
      "COLUMN_TYPE_CHANGED",
      "FOREIGN_KEY_ADDED",
      "INDEX_CHANGED",
      "PRIMARY_KEY_CHANGED",
      "RELATION_ADDED",
      "RELATION_REMOVED",
      "UNIQUE_CONSTRAINT_ADDED",
    ]);
    expect(drift.binding_impact).toBe("UNKNOWN");
    expect(drift.severity).toBe("BREAKING");
  });

  it("ignores observation envelope changes and rejects cross-datasource comparison", async () => {
    const base = await createPhysicalSchemaSnapshot(
      draft(ids.baseSnapshot, ids.baseScan, [orders()]),
    );
    const currentDraft = draft(ids.currentSnapshot, ids.currentScan, [orders()]);
    currentDraft.captured_at = "2026-08-08T09:00:00.000Z";
    const current = await createPhysicalSchemaSnapshot(currentDraft);
    expect(
      comparePhysicalSchemaSnapshots(base, current, {
        drift_event_id: ids.drift,
        observed_at: "2026-08-08T09:00:00.000Z",
      }).operations,
    ).toEqual([]);

    const otherDraft = draft(ids.currentSnapshot, ids.currentScan, [orders()]);
    otherDraft.content.datasource_fingerprint = `sha256:${"b".repeat(64)}`;
    const other = await createPhysicalSchemaSnapshot(otherDraft);
    expect(() =>
      comparePhysicalSchemaSnapshots(base, other, {
        drift_event_id: ids.drift,
        observed_at: "2026-08-08T09:00:00.000Z",
      }),
    ).toThrowError(/同一 datasource fingerprint/);
  });
});
