import { upsertModelCatalogEntryInputSchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeModelControlAdminRequest,
  modelControlResultResponse,
  rejectEnvironmentSystemModelMutation,
} from "@/lib/model-control-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeModelControlAdminRequest(request);
  return authorized.ok
    ? modelControlResultResponse(
        await authorized.value.repository.listModels(authorized.value.context),
      )
    : authorized.response;
}

export async function POST(request: NextRequest) {
  const authorized = await authorizeModelControlAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const parsed = upsertModelCatalogEntryInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_CATALOG_COMMAND_INVALID",
          message: "模型配置不符合严格契约。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  const immutableResponse = rejectEnvironmentSystemModelMutation(parsed.data.model_profile_id);
  if (immutableResponse) return immutableResponse;
  return modelControlResultResponse(
    await authorized.value.repository.applyModelCommand(authorized.value.context, parsed.data),
    201,
  );
}
