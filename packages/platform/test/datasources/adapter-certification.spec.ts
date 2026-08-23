import {
  buildGovernedDatasourceQueryRequest,
  buildGovernedDatasourceSchemaScanRequest,
  type DatasourceAdapterDescriptor,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildBuiltinDatasourceAdapterDescriptors } from "../../src/datasources/adapter-registry.js";
import { createClickhouseDatasourceAdapter } from "../../src/datasources/adapters/clickhouse.js";
import type {
  DatasourceAdapterTargetAuthority,
  DatasourceAdapterTransport,
} from "../../src/datasources/adapters/common.js";
import { createDuckdbDatasourceAdapter } from "../../src/datasources/adapters/duckdb.js";
import { createMysqlDatasourceAdapter } from "../../src/datasources/adapters/mysql.js";
import { createPostgresqlDatasourceAdapter } from "../../src/datasources/adapters/postgresql.js";
import { createSqliteDatasourceAdapter } from "../../src/datasources/adapters/sqlite.js";

const id = (suffix: number) => `71000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

function successfulPorts() {
  const authorize = vi.fn(async () => ({
    ok: true as const,
    value: { target_capability_hash: hash("a"), target: {} },
  }));
  const scanSchema = vi.fn<DatasourceAdapterTransport["scanSchema"]>(async () => [
    {
      namespace: "main",
      name: "orders",
      kind: "TABLE",
      columns: [{ name: "id", type: "integer", nullable: false }],
    },
  ]);
  const explain = vi.fn<DatasourceAdapterTransport["explain"]>(async () => undefined);
  const execute = vi.fn<DatasourceAdapterTransport["execute"]>(async () => ({
    columns: [{ name: "id", type: "integer" }],
    rows: [{ id: 1 }],
  }));
  return {
    target: { authorize } satisfies DatasourceAdapterTargetAuthority,
    transport: { scanSchema, explain, execute } satisfies DatasourceAdapterTransport,
    authorize,
    scanSchema,
    explain,
    execute,
  };
}

async function request(descriptor: DatasourceAdapterDescriptor, statement: string) {
  return buildGovernedDatasourceQueryRequest({
    schema_version: "governed-datasource-query@1.0.0",
    scope,
    query_id: id(3),
    datasource_id: id(4),
    adapter_ref: {
      adapter_id: descriptor.adapter_id,
      adapter_revision: descriptor.revision,
      descriptor_hash: descriptor.descriptor_hash,
      dialect: descriptor.dialect,
    },
    target_capability_hash: hash("a"),
    statement,
    parameters: [],
    allowed_relations: ["orders"],
    limits: { timeout_ms: 1_000, max_rows: 10, max_bytes: 10_000 },
  });
}

describe("mandatory governed Datasource Adapters", () => {
  it("executes a bounded read through each independent dialect policy", async () => {
    const descriptors = new Map(
      (await buildBuiltinDatasourceAdapterDescriptors()).map((descriptor) => [
        descriptor.adapter_id,
        descriptor,
      ]),
    );
    for (const adapterId of ["mysql", "sqlite", "clickhouse", "duckdb"] as const) {
      const descriptor = descriptors.get(adapterId);
      if (!descriptor) throw new Error(`missing ${adapterId} descriptor`);
      const ports = successfulPorts();
      const factory =
        adapterId === "mysql"
          ? createMysqlDatasourceAdapter
          : adapterId === "sqlite"
            ? createSqliteDatasourceAdapter
            : adapterId === "clickhouse"
              ? createClickhouseDatasourceAdapter
              : null;
      const adapter = factory
        ? await factory({
            descriptor,
            target_authority: ports.target,
            transport: ports.transport,
          })
        : await createDuckdbDatasourceAdapter({
            descriptor,
            target_authority: ports.target,
            transport: ports.transport,
            extractor: {
              extract: async () => ({
                statement_count: 1,
                statement_type: "SELECT",
                relations: ["orders"],
                external_access: false,
              }),
            },
          });
      const result = await adapter.execute(await request(descriptor, "SELECT id FROM orders"));
      expect(result, `${adapterId}:${JSON.stringify(result)}`).toMatchObject({
        ok: true,
        value: { row_count: 1, truncated: false },
      });
      expect(ports.authorize).toHaveBeenCalledTimes(1);
      expect(ports.explain).toHaveBeenCalledTimes(1);
      expect(ports.execute).toHaveBeenCalledTimes(1);
    }

    const descriptor = descriptors.get("postgresql");
    if (!descriptor) throw new Error("missing postgresql descriptor");
    const ports = successfulPorts();
    const adapter = await createPostgresqlDatasourceAdapter({
      descriptor,
      target_authority: ports.target,
      transport: ports.transport,
    });
    await expect(
      adapter.execute(await request(descriptor, "SELECT source.id AS id FROM orders AS source")),
    ).resolves.toMatchObject({ ok: true });
  });

  it("rejects write statements before explain or execute for every dialect", async () => {
    const descriptors = new Map(
      (await buildBuiltinDatasourceAdapterDescriptors()).map((descriptor) => [
        descriptor.adapter_id,
        descriptor,
      ]),
    );
    for (const adapterId of ["mysql", "sqlite", "clickhouse", "postgresql"] as const) {
      const descriptor = descriptors.get(adapterId);
      if (!descriptor) throw new Error(`missing ${adapterId} descriptor`);
      const ports = successfulPorts();
      const adapter = await (adapterId === "mysql"
        ? createMysqlDatasourceAdapter({
            descriptor,
            target_authority: ports.target,
            transport: ports.transport,
          })
        : adapterId === "sqlite"
          ? createSqliteDatasourceAdapter({
              descriptor,
              target_authority: ports.target,
              transport: ports.transport,
            })
          : adapterId === "clickhouse"
            ? createClickhouseDatasourceAdapter({
                descriptor,
                target_authority: ports.target,
                transport: ports.transport,
              })
            : createPostgresqlDatasourceAdapter({
                descriptor,
                target_authority: ports.target,
                transport: ports.transport,
              }));
      const result = await adapter.execute(await request(descriptor, "DELETE FROM orders"));
      expect(result).toMatchObject({ ok: false });
      expect(ports.explain).not.toHaveBeenCalled();
      expect(ports.execute).not.toHaveBeenCalled();
    }
  });

  it("binds schema scans to the same exact Adapter and target capability", async () => {
    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "sqlite",
    );
    if (!descriptor) throw new Error("missing sqlite descriptor");
    const ports = successfulPorts();
    const adapter = await createSqliteDatasourceAdapter({
      descriptor,
      target_authority: ports.target,
      transport: ports.transport,
    });
    const scan = await buildGovernedDatasourceSchemaScanRequest({
      schema_version: "governed-datasource-schema-scan@1.0.0",
      scope,
      scan_id: id(30),
      datasource_id: id(4),
      adapter_ref: {
        adapter_id: descriptor.adapter_id,
        adapter_revision: descriptor.revision,
        descriptor_hash: descriptor.descriptor_hash,
        dialect: descriptor.dialect,
      },
      target_capability_hash: hash("a"),
      timeout_ms: 1_000,
      max_objects: 10,
    });
    await expect(adapter.scanSchema(scan)).resolves.toMatchObject({
      ok: true,
      value: { objects: [{ namespace: "main", name: "orders" }] },
    });
    expect(ports.scanSchema).toHaveBeenCalledTimes(1);
    expect(ports.explain).not.toHaveBeenCalled();
    expect(ports.execute).not.toHaveBeenCalled();
  });

  it("does zero SQL work when target authority rejects the capability", async () => {
    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "mysql",
    );
    if (!descriptor) throw new Error("missing mysql descriptor");
    const ports = successfulPorts();
    const adapter = await createMysqlDatasourceAdapter({
      descriptor,
      target_authority: {
        authorize: async () => ({
          ok: false,
          error: { code: "DATASOURCE_TARGET_DENIED", message: "denied", retryable: false },
        }),
      },
      transport: ports.transport,
    });
    await expect(
      adapter.execute(await request(descriptor, "SELECT id FROM orders")),
    ).resolves.toMatchObject({ ok: false, error: { code: "DATASOURCE_TARGET_DENIED" } });
    expect(ports.explain).not.toHaveBeenCalled();
    expect(ports.execute).not.toHaveBeenCalled();
  });

  it("rejects multi-statement and dangerous function inputs before SQL I/O", async () => {
    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "mysql",
    );
    if (!descriptor) throw new Error("missing mysql descriptor");
    for (const statement of [
      "SELECT id FROM orders; SELECT id FROM orders",
      "SELECT sleep(1) FROM orders",
    ]) {
      const ports = successfulPorts();
      const adapter = await createMysqlDatasourceAdapter({
        descriptor,
        target_authority: ports.target,
        transport: ports.transport,
      });
      await expect(adapter.execute(await request(descriptor, statement))).resolves.toMatchObject({
        ok: false,
      });
      expect(ports.explain).not.toHaveBeenCalled();
      expect(ports.execute).not.toHaveBeenCalled();
    }
  });

  it("rejects row and byte overflow without releasing a partial result", async () => {
    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "mysql",
    );
    if (!descriptor) throw new Error("missing mysql descriptor");
    const overflowRows = Array.from({ length: 11 }, (_, id) => ({ id }));
    for (const [rows, limits, code] of [
      [
        overflowRows,
        { timeout_ms: 1_000, max_rows: 10, max_bytes: 10_000 },
        "DATASOURCE_ADAPTER_ROW_LIMIT_EXCEEDED",
      ],
      [
        [{ id: "x".repeat(100) }],
        { timeout_ms: 1_000, max_rows: 10, max_bytes: 10 },
        "DATASOURCE_ADAPTER_BYTE_LIMIT_EXCEEDED",
      ],
    ] as const) {
      const ports = successfulPorts();
      ports.execute.mockResolvedValueOnce({ columns: [{ name: "id", type: "text" }], rows });
      const adapter = await createMysqlDatasourceAdapter({
        descriptor,
        target_authority: ports.target,
        transport: ports.transport,
      });
      const base = await request(descriptor, "SELECT id FROM orders");
      const { request_hash: _requestHash, ...draft } = base;
      const bounded = await buildGovernedDatasourceQueryRequest({ ...draft, limits });
      await expect(adapter.execute(bounded)).resolves.toMatchObject({
        ok: false,
        error: { code },
      });
    }
  });

  it("aborts a transport that exceeds the request timeout", async () => {
    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "mysql",
    );
    if (!descriptor) throw new Error("missing mysql descriptor");
    const ports = successfulPorts();
    ports.explain.mockImplementationOnce(
      async ({ signal }) =>
        new Promise<void>(() => signal.addEventListener("abort", () => undefined, { once: true })),
    );
    const adapter = await createMysqlDatasourceAdapter({
      descriptor,
      target_authority: ports.target,
      transport: ports.transport,
    });
    const base = await request(descriptor, "SELECT id FROM orders");
    const { request_hash: _requestHash, ...draft } = base;
    const timed = await buildGovernedDatasourceQueryRequest({
      ...draft,
      limits: { ...base.limits, timeout_ms: 100 },
    });
    await expect(adapter.execute(timed)).resolves.toMatchObject({
      ok: false,
      error: { code: "DATASOURCE_ADAPTER_TIMEOUT", retryable: true },
    });
    expect(ports.execute).not.toHaveBeenCalled();
  });
});
