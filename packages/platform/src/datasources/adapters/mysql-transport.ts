import { Buffer } from "node:buffer";
import { connect as connectTls } from "node:tls";
import { createConnection } from "mysql2/promise";
import { z } from "zod";
import type { DatasourceAdapterTransport } from "./common.js";
import { DatasourceAdapterPolicyError } from "./common.js";

const targetSchema = z.strictObject({
  address: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  server_name: z.string().min(1).max(255),
  database: z.string().min(1).max(255),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(16_384),
  ca: z.string().min(1).max(1_000_000),
});

interface MysqlConnectionPort {
  query(options: unknown, values?: unknown[]): Promise<[unknown, readonly unknown[]]>;
  end(): Promise<void>;
}

export interface MysqlConnectionFactory {
  connect(target: z.infer<typeof targetSchema>, timeoutMs: number): Promise<MysqlConnectionPort>;
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
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
}

const defaultFactory: MysqlConnectionFactory = {
  async connect(target, timeoutMs) {
    const connection = await createConnection({
      host: target.server_name,
      port: target.port,
      user: target.username,
      password: target.password,
      database: target.database,
      connectTimeout: timeoutMs,
      multipleStatements: false,
      namedPlaceholders: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      stream: () =>
        connectTls({
          host: target.address,
          port: target.port,
          servername: target.server_name,
          ca: target.ca,
          rejectUnauthorized: true,
        }),
    });
    return {
      async query(options, values = []) {
        if (typeof options === "string") {
          const [rows, fields] = await connection.query(options, values);
          return [rows, fields];
        }
        const parsed = z
          .strictObject({ sql: z.string().min(1), timeout: z.number().int().positive() })
          .parse(options);
        const [rows, fields] = await connection.query(parsed, values);
        return [rows, fields];
      },
      end: () => connection.end(),
    };
  },
};

export function createMysqlDatasourceTransport(
  factory: MysqlConnectionFactory = defaultFactory,
): DatasourceAdapterTransport {
  const transport: DatasourceAdapterTransport = {
    async scanSchema({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      const approved = targetSchema.parse(target);
      const connection = await factory.connect(approved, request.timeout_ms);
      try {
        const [rowValue] = await connection.query(
          {
            sql: `SELECT c.table_schema,c.table_name,t.table_type,c.column_name,c.column_type,c.is_nullable
              FROM information_schema.columns c
              JOIN information_schema.tables t
                ON t.table_schema=c.table_schema AND t.table_name=c.table_name
              WHERE c.table_schema=?
              ORDER BY c.table_schema,c.table_name,c.ordinal_position
              LIMIT ${request.max_objects * 512}`,
            timeout: request.timeout_ms,
          },
          [approved.database],
        );
        const rows = z
          .array(
            z.object({
              table_schema: z.string(),
              table_name: z.string(),
              table_type: z.string(),
              column_name: z.string(),
              column_type: z.string(),
              is_nullable: z.string(),
            }),
          )
          .parse(rowValue);
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
            type: row.column_type,
            nullable: row.is_nullable === "YES",
          });
          grouped.set(key, item);
        }
        return [...grouped.values()];
      } finally {
        await connection.end();
      }
    },
    async explain({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      const approved = targetSchema.parse(target);
      const connection = await factory.connect(approved, request.limits.timeout_ms);
      try {
        await connection.query(
          { sql: `EXPLAIN ${request.statement}`, timeout: request.limits.timeout_ms },
          [...request.parameters],
        );
      } finally {
        await connection.end();
      }
    },
    async execute({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      const approved = targetSchema.parse(target);
      const connection = await factory.connect(approved, request.limits.timeout_ms);
      try {
        await connection.query("SET SESSION TRANSACTION READ ONLY");
        await connection.query("START TRANSACTION READ ONLY");
        const [rowValue, fieldValue] = await connection.query(
          { sql: request.statement, timeout: request.limits.timeout_ms },
          [...request.parameters],
        );
        if (!Array.isArray(rowValue) || !Array.isArray(fieldValue)) {
          throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
        }
        const rows = rowValue.map((row) => {
          if (typeof row !== "object" || row === null || Array.isArray(row)) {
            throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
          }
          return Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, jsonValue(value)]),
          );
        });
        const columns = fieldValue.map((field) => {
          if (typeof field !== "object" || field === null || !("name" in field)) {
            throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
          }
          return {
            name: String(field.name),
            type: "type" in field ? String(field.type) : "unknown",
          };
        });
        return { columns, rows };
      } finally {
        try {
          await connection.query("ROLLBACK");
        } finally {
          await connection.end();
        }
      }
    },
  };
  return Object.freeze(transport);
}
