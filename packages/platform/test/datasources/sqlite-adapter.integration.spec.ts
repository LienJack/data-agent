import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildGovernedDatasourceQueryRequest,
  buildGovernedDatasourceSchemaScanRequest,
} from "@data-agent/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildBuiltinDatasourceAdapterDescriptors } from "../../src/datasources/adapter-registry.js";
import { createSqliteDatasourceAdapter } from "../../src/datasources/adapters/sqlite.js";
import { createSqliteDatasourceTransport } from "../../src/datasources/adapters/sqlite-transport.js";

const id = (suffix: number) => `72000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("SQLite governed Adapter integration", () => {
  it("runs against a real read-only file and leaves it unchanged", async () => {
    const directory = await mkdtemp(join(tmpdir(), "data-agent-sqlite-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "fixture.sqlite");
    const setup = new DatabaseSync(path);
    setup.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)");
    setup.exec("INSERT INTO orders(id,amount) VALUES (1,10),(2,20)");
    setup.close();

    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "sqlite",
    );
    if (!descriptor) throw new Error("missing sqlite descriptor");
    const adapter = await createSqliteDatasourceAdapter({
      descriptor,
      target_authority: {
        authorize: async () => ({
          ok: true,
          value: { target_capability_hash: hash("a"), target: { path } },
        }),
      },
      transport: createSqliteDatasourceTransport(),
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
      statement: "SELECT id, amount FROM orders WHERE amount > ?",
      parameters: [10],
      allowed_relations: ["orders"],
      limits: { timeout_ms: 1_000, max_rows: 10, max_bytes: 10_000 },
    });
    await expect(adapter.execute(request)).resolves.toMatchObject({
      ok: true,
      value: { rows: [{ id: 2, amount: 20 }], row_count: 1 },
    });
    const scan = await buildGovernedDatasourceSchemaScanRequest({
      schema_version: "governed-datasource-schema-scan@1.0.0",
      scope: request.scope,
      scan_id: id(5),
      datasource_id: request.datasource_id,
      adapter_ref: request.adapter_ref,
      target_capability_hash: request.target_capability_hash,
      timeout_ms: 1_000,
      max_objects: 10,
    });
    await expect(adapter.scanSchema(scan)).resolves.toMatchObject({
      ok: true,
      value: {
        objects: [
          {
            namespace: "main",
            name: "orders",
            columns: [
              { name: "id", nullable: true },
              { name: "amount", nullable: false },
            ],
          },
        ],
      },
    });

    const verify = new DatabaseSync(path, { readOnly: true });
    expect(verify.prepare("SELECT COUNT(*) AS count FROM orders").get()).toEqual({ count: 2 });
    verify.close();
  });
});
