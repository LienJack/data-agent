import "server-only";

import type { SessionPrincipal } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getCreditLedgerRepository,
  getWorkspaceDeploymentId,
  getWorkspaceSessionFromHeaders,
} from "./workspace-identity";

export type CreditRequest = Readonly<{
  principal: SessionPrincipal;
  context: { readonly deployment_id: string; readonly principal_id: string };
  repository: ReturnType<typeof getCreditLedgerRepository>;
}>;

export async function authorizeCreditRequest(
  request: NextRequest,
): Promise<
  | { readonly ok: true; readonly value: CreditRequest }
  | { readonly ok: false; readonly response: NextResponse }
> {
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
      },
      repository: getCreditLedgerRepository(),
    },
  };
}

export async function authorizeCreditAdminRequest(
  request: NextRequest,
): Promise<
  | { readonly ok: true; readonly value: CreditRequest }
  | { readonly ok: false; readonly response: NextResponse }
> {
  const authorized = await authorizeCreditRequest(request);
  if (!authorized.ok) return authorized;
  if (authorized.value.principal.system_role !== "SUPER_ADMIN") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "SUPER_ADMIN_REQUIRED",
            message: "只有超级管理员可以访问全局积分管理。",
            retryable: false,
          },
        },
        { status: 403 },
      ),
    };
  }
  return authorized;
}

export function creditResultResponse<T>(
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
    result.error.code === "CREDIT_ACCOUNT_ACCESS_DENIED"
      ? 403
      : result.error.code.endsWith("_INVALID")
        ? 400
        : 409;
  return NextResponse.json({ error: result.error }, { status });
}
