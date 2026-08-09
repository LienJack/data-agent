import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  handleGetSchemaDiff,
  handleGetSchemaSnapshot,
  handleStartSchemaScan,
} from "../src/lib/schema-discovery-route";
import type { SchemaDiscoveryRuntime } from "../src/lib/schema-discovery-runtime";

const ids = {
  datasource: "warehouse-primary",
  scan: "00000000-0000-4000-8000-000000000001",
  snapshot: "00000000-0000-4000-8000-000000000002",
  baseSnapshot: "00000000-0000-4000-8000-000000000003",
  idempotency: "00000000-0000-4000-8000-000000000004",
} as const;
const hash = `sha256:${"a".repeat(64)}` as const;

function runtime() {
  const authority = {
    authority: "POSTGRESQL" as const,
    capabilityInput: { server: "capability" },
    scope: {
      appId: "00000000-0000-4000-8000-000000000010",
      tenantId: "00000000-0000-4000-8000-000000000011",
      environment: "test",
    },
    deploymentId: "00000000-0000-4000-8000-000000000012",
    principal: "00000000-0000-4000-8000-000000000013",
  };
  const startScan = vi.fn(async () => ({
    ok: true as const,
    value: {
      scan: {
        schema_version: "schema-scan-commit-result@1.0.0" as const,
        authority: "POSTGRESQL" as const,
        scan_run_id: ids.scan,
        snapshot_id: ids.snapshot,
        snapshot_content_hash: hash,
        terminal: "SUCCEEDED" as const,
        created: true,
      },
      snapshot: null,
      drift: null,
    },
  }));
  const getSnapshot = vi.fn(async () => ({
    ok: false as const,
    error: {
      code: "SCHEMA_SCAN_SNAPSHOT_NOT_FOUND",
      message: "not found",
      retryable: false,
    },
  }));
  const compareSnapshots = vi.fn(async () => ({
    ok: true as const,
    value: {
      schema_version: "schema-drift-event@1.0.0" as const,
      drift_event_id: ids.scan,
      datasource_id: ids.datasource,
      datasource_fingerprint: hash,
      base_snapshot_content_hash: hash,
      current_snapshot_content_hash: hash,
      observed_at: "2026-08-09T00:00:00.000Z",
      severity: "NONE" as const,
      binding_impact: "UNKNOWN" as const,
      operations: [],
    },
  }));
  const value = {
    authorityResolver: { resolve: vi.fn(async () => authority) },
    service: {
      startScan,
      getScan: vi.fn(),
      getSnapshot,
      compareSnapshots,
    },
  } as unknown as SchemaDiscoveryRuntime;
  return { value, authority, startScan, getSnapshot, compareSnapshots };
}

function scanRequest(extra: Record<string, unknown> = {}) {
  return {
    schema_version: "schema-scan-request@1.0.0",
    datasource_id: ids.datasource,
    include_schemas: ["public"],
    page_size: 250,
    statement_timeout_ms: 10_000,
    idempotency_key: ids.idempotency,
    ...extra,
  };
}

describe("schema discovery routes", () => {
  it("rejects password, DSN and client authority before dispatch", async () => {
    for (const forbidden of [
      { password: "raw-secret" },
      { dsn: "postgresql://reader:raw-secret@db.internal/warehouse" },
      { tenantId: "attacker", principal: "attacker" },
    ]) {
      const test = runtime();
      const response = await handleStartSchemaScan(
        new Request(`http://localhost/api/datasources/${ids.datasource}/schema-scans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(scanRequest(forbidden)),
        }),
        Promise.resolve({ id: ids.datasource }),
        test.value,
      );

      expect(response.status).toBe(400);
      expect(test.value.authorityResolver.resolve).not.toHaveBeenCalled();
      expect(test.startScan).not.toHaveBeenCalled();
      expect(JSON.stringify(await response.json())).not.toContain("raw-secret");
    }
  });

  it("dispatches only the strict request, server authority and request cancellation signal", async () => {
    const test = runtime();
    const request = new Request(`http://localhost/api/datasources/${ids.datasource}/schema-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scanRequest()),
    });

    const response = await handleStartSchemaScan(
      request,
      Promise.resolve({ id: ids.datasource }),
      test.value,
    );

    expect(response.status).toBe(201);
    expect(test.value.authorityResolver.resolve).toHaveBeenCalledWith({ access: "WRITE" });
    expect(test.startScan).toHaveBeenCalledWith(test.authority, scanRequest(), request.signal);
    await expect(response.json()).resolves.toMatchObject({
      meta: { authority: "POSTGRESQL", evidence_class: "PHYSICAL_ONLY" },
    });
  });

  it("binds diff identities to validated path and query values", async () => {
    const test = runtime();
    const response = await handleGetSchemaDiff(
      new Request(
        `http://localhost/api/schema-snapshots/${ids.snapshot}/diff?baseSnapshotId=${ids.baseSnapshot}`,
      ),
      Promise.resolve({ snapshotId: ids.snapshot }),
      test.value,
    );

    expect(response.status).toBe(200);
    expect(test.value.authorityResolver.resolve).toHaveBeenCalledWith({ access: "READ" });
    expect(test.compareSnapshots).toHaveBeenCalledWith(
      test.authority,
      ids.baseSnapshot,
      ids.snapshot,
    );
  });

  it("redacts unknown datasource failures from snapshot responses", async () => {
    const test = runtime();
    test.getSnapshot.mockRejectedValueOnce(
      new Error("postgresql://reader:raw-secret@db.internal/warehouse token=abc"),
    );

    const response = await handleGetSchemaSnapshot(
      Promise.resolve({ snapshotId: ids.snapshot }),
      test.value,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
        message: "当前无法读取 datasource 物理结构。",
        retryable: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("raw-secret");
    expect(JSON.stringify(body)).not.toContain("db.internal");
    expect(JSON.stringify(body)).not.toContain("token=abc");
  });
});
