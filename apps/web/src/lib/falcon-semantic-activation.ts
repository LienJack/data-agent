import { createHash } from "node:crypto";
import {
  type ContentHash,
  contentHashSchema,
  sha256ContentHash,
} from "@data-agent/contracts/common";
import {
  buildWorkspaceDefaultsCasUpdateCommandCandidate,
  type VersionedResourceReference,
} from "@data-agent/contracts/workspaces";
import {
  adaptPgCatalogPool,
  createPostgresCatalogScanner,
  createPostgresSchemaSnapshotStore,
} from "@data-agent/platform/catalog";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresEffectiveConfigResolver } from "@data-agent/platform/runs";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import pg, { type Pool } from "pg";
import {
  FALCON_DATASOURCE_ID,
  resolveFalconConnectionConfiguration,
} from "./falcon-workspace-bootstrap";

export interface FalconSemanticActivationScope {
  readonly appId: string;
  readonly workspaceId: string;
  readonly environment: string;
  readonly principalId: string;
  readonly deploymentId: string;
}

export interface FalconSemanticReleaseReference {
  readonly release_id: string;
  readonly release_generation: number;
  readonly release_hash: ContentHash;
}

export interface FalconSemanticActivationResult {
  readonly schema_version: "falcon-semantic-activation@1.0.0";
  readonly terminal: "READY";
  readonly workspace_id: string;
  readonly datasource_id: string;
  readonly semantic_release: FalconSemanticReleaseReference;
  readonly schema_snapshot: {
    readonly snapshot_id: string;
    readonly snapshot_hash: ContentHash;
    readonly created: boolean;
  };
  readonly model: {
    readonly model_profile_id: string;
    readonly provider: "deepseek";
    readonly model_id: string;
    readonly config_version: number;
  };
  readonly defaults: {
    readonly defaults_id: string;
    readonly defaults_revision: number;
    readonly defaults_hash: ContentHash;
    readonly changed: boolean;
  };
}

interface FalconResourceRow {
  readonly datasource_id: string;
  readonly datasource_revision: string;
  readonly host: string;
  readonly port: number;
  readonly database_name: string;
  readonly schema_name: string;
  readonly source_digest: string;
  readonly context_policy: VersionedResourceReference;
  readonly egress_policy: VersionedResourceReference;
  readonly safety_policy: VersionedResourceReference;
}

interface DeepSeekModelReference {
  readonly model_profile_id: string;
  readonly provider: "deepseek";
  readonly model_id: string;
  readonly config_version: number;
}

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function contentHash(value: string): ContentHash {
  contentHashSchema.parse(value);
  return value as ContentHash;
}

function requireValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function sameReference(
  actual: VersionedResourceReference | null,
  expected: { readonly resource_id: string; readonly resource_revision: number },
): boolean {
  return (
    actual?.resource_id === expected.resource_id &&
    actual.resource_revision === expected.resource_revision
  );
}

async function loadResources(pool: Pool, scope: FalconSemanticActivationScope) {
  const result = await pool.query<FalconResourceRow>(
    `select datasource.datasource_id::text,
            datasource.resource_version::text as datasource_revision,
            datasource.host,
            datasource.port,
            datasource.database_name,
            datasource.schema_name,
            receipt.source_digest,
            app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY')
              - array['max_context_tokens','max_resource_bindings'] as context_policy,
            app_data_agent.builtin_effective_config_policy('EGRESS_POLICY')
              - array['allowed_providers','allowed_audiences','classification'] as egress_policy,
            app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY')
              - array['max_tool_calls','max_provider_calls','max_elapsed_ms'] as safety_policy
       from app_data_agent.datasource_connections as datasource
       join lateral (
         select source_digest
           from app_data_agent.falcon_import_receipts
          where status='READY'
          order by imported_at desc
          limit 1
       ) as receipt on true
      where datasource.app_id=$1::uuid and datasource.tenant_id=$2::uuid
        and datasource.environment=$3::text and datasource.datasource_id=$4::uuid
        and datasource.status='ACTIVE' and datasource.username='falcon_demo_reader'
        and datasource.schema_name='falcon_db_24'`,
    [scope.appId, scope.workspaceId, scope.environment, FALCON_DATASOURCE_ID],
  );
  const row = result.rows[0];
  if (result.rowCount !== 1 || !row) throw new Error("FALCON_ACTIVATION_RESOURCES_REQUIRED");
  return row;
}

async function selectDeepSeekModel(
  pool: Pool,
  scope: FalconSemanticActivationScope,
): Promise<DeepSeekModelReference> {
  const result = await pool.query<{
    readonly model_profile_id: string;
    readonly provider: "deepseek";
    readonly model_id: string;
    readonly config_version: string;
  }>(
    `select model.model_profile_id::text,model.provider,model.model_id,
            model.config_version::text
       from app_data_agent.model_catalog_entries as model
       join platform.deployment_mappings as deployment
         on deployment.app_id=model.app_id and deployment.environment=model.environment
        and deployment.deployment_id=$1::uuid and deployment.is_active
      where model.app_id=$2::uuid and model.environment=$3::text
        and model.provider='deepseek' and model.status='ACTIVE'
        and model.api_authenticated_config_version=model.config_version
        and model.api_authenticated_at is not null
      order by model.is_system_default desc,model.config_version desc,model.model_profile_id
      limit 1`,
    [scope.deploymentId, scope.appId, scope.environment],
  );
  const model = result.rows[0];
  if (!model) throw new Error("FALCON_AUTHENTICATED_DEEPSEEK_REQUIRED");
  return {
    ...model,
    config_version: Number(model.config_version),
  };
}

async function ensureSchemaSnapshot(input: {
  readonly pool: Pool;
  readonly readerPool: Pool;
  readonly capability: unknown;
  readonly authorizer: ReturnType<typeof createPostgresCapabilityAuthority>["authorizer"];
  readonly datasourceFingerprint: ContentHash;
}) {
  const existing = await input.pool.query<{
    readonly snapshot_id: string;
    readonly snapshot_content_hash: ContentHash;
  }>(
    `select snapshot_id::text,snapshot_content_hash
       from catalog.schema_scan_run
      where datasource_id=$1::text and datasource_fingerprint=$2::text
        and terminal='SUCCEEDED' and snapshot_id is not null
      order by committed_at desc
      limit 1`,
    [FALCON_DATASOURCE_ID, input.datasourceFingerprint],
  );
  const current = existing.rows[0];
  if (current) return { ...current, created: false };

  const scanRunId = stableUuid(`falcon24:schema-scan:${input.datasourceFingerprint}`);
  const snapshotId = stableUuid(`falcon24:schema-snapshot:${input.datasourceFingerprint}`);
  const request = {
    schema_version: "schema-scan-request@1.0.0" as const,
    datasource_id: FALCON_DATASOURCE_ID,
    include_schemas: ["falcon_db_24"],
    page_size: 1_000,
    statement_timeout_ms: 60_000,
    idempotency_key: scanRunId,
  };
  const snapshot = requireValue(
    await createPostgresCatalogScanner(adaptPgCatalogPool(input.readerPool)).scan({
      request,
      datasource_fingerprint: input.datasourceFingerprint,
      snapshot_id: snapshotId,
      scan_run_id: scanRunId,
      captured_at: new Date().toISOString(),
    }),
  );
  const committed = requireValue(
    await createPostgresSchemaSnapshotStore({
      pool: adaptPgPool(input.pool),
      authorizer: input.authorizer,
    }).commitSuccess(input.capability, request, snapshot),
  );
  if (
    committed.terminal !== "SUCCEEDED" ||
    !committed.snapshot_id ||
    !committed.snapshot_content_hash
  ) {
    throw new Error("FALCON_SCHEMA_SNAPSHOT_COMMIT_FAILED");
  }
  return {
    snapshot_id: committed.snapshot_id,
    snapshot_content_hash: committed.snapshot_content_hash,
    created: committed.created,
  };
}

export async function activateFalconSemanticWorkspace(input: {
  readonly pool: Pool;
  readonly environment: NodeJS.ProcessEnv;
  readonly scope: FalconSemanticActivationScope;
  readonly release: FalconSemanticReleaseReference;
}): Promise<FalconSemanticActivationResult> {
  const sqlPool = adaptPgPool(input.pool);
  const authority = createPostgresCapabilityAuthority(sqlPool);
  const capability = requireValue(
    await authority.resolveForServerContext({
      deployment_id: input.scope.deploymentId,
      tenant_id: input.scope.workspaceId,
      principal_id: input.scope.principalId,
      access: "WRITE",
    }),
  );
  const resources = await loadResources(input.pool, input.scope);
  const datasourceFingerprint = await sha256ContentHash({
    schema_version: "falcon-datasource-fingerprint@1.0.0",
    datasource_id: resources.datasource_id,
    source_digest: resources.source_digest,
    host: resources.host,
    port: resources.port,
    database_name: resources.database_name,
    included_schemas: [resources.schema_name],
  });
  const connection = resolveFalconConnectionConfiguration(
    input.environment,
    input.scope.environment,
  );
  const readerPool = new pg.Pool({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: "falcon_demo_reader",
    password: connection.password,
    ssl: false,
    application_name: "data-agent-falcon-schema-scan",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 65_000,
    max: 1,
  });
  try {
    const [snapshot, model] = await Promise.all([
      ensureSchemaSnapshot({
        pool: input.pool,
        readerPool,
        capability,
        authorizer: authority.authorizer,
        datasourceFingerprint,
      }),
      selectDeepSeekModel(input.pool, input.scope),
    ]);
    const defaults = createPostgresEffectiveConfigResolver({
      pool: sqlPool,
      authorizer: authority.authorizer,
    });
    const existing = requireValue(await defaults.getWorkspaceDefaults(capability));
    const expected = {
      model: { resource_id: model.model_profile_id, resource_revision: model.config_version },
      datasource: {
        resource_id: resources.datasource_id,
        resource_revision: Number(resources.datasource_revision),
      },
      semantic: {
        resource_id: input.release.release_id,
        resource_revision: input.release.release_generation,
      },
      snapshot: { resource_id: snapshot.snapshot_id, resource_revision: 1 },
    };
    const alreadyReady =
      existing !== null &&
      sameReference(existing.revision.defaults.model, expected.model) &&
      sameReference(existing.revision.defaults.datasource, expected.datasource) &&
      sameReference(existing.revision.defaults.semantic_release, expected.semantic) &&
      sameReference(existing.revision.defaults.schema_snapshot, expected.snapshot) &&
      sameReference(existing.revision.defaults.context_policy, resources.context_policy) &&
      sameReference(existing.revision.defaults.egress_policy, resources.egress_policy) &&
      sameReference(existing.revision.defaults.execution_safety_policy, resources.safety_policy) &&
      existing.revision.defaults.files.length === 0 &&
      existing.revision.defaults.knowledge.length === 0 &&
      existing.revision.defaults.mcp_servers.length === 0 &&
      existing.revision.defaults.skills.length === 0;
    const revision = alreadyReady
      ? existing.revision
      : requireValue(
          await defaults.updateWorkspaceDefaults(
            capability,
            await buildWorkspaceDefaultsCasUpdateCommandCandidate({
              schema_version: "workspace-defaults-cas-update@1.0.0",
              operation_id: stableUuid(
                `falcon24:defaults:${input.scope.workspaceId}:${(existing?.revision.defaults_revision ?? 0) + 1}`,
              ),
              workspace_id: input.scope.workspaceId,
              expected_defaults_revision: existing?.revision.defaults_revision ?? 0,
              idempotency_key: stableUuid(
                `falcon24:defaults-request:${input.scope.workspaceId}:${(existing?.revision.defaults_revision ?? 0) + 1}`,
              ),
              defaults: {
                model: {
                  resource_id: expected.model.resource_id,
                  expected_revision: expected.model.resource_revision,
                },
                datasource: {
                  resource_id: expected.datasource.resource_id,
                  expected_revision: expected.datasource.resource_revision,
                },
                files: [],
                knowledge: [],
                mcp_servers: [],
                skills: [],
                semantic_release: {
                  resource_id: expected.semantic.resource_id,
                  expected_revision: expected.semantic.resource_revision,
                },
                schema_snapshot: {
                  resource_id: expected.snapshot.resource_id,
                  expected_revision: expected.snapshot.resource_revision,
                },
                context_policy: {
                  resource_id: resources.context_policy.resource_id,
                  expected_revision: resources.context_policy.resource_revision,
                },
                egress_policy: {
                  resource_id: resources.egress_policy.resource_id,
                  expected_revision: resources.egress_policy.resource_revision,
                },
                execution_safety_policy: {
                  resource_id: resources.safety_policy.resource_id,
                  expected_revision: resources.safety_policy.resource_revision,
                },
              },
            }),
          ),
        ).revision;
    return {
      schema_version: "falcon-semantic-activation@1.0.0",
      terminal: "READY",
      workspace_id: input.scope.workspaceId,
      datasource_id: FALCON_DATASOURCE_ID,
      semantic_release: input.release,
      schema_snapshot: {
        snapshot_id: snapshot.snapshot_id,
        snapshot_hash: contentHash(snapshot.snapshot_content_hash),
        created: snapshot.created,
      },
      model: {
        model_profile_id: model.model_profile_id,
        provider: "deepseek",
        model_id: model.model_id,
        config_version: model.config_version,
      },
      defaults: {
        defaults_id: revision.defaults_id,
        defaults_revision: revision.defaults_revision,
        defaults_hash: contentHash(revision.defaults_hash),
        changed: !alreadyReady,
      },
    };
  } finally {
    await readerPool.end();
  }
}
