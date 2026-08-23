import {
  artifactExportCommandSchema,
  buildJobSubmissionCommand,
  loadArtifactExportCommandSchema,
} from "@data-agent/contracts";
import {
  createPostgresArtifactWorkspaceStore,
  createPostgresRepository,
} from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import {
  ArtifactWorkspaceError,
  createArtifactWorkspaceService,
} from "@/lib/artifact-workspace-service";
import { getWorkspaceJobQueue } from "@/lib/job-center";
import { getWorkspaceAuthority, getWorkspaceSqlPool } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

function workspaceService() {
  const pool = getWorkspaceSqlPool();
  const authorizer = getWorkspaceAuthority().authorizer;
  return createArtifactWorkspaceService({
    repository: createPostgresRepository(pool, authorizer),
    exportStore: createPostgresArtifactWorkspaceStore({ pool, authorizer }),
  });
}

function decode(value: string | null): unknown {
  if (!value || value.length > 8_192) throw new Error("missing receipt");
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function failure(error: unknown) {
  if (error instanceof ArtifactWorkspaceError) {
    return workspaceErrorResponse({ code: error.code, message: error.message, retryable: false });
  }
  return workspaceErrorResponse({
    code: "ARTIFACT_EXPORT_INPUT_INVALID",
    message: "Artifact export 请求不符合契约。",
    retryable: false,
  });
}

type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { workspaceId, artifactId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  try {
    const command = artifactExportCommandSchema.parse(await request.json());
    if (
      command.source_ref.artifact_id !== artifactId ||
      command.source_ref.tenant_id !== workspaceId
    ) {
      return workspaceErrorResponse({
        code: "WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED",
        message: "Artifact 不存在或无权访问。",
        retryable: false,
      });
    }
    const jobCommand = await buildJobSubmissionCommand({
      schema_version: "job-submit@1.0.0",
      scope: {
        app_id: command.source_ref.app_id,
        tenant_id: command.source_ref.tenant_id,
        environment: command.source_ref.environment,
      },
      kind: "ARTIFACT_EXPORT",
      idempotency_key: `artifact-export:${command.idempotency_key}`,
      input: {
        schema_version: "job-input@1.0.0",
        kind: "ARTIFACT_EXPORT",
        resource_refs: [command.source_ref],
        parameters: {
          format: command.format,
          filename_stem: command.filename_stem,
          export_idempotency_key: command.idempotency_key,
        },
      },
      priority: 50,
      max_attempts: 3,
      cancel_policy: "COOPERATIVE",
    });
    const submitted = await getWorkspaceJobQueue(authorized.value.capability).enqueue(jobCommand);
    if (!submitted.ok) return workspaceErrorResponse(submitted.error);
    return NextResponse.json(
      {
        disposition: submitted.value.disposition,
        job: submitted.value,
      },
      {
        status: 202,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: NextRequest, context: Context) {
  const { workspaceId, artifactId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  try {
    const command = loadArtifactExportCommandSchema.parse(
      decode(request.nextUrl.searchParams.get("receipt")),
    );
    if (
      command.source_ref.artifact_id !== artifactId ||
      command.source_ref.tenant_id !== workspaceId
    ) {
      return workspaceErrorResponse({
        code: "WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED",
        message: "Artifact Export 不存在或无权访问。",
        retryable: false,
      });
    }
    const download = await workspaceService().download(authorized.value.capability, command);
    return new NextResponse(Buffer.from(download.bytes), {
      headers: {
        "Content-Type": download.receipt.mime_type,
        "Content-Disposition": `attachment; filename="${download.receipt.attachment_filename}"`,
        "Content-Length": String(download.bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
