import "server-only";

import type { SessionPrincipal } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getPricingControlRepository,
  getWorkspaceDeploymentId,
  getWorkspaceSessionFromHeaders,
} from "./workspace-identity";

export type PricingAdminRequest = Readonly<{
  principal: SessionPrincipal;
  context: { readonly deployment_id: string; readonly principal_id: string };
  repository: ReturnType<typeof getPricingControlRepository>;
}>;

export async function authorizePricingAdminRequest(
  request: NextRequest,
): Promise<
  | { readonly ok: true; readonly value: PricingAdminRequest }
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
            message: "只有超级管理员可以访问模型计费控制面。",
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
      repository: getPricingControlRepository(),
    },
  };
}

export function pricingResultResponse<T>(
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
