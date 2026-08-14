import { type NextRequest, NextResponse } from "next/server";

/** DELETE /api/models/[id] — 删除手工模型配置。 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;
  return NextResponse.json(
    {
      error: {
        code: "MODEL_ADMIN_ROUTE_REQUIRED",
        message: "模型变更必须使用超级管理员控制面。",
        retryable: false,
      },
    },
    { status: 410 },
  );
}
