import { type NextRequest, NextResponse } from "next/server";
import { dataSourceRouteErrorResponse } from "@/lib/datasource-route";
import {
  type DataSourceConnectorPort,
  type ResolvedDataSourceCredential,
  resolveDataSourceCredential,
  unavailableSecretResolver,
} from "@/lib/datasource-secret";
import type {
  DatabaseType,
  TestConnectionInput,
  TestConnectionResult,
} from "@/lib/datasource-types";
import { DATABASE_TYPE_CONFIGS, testConnectionInputSchema } from "@/lib/datasource-types";

/**
 * Data Sources API — 测试数据库连接。
 *
 * M0 默认没有 Secret Provider，因此需要凭据的连接在驱动执行前失败关闭。
 */
export async function POST(request: NextRequest) {
  try {
    const input = testConnectionInputSchema.parse(await request.json());
    const config = DATABASE_TYPE_CONFIGS[input.type];

    for (const field of config.requiredFields) {
      const value = input[field];
      if (!value?.toString().trim()) {
        return NextResponse.json(
          { error: { code: "VALIDATION_ERROR", message: `请填写必填字段: ${field}` } },
          { status: 400 },
        );
      }
    }

    const result = await resolveDataSourceCredential(
      input,
      null,
      unavailableSecretResolver(),
      connector,
    );
    return NextResponse.json({ data: result });
  } catch (error) {
    return dataSourceRouteErrorResponse(error);
  }
}

const connector: DataSourceConnectorPort = {
  async test(input, credential) {
    const startTime = Date.now();
    const testers: Record<DatabaseType, ConnectorTester> = {
      postgresql: testPostgresql,
      mysql: testMySQL,
      clickhouse: testClickHouse,
      sqlite: testSQLite,
      trino: testTrino,
    };

    await testers[input.type](input, credential, DATABASE_TYPE_CONFIGS[input.type].defaultPort);

    return {
      success: true,
      message: "连接成功",
      latencyMs: Date.now() - startTime,
    } satisfies TestConnectionResult;
  },
};

type ConnectorTester = (
  input: TestConnectionInput,
  credential: ResolvedDataSourceCredential | undefined,
  defaultPort?: number,
) => Promise<void>;

async function testPostgresql(
  input: TestConnectionInput,
  credential: ResolvedDataSourceCredential | undefined,
  defaultPort?: number,
): Promise<void> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    host: input.host,
    port: input.port ?? defaultPort,
    database: input.database,
    user: credential?.username ?? input.username,
    password: credential?.secretValue,
    ssl: input.ssl !== "disable" ? { rejectUnauthorized: input.ssl === "verify-full" } : false,
    connectionTimeoutMillis: 5000,
  });

  await client.connect();
  await client.end();
}

async function testMySQL(
  input: TestConnectionInput,
  credential: ResolvedDataSourceCredential | undefined,
  defaultPort?: number,
): Promise<void> {
  const mysql2 = await import("mysql2/promise");
  const connection = await mysql2.createConnection({
    host: input.host,
    port: input.port ?? defaultPort,
    database: input.database,
    user: credential?.username ?? input.username,
    password: credential?.secretValue,
    ssl: input.ssl !== "disable" ? {} : undefined,
    connectTimeout: 5000,
  });

  await connection.connect();
  await connection.end();
}

async function testClickHouse(
  input: TestConnectionInput,
  credential: ResolvedDataSourceCredential | undefined,
  defaultPort = 8123,
): Promise<void> {
  const protocol = input.ssl !== "disable" ? "https" : "http";
  const url = new URL(`${protocol}://${input.host}:${input.port ?? defaultPort}/`);
  url.searchParams.set("query", "SELECT 1");
  if (input.database) {
    url.searchParams.set("database", input.database);
  }

  const headers: Record<string, string> = {};
  const username = credential?.username ?? input.username;
  if (username && credential) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${credential.secretValue}`).toString("base64")}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url.toString(), { headers, signal: controller.signal });
    const text = await response.text();
    if (!response.ok || !text.trim()) {
      throw new Error("ClickHouse connection check failed");
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function testSQLite(
  input: TestConnectionInput,
  _credential: ResolvedDataSourceCredential | undefined,
): Promise<void> {
  if (!input.path) {
    throw new Error("SQLite path is required");
  }

  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(input.path, { readOnly: true });
  try {
    const row = database.prepare("SELECT 1 AS ok").get() as { ok?: number } | undefined;
    if (row?.ok !== 1) {
      throw new Error("SQLite connection check failed");
    }
  } finally {
    database.close();
  }
}

async function testTrino(
  input: TestConnectionInput,
  credential: ResolvedDataSourceCredential | undefined,
  defaultPort = 8080,
): Promise<void> {
  const protocol = input.ssl !== "disable" ? "https" : "http";
  const base = `${protocol}://${input.host}:${input.port ?? defaultPort}`;
  const username = credential?.username ?? input.username ?? "";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Trino-User": username,
  };
  if (credential) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${credential.secretValue}`).toString("base64")}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const firstResponse = await fetch(`${base}/v1/statement`, {
      method: "POST",
      body: "SELECT 1",
      headers,
      signal: controller.signal,
    });
    if (!firstResponse.ok) {
      throw new Error("Trino connection check failed");
    }

    let payload = (await firstResponse.json()) as {
      nextUri?: string;
      stats?: { state?: string };
      error?: unknown;
    };
    let state = payload.stats?.state ?? "UNKNOWN";
    let nextUri = payload.nextUri;
    let guard = 0;

    while (nextUri && state !== "FINISHED" && state !== "FAILED" && guard < 10) {
      guard += 1;
      const response = await fetch(nextUri, { headers, signal: controller.signal });
      if (!response.ok) {
        throw new Error("Trino connection check failed");
      }
      payload = (await response.json()) as typeof payload;
      state = payload.stats?.state ?? state;
      nextUri = payload.nextUri;
    }

    if (state === "FAILED" || payload.error) {
      throw new Error("Trino connection check failed");
    }
  } finally {
    clearTimeout(timeout);
  }
}
