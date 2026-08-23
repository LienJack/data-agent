import { describe, expect, it } from "vitest";
import {
  createPostgresCatalogScanner,
  type PostgresCatalogClient,
  type PostgresCatalogQuery,
} from "../../src/catalog/postgres-catalog.js";

const ids = {
  snapshot: "00000000-0000-4000-8000-000000000001",
  scan: "00000000-0000-4000-8000-000000000002",
  idempotency: "00000000-0000-4000-8000-000000000003",
} as const;
const fingerprint = `sha256:${"a".repeat(64)}`;

function scanInput(includeSchemas = ["public"]) {
  return {
    request: {
      schema_version: "schema-scan-request@1.0.0",
      datasource_id: "warehouse-primary",
      include_schemas: includeSchemas,
      page_size: 1,
      statement_timeout_ms: 10_000,
      idempotency_key: ids.idempotency,
    },
    datasource_fingerprint: fingerprint,
    snapshot_id: ids.snapshot,
    scan_run_id: ids.scan,
    captured_at: "2026-08-08T08:00:00.000Z",
  };
}

function queryName(text: string): string {
  if (text === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY") return "begin";
  if (text === "ROLLBACK") return "rollback";
  return text.match(/data-agent:catalog-([a-z-]+)@1/)?.[1] ?? "unknown";
}

function relationRow(name: string) {
  return {
    schema_name: "public",
    relation_name: name,
    relation_kind: "TABLE",
    comment: null,
  };
}

function columnRow(relationName: string) {
  return {
    schema_name: "public",
    relation_name: relationName,
    column_name: "id",
    ordinal_position: 1,
    formatted_type: "integer",
    type_schema: "pg_catalog",
    type_name: "int4",
    type_kind: "BASE",
    array_dimensions: 0,
    nullable: false,
    default_expression: null,
    identity_generation: null,
    generated_expression: null,
    comment: null,
  };
}

class FakeCatalogClient implements PostgresCatalogClient {
  readonly queries: PostgresCatalogQuery[] = [];
  released = false;

  constructor(
    private readonly execute: (
      query: PostgresCatalogQuery,
      queryIndex: number,
    ) => readonly object[] | Promise<readonly object[]>,
  ) {}

  async query<Row extends object = Record<string, unknown>>(
    query: PostgresCatalogQuery,
  ): Promise<{ readonly rows: readonly Row[] }> {
    this.queries.push(query);
    const rows = await this.execute(query, this.queries.length - 1);
    return { rows: rows as readonly Row[] };
  }

  release(): void {
    this.released = true;
  }
}

function successfulClient(): FakeCatalogClient {
  return new FakeCatalogClient((query) => {
    switch (queryName(query.text)) {
      case "preflight":
        return [
          {
            transaction_read_only: "on",
            server_version_num: "170004",
            database_name: "warehouse",
            database_oid: "16384",
          },
        ];
      case "relations": {
        const cursorName = query.values?.[2];
        if (cursorName === "") return [relationRow("accounts")];
        if (cursorName === "accounts") return [relationRow("orders")];
        return [];
      }
      case "columns": {
        const relationNames = query.values?.[1];
        return Array.isArray(relationNames) && typeof relationNames[0] === "string"
          ? [columnRow(relationNames[0])]
          : [];
      }
      default:
        return [];
    }
  });
}

describe("PostgreSQL catalog scanner", () => {
  it("uses one RR/RO client, fixed keyset queries, rollback and release", async () => {
    const client = successfulClient();
    const scanner = createPostgresCatalogScanner({ connect: async () => client });
    const result = await scanner.scan(scanInput());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture");
    expect(
      result.value.content.relations.map((relation) => relation.identity.relation_name),
    ).toEqual(["accounts", "orders"]);
    expect(client.queries.map((query) => queryName(query.text))).toEqual([
      "begin",
      "timeouts",
      "preflight",
      "relations",
      "columns",
      "constraints",
      "indexes",
      "relations",
      "columns",
      "constraints",
      "indexes",
      "relations",
      "rollback",
    ]);
    expect(client.queries[3]?.values).toEqual([["public"], "", "", 1]);
    expect(client.queries[7]?.values).toEqual([["public"], "public", "accounts", 1]);
    expect(client.released).toBe(true);
    for (const query of client.queries) {
      expect(query.text).not.toMatch(
        /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|commit)\b/i,
      );
    }
  });

  it("passes AbortSignal to catalog queries and rolls back without further reads", async () => {
    const controller = new AbortController();
    const client = new FakeCatalogClient((query) => {
      if (queryName(query.text) === "preflight") {
        return [
          {
            transaction_read_only: "on",
            server_version_num: "170004",
            database_name: "warehouse",
            database_oid: "16384",
          },
        ];
      }
      if (queryName(query.text) === "relations") {
        expect(query.signal).toBe(controller.signal);
        controller.abort();
        return [relationRow("orders")];
      }
      return [];
    });
    const result = await createPostgresCatalogScanner({ connect: async () => client }).scan(
      scanInput(),
      controller.signal,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "SCHEMA_SCAN_CANCELLED" } });
    expect(client.queries.map((query) => queryName(query.text))).toEqual([
      "begin",
      "timeouts",
      "preflight",
      "relations",
      "rollback",
    ]);
    expect(client.released).toBe(true);
  });

  it.each([
    [{ code: "57014", message: "statement timeout at password=secret" }, "SCHEMA_SCAN_TIMEOUT"],
    [
      { code: "42501", message: "permission denied for host secret" },
      "SCHEMA_SCAN_PERMISSION_DENIED",
    ],
    [
      { code: "08006", message: "postgres://user:password@secret-host" },
      "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
    ],
  ])("maps driver failure to a redacted terminal", async (driverError, expectedCode) => {
    const client = new FakeCatalogClient((query) => {
      if (queryName(query.text) === "preflight") {
        return [
          {
            transaction_read_only: "on",
            server_version_num: "170004",
            database_name: "warehouse",
            database_oid: "16384",
          },
        ];
      }
      if (queryName(query.text) === "relations") throw driverError;
      return [];
    });
    const result = await createPostgresCatalogScanner({ connect: async () => client }).scan(
      scanInput(),
    );

    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    if (result.ok) throw new Error("fixture");
    expect(result.error.message).not.toMatch(/secret|password|postgres:\/\//i);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.released).toBe(true);
  });

  it("fails closed when read-only preflight is not proven", async () => {
    const client = new FakeCatalogClient((query) => {
      if (queryName(query.text) === "preflight") {
        return [
          {
            transaction_read_only: "off",
            server_version_num: "170004",
            database_name: "warehouse",
            database_oid: "16384",
          },
        ];
      }
      return [];
    });
    const result = await createPostgresCatalogScanner({ connect: async () => client }).scan(
      scanInput(),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID" },
    });
    expect(client.queries.map((query) => queryName(query.text))).toEqual([
      "begin",
      "timeouts",
      "preflight",
      "rollback",
    ]);
  });

  it("redacts connector release failures after rollback", async () => {
    const client = successfulClient();
    client.release = () => {
      throw new Error("postgresql://reader:raw-secret@db.internal/warehouse");
    };

    const result = await createPostgresCatalogScanner({ connect: async () => client }).scan(
      scanInput(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE", retryable: true },
    });
    if (result.ok) throw new Error("fixture");
    expect(result.error.message).not.toMatch(/raw-secret|db\.internal|postgresql:\/\//i);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
  });

  it("rejects internal schemas before opening a datasource connection", async () => {
    let connected = false;
    const result = await createPostgresCatalogScanner({
      connect: async () => {
        connected = true;
        return successfulClient();
      },
    }).scan(scanInput(["pg_catalog"]));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_SCAN_SCOPE_FORBIDDEN" },
    });
    expect(connected).toBe(false);
  });
});
