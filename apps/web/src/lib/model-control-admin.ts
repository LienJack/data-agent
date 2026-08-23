import "server-only";

import type { SessionPrincipal } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isEnvironmentSystemModelProfileId } from "./system-models";
import {
  getModelControlRepository,
  getWorkspaceDeploymentId,
  getWorkspaceSessionFromHeaders,
} from "./workspace-identity";

export type ModelControlAdminRequest = Readonly<{
  principal: SessionPrincipal;
  context: { readonly deployment_id: string; readonly principal_id: string };
  repository: ReturnType<typeof getModelControlRepository>;
}>;

export async function authorizeModelControlAdminRequest(
  request: NextRequest,
): Promise<
  | { readonly ok: true; readonly value: ModelControlAdminRequest }
  | { readonly ok: false; readonly response: NextResponse }
> {
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
            message: "只有超级管理员可以访问模型控制面。",
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
      repository: getModelControlRepository(),
    },
  };
}

export function modelControlResultResponse<T>(
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
  return result.ok
    ? NextResponse.json({ data: result.value }, { status: successStatus })
    : NextResponse.json(
        { error: result.error },
        { status: result.error.code === "SUPER_ADMIN_REQUIRED" ? 403 : 409 },
      );
}

export function rejectEnvironmentSystemModelMutation(profileId: string): NextResponse | null {
  if (!isEnvironmentSystemModelProfileId(profileId)) return null;
  return NextResponse.json(
    {
      error: {
        code: "SYSTEM_MODEL_IMMUTABLE",
        message: "系统模型由环境变量托管，不能修改、停用或删除。",
        retryable: false,
      },
    },
    { status: 409 },
  );
}
