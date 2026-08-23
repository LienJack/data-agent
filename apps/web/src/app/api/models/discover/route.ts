import { type NextRequest, NextResponse } from "next/server";

/** POST /api/models/discover — 使用临时凭据读取供应商当前可用模型目录。 */
export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json(
    {
      error: {
        code: "MODEL_ADMIN_ROUTE_REQUIRED",
        message: "临时明文凭据发现接口已关闭；请配置 SecretRef。",
        retryable: false,
      },
    },
    { status: 410 },
  );
}
