import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGovernedDatasourceQueryRequest,
  buildGovernedDatasourceSchemaScanRequest,
} from "@data-agent/contracts";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, describe, expect, it } from "vitest";
import { buildBuiltinDatasourceAdapterDescriptors } from "../../src/datasources/adapter-registry.js";
import { createDuckdbDatasourceAdapter } from "../../src/datasources/adapters/duckdb.js";
import {
  createDuckdbDatasourceTransport,
  createDuckdbStatementExtractor,
} from "../../src/datasources/adapters/duckdb-transport.js";

const id = (suffix: number) => `73000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("DuckDB governed Adapter integration", () => {
  it("uses native statement extraction and a read-only database instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "data-agent-duckdb-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "fixture.duckdb");
    const setupInstance = await DuckDBInstance.create(path);
    const setup = await setupInstance.connect();
    await setup.run("CREATE TABLE orders(id INTEGER, amount INTEGER)");
    await setup.run("INSERT INTO orders VALUES (1,10),(2,20)");
    setup.closeSync();
    setupInstance.closeSync();

    const descriptor = (await buildBuiltinDatasourceAdapterDescriptors()).find(
      ({ adapter_id }) => adapter_id === "duckdb",
    );
    if (!descriptor) throw new Error("missing duckdb descriptor");
    const target = { path };
    const extractor = createDuckdbStatementExtractor(target);
    const extracted = await extractor.extract("SELECT id, amount FROM orders WHERE amount > ?");
    expect(extracted.relations).toEqual(["orders"]);
    const adapter = await createDuckdbDatasourceAdapter({
      descriptor,
      target_authority: {
        authorize: async () => ({
          ok: true,
          value: { target_capability_hash: hash("a"), target },
        }),
      },
      extractor,
      transport: createDuckdbDatasourceTransport(),
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
      limits: { timeout_ms: 5_000, max_rows: 10, max_bytes: 10_000 },
    });
    const result = await adapter.execute(request);
    expect(result, JSON.stringify(result)).toMatchObject({
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
      timeout_ms: 5_000,
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
              { name: "amount", nullable: true },
            ],
          },
        ],
      },
    });
  });
});
