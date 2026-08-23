import { Buffer } from "node:buffer";
import pg from "pg";
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

interface PostgresqlConnectionPort {
  query(input: string | { readonly text: string; readonly values?: unknown[] }): Promise<{
    readonly rows: unknown[];
    readonly fields: readonly { readonly name: string; readonly dataTypeID?: number }[];
  }>;
  end(): Promise<void>;
}

export interface PostgresqlConnectionFactory {
  connect(
    target: z.infer<typeof targetSchema>,
    timeoutMs: number,
  ): Promise<PostgresqlConnectionPort>;
}

const defaultFactory: PostgresqlConnectionFactory = {
  async connect(target, timeoutMs) {
    const client = new pg.Client({
      host: target.address,
      port: target.port,
      database: target.database,
      user: target.username,
      password: target.password,
      connectionTimeoutMillis: timeoutMs,
      ssl: {
        ca: target.ca,
        servername: target.server_name,
        rejectUnauthorized: true,
      },
    });
    await client.connect();
    return {
      async query(input) {
        const result =
          typeof input === "string"
            ? await client.query<Record<string, unknown>>(input)
            : await client.query<Record<string, unknown>>(input.text, input.values ?? []);
        return { rows: result.rows, fields: result.fields };
      },
      end: () => client.end(),
    };
  },
};

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
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
  }
  throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
}

async function beginReadOnly(connection: PostgresqlConnectionPort, timeoutMs: number) {
  await connection.query("BEGIN READ ONLY");
  await connection.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
  await connection.query("SET LOCAL default_transaction_read_only = on");
}

export function createPostgresqlDatasourceTransport(
  factory: PostgresqlConnectionFactory = defaultFactory,
): DatasourceAdapterTransport {
  const transport: DatasourceAdapterTransport = {
    async scanSchema({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      const approved = targetSchema.parse(target);
      const connection = await factory.connect(approved, request.timeout_ms);
      try {
        await beginReadOnly(connection, request.timeout_ms);
        const result = await connection.query({
          text: `SELECT c.table_schema,c.table_name,t.table_type,c.column_name,c.data_type,c.is_nullable
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_catalog=c.table_catalog AND t.table_schema=c.table_schema
             AND t.table_name=c.table_name
            WHERE c.table_schema NOT IN ('information_schema','pg_catalog')
            ORDER BY c.table_schema,c.table_name,c.ordinal_position
            LIMIT $1`,
          values: [request.max_objects * 512],
        });
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
          .parse(result.rows);
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
      } finally {
        try {
          await connection.query("ROLLBACK");
        } finally {
          await connection.end();
        }
      }
    },
    async explain({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      const approved = targetSchema.parse(target);
      const connection = await factory.connect(approved, request.limits.timeout_ms);
      try {
        await beginReadOnly(connection, request.limits.timeout_ms);
        await connection.query({
          text: `EXPLAIN (FORMAT JSON) ${request.statement}`,
          values: [...request.parameters],
        });
      } finally {
        try {
          await connection.query("ROLLBACK");
        } finally {
          await connection.end();
        }
      }
    },
    async execute({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      const approved = targetSchema.parse(target);
      const connection = await factory.connect(approved, request.limits.timeout_ms);
      try {
        await beginReadOnly(connection, request.limits.timeout_ms);
        const result = await connection.query({
          text: request.statement,
          values: [...request.parameters],
        });
        const rows = result.rows.map((row) => {
          if (typeof row !== "object" || row === null || Array.isArray(row)) {
            throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
          }
          return Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, jsonValue(value)]),
          );
        });
        return {
          columns: result.fields.map((field) => ({
            name: field.name,
            type: field.dataTypeID === undefined ? "unknown" : String(field.dataTypeID),
          })),
          rows,
        };
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
