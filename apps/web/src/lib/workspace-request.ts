import "server-only";

import type { SessionPrincipal } from "@data-agent/contracts";
import type { AppCapability, BoundaryResult } from "@data-agent/platform";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getWorkspaceSessionFromHeaders,
  resolveSessionWorkspaceCapability,
} from "./workspace-identity";

const workspaceIdSchema = z.uuid();

export interface WorkspaceRequestContext {
  readonly session: SessionPrincipal;
  readonly capability: AppCapability;
}

interface PublicPortError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

function failure<T>(code: string, message: string, retryable = false): BoundaryResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

export async function authorizeWorkspaceRequest(
  request: Request,
  workspaceId: string,
  access: "READ" | "WRITE",
): Promise<BoundaryResult<WorkspaceRequestContext>> {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) {
    return failure("WORKSPACE_ACCESS_DENIED", "工作空间不存在或无权访问。");
  }
  const assertedWorkspace = request.headers.get("x-workspace-id")?.trim();
  if (assertedWorkspace && assertedWorkspace !== parsed.data) {
    return failure("WORKSPACE_ACCESS_DENIED", "工作空间不存在或无权访问。");
  }
  const session = await getWorkspaceSessionFromHeaders(request.headers);
  if (!session.ok) return session;
  const capability = await resolveSessionWorkspaceCapability(session.value, parsed.data, access);
  if (!capability.ok) return capability;
  return { ok: true, value: { session: session.value, capability: capability.value } };
}

function statusForWorkspaceError(code: string): number {
  if (code === "AUTH_SESSION_REQUIRED" || code === "AUTH_SESSION_INVALID") return 401;
  if (code === "WORKSPACE_ROLE_DENIED" || code === "PERSISTENCE_WRITE_DENIED") return 403;
  if (
    code === "WORKSPACE_ACCESS_DENIED" ||
    code === "WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED" ||
    code.endsWith("_NOT_FOUND_OR_DENIED")
  ) {
    return 404;
  }
  if (code.endsWith("_INPUT_INVALID") || code.endsWith("_REQUIRED")) return 400;
  if (code.endsWith("_CONFLICT") || code.endsWith("_FROZEN") || code.endsWith("_IN_USE")) {
    return 409;
  }
  if (code.endsWith("_UNAVAILABLE") || code.endsWith("_FAILED")) return 503;
  return 400;
}

export function workspaceErrorResponse(error: PublicPortError): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message, retryable: error.retryable } },
    { status: statusForWorkspaceError(error.code) },
  );
}

export function workspaceRouteRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "WORKSPACE_ROUTE_REQUIRED",
        message: "请使用 /api/workspaces/:workspaceId 下的工作空间作用域接口。",
        retryable: false,
      },
    },
    { status: 410 },
  );
}
