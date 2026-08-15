import "server-only";

import type { NextRequest } from "next/server";
import { createCapabilitySchemaDiscoveryAuthorityResolver } from "./schema-discovery-authority";
import {
  createEcommerceDemoConnectorFactory,
  createEcommerceDemoEgressAuthorizer,
  createEcommerceDemoSecretResolver,
  ecommerceDemoRuntimeEnvironment,
} from "./ecommerce-demo-datasource-runtime";
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
  createSemanticExplorerRuntime,
  type SemanticExplorerRuntime,
} from "./semantic-explorer-runtime";
import {
  createSemanticGovernanceRuntime,
  type SemanticGovernanceRuntime,
} from "./semantic-governance-runtime";
import {
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "./workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "./workspace-request";

export type WorkspaceSemanticRuntimeResult<T> =
  | { readonly ok: true; readonly runtime: T }
  | { readonly ok: false; readonly response: ReturnType<typeof workspaceErrorResponse> };

function allowedDomains(): readonly string[] | undefined {
  const domains = (process.env.SEMANTIC_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
  return domains.length > 0 ? domains : undefined;
}

async function requestDependencies(request: NextRequest, access: "READ" | "WRITE") {
  const workspaceId = request.headers.get("x-workspace-id")?.trim() ?? "";
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, access);
  if (!authorized.ok)
    return { ok: false as const, response: workspaceErrorResponse(authorized.error) };
  return {
    ok: true as const,
    sqlPool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
    capability: authorized.value.capability,
    resolver: createCapabilitySemanticAuthorityResolver(
      authorized.value.capability,
      allowedDomains(),
    ),
  };
}

export async function getWorkspaceSemanticExplorerRuntime(
  request: NextRequest,
): Promise<WorkspaceSemanticRuntimeResult<SemanticExplorerRuntime>> {
  const dependencies = await requestDependencies(request, "READ");
  if (!dependencies.ok) return dependencies;
  return {
    ok: true,
    runtime: createSemanticExplorerRuntime({
      environment: { ...process.env, SEMANTIC_EXPLORER_ENABLED: "true" },
      sqlPool: dependencies.sqlPool,
      transactionalAuthorizer: dependencies.authorizer,
      authorityResolver: dependencies.resolver,
    }),
  };
}

export async function getWorkspaceSemanticGovernanceRuntime(
  request: NextRequest,
  access: "READ" | "WRITE",
): Promise<WorkspaceSemanticRuntimeResult<SemanticGovernanceRuntime>> {
  const dependencies = await requestDependencies(request, access);
  if (!dependencies.ok) return dependencies;
  return {
    ok: true,
    runtime: createSemanticGovernanceRuntime({
      environment: { ...process.env, SEMANTIC_GOVERNANCE_BACKEND: "postgres" },
      sqlPool: dependencies.sqlPool,
      transactionalAuthorizer: dependencies.authorizer,
      authorityResolver: dependencies.resolver,
    }),
  };
}

export async function getWorkspaceSchemaDiscoveryRuntime(
  request: NextRequest,
  access: "READ" | "WRITE",
): Promise<WorkspaceSemanticRuntimeResult<SchemaDiscoveryRuntime>> {
  const dependencies = await requestDependencies(request, access);
  if (!dependencies.ok) return dependencies;
  const runtimeEnvironment = ecommerceDemoRuntimeEnvironment(process.env);
  return {
    ok: true,
    runtime: createSchemaDiscoveryRuntime({
      environment: runtimeEnvironment,
      sqlPool: dependencies.sqlPool,
      transactionalAuthorizer: dependencies.authorizer,
      authorityResolver: createCapabilitySchemaDiscoveryAuthorityResolver(dependencies.capability),
      datasourceResolver: createSchemaDiscoveryDatasourceResolver({
        metadataResolver: createWorkspaceDatasourceMetadataResolver(getWorkspaceDataRepository()),
        egressAuthorizer: createEcommerceDemoEgressAuthorizer(runtimeEnvironment),
        secretResolver: createEcommerceDemoSecretResolver(runtimeEnvironment),
        connectorFactory: createEcommerceDemoConnectorFactory(),
      }),
    }),
  };
}
