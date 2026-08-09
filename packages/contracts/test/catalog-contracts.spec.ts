import { describe, expect, it } from "vitest";
import {
  physicalSchemaSnapshotSchema,
  schemaDriftEventSchema,
  schemaScanRequestSchema,
} from "../src/catalog/index.js";

const ids = {
  snapshot: "00000000-0000-4000-8000-000000000001",
  scan: "00000000-0000-4000-8000-000000000002",
  idempotency: "00000000-0000-4000-8000-000000000003",
  drift: "00000000-0000-4000-8000-000000000004",
} as const;
const hash = `sha256:${"a".repeat(64)}`;

function request() {
  return {
    schema_version: "schema-scan-request@1.0.0",
    datasource_id: "warehouse-primary",
    include_schemas: ["analytics", "public"],
    page_size: 250,
    statement_timeout_ms: 10_000,
    idempotency_key: ids.idempotency,
  } as const;
}

function snapshot() {
  return {
    schema_version: "physical-schema-snapshot@1.0.0",
    snapshot_id: ids.snapshot,
    scan_run_id: ids.scan,
    snapshot_content_hash: hash,
    captured_at: "2026-08-08T08:00:00.000Z",
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: "warehouse-primary",
      datasource_fingerprint: hash,
      engine: "postgresql",
      engine_version: { major: 17, minor: 4 },
      database_identity: { database_name: "warehouse", database_oid: 16_384 },
      included_schemas: ["public"],
      relations: [],
    },
  } as const;
}

describe("catalog contracts", () => {
  it("accepts only a strict, versioned, authority-free scan request", () => {
    expect(schemaScanRequestSchema.parse(request())).toEqual(request());
    for (const forbidden of [
      "app_id",
      "tenant_id",
      "environment",
      "principal",
      "role",
      "password",
      "dsn",
      "sql",
      "snapshot_content_hash",
    ]) {
      expect(() =>
        schemaScanRequestSchema.parse({ ...request(), [forbidden]: "attacker" }),
      ).toThrow();
    }
  });

  it("rejects unknown snapshot facts at every parsed boundary", () => {
    expect(physicalSchemaSnapshotSchema.parse(snapshot())).toEqual(snapshot());
    expect(() =>
      physicalSchemaSnapshotSchema.parse({
        ...snapshot(),
        content: { ...snapshot().content, semantic_status: "PUBLISHED" },
      }),
    ).toThrow();
  });

  it("keeps drift binding impact unknown", () => {
    const event = {
      schema_version: "schema-drift-event@1.0.0",
      drift_event_id: ids.drift,
      datasource_id: "warehouse-primary",
      datasource_fingerprint: hash,
      base_snapshot_content_hash: hash,
      current_snapshot_content_hash: `sha256:${"b".repeat(64)}`,
      observed_at: "2026-08-08T08:01:00.000Z",
      severity: "NONE",
      binding_impact: "UNKNOWN",
      operations: [],
    } as const;
    expect(schemaDriftEventSchema.parse(event)).toEqual(event);
    expect(() => schemaDriftEventSchema.parse({ ...event, binding_impact: "AFFECTED" })).toThrow();
  });
});
