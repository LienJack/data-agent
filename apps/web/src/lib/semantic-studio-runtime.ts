import "server-only";

import {
  createPostgresSemanticAuthoringStore,
  createPostgresSemanticGraphStore,
} from "@data-agent/platform";
import type { NextRequest } from "next/server";
import { createSemanticStudioService, type SemanticStudioService } from "./semantic-studio-service";
import { getWorkspaceAuthority, getWorkspaceSqlPool } from "./workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "./workspace-request";

export type SemanticStudioRuntimeResult =
  | { readonly ok: true; readonly service: SemanticStudioService }
  | { readonly ok: false; readonly response: ReturnType<typeof workspaceErrorResponse> };

function allowedDomains(): readonly string[] {
  const configured = (process.env.SEMANTIC_ALLOWED_DOMAINS ?? "ecommerce")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
  return [...new Set(configured)].sort();
}

export async function getSemanticStudioRuntime(
  request: NextRequest,
  workspaceId: string,
  access: "READ" | "WRITE",
): Promise<SemanticStudioRuntimeResult> {
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, access);
  if (!authorized.ok) return { ok: false, response: workspaceErrorResponse(authorized.error) };
  const pool = getWorkspaceSqlPool();
  const authorizer = getWorkspaceAuthority().authorizer;
  const capability = authorized.value.capability;
  return {
    ok: true,
    service: createSemanticStudioService({
      graph_store: createPostgresSemanticGraphStore({ pool, authorizer }),
      create_authoring_store: (semanticDomain) =>
        createPostgresSemanticAuthoringStore({
          pool,
          authorizer,
          capability,
          semantic_domain: semanticDomain,
        }),
      capability,
      scope: capability.scope,
      principal_id: capability.principal,
      allowed_domains: allowedDomains(),
    }),
  };
}
