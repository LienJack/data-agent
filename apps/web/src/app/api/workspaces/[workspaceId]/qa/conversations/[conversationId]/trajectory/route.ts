import {
  conversationTrajectorySchema,
  type PublicRunEvent,
  toPublicRunEvent,
} from "@data-agent/contracts";
import { createPostgresRunEventStore } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);

  const repository = getWorkspaceDataRepository();
  const [conversation, bindings] = await Promise.all([
    repository.getConversation(authorized.value.capability, conversationId),
    repository.listRunBindingsForConversation(authorized.value.capability, conversationId),
  ]);
  if (!conversation.ok) return workspaceErrorResponse(conversation.error);
  if (!bindings.ok) return workspaceErrorResponse(bindings.error);
  if (!conversation.value) {
    return workspaceErrorResponse({
      code: "CONVERSATION_NOT_FOUND_OR_DENIED",
      message: "对话不存在或无权访问。",
      retryable: false,
    });
  }

  const sqlPool = getWorkspaceSqlPool();
  const eventStore = createPostgresRunEventStore(
    sqlPool,
    getWorkspaceAuthority().authorizer,
    authorized.value.capability,
  );
  const events: PublicRunEvent[] = [];
  for (const binding of bindings.value) {
    let cursor = 0;
    while (events.length < 10_000) {
      const result = await eventStore.listEvents({
        scope: authorized.value.capability.scope,
        run_id: binding.run_id,
        after_sequence: cursor,
        limit: 500,
      });
      if (!result.ok) return workspaceErrorResponse(result.error);
      if (result.value.length === 0) break;
      events.push(...result.value.map(toPublicRunEvent));
      cursor = result.value.at(-1)?.sequence ?? cursor;
      if (result.value.length < 500) break;
    }
  }
  events.sort(
    (left, right) =>
      left.occurred_at.localeCompare(right.occurred_at) ||
      left.run_id.localeCompare(right.run_id) ||
      left.sequence - right.sequence,
  );

  return NextResponse.json({
    data: conversationTrajectorySchema.parse({
      schema_version: "conversation-trajectory@1.0.0",
      conversation_id: conversationId,
      events,
    }),
  });
}
