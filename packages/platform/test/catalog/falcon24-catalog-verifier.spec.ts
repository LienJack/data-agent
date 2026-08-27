import { describe, expect, it } from "vitest";
import {
  type PostgresCatalogConnector,
  verifyFalcon24CatalogInventory,
} from "../../src/catalog/index.js";

function connector(input: { readonly schema_count: number; readonly target_present: boolean }) {
  const statements: string[] = [];
  const value: PostgresCatalogConnector = {
    async connect() {
      return {
        async query<Row extends object>({ text }: { readonly text: string }) {
          statements.push(text);
          if (text.includes("falcon24-catalog-verifier-preflight")) {
            return {
              rows: [
                {
                  server_version_num: 170_005,
                  database_name: "data_agent",
                  falcon_schema_count: input.schema_count,
                  target_present: input.target_present,
                },
              ] as Row[],
            };
          }
          if (text.includes("falcon24-catalog-verifier-result")) {
            return {
              rows: [
                {
                  inventory_material: {
                    schema_name: "falcon_db_24",
                    tables: [
                      {
                        table_name: "orders",
                        columns: [
                          {
                            ordinal: 1,
                            column_name: "id",
                            data_type: "bigint",
                            is_nullable: false,
                          },
                        ],
                        row_count: 1,
                        null_count: 0,
                      },
                    ],
                    table_count: 1,
                    column_count: 1,
                    row_count: 1,
                    null_count: 0,
                    content_digest: `sha256:${"a".repeat(64)}`,
                  },
                },
              ] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        release() {},
      };
    },
  };
  return { statements, value };
}

describe("Falcon24 PostgreSQL catalog verifier", () => {
  it("rebuilds a content-addressed db24 inventory inside a rolled-back snapshot", async () => {
    const scripted = connector({ schema_count: 1, target_present: true });
    const inventory = await verifyFalcon24CatalogInventory(scripted.value);

    expect(inventory).toMatchObject({
      schema_name: "falcon_db_24",
      table_count: 1,
      column_count: 1,
      row_count: 1,
      null_count: 0,
      inventory_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect(scripted.statements.at(0)).toBe("begin isolation level repeatable read");
    expect(scripted.statements.at(-1)).toBe("rollback");
  });

  it("fails closed and rolls back when another Falcon schema is present", async () => {
    const scripted = connector({ schema_count: 2, target_present: true });

    await expect(verifyFalcon24CatalogInventory(scripted.value)).rejects.toThrow(
      "FALCON24_CATALOG_VERIFICATION_SCOPE_DRIFT",
    );
    expect(scripted.statements.at(-1)).toBe("rollback");
  });
});
