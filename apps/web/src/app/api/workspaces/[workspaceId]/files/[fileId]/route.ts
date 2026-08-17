import {
  buildWorkspaceFileDeleteCommand,
  buildWorkspaceFilePromoteCommand,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { getWorkspaceContent, getWorkspaceFiles } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string; fileId: string }> };
const referenceInputSchema = z.strictObject({
  revision: z.coerce.number().int().positive().safe(),
  revision_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
const mutationInputSchema = referenceInputSchema.extend({
  idempotency_key: workspaceIdempotencyKeySchema,
});

function disposition(filename: string): string {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 120) || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, fileId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const parsed = referenceInputSchema.safeParse({
    revision: request.nextUrl.searchParams.get("revision"),
    revision_hash: request.nextUrl.searchParams.get("revision_hash"),
  });
  if (!parsed.success) {
    return workspaceErrorResponse({
      code: "WORKSPACE_FILE_DOWNLOAD_INPUT_INVALID",
      message: "下载必须绑定 exact File Revision。",
      retryable: false,
    });
  }
  const authority = await getWorkspaceFiles().resolveDownload(authorized.value.capability, {
    file_id: fileId,
    ...parsed.data,
  });
  if (!authority.ok) return workspaceErrorResponse(authority.error);
  const bytes = await getWorkspaceContent().get(
    authorized.value.capability,
    authority.value.storage_key,
    authority.value.blob_hash,
    authority.value.byte_size,
  );
  if (!bytes.ok) return workspaceErrorResponse(bytes.error);
  if (bytes.value === null) {
    return workspaceErrorResponse({
      code: "WORKSPACE_FILE_BLOB_NOT_FOUND",
      message: "文件内容暂不可用。",
      retryable: false,
    });
  }
  return new NextResponse(bytes.value as BodyInit, {
    headers: {
      "Content-Type": authority.value.detected_mime,
      "Content-Length": String(authority.value.byte_size),
      "Content-Disposition": disposition(authority.value.file.original_filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { workspaceId, fileId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = mutationInputSchema
    .extend({ action: z.literal("PROMOTE") })
    .safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "WORKSPACE_FILE_PROMOTE_INPUT_INVALID",
      message: "文件提升请求不符合严格合同。",
      retryable: false,
    });
  }
  const command = await buildWorkspaceFilePromoteCommand({
    schema_version: "workspace-file-promote@1.0.0",
    operation_id: deriveIdempotentOperationId({
      operation_kind: "workspace-file-promote",
      workspace_id: workspaceId,
      principal_id: authorized.value.capability.principal,
      idempotency_key: input.data.idempotency_key,
    }),
    workspace_id: workspaceId,
    file_ref: {
      file_id: fileId,
      revision: input.data.revision,
      revision_hash: input.data.revision_hash,
    },
    idempotency_key: input.data.idempotency_key,
  });
  const result = await getWorkspaceFiles().promote(authorized.value.capability, command);
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { workspaceId, fileId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = mutationInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "WORKSPACE_FILE_DELETE_INPUT_INVALID",
      message: "文件删除请求不符合严格合同。",
      retryable: false,
    });
  }
  const command = await buildWorkspaceFileDeleteCommand({
    schema_version: "workspace-file-delete@1.0.0",
    operation_id: deriveIdempotentOperationId({
      operation_kind: "workspace-file-delete",
      workspace_id: workspaceId,
      principal_id: authorized.value.capability.principal,
      idempotency_key: input.data.idempotency_key,
    }),
    workspace_id: workspaceId,
    file_ref: {
      file_id: fileId,
      revision: input.data.revision,
      revision_hash: input.data.revision_hash,
    },
    idempotency_key: input.data.idempotency_key,
  });
  const result = await getWorkspaceFiles().delete(authorized.value.capability, command);
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}
