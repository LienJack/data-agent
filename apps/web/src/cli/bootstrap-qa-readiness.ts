import {
  DATA_AGENT_SPECIALIST_PROFILE_IDS,
  type DataAgentSpecialistProfileId,
  materializeBuiltinTeamProfiles,
} from "@data-agent/agent-runtime";
import {
  buildWorkspaceDefaultsCasUpdateCommandCandidate,
  type ModelCatalogEntry,
  type VersionedResourceReference,
} from "@data-agent/contracts";
import {
  type AppCapability,
  adaptPgPool,
  createPostgresAgentProfileRegistry,
  createPostgresCapabilityAuthority,
  createPostgresEffectiveConfigResolver,
  createPostgresModelControlRepository,
  createPostgresSkillRegistry,
  createPostgresWorkspaceDataRepository,
} from "@data-agent/platform";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import pg from "pg";
import { z } from "zod";
import {
  type QaReadinessBootstrapDependencies,
  type QaReadinessState,
  runQaReadinessBootstrap,
} from "../../../../scripts/qa-readiness-bootstrap";
import {
  isBuiltinTeamAuthorityNotReady,
  BUILTIN_TEAM_ROLE_MODEL_IDS as ROLE_MODEL_IDS,
  resolveBuiltinTeamMaterializationInput,
  verifyCurrentBuiltinTeamAuthority,
} from "../lib/builtin-team-authority";
import { ECOMMERCE_DEMO_DATASOURCE_ID } from "../lib/ecommerce-demo-bootstrap";
import {
  closeEcommerceDemoConnectorPools,
  createEcommerceDemoConnectorFactory,
  createEcommerceDemoEgressAuthorizer,
  createEcommerceDemoSecretResolver,
  ecommerceDemoRuntimeEnvironment,
} from "../lib/ecommerce-demo-datasource-runtime";
import { deriveIdempotentOperationId } from "../lib/run-command-identity";
import { createCapabilitySchemaDiscoveryAuthorityResolver } from "../lib/schema-discovery-authority";
import {
  createSchemaDiscoveryDatasourceResolver,
  createWorkspaceDatasourceMetadataResolver,
} from "../lib/schema-discovery-datasource";
import { createSchemaDiscoveryRuntime } from "../lib/schema-discovery-runtime";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_QA_READINESS_BOOTSTRAP";
const LOCAL_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_IDS = DATA_AGENT_SPECIALIST_PROFILE_IDS;
const ROLE_LABELS = {
  "governed-analysis-agent": "Governed analysis specialist",
  "governed-text2sql-agent": "Text2SQL specialist",
  "report-writing-agent": "Report specialist",
  "semantic-management-agent": "Semantic specialist",
} as const satisfies Readonly<Record<DataAgentSpecialistProfileId, string>>;
const ROLE_MODEL_ID_SET = new Set<string>(Object.values(ROLE_MODEL_IDS));

const configurationSchema = z.strictObject({
  databaseUrl: z.string().min(1),
  deploymentId: z.uuid(),
  workspaceId: z.uuid(),
  principalId: z.uuid(),
});

interface BootstrapResources {
  readonly datasource: { readonly resource_id: string; readonly resource_revision: number };
  readonly semantic: { readonly resource_id: string; readonly resource_revision: number };
  readonly snapshot: { readonly resource_id: string; readonly resource_revision: 1 } | null;
  readonly context: VersionedResourceReference;
  readonly egress: VersionedResourceReference;
  readonly safety: VersionedResourceReference;
}

function loadEnvironment(): NodeJS.ProcessEnv {
  return loadRuntimeEnvironment().environment;
}

function operationId(capability: AppCapability, kind: string, key: string): string {
  return deriveIdempotentOperationId({
    operation_kind: kind,
    workspace_id: capability.scope.tenant_id,
    principal_id: capability.principal,
    idempotency_key: key,
  });
}

function requireValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function sameRequestedReference(
  actual: VersionedResourceReference | null,
  expected: { readonly resource_id: string; readonly resource_revision: number },
): boolean {
  return (
    actual?.resource_id === expected.resource_id &&
    actual.resource_revision === expected.resource_revision
  );
}

function exactRoleModel(model: ModelCatalogEntry, base: ModelCatalogEntry, profileId: string) {
  return (
    model.model_profile_id === profileId &&
    model.provider === base.provider &&
    model.model_id === base.model_id &&
    model.base_url === base.base_url &&
    model.status === "ACTIVE" &&
    JSON.stringify(model.capabilities) === JSON.stringify(base.capabilities) &&
    JSON.stringify(model.credential_ref) === JSON.stringify(base.credential_ref)
  );
}

async function createDependencies(input: {
  pool: pg.Pool;
  capability: AppCapability;
  authority: ReturnType<typeof createPostgresCapabilityAuthority>;
  deploymentId: string;
  environment: NodeJS.ProcessEnv;
}): Promise<QaReadinessBootstrapDependencies> {
  const sqlPool = adaptPgPool(input.pool);
  const scope = input.capability.scope;
  const adminContext = {
    deployment_id: input.deploymentId,
    principal_id: input.capability.principal,
  };
  const modelControl = createPostgresModelControlRepository(sqlPool);
  const workspaceRepository = createPostgresWorkspaceDataRepository(
    sqlPool,
    input.authority.authorizer,
  );
  const defaults = createPostgresEffectiveConfigResolver({
    pool: sqlPool,
    authorizer: input.authority.authorizer,
  });
  const skills = createPostgresSkillRegistry({
    pool: sqlPool,
    authorizer: input.authority.authorizer,
  });
  const profiles = createPostgresAgentProfileRegistry({
    pool: sqlPool,
    authorizer: input.authority.authorizer,
  });
  const runtimeEnvironment = ecommerceDemoRuntimeEnvironment(input.environment);
  const schemaRuntime = createSchemaDiscoveryRuntime({
    environment: runtimeEnvironment,
    sqlPool,
    transactionalAuthorizer: input.authority.authorizer,
    authorityResolver: createCapabilitySchemaDiscoveryAuthorityResolver(input.capability),
    datasourceResolver: createSchemaDiscoveryDatasourceResolver({
      metadataResolver: createWorkspaceDatasourceMetadataResolver(workspaceRepository),
      egressAuthorizer: createEcommerceDemoEgressAuthorizer(runtimeEnvironment),
      secretResolver: createEcommerceDemoSecretResolver(runtimeEnvironment),
      connectorFactory: createEcommerceDemoConnectorFactory(),
    }),
  });

  async function models(): Promise<readonly ModelCatalogEntry[]> {
    return requireValue(await modelControl.listModels(adminContext));
  }

  async function authenticatedBaseModel(): Promise<ModelCatalogEntry> {
    const [catalog, authentications] = await Promise.all([
      modelControl.listModels(adminContext),
      modelControl.listModelAuthentications(adminContext),
    ]);
    const available = requireValue(catalog);
    const passed = new Set(
      requireValue(authentications)
        .filter((item) => item.state === "PASS")
        .map((item) => `${item.model_profile_id}:${item.model_config_version}`),
    );
    const model = available
      .filter(
        (item) =>
          item.status === "ACTIVE" &&
          passed.has(`${item.model_profile_id}:${item.config_version}`) &&
          !ROLE_MODEL_ID_SET.has(item.model_profile_id),
      )
      .sort((left, right) => Number(right.is_system_default) - Number(left.is_system_default))[0];
    if (!model) throw new Error("QA_READINESS_AUTHENTICATED_MODEL_REQUIRED");
    return model;
  }

  async function roleModelsReady(): Promise<boolean> {
    const catalog = await models();
    const base = await authenticatedBaseModel();
    return PROFILE_IDS.every((profileId) => {
      const current = catalog.find(
        (candidate) => candidate.model_profile_id === ROLE_MODEL_IDS[profileId],
      );
      return current ? exactRoleModel(current, base, ROLE_MODEL_IDS[profileId]) : false;
    });
  }

  async function resources(): Promise<BootstrapResources> {
    const result = await input.pool.query<{
      datasource_id: string;
      datasource_revision: string;
      semantic_id: string;
      semantic_revision: string;
      snapshot_id: string | null;
      context_policy: VersionedResourceReference;
      egress_policy: VersionedResourceReference;
      safety_policy: VersionedResourceReference;
    }>(
      `select datasource.datasource_id::text,
              datasource.resource_version::text as datasource_revision,
              pointer.current_release_id::text as semantic_id,
              pointer.current_release_generation::text as semantic_revision,
              scan.snapshot_id::text,
              app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY')
                - array['max_context_tokens','max_resource_bindings'] as context_policy,
              app_data_agent.builtin_effective_config_policy('EGRESS_POLICY')
                - array['allowed_providers','allowed_audiences','classification'] as egress_policy,
              app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY')
                - array['max_tool_calls','max_provider_calls','max_elapsed_ms'] as safety_policy
         from app_data_agent.datasource_connections datasource
         join semantic.semantic_domain_registry domain
           on domain.app_id=datasource.app_id and domain.tenant_id=datasource.tenant_id
          and domain.environment=datasource.environment and domain.datasource_id=datasource.datasource_id
          and domain.is_active
         join semantic.semantic_active_pointer pointer
           on pointer.app_id=domain.app_id and pointer.tenant_id=domain.tenant_id
          and pointer.environment=domain.environment and pointer.semantic_domain=domain.semantic_domain
          and pointer.current_release_id is not null
         left join lateral (
           select run.snapshot_id
             from catalog.schema_scan_run run
            where run.app_id=datasource.app_id and run.tenant_id=datasource.tenant_id
              and run.environment=datasource.environment
              and run.datasource_id=datasource.datasource_id::text
              and run.terminal='SUCCEEDED'
            order by run.committed_at desc limit 1
         ) scan on true
        where datasource.app_id=$1::uuid and datasource.tenant_id=$2::uuid
          and datasource.environment=$3::text and datasource.datasource_id=$4::uuid
          and datasource.status='ACTIVE'`,
      [scope.app_id, scope.tenant_id, scope.environment, ECOMMERCE_DEMO_DATASOURCE_ID],
    );
    const row = result.rows[0];
    if (!row) throw new Error("QA_READINESS_ECOMMERCE_RESOURCES_REQUIRED");
    return {
      datasource: {
        resource_id: row.datasource_id,
        resource_revision: Number(row.datasource_revision),
      },
      semantic: {
        resource_id: row.semantic_id,
        resource_revision: Number(row.semantic_revision),
      },
      snapshot: row.snapshot_id ? { resource_id: row.snapshot_id, resource_revision: 1 } : null,
      context: row.context_policy,
      egress: row.egress_policy,
      safety: row.safety_policy,
    };
  }

  async function defaultsReady(currentResources: BootstrapResources): Promise<boolean> {
    if (!currentResources.snapshot) return false;
    const current = requireValue(await defaults.getWorkspaceDefaults(input.capability));
    if (!current) return false;
    const base = await authenticatedBaseModel();
    return (
      sameRequestedReference(current.revision.defaults.model, {
        resource_id: base.model_profile_id,
        resource_revision: base.config_version,
      }) &&
      sameRequestedReference(current.revision.defaults.datasource, currentResources.datasource) &&
      sameRequestedReference(
        current.revision.defaults.semantic_release,
        currentResources.semantic,
      ) &&
      sameRequestedReference(
        current.revision.defaults.schema_snapshot,
        currentResources.snapshot,
      ) &&
      sameRequestedReference(current.revision.defaults.context_policy, currentResources.context) &&
      sameRequestedReference(current.revision.defaults.egress_policy, currentResources.egress) &&
      sameRequestedReference(
        current.revision.defaults.execution_safety_policy,
        currentResources.safety,
      )
    );
  }

  async function teamProfilesReady(): Promise<boolean> {
    const currentResources = await resources();
    const [profileItems, skillItems] = await Promise.all([
      profiles.listManagedV2(input.capability).then(requireValue),
      skills.list(input.capability, false).then(requireValue),
    ]);
    try {
      await verifyCurrentBuiltinTeamAuthority({
        materialization_input: await resolveBuiltinTeamMaterializationInput({
          pool: sqlPool,
          capability: input.capability,
          deployment_id: input.deploymentId,
          context_policy_ref: currentResources.context,
          execution_safety_policy_ref: currentResources.safety,
        }),
        profile_items: profileItems,
        skill_items: skillItems,
      });
      return true;
    } catch (error) {
      if (isBuiltinTeamAuthorityNotReady(error)) {
        return false;
      }
      throw error;
    }
  }

  async function inspect(): Promise<QaReadinessState> {
    const currentResources = await resources();
    const [modelReady, defaultsAreReady, teamReady] = await Promise.all([
      roleModelsReady(),
      defaultsReady(currentResources),
      teamProfilesReady(),
    ]);
    return {
      schema_version: "qa-readiness-state@1.0.0",
      workspace_id: scope.tenant_id,
      model_profiles_ready: modelReady,
      schema_snapshot_ready: currentResources.snapshot !== null,
      defaults_ready: defaultsAreReady,
      team_profiles_ready: teamReady,
    };
  }

  async function ensureModelProfiles(): Promise<void> {
    const base = await authenticatedBaseModel();
    const catalog = await models();
    for (const profileId of PROFILE_IDS) {
      const modelProfileId = ROLE_MODEL_IDS[profileId];
      const current = catalog.find((item) => item.model_profile_id === modelProfileId);
      if (current) {
        if (!exactRoleModel(current, base, modelProfileId)) {
          throw new Error("QA_READINESS_MODEL_PROFILE_CONFLICT");
        }
        continue;
      }
      const key = `qa-readiness:model:${profileId}:v1`;
      const committed = await modelControl.applyModelCommand(adminContext, {
        schema_version: "model-catalog-upsert@1.0.0",
        operation_id: operationId(input.capability, "qa-readiness-model", key),
        idempotency_key: key,
        model_profile_id: modelProfileId,
        provider: base.provider,
        model_id: base.model_id,
        display_name: `${base.display_name} - ${ROLE_LABELS[profileId]}`,
        base_url: base.base_url,
        capabilities: base.capabilities,
        credential_ref: base.credential_ref,
        status: "ACTIVE",
        is_system_default: false,
        expected_config_version: 0,
      });
      requireValue(committed);
    }
  }

  async function ensureSchemaSnapshot(): Promise<void> {
    const authority = await schemaRuntime.authorityResolver.resolve({ access: "WRITE" });
    const key = operationId(input.capability, "qa-readiness-schema-scan", "ecommerce:v1");
    const result = await schemaRuntime.service.startScan(authority, {
      schema_version: "schema-scan-request@1.0.0",
      datasource_id: ECOMMERCE_DEMO_DATASOURCE_ID,
      include_schemas: ["demo_adb_ecommerce_mart", "demo_adb_ecommerce_raw"],
      page_size: 1_000,
      statement_timeout_ms: 60_000,
      idempotency_key: key,
    });
    const value = requireValue(result);
    if (value.scan.terminal !== "SUCCEEDED" || !value.snapshot) {
      throw new Error(value.scan.terminal);
    }
  }

  async function ensureDefaults(): Promise<void> {
    const currentResources = await resources();
    if (!currentResources.snapshot) throw new Error("QA_READINESS_SCHEMA_SNAPSHOT_REQUIRED");
    const base = await authenticatedBaseModel();
    const existing = requireValue(await defaults.getWorkspaceDefaults(input.capability));
    if (await defaultsReady(currentResources)) return;
    const expectedRevision = existing?.revision.defaults_revision ?? 0;
    const key = `qa-readiness:defaults:v${expectedRevision + 1}`;
    const command = await buildWorkspaceDefaultsCasUpdateCommandCandidate({
      schema_version: "workspace-defaults-cas-update@1.0.0",
      operation_id: operationId(input.capability, "qa-readiness-defaults", key),
      workspace_id: scope.tenant_id,
      expected_defaults_revision: expectedRevision,
      idempotency_key: key,
      defaults: {
        model: {
          resource_id: base.model_profile_id,
          expected_revision: base.config_version,
        },
        datasource: {
          resource_id: currentResources.datasource.resource_id,
          expected_revision: currentResources.datasource.resource_revision,
        },
        files: [],
        knowledge: [],
        mcp_servers: [],
        skills: [],
        semantic_release: {
          resource_id: currentResources.semantic.resource_id,
          expected_revision: currentResources.semantic.resource_revision,
        },
        schema_snapshot: {
          resource_id: currentResources.snapshot.resource_id,
          expected_revision: 1,
        },
        context_policy: {
          resource_id: currentResources.context.resource_id,
          expected_revision: currentResources.context.resource_revision,
        },
        egress_policy: {
          resource_id: currentResources.egress.resource_id,
          expected_revision: currentResources.egress.resource_revision,
        },
        execution_safety_policy: {
          resource_id: currentResources.safety.resource_id,
          expected_revision: currentResources.safety.resource_revision,
        },
      },
    });
    requireValue(await defaults.updateWorkspaceDefaults(input.capability, command));
  }

  async function ensureTeamProfiles(): Promise<void> {
    const currentResources = await resources();
    if (!currentResources.snapshot || !(await defaultsReady(currentResources))) {
      throw new Error("QA_READINESS_DEFAULTS_REQUIRED");
    }
    const result = await materializeBuiltinTeamProfiles(
      {
        ...(await resolveBuiltinTeamMaterializationInput({
          pool: sqlPool,
          capability: input.capability,
          deployment_id: input.deploymentId,
          context_policy_ref: currentResources.context,
          execution_safety_policy_ref: currentResources.safety,
        })),
        capability_input: input.capability,
        actor_principal_id: input.capability.principal,
        create_operation_id: (material) =>
          operationId(
            input.capability,
            "qa-readiness-team-materialization",
            `builtin-team:v4:${material}`,
          ),
        idempotency_prefix: "qa-readiness:builtin-team:v4",
      },
      { skills, profiles },
    );
    requireValue(result);
  }

  return { inspect, ensureModelProfiles, ensureSchemaSnapshot, ensureDefaults, ensureTeamProfiles };
}

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const environment = loadEnvironment();
  const confirmed = environment[CONFIRMATION_VARIABLE]?.trim() === "YES";
  const production = environment.NODE_ENV === "production";
  if (!confirmed || production) {
    const result = await runQaReadinessBootstrap(
      {
        workspace_id: environment.WORKER_TENANT_ID ?? "00000000-0000-4000-8000-000000000000",
        environment: production ? "production" : "local",
        confirmed,
      },
      {
        inspect: async () => {
          throw new Error("QA_READINESS_UNEXPECTED_INSPECTION");
        },
        ensureModelProfiles: async () => undefined,
        ensureSchemaSnapshot: async () => undefined,
        ensureDefaults: async () => undefined,
        ensureTeamProfiles: async () => undefined,
      },
    );
    report({ ...result, confirmation_variable: CONFIRMATION_VARIABLE });
    process.exitCode = result.terminal === "NOT_RUN" ? 2 : 64;
    return;
  }

  const configuration = configurationSchema.safeParse({
    databaseUrl: environment.DATABASE_URL,
    deploymentId:
      environment.WORKER_DEPLOYMENT_ID ?? environment.SEMANTIC_DEPLOYMENT_ID ?? LOCAL_DEPLOYMENT_ID,
    workspaceId: environment.WORKER_TENANT_ID ?? environment.SEMANTIC_TENANT_ID,
    principalId: environment.WORKER_PRINCIPAL_ID ?? environment.SEMANTIC_PRINCIPAL_ID,
  });
  if (!configuration.success) {
    report({
      schema_version: "qa-readiness-bootstrap-result@1.0.0",
      terminal: "HOLD",
      reason_code: "QA_READINESS_CONFIGURATION_INVALID",
    });
    process.exitCode = 64;
    return;
  }

  const pool = new pg.Pool({
    connectionString: configuration.data.databaseUrl,
    application_name: "data-agent-qa-readiness-bootstrap",
    max: 4,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 120_000,
  });
  try {
    const authority = createPostgresCapabilityAuthority(adaptPgPool(pool));
    const capability = requireValue(
      await authority.resolveForServerContext({
        deployment_id: configuration.data.deploymentId,
        tenant_id: configuration.data.workspaceId,
        principal_id: configuration.data.principalId,
        access: "WRITE",
      }),
    );
    const dependencies = await createDependencies({
      pool,
      capability,
      authority,
      deploymentId: configuration.data.deploymentId,
      environment,
    });
    const result = await runQaReadinessBootstrap(
      {
        workspace_id: configuration.data.workspaceId,
        environment: capability.scope.environment,
        confirmed: true,
      },
      dependencies,
    );
    report(result);
    if (result.terminal !== "READY") process.exitCode = 2;
  } catch (error) {
    report({
      schema_version: "qa-readiness-bootstrap-result@1.0.0",
      terminal: "HOLD",
      reason_code:
        error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.message)
          ? error.message
          : "QA_READINESS_BOOTSTRAP_FAILED",
    });
    process.exitCode = 2;
  } finally {
    await closeEcommerceDemoConnectorPools();
    await pool.end();
  }
}

await main();
