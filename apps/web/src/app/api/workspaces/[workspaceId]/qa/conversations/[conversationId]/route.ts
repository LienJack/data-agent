import {
  bindWorkspaceConversationDatasourceInputSchema,
  updateWorkspaceConversationModelInputSchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceDataRepository } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

const patchSchema = z
  .strictObject({
    schema_version: z.literal("workspace-conversation-patch@1.0.0"),
    datasource_id: z.uuid().optional(),
    model_id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/)
      .nullable()
      .optional(),
  })
  .refine((value) => value.datasource_id !== undefined || value.model_id !== undefined);

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getWorkspaceDataRepository().getConversation(
    authorized.value.capability,
    conversationId,
  );
  if (!result.ok) return workspaceErrorResponse(result.error);
  if (!result.value) {
    return workspaceErrorResponse({
      code: "CONVERSATION_NOT_FOUND_OR_DENIED",
      message: "对话不存在或无权访问。",
      retryable: false,
    });
  }
  return NextResponse.json({ data: result.value });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return workspaceErrorResponse({
      code: "CONVERSATION_INPUT_INVALID",
      message: "对话更新请求不符合契约。",
      retryable: false,
    });
  }
  const repository = getWorkspaceDataRepository();
  let current = parsed.data.datasource_id
    ? await repository.bindConversationDatasource(
        authorized.value.capability,
        conversationId,
        bindWorkspaceConversationDatasourceInputSchema.parse({
          schema_version: "workspace-conversation-bind-datasource@1.0.0",
          datasource_id: parsed.data.datasource_id,
        }),
      )
    : await repository.getConversation(authorized.value.capability, conversationId);
  if (!current.ok) return workspaceErrorResponse(current.error);
  if (parsed.data.model_id !== undefined) {
    current = await repository.updateConversationModel(
      authorized.value.capability,
      conversationId,
      updateWorkspaceConversationModelInputSchema.parse({
        schema_version: "workspace-conversation-update-model@1.0.0",
        model_id: parsed.data.model_id,
      }),
    );
  }
  if (!current.ok) return workspaceErrorResponse(current.error);
  if (!current.value) {
    return workspaceErrorResponse({
      code: "CONVERSATION_NOT_FOUND_OR_DENIED",
      message: "对话不存在或无权访问。",
      retryable: false,
    });
  }
  return NextResponse.json({ data: current.value });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getWorkspaceDataRepository().deleteConversation(
    authorized.value.capability,
    conversationId,
  );
  return result.ok
    ? NextResponse.json({ data: { success: true } })
    : workspaceErrorResponse(result.error);
}
