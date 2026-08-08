import { type NextRequest, NextResponse } from "next/server";
import { dataSourceConnections } from "@/lib/datasource-repository";

/**
 * Data Sources API — 单个数据源连接管理。
 *
 * DELETE /api/datasources/[id] — 删除数据源连接
 */

// ─── DELETE /api/datasources/[id] ─────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!dataSourceConnections.has(id)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "数据源连接不存在" } },
      { status: 404 },
    );
  }

  dataSourceConnections.delete(id);

  return NextResponse.json({ data: { success: true } });
}
