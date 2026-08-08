import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  dataSourceConnections,
  type StoredDataSourceConnection,
} from "@/lib/datasource-repository";
import { dataSourceRouteErrorResponse } from "@/lib/datasource-route";
import type { DataSourceConnection } from "@/lib/datasource-types";
import { createDataSourceInputSchema, DATABASE_TYPE_CONFIGS } from "@/lib/datasource-types";
import { publicSemanticGovernanceError } from "@/lib/semantic-governance-error";

/**
 * Data Sources API — 数据源连接管理。
 *
 * GET  /api/datasources — 获取所有数据源连接
 * POST /api/datasources — 创建新数据源连接
 */

// ─── GET /api/datasources ──────────────────────────────────────────────────────

export async function GET() {
  const list: DataSourceConnection[] = Array.from(dataSourceConnections.values()).map((conn) => ({
    id: conn.id,
    name: conn.name,
    type: conn.type,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    username: conn.username,
    credentialRef: conn.credentialRef,
    ssl: conn.ssl,
    path: conn.path,
    catalog: conn.catalog,
    schema: conn.schema,
    status: conn.status,
    lastTestedAt: conn.lastTestedAt,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  }));

  return NextResponse.json({ data: list });
}

// ─── POST /api/datasources ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = createDataSourceInputSchema.parse(await request.json());

    const config = DATABASE_TYPE_CONFIGS[body.type];
    if (!config) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "不支持的数据库类型" } },
        { status: 400 },
      );
    }

    // 按类型配置校验必填字段
    for (const field of config.requiredFields) {
      const value = body[field];
      if (!value?.toString().trim()) {
        return NextResponse.json(
          { error: { code: "VALIDATION_ERROR", message: `请填写必填字段: ${field}` } },
          { status: 400 },
        );
      }
    }

    if (config.requiresCredential && !body.credentialRef) {
      throw publicSemanticGovernanceError("DATASOURCE_CREDENTIAL_REF_INVALID");
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const stored: StoredDataSourceConnection = {
      id,
      name: body.name.trim(),
      type: body.type,
      host: body.host?.trim(),
      port: body.port,
      database: body.database?.trim(),
      username: body.username?.trim(),
      credentialRef: body.credentialRef,
      ssl: body.ssl ?? "disable",
      path: body.path?.trim(),
      catalog: body.catalog?.trim(),
      schema: body.schema?.trim(),
      status: "unknown",
      createdAt: now,
      updatedAt: now,
    };

    dataSourceConnections.set(id, stored);

    const result: DataSourceConnection = {
      id: stored.id,
      name: stored.name,
      type: stored.type,
      host: stored.host,
      port: stored.port,
      database: stored.database,
      username: stored.username,
      credentialRef: stored.credentialRef,
      ssl: stored.ssl,
      path: stored.path,
      catalog: stored.catalog,
      schema: stored.schema,
      status: stored.status,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return dataSourceRouteErrorResponse(error);
  }
}
