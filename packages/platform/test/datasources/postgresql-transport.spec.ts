import { buildGovernedDatasourceQueryRequest } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildBuiltinDatasourceAdapterDescriptors } from "../../src/datasources/adapter-registry.js";
import { createPostgresqlDatasourceAdapter } from "../../src/datasources/adapters/postgresql.js";
import { createPostgresqlDatasourceTransport } from "../../src/datasources/adapters/postgresql-transport.js";

const id = (suffix: number) => `76000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("PostgreSQL governed transport", () => {
  it("uses an exact read-only transaction for explain and execute", async () => {
    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "postgresql",
    );
    if (!descriptor) throw new Error("missing postgresql descriptor");
    const calls: unknown[] = [];
    const end = vi.fn(async () => undefined);
    const connect = vi.fn(async (_target: unknown, _timeoutMs: number) => ({
      async query(input: unknown) {
        calls.push(input);
        const text = typeof input === "string" ? input : "";
        return text.startsWith("BEGIN") || text.startsWith("SET") || text === "ROLLBACK"
          ? { rows: [], fields: [] }
          : { rows: [{ id: 1 }], fields: [{ name: "id", dataTypeID: 23 }] };
      },
      end,
    }));
    const target = {
      address: "203.0.113.30",
      port: 5432,
      server_name: "postgres.example.com",
      database: "analytics",
      username: "reader",
      password: "test-only",
      ca: "test-ca",
    };
    const adapter = await createPostgresqlDatasourceAdapter({
      descriptor,
      target_authority: {
        authorize: async () => ({
          ok: true,
          value: { target_capability_hash: hash("a"), target },
        }),
      },
      transport: createPostgresqlDatasourceTransport({ connect }),
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
      statement: "SELECT source.id AS id FROM orders AS source",
      parameters: [],
      allowed_relations: ["orders"],
      limits: { timeout_ms: 1_500, max_rows: 10, max_bytes: 10_000 },
    });
    await expect(adapter.execute(request)).resolves.toMatchObject({ ok: true });
    expect(connect).toHaveBeenCalledWith(target, 1_500);
    expect(calls.filter((call) => call === "BEGIN READ ONLY")).toHaveLength(2);
    expect(calls.filter((call) => call === "ROLLBACK")).toHaveLength(2);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "EXPLAIN (FORMAT JSON) SELECT source.id AS id FROM orders AS source",
        }),
      ]),
    );
    expect(end).toHaveBeenCalledTimes(2);
  });
});
