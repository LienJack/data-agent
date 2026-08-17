import { buildGovernedDatasourceQueryRequest } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildBuiltinDatasourceAdapterDescriptors } from "../../src/datasources/adapter-registry.js";
import { createClickhouseDatasourceAdapter } from "../../src/datasources/adapters/clickhouse.js";
import { createClickhouseDatasourceTransport } from "../../src/datasources/adapters/clickhouse-transport.js";

const id = (suffix: number) => `75000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("ClickHouse governed transport", () => {
  it("applies readonly and result limits to explain and execute", async () => {
    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "clickhouse",
    );
    if (!descriptor) throw new Error("missing clickhouse descriptor");
    const queries: unknown[] = [];
    const close = vi.fn(async () => undefined);
    const connect = vi.fn((_target: unknown, _timeoutMs: number) => ({
      async query(input: unknown) {
        queries.push(input);
        return { json: async () => [{ id: 1 }] };
      },
      close,
    }));
    const target = {
      address: "203.0.113.20",
      port: 8443,
      server_name: "clickhouse.example.com",
      database: "analytics",
      username: "reader",
      password: "test-only",
      ca: "test-ca",
    };
    const adapter = await createClickhouseDatasourceAdapter({
      descriptor,
      target_authority: {
        authorize: async () => ({
          ok: true,
          value: { target_capability_hash: hash("a"), target },
        }),
      },
      transport: createClickhouseDatasourceTransport({ connect }),
    });
    const request = await buildGovernedDatasourceQueryRequest({
      schema_version: "governed-datasource-query@1.0.0",
      scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
      query_id: id(3),
      datasource_id: id(4),
      adapter_ref: {
        adapter_id: descriptor.adapter_id,
        adapter_revision: descriptor.revision,
        descriptor_hash: descriptor.descriptor_hash,
        dialect: descriptor.dialect,
      },
      target_capability_hash: hash("a"),
      statement: "SELECT id FROM orders",
      parameters: [],
      allowed_relations: ["orders"],
      limits: { timeout_ms: 1_500, max_rows: 10, max_bytes: 10_000 },
    });
    await expect(adapter.execute(request)).resolves.toMatchObject({ ok: true });
    expect(connect).toHaveBeenCalledWith(target, 1_500);
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          query: "EXPLAIN SYNTAX SELECT id FROM orders",
          clickhouse_settings: expect.objectContaining({
            readonly: 2,
            max_result_rows: 10,
            result_overflow_mode: "throw",
          }),
        }),
      ]),
    );
    expect(close).toHaveBeenCalledTimes(2);
  });
});
