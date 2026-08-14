import "server-only";

import type { SessionPrincipal } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getOperationsAdminRepository,
  getWorkspaceDeploymentId,
  getWorkspaceSessionFromHeaders,
} from "./workspace-identity";

export type OperationsAdminRequest = Readonly<{
  principal: SessionPrincipal;
  context: { readonly deployment_id: string; readonly principal_id: string };
  repository: ReturnType<typeof getOperationsAdminRepository>;
}>;

export type WorkspaceMembersRequest = Readonly<{
  principal: SessionPrincipal;
  context: {
    readonly deployment_id: string;
    readonly principal_id: string;
    readonly workspace_id: string;
  };
  repository: ReturnType<typeof getOperationsAdminRepository>;
}>;

type Authorized<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: NextResponse };

export async function authorizeOperationsAdminRequest(
  request: NextRequest,
): Promise<Authorized<OperationsAdminRequest>> {
  const session = await getWorkspaceSessionFromHeaders(request.headers);
  if (!session.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: session.error }, { status: 401 }),
    };
  }
  if (session.value.system_role !== "SUPER_ADMIN") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "SUPER_ADMIN_REQUIRED",
            message: "只有超级管理员可以访问全局运维控制面。",
            retryable: false,
          },
        },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    value: {
      principal: session.value,
      context: {
        deployment_id: getWorkspaceDeploymentId(),
        principal_id: session.value.principal_id,
      },
      repository: getOperationsAdminRepository(),
    },
  };
}

export async function authorizeWorkspaceMembersRequest(
  request: NextRequest,
  workspaceId: string,
): Promise<Authorized<WorkspaceMembersRequest>> {
  const session = await getWorkspaceSessionFromHeaders(request.headers);
  if (!session.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: session.error }, { status: 401 }),
    };
  }
  return {
    ok: true,
    value: {
      principal: session.value,
      context: {
        deployment_id: getWorkspaceDeploymentId(),
        principal_id: session.value.principal_id,
        workspace_id: workspaceId,
      },
      repository: getOperationsAdminRepository(),
    },
  };
}

export function operationsResultResponse<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly message: string;
          readonly retryable: boolean;
        };
      },
  successStatus = 200,
) {
  if (result.ok) return NextResponse.json({ data: result.value }, { status: successStatus });
  const status =
    result.error.code === "SUPER_ADMIN_REQUIRED" ||
    result.error.code === "OPERATIONS_ADMIN_ACCESS_DENIED"
      ? 403
      : result.error.code.endsWith("_INVALID")
        ? 400
        : result.error.code.endsWith("_UNAVAILABLE") || result.error.retryable
          ? 503
          : 409;
  return NextResponse.json({ error: result.error }, { status });
}
