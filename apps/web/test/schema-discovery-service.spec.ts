import type {
  PhysicalSchemaSnapshot,
  PortResult,
  SchemaScanCommitResult,
  SchemaScanRequest,
} from "@data-agent/contracts";
import type {
  PostgresCatalogClient,
  PostgresCatalogQuery,
  PostgresSchemaSnapshotStore,
} from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSchemaDiscoveryService } from "../src/lib/schema-discovery-service";

const ids = {
  generatedScan: "00000000-0000-4000-8000-000000000001",
  generatedSnapshot: "00000000-0000-4000-8000-000000000002",
  storedScan: "00000000-0000-4000-8000-000000000003",
  storedSnapshot: "00000000-0000-4000-8000-000000000004",
  idempotency: "00000000-0000-4000-8000-000000000005",
} as const;
const fingerprint = `sha256:${"a".repeat(64)}` as const;
const request: SchemaScanRequest = {
  schema_version: "schema-scan-request@1.0.0",
  datasource_id: "warehouse-primary",
  include_schemas: ["public"],
  page_size: 250,
  statement_timeout_ms: 10_000,
  idempotency_key: ids.idempotency,
};
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

function emptyCatalogClient(): PostgresCatalogClient {
  return {
    async query<Row extends object = Record<string, unknown>>(
      query: PostgresCatalogQuery,
    ): Promise<{ readonly rows: readonly Row[] }> {
      let rows: readonly object[] = [];
      if (query.text.includes("catalog-preflight")) {
        rows = [
          {
            transaction_read_only: "on",
            server_version_num: "170004",
            database_name: "warehouse",
            database_oid: "16384",
          },
        ];
      }
      return { rows: rows as readonly Row[] };
    },
    release: vi.fn(),
  };
}

function storeForReplay() {
  let scanned: PhysicalSchemaSnapshot | null = null;
  const commitSuccess = vi.fn(
    async (
      _capability: unknown,
      _request: SchemaScanRequest,
      snapshot: PhysicalSchemaSnapshot,
    ): Promise<PortResult<SchemaScanCommitResult>> => {
      scanned = snapshot;
      return {
        ok: true as const,
        value: {
          schema_version: "schema-scan-commit-result@1.0.0" as const,
          authority: "POSTGRESQL" as const,
          scan_run_id: ids.storedScan,
          snapshot_id: ids.storedSnapshot,
          snapshot_content_hash: snapshot.snapshot_content_hash,
          terminal: "SUCCEEDED" as const,
          created: false,
        },
      };
    },
  );
  const getSnapshot = vi.fn(async () => {
    if (!scanned) throw new Error("fixture called before scan");
    return {
      ok: true as const,
      value: {
        ...scanned,
        snapshot_id: ids.storedSnapshot,
        scan_run_id: ids.storedScan,
      },
    };
  });
  return {
    value: {
      commitSuccess,
      commitFailure: vi.fn(),
      commitDrift: vi.fn(),
      getScan: vi.fn(),
      getSnapshot,
      getDrift: vi.fn(),
    } as unknown as PostgresSchemaSnapshotStore,
    commitSuccess,
    getSnapshot,
  };
}

describe("schema discovery service", () => {
  it("returns the PostgreSQL-authoritative snapshot identity on idempotent replay", async () => {
    const store = storeForReplay();
    const randomIds = [ids.generatedScan, ids.generatedSnapshot];
    const service = createSchemaDiscoveryService({
      store: store.value,
      datasourceResolver: {
        async resolve() {
          return {
            datasource_fingerprint: fingerprint,
            connector: { connect: async () => emptyCatalogClient() },
          };
        },
      },
      randomId: () => randomIds.shift() ?? "unexpected-random-id",
      now: () => new Date("2026-08-09T00:00:00.000Z"),
    });

    const result = await service.startScan(authority, request);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture");
    expect(result.value.scan.created).toBe(false);
    expect(result.value.snapshot).toMatchObject({
      snapshot_id: ids.storedSnapshot,
      scan_run_id: ids.storedScan,
      snapshot_content_hash: result.value.scan.snapshot_content_hash,
    });
    expect(store.getSnapshot).toHaveBeenCalledWith(authority.capabilityInput, ids.storedSnapshot);
  });

  it("fails closed if a new commit receipt changes the scanned snapshot identity", async () => {
    const store = storeForReplay();
    store.commitSuccess.mockImplementationOnce(async (_capability, _request, snapshot) => ({
      ok: true as const,
      value: {
        schema_version: "schema-scan-commit-result@1.0.0",
        authority: "POSTGRESQL",
        scan_run_id: ids.generatedScan,
        snapshot_id: ids.storedSnapshot,
        snapshot_content_hash: snapshot.snapshot_content_hash,
        terminal: "SUCCEEDED",
        created: true,
      } satisfies SchemaScanCommitResult,
    }));
    const randomIds = [ids.generatedScan, ids.generatedSnapshot];
    const service = createSchemaDiscoveryService({
      store: store.value,
      datasourceResolver: {
        async resolve() {
          return {
            datasource_fingerprint: fingerprint,
            connector: { connect: async () => emptyCatalogClient() },
          };
        },
      },
      randomId: () => randomIds.shift() ?? "unexpected-random-id",
      now: () => new Date("2026-08-09T00:00:00.000Z"),
    });

    await expect(service.startScan(authority, request)).resolves.toMatchObject({
      ok: false,
      error: { code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID" },
    });
    expect(store.getSnapshot).not.toHaveBeenCalled();
  });
});
