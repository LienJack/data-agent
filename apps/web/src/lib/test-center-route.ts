import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { TestCenterRuntimeError, withTestCenterWorkspaceContext } from "./test-center-runtime";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "./workspace-request";

export async function withWorkspaceTestCenterRequest(
  request: Request,
  workspaceId: string,
  access: "READ" | "WRITE",
  work: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, access);
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const capability = authorized.value.capability;
  return withTestCenterWorkspaceContext(
    {
      appId: capability.scope.app_id,
      tenantId: capability.scope.tenant_id,
      environment: capability.scope.environment,
      principalId: capability.principal,
    },
    work,
  );
}

export function testCenterErrorResponse(error: unknown): NextResponse {
  if (error instanceof TestCenterRuntimeError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "TEST_CENTER_INPUT_INVALID",
          message: "能力测试请求不符合契约。",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { error: { code: "TEST_CENTER_INTERNAL_ERROR", message: "能力测试服务发生内部错误。" } },
    { status: 500 },
  );
}
