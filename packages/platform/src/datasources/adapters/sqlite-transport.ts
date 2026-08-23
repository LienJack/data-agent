import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { DatasourceAdapterTransport } from "./common.js";
import { DatasourceAdapterPolicyError } from "./common.js";

const targetSchema = z.strictObject({
  path: z.string().min(1).max(4_096).refine(isAbsolute),
});

function parameters(values: readonly (string | number | boolean | null)[]) {
  return values.map((value) => (typeof value === "boolean" ? Number(value) : value));
}

function jsonValue(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
}

function openReadOnly(targetInput: unknown, timeoutMs: number): DatabaseSync {
  const target = targetSchema.parse(targetInput);
  const database = new DatabaseSync(target.path, {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    timeout: timeoutMs,
  });
  database.enableDefensive(true);
  database.exec("PRAGMA query_only=ON");
  return database;
}

export function createSqliteDatasourceTransport(): DatasourceAdapterTransport {
  const transport: DatasourceAdapterTransport = {
    async scanSchema({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      const database = openReadOnly(target, request.timeout_ms);
      try {
        const relations = z
          .array(z.object({ name: z.string().min(1), type: z.enum(["table", "view"]) }))
          .parse(
            database
              .prepare(
                "SELECT name,type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
              )
              .all(),
          );
        return relations.map((relation) => {
          const quoted = relation.name.replaceAll('"', '""');
          const columns = z
            .array(
              z.object({
                name: z.string().min(1),
                type: z.string(),
                notnull: z.number().int(),
              }),
            )
            .parse(database.prepare(`PRAGMA table_info("${quoted}")`).all());
          return {
            namespace: "main",
            name: relation.name,
            kind: relation.type === "table" ? ("TABLE" as const) : ("VIEW" as const),
            columns: columns.map((column) => ({
              name: column.name,
              type: column.type || "unknown",
              nullable: column.notnull === 0,
            })),
          };
        });
      } finally {
        database.close();
      }
    },
    async explain({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      const database = openReadOnly(target, request.limits.timeout_ms);
      try {
        database
          .prepare(`EXPLAIN QUERY PLAN ${request.statement}`)
          .all(...parameters(request.parameters));
      } finally {
        database.close();
      }
    },
    async execute({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      const database = openReadOnly(target, request.limits.timeout_ms);
      try {
        const statement = database.prepare(request.statement);
        const rows = statement
          .all(...parameters(request.parameters))
          .map((row) =>
            Object.fromEntries(Object.entries(row).map(([key, value]) => [key, jsonValue(value)])),
          );
        const columns = statement.columns().map((column) => ({
          name: column.name,
          type: column.type ?? "unknown",
        }));
        return { columns, rows };
      } finally {
        database.close();
      }
    },
  };
  return Object.freeze(transport);
}
