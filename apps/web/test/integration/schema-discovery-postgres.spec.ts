import { randomUUID } from "node:crypto";
import {
  adaptPgCatalogPool,
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresSchemaSnapshotStore,
} from "@data-agent/platform";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPostgresSchemaDiscoveryAuthorityResolver } from "../../src/lib/schema-discovery-authority";
import { createSchemaDiscoveryService } from "../../src/lib/schema-discovery-service";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEPLOYMENT_ID = "00000000-0000-4000-8000-00000000de01";
const TENANT_ID = "00000000-0000-4000-8000-00000000aa11";
const PRINCIPAL_ID = "00000000-0000-4000-8000-000000001001";
const DATASOURCE_ID = "schema-discovery-integration";
const DATASOURCE_FINGERPRINT = `sha256:${"b".repeat(64)}` as const;

const databaseUrl = process.env.DATA_AGENT_TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.DATA_AGENT_TEST_ADMIN_DATABASE_URL;
const datasourceUrl = process.env.DATA_AGENT_SANDBOX_DSN;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

describe.skipIf(!databaseUrl || !adminDatabaseUrl || !datasourceUrl)(
  "Schema Discovery PostgreSQL vertical slice",
  () => {
    const backendPool = new Pool({ connectionString: databaseUrl });
    const adminPool = new Pool({ connectionString: adminDatabaseUrl });
    const datasourcePool = new Pool({ connectionString: datasourceUrl });
    const sqlPool = adaptPgPool(backendPool);
    const postgresAuthority = createPostgresCapabilityAuthority(sqlPool);
    const authorityResolver = createPostgresSchemaDiscoveryAuthorityResolver({
      authority: postgresAuthority,
      deploymentId: DEPLOYMENT_ID,
      tenantId: TENANT_ID,
      principalId: PRINCIPAL_ID,
    });
    const store = createPostgresSchemaSnapshotStore({
      pool: sqlPool,
      authorizer: postgresAuthority.authorizer,
    });
    const service = createSchemaDiscoveryService({
      store,
      datasourceResolver: {
        async resolve() {
          return {
            datasource_fingerprint: DATASOURCE_FINGERPRINT,
            connector: adaptPgCatalogPool(datasourcePool),
          };
        },
      },
    });
    const schemaName = `schema_discovery_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const quotedSchema = quoteIdentifier(schemaName);

    beforeAll(async () => {
      await adminPool.query(`
        create schema ${quotedSchema};
        create table ${quotedSchema}.orders (
          order_id bigint primary key,
          amount numeric(18, 2) not null
        );
        revoke all on schema ${quotedSchema} from public;
        revoke all on ${quotedSchema}.orders from public;
        grant usage on schema ${quotedSchema} to sandbox_reader;
        grant select on ${quotedSchema}.orders to sandbox_reader;
      `);
    });

    afterAll(async () => {
      await adminPool.query(`drop schema if exists ${quotedSchema} cascade`);
      await Promise.all([backendPool.end(), adminPool.end(), datasourcePool.end()]);
    });

    it("scans a read-only datasource, replays the authoritative snapshot and persists drift", async () => {
      const authority = await authorityResolver.resolve({ access: "WRITE" });
      expect(authority).toMatchObject({
        authority: "POSTGRESQL",
        scope: { appId: APP_ID, tenantId: TENANT_ID, environment: "test" },
      });
      const initialRequest = {
        schema_version: "schema-scan-request@1.0.0" as const,
        datasource_id: DATASOURCE_ID,
        include_schemas: [schemaName],
        page_size: 100,
        statement_timeout_ms: 10_000,
        idempotency_key: randomUUID(),
      };

      const initial = await service.startScan(authority, initialRequest);
      expect(initial.ok).toBe(true);
      if (!initial.ok || !initial.value.snapshot) throw new Error("initial schema scan failed");
      expect(initial.value.scan).toMatchObject({
        authority: "POSTGRESQL",
        terminal: "SUCCEEDED",
        created: true,
        snapshot_id: initial.value.snapshot.snapshot_id,
      });
      expect(initial.value.snapshot.content.relations).toEqual([
        expect.objectContaining({
          identity: { schema_name: schemaName, relation_name: "orders" },
          columns: expect.arrayContaining([
            expect.objectContaining({ column_name: "order_id", formatted_type: "bigint" }),
            expect.objectContaining({ column_name: "amount", formatted_type: "numeric(18,2)" }),
          ]),
        }),
      ]);

      const replay = await service.startScan(authority, initialRequest);
      expect(replay.ok).toBe(true);
      if (!replay.ok || !replay.value.snapshot) throw new Error("schema scan replay failed");
      expect(replay.value.scan.created).toBe(false);
      expect(replay.value.snapshot.snapshot_id).toBe(initial.value.snapshot.snapshot_id);
      expect(replay.value.snapshot.snapshot_content_hash).toBe(
        initial.value.snapshot.snapshot_content_hash,
      );

      await adminPool.query(`alter table ${quotedSchema}.orders add column scan_note text`);
      const changed = await service.startScan(authority, {
        ...initialRequest,
        base_snapshot_id: initial.value.snapshot.snapshot_id,
        idempotency_key: randomUUID(),
      });
      expect(changed.ok).toBe(true);
      if (!changed.ok || !changed.value.snapshot || !changed.value.drift) {
        throw new Error("changed schema scan failed");
      }
      expect(changed.value.snapshot.snapshot_content_hash).not.toBe(
        initial.value.snapshot.snapshot_content_hash,
      );
      expect(changed.value.drift).toMatchObject({
        datasource_id: DATASOURCE_ID,
        severity: "INFO",
        binding_impact: "UNKNOWN",
        operations: [
          expect.objectContaining({
            operation_kind: "COLUMN_ADDED",
            identity: {
              relation: { schema_name: schemaName, relation_name: "orders" },
              column_name: "scan_note",
            },
          }),
        ],
      });

      const persistedDrift = await store.getDrift(
        authority.capabilityInput,
        DATASOURCE_ID,
        changed.value.drift.drift_event_id,
      );
      expect(persistedDrift).toEqual({ ok: true, value: changed.value.drift });
    });
  },
);
