import "server-only";

import {
  createPostgresSemanticAuthoringStore,
  createPostgresSemanticCandidateRevisionStore,
  createPostgresSemanticGraphStore,
} from "@data-agent/platform";
import type { NextRequest } from "next/server";
import {
  createSemanticCandidateSaveService,
  type SemanticCandidateSaveService,
} from "./semantic-candidate-save-service";
import {
  getKnowledgeRegistry,
  getWorkspaceAuthority,
  getWorkspaceSqlPool,
} from "./workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "./workspace-request";

export type SemanticCandidateSaveRuntimeResult =
  | { readonly ok: true; readonly service: SemanticCandidateSaveService }
  | { readonly ok: false; readonly response: ReturnType<typeof workspaceErrorResponse> };

export async function getSemanticCandidateSaveRuntime(
  request: NextRequest,
  workspaceId: string,
): Promise<SemanticCandidateSaveRuntimeResult> {
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return { ok: false, response: workspaceErrorResponse(authorized.error) };
  const pool = getWorkspaceSqlPool();
  const authorizer = getWorkspaceAuthority().authorizer;
  const capability = authorized.value.capability;
  return {
    ok: true,
    service: createSemanticCandidateSaveService({
      capability,
      scope: capability.scope,
      principal_id: capability.principal,
      create_authoring_store: (semanticDomain) =>
        createPostgresSemanticAuthoringStore({
          pool,
          authorizer,
          capability,
          semantic_domain: semanticDomain,
        }),
      graph_store: createPostgresSemanticGraphStore({ pool, authorizer }),
      candidate_revision_store: createPostgresSemanticCandidateRevisionStore({ pool, authorizer }),
      knowledge_registry: getKnowledgeRegistry(),
      new_id: crypto.randomUUID,
      now: () => new Date(),
    }),
  };
}
