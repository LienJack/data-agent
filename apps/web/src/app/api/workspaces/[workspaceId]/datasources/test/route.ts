import { type NextRequest, NextResponse } from "next/server";
import { testConnectionInputSchema } from "@/lib/datasource-types";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

/**
 * Connection tests remain fail-closed until a scoped SecretRef resolver and the
 * existing datasource-egress approval port are wired to the Web runtime.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = testConnectionInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "DATASOURCE_INPUT_INVALID",
      message: "连接测试请求不符合契约。",
      retryable: false,
    });
  }
  return NextResponse.json(
    {
      error: {
        code: "DATASOURCE_EGRESS_APPROVAL_REQUIRED",
        message: "连接测试需要服务端 SecretRef 与数据源出口审批，当前未授权直接连接。",
        retryable: false,
      },
    },
    { status: 503 },
  );
}
