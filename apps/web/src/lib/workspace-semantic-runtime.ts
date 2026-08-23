import "server-only";

import { randomUUID } from "node:crypto";
import type { JobQueuePort, SemanticInductionRegistryPort } from "@data-agent/contracts";
import {
  createPostgresJobQueue,
  createPostgresSemanticAuthoringStore,
  createPostgresSemanticBindingImpactStore,
  createPostgresSemanticCandidateRevisionStore,
  createPostgresSemanticGraphStore,
  createPostgresSemanticInductionRegistry,
} from "@data-agent/platform";
import {
  createSemanticBindingImpactService,
  createSemanticCandidateSaveService,
  createSemanticStudioService,
  type SemanticBindingImpactService,
  type SemanticCandidateSaveService,
  type SemanticStudioService,
} from "@data-agent/semantic/application";
import type { NextRequest } from "next/server";
import {
  createEcommerceDemoConnectorFactory,
  createEcommerceDemoEgressAuthorizer,
  createEcommerceDemoSecretResolver,
  ecommerceDemoRuntimeEnvironment,
} from "./ecommerce-demo-datasource-runtime";
import { createCapabilitySchemaDiscoveryAuthorityResolver } from "./schema-discovery-authority";
import {
  createSchemaDiscoveryDatasourceResolver,
  createWorkspaceDatasourceMetadataResolver,
} from "./schema-discovery-datasource";
import {
  createSchemaDiscoveryRuntime,
  type SchemaDiscoveryRuntime,
} from "./schema-discovery-runtime";
import { createCapabilitySemanticAuthorityResolver } from "./semantic-authority";
import {
  createSemanticCandidateRuntime,
  type SemanticCandidateRuntime,
} from "./semantic-candidate-runtime";
import {
  createSemanticExplorerRuntime,
  type SemanticExplorerRuntime,
} from "./semantic-explorer-runtime";
import {
  createSemanticGovernanceRuntime,
  type SemanticGovernanceRuntime,
} from "./semantic-governance-runtime";
import {
  getKnowledgeRegistry,
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "./workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "./workspace-request";

export type WorkspaceSemanticRuntimeResult<T> =
  | { readonly ok: true; readonly runtime: T }
  | { readonly ok: false; readonly response: ReturnType<typeof workspaceErrorResponse> };

type WorkspaceSemanticFeature =
  | "BINDING_IMPACT"
  | "CANDIDATE"
  | "CANDIDATE_SAVE"
  | "EXPLORER"
  | "GOVERNANCE"
  | "INDUCTION"
  | "SCHEMA_DISCOVERY"
  | "STUDIO";

interface WorkspaceSemanticRuntimeOptions<Feature extends WorkspaceSemanticFeature> {
  readonly feature: Feature;
  readonly access: "READ" | "WRITE";
  readonly workspaceId?: string;
}

type WorkspaceSemanticRuntime =
  | Readonly<{
      authorityResolver: ReturnType<typeof createCapabilitySemanticAuthorityResolver>;
      service: SemanticBindingImpactService;
    }>
  | SemanticCandidateRuntime
  | SemanticCandidateSaveService
  | SemanticExplorerRuntime
  | SemanticGovernanceRuntime
  | Readonly<{
      capabilityInput: unknown;
      scope: import("@data-agent/contracts").AppScope;
      principalId: string;
      registry: SemanticInductionRegistryPort;
      queue: JobQueuePort;
    }>
  | SchemaDiscoveryRuntime
  | SemanticStudioService;

function configuredAllowedDomains(): readonly string[] {
  return [
    ...new Set(
      (process.env.SEMANTIC_ALLOWED_DOMAINS ?? "")
        .split(",")
        .map((domain) => domain.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function unavailableConfiguration(): WorkspaceSemanticRuntimeResult<never> {
  return {
    ok: false,
    response: workspaceErrorResponse({
      code: "SEMANTIC_RUNTIME_UNAVAILABLE",
      message: "语义运行时未配置允许访问的语义域。",
      retryable: false,
    }),
  };
}

export function getWorkspaceSemanticRuntime(
  request: NextRequest,
  options: WorkspaceSemanticRuntimeOptions<"BINDING_IMPACT">,
): Promise<
  WorkspaceSemanticRuntimeResult<
    Readonly<{
      authorityResolver: ReturnType<typeof createCapabilitySemanticAuthorityResolver>;
      service: SemanticBindingImpactService;
    }>
  >
>;
export function getWorkspaceSemanticRuntime(
  request: NextRequest,
  options: WorkspaceSemanticRuntimeOptions<"CANDIDATE">,
): Promise<WorkspaceSemanticRuntimeResult<SemanticCandidateRuntime>>;
export function getWorkspaceSemanticRuntime(
  request: NextRequest,
  options: WorkspaceSemanticRuntimeOptions<"CANDIDATE_SAVE">,
): Promise<WorkspaceSemanticRuntimeResult<SemanticCandidateSaveService>>;
export function getWorkspaceSemanticRuntime(
  request: NextRequest,
  options: WorkspaceSemanticRuntimeOptions<"EXPLORER">,
): Promise<WorkspaceSemanticRuntimeResult<SemanticExplorerRuntime>>;
export function getWorkspaceSemanticRuntime(
  request: NextRequest,
  options: WorkspaceSemanticRuntimeOptions<"GOVERNANCE">,
): Promise<WorkspaceSemanticRuntimeResult<SemanticGovernanceRuntime>>;
export function getWorkspaceSemanticRuntime(
  request: NextRequest,
  options: WorkspaceSemanticRuntimeOptions<"INDUCTION">,
): Promise<
  WorkspaceSemanticRuntimeResult<
    Readonly<{
      capabilityInput: unknown;
      scope: import("@data-agent/contracts").AppScope;
      principalId: string;
      registry: SemanticInductionRegistryPort;
      queue: JobQueuePort;
    }>
  >
>;
export function getWorkspaceSemanticRuntime(
  request: NextRequest,
  options: WorkspaceSemanticRuntimeOptions<"SCHEMA_DISCOVERY">,
): Promise<WorkspaceSemanticRuntimeResult<SchemaDiscoveryRuntime>>;
export function getWorkspaceSemanticRuntime(
  request: NextRequest,
  options: WorkspaceSemanticRuntimeOptions<"STUDIO">,
): Promise<WorkspaceSemanticRuntimeResult<SemanticStudioService>>;
export async function getWorkspaceSemanticRuntime(
  request: NextRequest,
  options: WorkspaceSemanticRuntimeOptions<WorkspaceSemanticFeature>,
): Promise<WorkspaceSemanticRuntimeResult<WorkspaceSemanticRuntime>> {
  const workspaceId = options.workspaceId ?? request.headers.get("x-workspace-id")?.trim() ?? "";
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, options.access);
  if (!authorized.ok) {
    return { ok: false, response: workspaceErrorResponse(authorized.error) };
  }

  const capability = authorized.value.capability;
  const sqlPool = getWorkspaceSqlPool();
  const authorizer = getWorkspaceAuthority().authorizer;

  if (options.feature === "SCHEMA_DISCOVERY") {
    const environment = ecommerceDemoRuntimeEnvironment(process.env);
    return {
      ok: true,
      runtime: createSchemaDiscoveryRuntime({
        environment,
        sqlPool,
        transactionalAuthorizer: authorizer,
        authorityResolver: createCapabilitySchemaDiscoveryAuthorityResolver(capability),
        datasourceResolver: createSchemaDiscoveryDatasourceResolver({
          metadataResolver: createWorkspaceDatasourceMetadataResolver(getWorkspaceDataRepository()),
          egressAuthorizer: createEcommerceDemoEgressAuthorizer(environment),
          secretResolver: createEcommerceDemoSecretResolver(environment),
          connectorFactory: createEcommerceDemoConnectorFactory(),
        }),
      }),
    };
  }

  const allowedDomains = configuredAllowedDomains();
  if (allowedDomains.length === 0) return unavailableConfiguration();
  const authorityResolver = createCapabilitySemanticAuthorityResolver(capability, allowedDomains);

  switch (options.feature) {
    case "BINDING_IMPACT":
      return {
        ok: true,
        runtime: Object.freeze({
          authorityResolver,
          service: createSemanticBindingImpactService({
            store: createPostgresSemanticBindingImpactStore({ pool: sqlPool, authorizer }),
          }),
        }),
      };
    case "CANDIDATE":
      return {
        ok: true,
        runtime: createSemanticCandidateRuntime({
          environment: process.env,
          sqlPool,
          transactionalAuthorizer: authorizer,
          authorityResolver,
        }),
      };
    case "CANDIDATE_SAVE":
      return {
        ok: true,
        runtime: createSemanticCandidateSaveService({
          capability,
          scope: capability.scope,
          principal_id: capability.principal,
          create_authoring_store: (semanticDomain) =>
            createPostgresSemanticAuthoringStore({
              pool: sqlPool,
              authorizer,
              capability,
              semantic_domain: semanticDomain,
            }),
          graph_store: createPostgresSemanticGraphStore({ pool: sqlPool, authorizer }),
          candidate_revision_store: createPostgresSemanticCandidateRevisionStore({
            pool: sqlPool,
            authorizer,
          }),
          knowledge_registry: getKnowledgeRegistry(),
          new_id: randomUUID,
          now: () => new Date(),
        }),
      };
    case "EXPLORER":
      return {
        ok: true,
        runtime: createSemanticExplorerRuntime({
          environment: { ...process.env, SEMANTIC_EXPLORER_ENABLED: "true" },
          sqlPool,
          transactionalAuthorizer: authorizer,
          authorityResolver,
        }),
      };
    case "GOVERNANCE":
      return {
        ok: true,
        runtime: createSemanticGovernanceRuntime({
          sqlPool,
          transactionalAuthorizer: authorizer,
          authorityResolver,
        }),
      };
    case "INDUCTION":
      return {
        ok: true,
        runtime: Object.freeze({
          capabilityInput: capability,
          scope: capability.scope,
          principalId: capability.principal,
          registry: createPostgresSemanticInductionRegistry({ pool: sqlPool, authorizer }),
          queue: createPostgresJobQueue(sqlPool, authorizer, capability, {
            lease_duration_ms: 30_000,
          }),
        }),
      };
    case "STUDIO":
      return {
        ok: true,
        runtime: createSemanticStudioService({
          graph_store: createPostgresSemanticGraphStore({ pool: sqlPool, authorizer }),
          candidate_revision_store: createPostgresSemanticCandidateRevisionStore({
            pool: sqlPool,
            authorizer,
          }),
          create_authoring_store: (semanticDomain) =>
            createPostgresSemanticAuthoringStore({
              pool: sqlPool,
              authorizer,
              capability,
              semantic_domain: semanticDomain,
            }),
          capability,
          scope: capability.scope,
          principal_id: capability.principal,
          allowed_domains: allowedDomains,
          knowledge_registry: getKnowledgeRegistry(),
        }),
      };
  }
}
