import { artifactReferenceSchema } from "@data-agent/contracts";
import {
  createPostgresArtifactWorkspaceStore,
  createPostgresRepository,
} from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import {
  ArtifactWorkspaceError,
  createArtifactWorkspaceService,
} from "@/lib/artifact-workspace-service";
import { getWorkspaceAuthority, getWorkspaceSqlPool } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

function decodeReference(value: string | null): unknown {
  if (!value || value.length > 4_096) throw new Error("missing reference");
  if (value.startsWith("{")) return JSON.parse(value);
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function service() {
  const pool = getWorkspaceSqlPool();
  const authorizer = getWorkspaceAuthority().authorizer;
  return createArtifactWorkspaceService({
    repository: createPostgresRepository(pool, authorizer),
    exportStore: createPostgresArtifactWorkspaceStore({ pool, authorizer }),
  });
}

function safeFailure(error: unknown) {
  if (error instanceof ArtifactWorkspaceError) {
    return workspaceErrorResponse({ code: error.code, message: error.message, retryable: false });
  }
  return workspaceErrorResponse({
    code: "ARTIFACT_PREVIEW_INPUT_INVALID",
    message: "Artifact preview 请求不符合契约。",
    retryable: false,
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; artifactId: string }> },
) {
  const { workspaceId, artifactId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  try {
    const reference = artifactReferenceSchema.parse(
      decodeReference(request.nextUrl.searchParams.get("reference")),
    );
    if (reference.artifact_id !== artifactId || reference.tenant_id !== workspaceId) {
      return workspaceErrorResponse({
        code: "WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED",
        message: "Artifact 不存在或无权访问。",
        retryable: false,
      });
    }
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    const preview = await service().preview(authorized.value.capability, reference, {
      offset,
      limit,
    });
    return NextResponse.json(preview, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}
