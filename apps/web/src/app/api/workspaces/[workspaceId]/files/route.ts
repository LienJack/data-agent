import {
  buildJobSubmissionCommand,
  buildWorkspaceFileUploadCommitCommand,
  workspaceFileUploadIntentSchema,
} from "@data-agent/contracts";
import { createPostgresJobQueue } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { observeWorkspaceFileContent } from "@/lib/workspace-file-content";
import {
  getWorkspaceAuthority,
  getWorkspaceContent,
  getWorkspaceFiles,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const result = await getWorkspaceFiles().list(authorized.value.capability, {
    session_id: sessionId,
    limit: 100,
  });
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return workspaceErrorResponse({
      code: "WORKSPACE_FILE_UPLOAD_INPUT_INVALID",
      message: "文件上传必须使用 multipart/form-data。",
      retryable: false,
    });
  }
  const file = form.get("file");
  const intent = workspaceFileUploadIntentSchema.safeParse({
    schema_version: "workspace-file-upload-intent@1.0.0",
    original_filename: file instanceof File ? file.name : "",
    visibility: "SESSION",
    session_id: form.get("session_id"),
    idempotency_key: form.get("idempotency_key"),
  });
  if (!(file instanceof File) || !intent.success) {
    return workspaceErrorResponse({
      code: "WORKSPACE_FILE_UPLOAD_INPUT_INVALID",
      message: "文件、Session 或幂等键不符合严格合同。",
      retryable: false,
    });
  }
  let observed: Awaited<ReturnType<typeof observeWorkspaceFileContent>>;
  try {
    observed = await observeWorkspaceFileContent(file);
  } catch {
    return workspaceErrorResponse({
      code: "WORKSPACE_FILE_UPLOAD_INPUT_INVALID",
      message: "文件大小或内容格式不受支持。",
      retryable: false,
    });
  }
  const operationId = deriveIdempotentOperationId({
    operation_kind: "workspace-file-upload",
    workspace_id: workspaceId,
    principal_id: authorized.value.capability.principal,
    idempotency_key: intent.data.idempotency_key,
  });
  const content = getWorkspaceContent();
  const storageKey = content.createKey(authorized.value.capability, observed.blob_hash);
  const stored = await content.put(
    authorized.value.capability,
    storageKey,
    observed.bytes,
    observed.blob_hash,
  );
  if (!stored.ok) return workspaceErrorResponse(stored.error);
  const command = await buildWorkspaceFileUploadCommitCommand({
    schema_version: "workspace-file-upload-commit@1.0.0",
    operation_id: operationId,
    workspace_id: workspaceId,
    intent: intent.data,
    observed_content: {
      blob_hash: observed.blob_hash,
      byte_size: observed.byte_size,
      detected_mime: observed.detected_mime,
      storage_key: storageKey,
    },
  });
  const committed = await getWorkspaceFiles().commitUpload(authorized.value.capability, command);
  if (!committed.ok) return workspaceErrorResponse(committed.error);
  const revision = committed.value;
  const queue = createPostgresJobQueue(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
    authorized.value.capability,
    { lease_duration_ms: 30_000 },
  );
  const job = await queue.enqueue(
    await buildJobSubmissionCommand({
      schema_version: "job-submit@1.0.0",
      scope: authorized.value.capability.scope,
      kind: "FILE_SCAN",
      idempotency_key: `${intent.data.idempotency_key}/scan`,
      input: {
        schema_version: "job-input@1.0.0",
        kind: "FILE_SCAN",
        resource_refs: [],
        parameters: {
          file_id: revision.file_id,
          revision: revision.revision,
          revision_hash: revision.revision_hash,
        },
      },
      priority: 50,
      max_attempts: 3,
      cancel_policy: "COOPERATIVE",
    }),
  );
  return job.ok
    ? NextResponse.json({ data: { file: revision, scan_job: job.value } }, { status: 202 })
    : workspaceErrorResponse(job.error);
}
