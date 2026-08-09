import type { PhysicalSchemaSnapshot, SchemaScanRequest } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPhysicalSchemaSnapshot } from "../../src/catalog/physical-schema.js";
import { createPostgresSchemaSnapshotStore } from "../../src/catalog/postgres-snapshot-store.js";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  owner: "00000000-0000-4000-8000-000000000004",
  viewer: "00000000-0000-4000-8000-000000000005",
  snapshot: "00000000-0000-4000-8000-000000000006",
  scan: "00000000-0000-4000-8000-000000000007",
  idempotency: "00000000-0000-4000-8000-000000000008",
} as const;
const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;

function capabilities() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.owner,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "OWNER",
      },
      {
        subject: ids.viewer,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "VIEWER",
      },
    ],
  );
  const owner = registry.resolveForDeployment(ids.deployment, { subject: ids.owner });
  const viewer = registry.resolveForDeployment(ids.deployment, { subject: ids.viewer });
  if (!owner.ok || !viewer.ok) throw new Error("fixture");
  return {
    authorizer: asTransactionalTestAuthority(registry.authorizer),
    owner: owner.value,
    viewer: viewer.value,
  };
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          const result = handle(text, values);
          if (result) return result as SqlQueryResult<Row>;
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { calls, pool };
}

function request(): SchemaScanRequest {
  return {
    schema_version: "schema-scan-request@1.0.0",
    datasource_id: "warehouse-primary",
    include_schemas: ["public"],
    page_size: 100,
    statement_timeout_ms: 10_000,
    idempotency_key: ids.idempotency,
  };
}

async function snapshot(): Promise<PhysicalSchemaSnapshot> {
  return createPhysicalSchemaSnapshot({
    schema_version: "physical-schema-snapshot-draft@1.0.0",
    snapshot_id: ids.snapshot,
    scan_run_id: ids.scan,
    captured_at: "2026-08-09T00:00:00.000Z",
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: "warehouse-primary",
      datasource_fingerprint: hash("a"),
      engine: "postgresql",
      engine_version: { major: 17, minor: 10 },
      database_identity: { database_name: "warehouse", database_oid: 16_384 },
      included_schemas: ["public"],
      relations: [],
    },
  });
}

describe("PostgreSQL schema snapshot store", () => {
  it("commits a parsed snapshot through the narrow authority RPC", async () => {
    const { authorizer, owner } = capabilities();
    const physicalSnapshot = await snapshot();
    const scripted = scriptedPool((text) =>
      text.includes("catalog.commit_schema_scan_success")
        ? {
            rows: [
              {
                value: {
                  scan_run_id: ids.scan,
                  snapshot_id: ids.snapshot,
                  snapshot_content_hash: physicalSnapshot.snapshot_content_hash,
                  terminal: "SUCCEEDED",
                  created: true,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const result = await createPostgresSchemaSnapshotStore({
      pool: scripted.pool,
      authorizer,
    }).commitSuccess(owner, request(), physicalSnapshot);

    expect(result).toMatchObject({
      ok: true,
      value: { authority: "POSTGRESQL", terminal: "SUCCEEDED", created: true },
    });
    const rpc = scripted.calls.find((call) =>
      call.text.includes("catalog.commit_schema_scan_success"),
    );
    expect(rpc?.values.slice(0, 6)).toEqual([
      ids.app,
      ids.tenant,
      "test",
      ids.owner,
      "warehouse-primary",
      ids.idempotency,
    ]);
    expect(rpc?.values[7]).toEqual(physicalSnapshot);
  });

  it("maps database conflict markers without leaking database details", async () => {
    const { authorizer, owner } = capabilities();
    const scripted = scriptedPool((text) => {
      if (text.includes("catalog.commit_schema_scan_success")) {
        throw Object.assign(new Error("SCHEMA_SCAN_IDEMPOTENCY_CONFLICT"), { code: "23505" });
      }
      return undefined;
    });
    const result = await createPostgresSchemaSnapshotStore({
      pool: scripted.pool,
      authorizer,
    }).commitSuccess(owner, request(), await snapshot());
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_SCAN_IDEMPOTENCY_CONFLICT", retryable: false },
    });
  });

  it("rejects a forged snapshot content hash before invoking PostgreSQL", async () => {
    const { authorizer, owner } = capabilities();
    const scripted = scriptedPool(() => undefined);
    const physicalSnapshot = await snapshot();
    const result = await createPostgresSchemaSnapshotStore({
      pool: scripted.pool,
      authorizer,
    }).commitSuccess(owner, request(), {
      ...physicalSnapshot,
      snapshot_content_hash: hash("f"),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID", retryable: false },
    });
    expect(
      scripted.calls.some((call) => call.text.includes("catalog.commit_schema_scan_success")),
    ).toBe(false);
  });

  it("denies viewer writes before invoking a catalog RPC", async () => {
    const { authorizer, viewer } = capabilities();
    const scripted = scriptedPool(() => undefined);
    const result = await createPostgresSchemaSnapshotStore({
      pool: scripted.pool,
      authorizer,
    }).commitSuccess(viewer, request(), await snapshot());
    expect(result).toMatchObject({ ok: false, error: { code: "PERSISTENCE_WRITE_DENIED" } });
    expect(
      scripted.calls.some((call) => call.text.includes("catalog.commit_schema_scan_success")),
    ).toBe(false);
  });

  it("parses snapshot reads and returns a stable not-found result", async () => {
    const { authorizer, owner } = capabilities();
    const physicalSnapshot = await snapshot();
    let found = true;
    const scripted = scriptedPool((text) =>
      text.includes("catalog.get_physical_schema_snapshot")
        ? { rows: [{ value: found ? physicalSnapshot : null }], rowCount: 1 }
        : undefined,
    );
    const store = createPostgresSchemaSnapshotStore({ pool: scripted.pool, authorizer });
    expect(await store.getSnapshot(owner, ids.snapshot)).toEqual({
      ok: true,
      value: physicalSnapshot,
    });
    found = false;
    expect(await store.getSnapshot(owner, ids.snapshot)).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_SCAN_NOT_FOUND" },
    });
  });
});
