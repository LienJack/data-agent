import "server-only";

import { immutableIdSchema, schemaScanRequestSchema } from "@data-agent/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  type SchemaDiscoveryAuthorityContext,
  SchemaDiscoveryAuthorityError,
} from "./schema-discovery-authority";
import type { SchemaDiscoveryRuntime } from "./schema-discovery-runtime";

const datasourceIdSchema = schemaScanRequestSchema.shape.datasource_id;

function errorStatus(code: string): number {
  if (code === "SCHEMA_SCAN_SCOPE_FORBIDDEN") return 403;
  if (code === "SCHEMA_SCAN_NOT_FOUND" || code === "SCHEMA_SCAN_SNAPSHOT_NOT_FOUND") return 404;
  if (code === "SCHEMA_SCAN_TIMEOUT") return 504;
  if (code === "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE") return 503;
  if (code === "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID") return 400;
  if (code === "SCHEMA_SCAN_IDEMPOTENCY_CONFLICT") return 409;
  return 500;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: {
          code: "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID",
          message: "请求内容不符合 Schema Discovery 契约。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof SchemaDiscoveryAuthorityError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message:
            error.code === "SCHEMA_SCAN_SCOPE_FORBIDDEN"
              ? "当前 Authority 不允许访问该 datasource 物理结构。"
              : "Schema Discovery Authority 尚未配置。",
          retryable: error.retryable,
        },
      },
      { status: errorStatus(error.code) },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
        message: "当前无法读取 datasource 物理结构。",
        retryable: true,
      },
    },
    { status: 503 },
  );
}

function resultResponse<T>(
  result:
    | Awaited<ReturnType<SchemaDiscoveryRuntime["service"]["getSnapshot"]>>
    | { ok: true; value: T },
  successStatus = 200,
): NextResponse {
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: errorStatus(result.error.code) });
  }
  return NextResponse.json(
    { data: result.value, meta: { authority: "POSTGRESQL", evidence_class: "PHYSICAL_ONLY" } },
    { status: successStatus },
  );
}

async function authority(
  runtime: SchemaDiscoveryRuntime,
  access: "READ" | "WRITE",
): Promise<SchemaDiscoveryAuthorityContext> {
  return runtime.authorityResolver.resolve({ access });
}

export async function handleStartSchemaScan(
  request: Request,
  params: Promise<{ id: string }>,
  runtime: SchemaDiscoveryRuntime,
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const parsedDatasourceId = datasourceIdSchema.parse(id);
    const scanRequest = schemaScanRequestSchema.parse(await request.json());
    if (scanRequest.datasource_id !== parsedDatasourceId) {
      throw new z.ZodError([]);
    }
    const resolvedAuthority = await authority(runtime, "WRITE");
    const result = await runtime.service.startScan(resolvedAuthority, scanRequest, request.signal);
    if (!result.ok) return resultResponse(result);
    return resultResponse(result, result.value.scan.created ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetSchemaScan(
  params: Promise<{ id: string; runId: string }>,
  runtime: SchemaDiscoveryRuntime,
): Promise<NextResponse> {
  try {
    const { id, runId } = await params;
    const parsedDatasourceId = datasourceIdSchema.parse(id);
    const parsedRunId = immutableIdSchema.parse(runId);
    const resolvedAuthority = await authority(runtime, "READ");
    return resultResponse(
      await runtime.service.getScan(resolvedAuthority, parsedDatasourceId, parsedRunId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetSchemaSnapshot(
  params: Promise<{ snapshotId: string }>,
  runtime: SchemaDiscoveryRuntime,
): Promise<NextResponse> {
  try {
    const { snapshotId } = await params;
    const parsedSnapshotId = immutableIdSchema.parse(snapshotId);
    const resolvedAuthority = await authority(runtime, "READ");
    return resultResponse(await runtime.service.getSnapshot(resolvedAuthority, parsedSnapshotId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetSchemaDiff(
  request: Request,
  params: Promise<{ snapshotId: string }>,
  runtime: SchemaDiscoveryRuntime,
): Promise<NextResponse> {
  try {
    const { snapshotId } = await params;
    const baseSnapshotId = new URL(request.url).searchParams.get("baseSnapshotId");
    const parsedBaseSnapshotId = immutableIdSchema.parse(baseSnapshotId);
    const parsedCurrentSnapshotId = immutableIdSchema.parse(snapshotId);
    const resolvedAuthority = await authority(runtime, "READ");
    return resultResponse(
      await runtime.service.compareSnapshots(
        resolvedAuthority,
        parsedBaseSnapshotId,
        parsedCurrentSnapshotId,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
