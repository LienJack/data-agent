import { modelCatalogStatusInputSchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeModelControlAdminRequest,
  modelControlResultResponse,
  rejectEnvironmentSystemModelMutation,
} from "@/lib/model-control-admin";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ modelProfileId: string }> },
) {
  const authorized = await authorizeModelControlAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const parsed = modelCatalogStatusInputSchema.safeParse(await request.json().catch(() => null));
  const { modelProfileId } = await params;
  if (!parsed.success || parsed.data.model_profile_id !== modelProfileId) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_CATALOG_COMMAND_INVALID",
          message: "模型状态命令无效。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  const immutableResponse = rejectEnvironmentSystemModelMutation(modelProfileId);
  if (immutableResponse) return immutableResponse;
  return modelControlResultResponse(
    await authorized.value.repository.applyModelCommand(authorized.value.context, parsed.data),
  );
}
