import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";
import { DuckDBInstance, StatementType } from "@duckdb/node-api";
import { z } from "zod";
import type { DatasourceAdapterTransport } from "./common.js";
import { DatasourceAdapterPolicyError } from "./common.js";
import type { DuckdbStatementExtractor } from "./duckdb.js";

const targetSchema = z.strictObject({
  path: z.string().min(1).max(4_096).refine(isAbsolute),
});

async function withConnection<T>(
  targetInput: unknown,
  operation: (connection: Awaited<ReturnType<DuckDBInstance["connect"]>>) => Promise<T>,
): Promise<T> {
  const target = targetSchema.parse(targetInput);
  const instance = await DuckDBInstance.create(target.path, {
    access_mode: "READ_ONLY",
    enable_external_access: "false",
    allow_unsigned_extensions: "false",
  });
  const connection = await instance.connect();
  try {
    return await operation(connection);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function jsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
  }
  throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
}

export function createDuckdbStatementExtractor(target: unknown): DuckdbStatementExtractor {
  return {
    extract(statement) {
      return withConnection(target, async (connection) => {
        const extracted = await connection.extractStatements(statement);
        const prepared = extracted.count === 1 ? await extracted.prepare(0) : null;
        return {
          statement_count: extracted.count,
          statement_type:
            prepared?.statementType === StatementType.SELECT ? "SELECT" : "NON_SELECT",
          relations: [...statement.matchAll(/\b(?:FROM|JOIN)\s+"?([A-Za-z_][A-Za-z0-9_.]*)"?/gi)]
            .map((match) => match[1] ?? "")
            .toSorted(),
          external_access:
            /\b(?:ATTACH|COPY|INSTALL|LOAD|read_csv|read_json|read_parquet|httpfs)\b/i.test(
              statement,
            ),
        };
      });
    },
  };
}

export function createDuckdbDatasourceTransport(): DatasourceAdapterTransport {
  const transport: DatasourceAdapterTransport = {
    async scanSchema({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      return withConnection(target, async (connection) => {
        const reader = await connection.runAndReadAll(`
          SELECT c.table_schema,c.table_name,t.table_type,c.column_name,c.data_type,c.is_nullable
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_catalog=c.table_catalog AND t.table_schema=c.table_schema
           AND t.table_name=c.table_name
          WHERE c.table_schema NOT IN ('information_schema','pg_catalog')
          ORDER BY c.table_schema,c.table_name,c.ordinal_position
          LIMIT ${request.max_objects * 512}
        `);
        const rows = z
          .array(
            z.object({
              table_schema: z.string(),
              table_name: z.string(),
              table_type: z.string(),
              column_name: z.string(),
              data_type: z.string(),
              is_nullable: z.string(),
            }),
          )
          .parse(reader.getRowObjectsJson());
        const grouped = new Map<
          string,
          {
            namespace: string;
            name: string;
            kind: "TABLE" | "VIEW";
            columns: { name: string; type: string; nullable: boolean }[];
          }
        >();
        for (const row of rows) {
          const key = `${row.table_schema}.${row.table_name}`;
          const item = grouped.get(key) ?? {
            namespace: row.table_schema,
            name: row.table_name,
            kind: row.table_type === "VIEW" ? ("VIEW" as const) : ("TABLE" as const),
            columns: [],
          };
          item.columns.push({
            name: row.column_name,
            type: row.data_type,
            nullable: row.is_nullable === "YES",
          });
          grouped.set(key, item);
        }
        return [...grouped.values()];
      });
    },
    async explain({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      await withConnection(target, async (connection) => {
        await connection.runAndReadAll(`EXPLAIN ${request.statement}`, request.parameters);
      });
    },
    async execute({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      return withConnection(target, async (connection) => {
        const reader = await connection.runAndReadAll(request.statement, request.parameters);
        const names = reader.deduplicatedColumnNames();
        const types = reader.columnTypes();
        const rows = reader
          .getRowsJson()
          .map((row) =>
            Object.fromEntries(names.map((name, index) => [name, jsonValue(row[index])])),
          );
        return {
          columns: names.map((name, index) => ({
            name,
            type: types[index]?.toString() ?? "unknown",
          })),
          rows,
        };
      });
    },
  };
  return Object.freeze(transport);
}
