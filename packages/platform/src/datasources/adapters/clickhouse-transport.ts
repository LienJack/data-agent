import { Buffer } from "node:buffer";
import { Agent as HttpsAgent } from "node:https";
import { createClient } from "@clickhouse/client";
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

interface ClickhouseResultPort {
  json(): Promise<unknown>;
}

interface ClickhouseClientPort {
  query(input: {
    readonly query: string;
    readonly format: "JSONEachRow";
    readonly query_params: Readonly<Record<string, string | number | boolean | null>>;
    readonly clickhouse_settings: Readonly<Record<string, string | number>>;
    readonly abort_signal: AbortSignal;
  }): Promise<ClickhouseResultPort>;
  close(): Promise<void>;
}

export interface ClickhouseClientFactory {
  connect(target: z.infer<typeof targetSchema>, timeoutMs: number): ClickhouseClientPort;
}

const defaultFactory: ClickhouseClientFactory = {
  connect(target, timeoutMs) {
    return createClient({
      url: `https://${target.address}:${target.port}`,
      username: target.username,
      password: target.password,
      database: target.database,
      request_timeout: timeoutMs,
      max_open_connections: 1,
      compression: { request: false, response: false },
      http_agent: new HttpsAgent({
        ca: Buffer.from(target.ca),
        servername: target.server_name,
        rejectUnauthorized: true,
        keepAlive: false,
      }),
    });
  },
};

function parameters(values: readonly (string | number | boolean | null)[]) {
  return Object.fromEntries(values.map((value, index) => [`p${index + 1}`, value]));
}

function settings(timeoutMs: number, maxRows: number) {
  return {
    readonly: 2,
    max_execution_time: Math.max(1, Math.ceil(timeoutMs / 1_000)),
    max_result_rows: maxRows,
    result_overflow_mode: "throw",
  } as const;
}

function rows(input: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(input)) {
    throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
  }
  return input.map((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
    }
    return row as Record<string, unknown>;
  });
}

export function createClickhouseDatasourceTransport(
  factory: ClickhouseClientFactory = defaultFactory,
): DatasourceAdapterTransport {
  const transport: DatasourceAdapterTransport = {
    async scanSchema({ request, target, signal }) {
      const approved = targetSchema.parse(target);
      const client = factory.connect(approved, request.timeout_ms);
      try {
        const result = await client.query({
          query: `SELECT database AS namespace,table AS name,name AS column_name,type
            FROM system.columns
            WHERE database=currentDatabase()
            ORDER BY database,table,position
            LIMIT ${request.max_objects * 512}`,
          format: "JSONEachRow",
          query_params: {},
          clickhouse_settings: settings(request.timeout_ms, request.max_objects * 512),
          abort_signal: signal,
        });
        const values = z
          .array(
            z.object({
              namespace: z.string(),
              name: z.string(),
              column_name: z.string(),
              type: z.string(),
            }),
          )
          .parse(await result.json());
        const grouped = new Map<
          string,
          {
            namespace: string;
            name: string;
            kind: "TABLE";
            columns: { name: string; type: string; nullable: boolean }[];
          }
        >();
        for (const row of values) {
          const key = `${row.namespace}.${row.name}`;
          const item = grouped.get(key) ?? {
            namespace: row.namespace,
            name: row.name,
            kind: "TABLE" as const,
            columns: [],
          };
          item.columns.push({
            name: row.column_name,
            type: row.type,
            nullable: /^Nullable\(/.test(row.type),
          });
          grouped.set(key, item);
        }
        return [...grouped.values()];
      } finally {
        await client.close();
      }
    },
    async explain({ request, target, signal }) {
      const approved = targetSchema.parse(target);
      const client = factory.connect(approved, request.limits.timeout_ms);
      try {
        const result = await client.query({
          query: `EXPLAIN SYNTAX ${request.statement}`,
          format: "JSONEachRow",
          query_params: parameters(request.parameters),
          clickhouse_settings: settings(request.limits.timeout_ms, request.limits.max_rows),
          abort_signal: signal,
        });
        await result.json();
      } finally {
        await client.close();
      }
    },
    async execute({ request, target, signal }) {
      const approved = targetSchema.parse(target);
      const client = factory.connect(approved, request.limits.timeout_ms);
      try {
        const result = await client.query({
          query: request.statement,
          format: "JSONEachRow",
          query_params: parameters(request.parameters),
          clickhouse_settings: settings(request.limits.timeout_ms, request.limits.max_rows),
          abort_signal: signal,
        });
        const values = rows(await result.json());
        const names = Object.keys(values[0] ?? {}).toSorted();
        return {
          columns: names.map((name) => ({ name, type: "unknown" })),
          rows: values,
        };
      } finally {
        await client.close();
      }
    },
  };
  return Object.freeze(transport);
}
