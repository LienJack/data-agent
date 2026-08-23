import {
  archiveModelProviderConnectionInputSchema,
  upsertModelProviderConnectionInputSchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeModelControlAdminRequest,
  modelControlResultResponse,
} from "@/lib/model-control-admin";
import { findEnvironmentProviderView } from "@/lib/model-provider-admin";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly connectionId: string }>;
}

function immutableResponse() {
  return NextResponse.json(
    {
      error: {
        code: "SYSTEM_MODEL_IMMUTABLE",
        message: "该供应商由 .env 环境变量托管，不能修改或删除。",
        retryable: false,
      },
    },
    { status: 409 },
  );
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authorized = await authorizeModelControlAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const { connectionId } = await context.params;
  if (findEnvironmentProviderView(connectionId)) return immutableResponse();
  const parsed = upsertModelProviderConnectionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success || parsed.data.provider_connection_id !== connectionId) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_PROVIDER_COMMAND_INVALID",
          message: "供应商连接更新不符合严格契约。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  return modelControlResultResponse(
    await authorized.value.repository.applyProviderConnectionCommand(
      authorized.value.context,
      parsed.data,
    ),
  );
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authorized = await authorizeModelControlAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const { connectionId } = await context.params;
  if (findEnvironmentProviderView(connectionId)) return immutableResponse();
  const parsed = archiveModelProviderConnectionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success || parsed.data.provider_connection_id !== connectionId) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_PROVIDER_COMMAND_INVALID",
          message: "供应商归档命令不符合严格契约。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  return modelControlResultResponse(
    await authorized.value.repository.applyProviderConnectionCommand(
      authorized.value.context,
      parsed.data,
    ),
  );
}
