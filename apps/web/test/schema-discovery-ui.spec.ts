import type { PhysicalSchemaSnapshot, SchemaDriftEvent } from "@data-agent/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhysicalSchemaBrowser } from "../src/components/semantic/physical-schema-browser";
import { PhysicalSchemaDiff } from "../src/components/semantic/physical-schema-diff";
import { PhysicalSchemaTree } from "../src/components/semantic/physical-schema-tree";

const hashA = `sha256:${"a".repeat(64)}` as const;
const hashB = `sha256:${"b".repeat(64)}` as const;
const snapshot: PhysicalSchemaSnapshot = {
  schema_version: "physical-schema-snapshot@1.0.0",
  snapshot_id: "00000000-0000-4000-8000-000000000001",
  scan_run_id: "00000000-0000-4000-8000-000000000002",
  snapshot_content_hash: hashA,
  captured_at: "2026-08-09T00:00:00.000Z",
  content: {
    schema_version: "physical-schema-content@1.0.0",
    datasource_id: "warehouse-primary",
    datasource_fingerprint: hashA,
    engine: "postgresql",
    engine_version: { major: 17, minor: 4 },
    database_identity: { database_name: "warehouse", database_oid: 16_384 },
    included_schemas: ["public"],
    relations: [
      {
        identity: { schema_name: "public", relation_name: "orders" },
        relation_kind: "TABLE",
        comment: "Order facts",
        columns: [
          {
            column_name: "id",
            ordinal_position: 1,
            formatted_type: "bigint",
            type_identity: {
              type_schema: "pg_catalog",
              type_name: "int8",
              type_kind: "BASE",
              array_dimensions: 0,
            },
            nullable: false,
            default_expression: null,
            identity_generation: null,
            generated_expression: null,
            comment: "Physical identifier",
          },
        ],
        primary_key: {
          constraint_name: "orders_pkey",
          columns: ["id"],
          deferrable: false,
          initially_deferred: false,
        },
        foreign_keys: [],
        unique_constraints: [],
        check_constraints: [],
        indexes: [],
      },
    ],
  },
};
const drift: SchemaDriftEvent = {
  schema_version: "schema-drift-event@1.0.0",
  drift_event_id: "00000000-0000-4000-8000-000000000003",
  datasource_id: "warehouse-primary",
  datasource_fingerprint: hashA,
  base_snapshot_content_hash: hashB,
  current_snapshot_content_hash: hashA,
  observed_at: "2026-08-09T00:01:00.000Z",
  severity: "WARNING",
  binding_impact: "UNKNOWN",
  operations: [
    {
      operation_kind: "COLUMN_ADDED",
      severity: "INFO",
      identity: {
        relation: { schema_name: "public", relation_name: "orders" },
        column_name: "id",
      },
      after: snapshot.content.relations[0]?.columns[0] as NonNullable<
        (typeof snapshot.content.relations)[number]
      >["columns"][number],
    },
  ],
};

describe("physical schema UI", () => {
  it("labels the browser as physical evidence that is not published semantic meaning", () => {
    const html = renderToStaticMarkup(createElement(PhysicalSchemaBrowser));

    expect(html).toContain("物理证据，未发布为业务语义");
    expect(html).toContain("不会自动成为 Join、实体或指标定义");
  });

  it("renders structured relations and content-hash provenance", () => {
    const html = renderToStaticMarkup(createElement(PhysicalSchemaTree, { snapshot }));

    expect(html).toContain('data-snapshot-content-hash="sha256:aaaaaaaa');
    expect(html).toContain("Physical Schema");
    expect(html).toContain("public");
    expect(html).toContain("orders");
    expect(html).toContain("bigint");
  });

  it("renders deterministic drift operations with both snapshot hashes", () => {
    const html = renderToStaticMarkup(createElement(PhysicalSchemaDiff, { drift }));

    expect(html).toContain('data-current-snapshot-content-hash="sha256:aaaaaaaa');
    expect(html).toContain('data-base-snapshot-content-hash="sha256:bbbbbbbb');
    expect(html).toContain("COLUMN_ADDED");
    expect(html).toContain("public.orders.id");
    expect(html).toContain("Binding impact UNKNOWN");
  });
});
