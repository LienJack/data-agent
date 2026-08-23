import { randomUUID } from "node:crypto";
import {
  buildResolvedContextRequest,
  workspaceDefaultsReferenceSchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEffectiveConfigResolver, getResolvedContextService } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const previewInputSchema = z.strictObject({
  question: z.string().trim().min(1).max(4_000),
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = previewInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "RESOLVED_CONTEXT_PREVIEW_INPUT_INVALID",
      message: "Context Preview 需要非空 question。",
      retryable: false,
    });
  }
  const defaults = await getEffectiveConfigResolver().getWorkspaceDefaults(
    authorized.value.capability,
  );
  if (!defaults.ok) return workspaceErrorResponse(defaults.error);
  const defaultsReference = workspaceDefaultsReferenceSchema.safeParse(
    defaults.value?.defaults_ref,
  );
  if (!defaultsReference.success) {
    return workspaceErrorResponse({
      code: "RESOLVED_CONTEXT_DEFAULTS_INCOMPLETE",
      message: "Workspace Defaults 尚未形成可解析的 Authority Reference。",
      retryable: false,
    });
  }
  const resolvedRequest = await buildResolvedContextRequest({
    schema_version: "resolved-context-request@1.0.0",
    request_id: randomUUID(),
    scope: authorized.value.capability.scope,
    question: input.data.question,
    basis: { consumer: "PREVIEW", defaults_ref: defaultsReference.data },
  });
  const resolved = await getResolvedContextService().preview(
    authorized.value.capability,
    resolvedRequest,
  );
  return resolved.ok
    ? NextResponse.json({ data: resolved.value })
    : workspaceErrorResponse(resolved.error);
}
