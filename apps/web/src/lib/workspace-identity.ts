import "server-only";

import {
  type SessionPrincipal,
  sessionPrincipalSchema,
  type WorkspaceAccessProjection,
} from "@data-agent/contracts";
import {
  type AppCapability,
  adaptPgPool,
  type BoundaryResult,
  createFileSystemStorageClient,
  createPostgresAgentDispatchAuthority,
  createPostgresAgentProfileRegistry,
  createPostgresAgentTeamTraceProjector,
  createPostgresCreditLedgerRepository,
  createPostgresEffectiveConfigResolver,
  createPostgresKnowledgeRegistry,
  createPostgresMcpRegistry,
  createPostgresModelBillingRepository,
  createPostgresModelControlRepository,
  createPostgresOperationsAdminRepository,
  createPostgresPricingControlRepository,
  createPostgresProviderInvocationStore,
  createPostgresQaAdminAuditRepository,
  createPostgresResolutionTraceProjector,
  createPostgresResolvedContextRegistry,
  createPostgresSemanticInductionRegistry,
  createPostgresSemanticPortabilityRepository,
  createPostgresSessionRecovery,
  createPostgresSkillRegistry,
  createPostgresWorkspaceAuthority,
  createPostgresWorkspaceDataRepository,
  createPostgresWorkspaceFiles,
  createWorkspaceContentNamespace,
  type ResolvedSessionPrincipal,
} from "@data-agent/platform";
import { createResolvedContextService } from "@data-agent/semantic";
import { headers } from "next/headers";
import pg from "pg";
import { z } from "zod";
import { getDataAgentAuth } from "./auth";
import { ensureRootEnvironmentLoaded } from "./root-env";

const WORKSPACE_IDENTITY_RUNTIME = Symbol.for("data-agent.workspace-identity-runtime");

const authSessionSnapshotSchema = z.object({
  session: z.object({
    id: z.string().min(1).max(256),
    expiresAt: z.coerce.date(),
  }),
  user: z.object({ id: z.uuid() }),
});

interface WorkspaceIdentityRuntimeState {
  pool?: pg.Pool;
  authority?: ReturnType<typeof createPostgresWorkspaceAuthority>;
  workspaceDataRepository?: ReturnType<typeof createPostgresWorkspaceDataRepository>;
  modelControlRepository?: ReturnType<typeof createPostgresModelControlRepository>;
  pricingControlRepository?: ReturnType<typeof createPostgresPricingControlRepository>;
  creditLedgerRepository?: ReturnType<typeof createPostgresCreditLedgerRepository>;
  modelBillingRepository?: ReturnType<typeof createPostgresModelBillingRepository>;
  operationsAdminRepository?: ReturnType<typeof createPostgresOperationsAdminRepository>;
  semanticPortabilityRepository?: ReturnType<typeof createPostgresSemanticPortabilityRepository>;
  effectiveConfigResolver?: ReturnType<typeof createPostgresEffectiveConfigResolver>;
  providerInvocationStore?: ReturnType<typeof createPostgresProviderInvocationStore>;
  workspaceFiles?: ReturnType<typeof createPostgresWorkspaceFiles>;
  knowledgeRegistry?: ReturnType<typeof createPostgresKnowledgeRegistry>;
  mcpRegistry?: ReturnType<typeof createPostgresMcpRegistry>;
  skillRegistry?: ReturnType<typeof createPostgresSkillRegistry>;
  semanticInductionRegistry?: ReturnType<typeof createPostgresSemanticInductionRegistry>;
  sessionRecovery?: ReturnType<typeof createPostgresSessionRecovery>;
  resolutionTraceProjector?: ReturnType<typeof createPostgresResolutionTraceProjector>;
  resolvedContextService?: ReturnType<typeof createResolvedContextService>;
  workspaceContent?: ReturnType<typeof createWorkspaceContentNamespace>;
  agentProfileRegistry?: ReturnType<typeof createPostgresAgentProfileRegistry>;
  agentDispatchAuthority?: ReturnType<typeof createPostgresAgentDispatchAuthority>;
  agentTeamTraceProjector?: ReturnType<typeof createPostgresAgentTeamTraceProjector>;
}

interface SessionResolutionDependencies {
  readonly deploymentId: string;
  readonly getAuthSession: (requestHeaders: Headers) => Promise<unknown>;
  readonly resolvePrincipal: (input: {
    deployment_id: string;
    auth_user_id: string;
  }) => Promise<BoundaryResult<ResolvedSessionPrincipal>>;
}

function boundaryFailure<T>(code: string, message: string, retryable = false): BoundaryResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function state(): WorkspaceIdentityRuntimeState {
  const globals = globalThis as typeof globalThis & {
    [WORKSPACE_IDENTITY_RUNTIME]?: WorkspaceIdentityRuntimeState;
  };
  globals[WORKSPACE_IDENTITY_RUNTIME] ??= {};
  return globals[WORKSPACE_IDENTITY_RUNTIME];
}

export class WorkspaceIdentityConfigurationError extends Error {
  override readonly name = "WorkspaceIdentityConfigurationError";
  readonly code = "WORKSPACE_IDENTITY_NOT_CONFIGURED";
}

export function getWorkspaceDeploymentId(): string {
  ensureRootEnvironmentLoaded();
  const parsed = z
    .uuid()
    .safeParse(process.env.WORKSPACE_DEPLOYMENT_ID ?? process.env.SEMANTIC_DEPLOYMENT_ID);
  if (!parsed.success) {
    throw new WorkspaceIdentityConfigurationError(
      "工作空间身份运行时需要 WORKSPACE_DEPLOYMENT_ID（可回退 SEMANTIC_DEPLOYMENT_ID）。",
    );
  }
  return parsed.data;
}

export function getWorkspaceAuthority() {
  const runtime = state();
  if (runtime.authority) return runtime.authority;
  ensureRootEnvironmentLoaded();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new WorkspaceIdentityConfigurationError("工作空间身份运行时需要 DATABASE_URL。");
  }
  runtime.pool ??= new pg.Pool({
    connectionString,
    options: "-c search_path=app_data_agent,platform,pg_catalog",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  runtime.authority = createPostgresWorkspaceAuthority(runtime.pool);
  return runtime.authority;
}

function getWorkspacePool(): pg.Pool {
  getWorkspaceAuthority();
  const pool = state().pool;
  if (!pool) {
    throw new WorkspaceIdentityConfigurationError("工作空间数据库连接池尚未初始化。");
  }
  return pool;
}

export function getWorkspaceSqlPool() {
  return adaptPgPool(getWorkspacePool());
}

export function getWorkspaceDataRepository() {
  const runtime = state();
  runtime.workspaceDataRepository ??= createPostgresWorkspaceDataRepository(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
  );
  return runtime.workspaceDataRepository;
}

export function getAgentProfileRegistry() {
  const runtime = state();
  runtime.agentProfileRegistry ??= createPostgresAgentProfileRegistry({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.agentProfileRegistry;
}

export function getAgentDispatchAuthority() {
  const runtime = state();
  runtime.agentDispatchAuthority ??= createPostgresAgentDispatchAuthority({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.agentDispatchAuthority;
}

export function getAgentTeamTraceProjector() {
  const runtime = state();
  runtime.agentTeamTraceProjector ??= createPostgresAgentTeamTraceProjector({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.agentTeamTraceProjector;
}

export function getEffectiveConfigResolver() {
  const runtime = state();
  runtime.effectiveConfigResolver ??= createPostgresEffectiveConfigResolver({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.effectiveConfigResolver;
}

export function getProviderInvocationStore() {
  const runtime = state();
  runtime.providerInvocationStore ??= createPostgresProviderInvocationStore({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.providerInvocationStore;
}

export function getWorkspaceFiles() {
  const runtime = state();
  runtime.workspaceFiles ??= createPostgresWorkspaceFiles({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.workspaceFiles;
}

export function getKnowledgeRegistry() {
  const runtime = state();
  runtime.knowledgeRegistry ??= createPostgresKnowledgeRegistry({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.knowledgeRegistry;
}

export function getMcpRegistry() {
  const runtime = state();
  runtime.mcpRegistry ??= createPostgresMcpRegistry({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.mcpRegistry;
}

export function getSkillRegistry() {
  const runtime = state();
  runtime.skillRegistry ??= createPostgresSkillRegistry({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.skillRegistry;
}

export function getSemanticInductionRegistry() {
  const runtime = state();
  runtime.semanticInductionRegistry ??= createPostgresSemanticInductionRegistry({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.semanticInductionRegistry;
}

export function getSessionRecovery() {
  const runtime = state();
  runtime.sessionRecovery ??= createPostgresSessionRecovery({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.sessionRecovery;
}

export function getResolutionTraceProjector() {
  const runtime = state();
  runtime.resolutionTraceProjector ??= createPostgresResolutionTraceProjector({
    pool: getWorkspaceSqlPool(),
    authorizer: getWorkspaceAuthority().authorizer,
  });
  return runtime.resolutionTraceProjector;
}

export function getResolvedContextService() {
  const runtime = state();
  runtime.resolvedContextService ??= createResolvedContextService({
    authority: createPostgresResolvedContextRegistry({
      pool: getWorkspaceSqlPool(),
      authorizer: getWorkspaceAuthority().authorizer,
    }),
  });
  return runtime.resolvedContextService;
}

export function getWorkspaceContent() {
  const runtime = state();
  ensureRootEnvironmentLoaded();
  runtime.workspaceContent ??= createWorkspaceContentNamespace(
    createFileSystemStorageClient(
      process.env.DATA_AGENT_WORKSPACE_FILE_STORAGE_ROOT ?? ".data/workspace-content",
    ),
    getWorkspaceAuthority().authorizer,
  );
  return runtime.workspaceContent;
}

export function getPricingControlRepository() {
  const runtime = state();
  runtime.pricingControlRepository ??= createPostgresPricingControlRepository(
    getWorkspaceSqlPool(),
  );
  return runtime.pricingControlRepository;
}

export function getModelControlRepository() {
  const runtime = state();
  runtime.modelControlRepository ??= createPostgresModelControlRepository(getWorkspaceSqlPool());
  return runtime.modelControlRepository;
}

export function getCreditLedgerRepository() {
  const runtime = state();
  runtime.creditLedgerRepository ??= createPostgresCreditLedgerRepository(getWorkspaceSqlPool());
  return runtime.creditLedgerRepository;
}

export function getModelBillingRepository() {
  const runtime = state();
  runtime.modelBillingRepository ??= createPostgresModelBillingRepository(getWorkspaceSqlPool());
  return runtime.modelBillingRepository;
}

export function getOperationsAdminRepository() {
  const runtime = state();
  runtime.operationsAdminRepository ??= createPostgresOperationsAdminRepository(
    getWorkspaceSqlPool(),
  );
  return runtime.operationsAdminRepository;
}

export function getQaAdminAuditRepository() {
  return createPostgresQaAdminAuditRepository(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
  );
}

export function getSemanticPortabilityRepository() {
  const runtime = state();
  runtime.semanticPortabilityRepository ??= createPostgresSemanticPortabilityRepository(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
  );
  return runtime.semanticPortabilityRepository;
}

export async function resolveWorkspaceSession(
  requestHeaders: Headers,
  dependencies: SessionResolutionDependencies,
): Promise<BoundaryResult<SessionPrincipal>> {
  let rawSession: unknown;
  try {
    rawSession = await dependencies.getAuthSession(requestHeaders);
  } catch {
    return boundaryFailure("AUTH_SESSION_INVALID", "认证会话无法验证。", true);
  }
  const authSession = authSessionSnapshotSchema.safeParse(rawSession);
  if (!authSession.success) {
    return boundaryFailure("AUTH_SESSION_REQUIRED", "请先登录 Data Agent。");
  }
  const principal = await dependencies.resolvePrincipal({
    deployment_id: dependencies.deploymentId,
    auth_user_id: authSession.data.user.id,
  });
  if (!principal.ok) return principal;
  const authzEpoch = Number(principal.value.authz_epoch);
  if (!Number.isSafeInteger(authzEpoch) || authzEpoch < 1) {
    return boundaryFailure("AUTH_SESSION_INVALID", "应用用户授权版本无效。");
  }
  const parsed = sessionPrincipalSchema.safeParse({
    schema_version: "session-principal@1.0.0",
    app_id: principal.value.app_id,
    environment: principal.value.environment,
    principal_id: principal.value.principal_id,
    auth_user_id: principal.value.auth_user_id,
    system_role: principal.value.system_role,
    authz_epoch: authzEpoch,
    session_id: authSession.data.session.id,
    session_expires_at: authSession.data.session.expiresAt.toISOString(),
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : boundaryFailure("AUTH_SESSION_INVALID", "认证会话与应用用户映射不一致。");
}

export async function getCurrentWorkspaceSession(): Promise<BoundaryResult<SessionPrincipal>> {
  return getWorkspaceSessionFromHeaders(await headers());
}

export async function getWorkspaceSessionFromHeaders(
  requestHeaders: Headers,
): Promise<BoundaryResult<SessionPrincipal>> {
  try {
    const authority = getWorkspaceAuthority();
    return await resolveWorkspaceSession(requestHeaders, {
      deploymentId: getWorkspaceDeploymentId(),
      getAuthSession: (requestHeaders) =>
        getDataAgentAuth().api.getSession({
          headers: requestHeaders,
          query: { disableCookieCache: true },
        }),
      resolvePrincipal: (input) => authority.resolveSessionPrincipal(input),
    });
  } catch {
    return boundaryFailure("APP_AUTHORITY_UNAVAILABLE", "工作空间身份运行时尚未就绪。", true);
  }
}

export async function listSessionWorkspaces(
  principal: SessionPrincipal,
): Promise<BoundaryResult<readonly WorkspaceAccessProjection[]>> {
  try {
    return await getWorkspaceAuthority().listWorkspaces({
      deployment_id: getWorkspaceDeploymentId(),
      principal_id: principal.principal_id,
    });
  } catch {
    return boundaryFailure("APP_AUTHORITY_UNAVAILABLE", "工作空间列表暂时不可用。", true);
  }
}

export async function resolveSessionWorkspaceCapability(
  principal: SessionPrincipal,
  workspaceId: string,
  access: "READ" | "WRITE" = "READ",
): Promise<BoundaryResult<AppCapability>> {
  try {
    return await getWorkspaceAuthority().resolveForServerContext({
      deployment_id: getWorkspaceDeploymentId(),
      workspace_id: workspaceId,
      principal_id: principal.principal_id,
      access,
    });
  } catch {
    return boundaryFailure<AppCapability>(
      "APP_AUTHORITY_UNAVAILABLE",
      "工作空间权限暂时不可用。",
      true,
    );
  }
}
