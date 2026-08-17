import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceJobQueue, projectCapabilityReadiness } from "@/lib/job-center";
import { authorizeWorkspaceRequest } from "@/lib/workspace-request";

const workspaceIdSchema = z.string().uuid();

const minimal = { live: true, ready: true } as const;

export async function GET(request: NextRequest) {
  const workspaceId = workspaceIdSchema.safeParse(request.nextUrl.searchParams.get("workspace_id"));
  if (!workspaceId.success) {
    return NextResponse.json(minimal, { headers: { "Cache-Control": "no-store" } });
  }
  const authorized = await authorizeWorkspaceRequest(request, workspaceId.data, "READ");
  if (!authorized.ok) {
    return NextResponse.json(minimal, { headers: { "Cache-Control": "no-store" } });
  }
  const result = await getWorkspaceJobQueue(authorized.value.capability).listReadiness({
    scope: authorized.value.capability.scope,
  });
  if (!result.ok) {
    return NextResponse.json(
      { live: true, ready: false },
      { status: result.error.retryable ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      ...minimal,
      capabilities: result.value.map(projectCapabilityReadiness),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
