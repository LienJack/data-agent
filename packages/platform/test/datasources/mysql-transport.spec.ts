import { buildGovernedDatasourceQueryRequest } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildBuiltinDatasourceAdapterDescriptors } from "../../src/datasources/adapter-registry.js";
import { createMysqlDatasourceAdapter } from "../../src/datasources/adapters/mysql.js";
import { createMysqlDatasourceTransport } from "../../src/datasources/adapters/mysql-transport.js";

const id = (suffix: number) => `74000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("MySQL governed transport", () => {
  it("uses the approved fixed address with SNI metadata and a read-only transaction", async () => {
    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "mysql",
    );
    if (!descriptor) throw new Error("missing mysql descriptor");
    const calls: unknown[] = [];
    const end = vi.fn(async () => undefined);
    const connect = vi.fn(async (_target: unknown, _timeoutMs: number) => ({
      async query(options: unknown): Promise<[unknown, readonly unknown[]]> {
        calls.push(options);
        return Array.isArray(options)
          ? [[], []]
          : typeof options === "object" && options !== null && "sql" in options
            ? [[{ id: 1 }], [{ name: "id", type: 3 }]]
            : [[], []];
      },
      end,
    }));
    const target = {
      address: "203.0.113.10",
      port: 3306,
      server_name: "mysql.example.com",
      database: "analytics",
      username: "reader",
      password: "test-only",
      ca: "test-ca",
    };
    const adapter = await createMysqlDatasourceAdapter({
      descriptor,
      target_authority: {
        authorize: async () => ({
          ok: true,
          value: { target_capability_hash: hash("a"), target },
        }),
      },
      transport: createMysqlDatasourceTransport({ connect }),
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
      limits: { timeout_ms: 1_000, max_rows: 10, max_bytes: 10_000 },
    });
    await expect(adapter.execute(request)).resolves.toMatchObject({ ok: true });
    expect(connect).toHaveBeenCalledWith(target, 1_000);
    expect(calls).toContain("SET SESSION TRANSACTION READ ONLY");
    expect(calls).toContain("START TRANSACTION READ ONLY");
    expect(calls).toContain("ROLLBACK");
    expect(end).toHaveBeenCalledTimes(2);
  });
});
