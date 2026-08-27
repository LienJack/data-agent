import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildBuiltinTeamMaterialization,
  materializeBuiltinTeamProfiles,
} from "@data-agent/agent-runtime";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24AuthorityBaseline,
  verifyFalcon24RetainedAssetsManifest,
} from "@data-agent/contracts/evals";
import { verifyFalcon24E1StagingReceipt } from "@data-agent/contracts/runs";
import { loadRuntimeBuildIdentity } from "@data-agent/contracts/server";
import {
  buildWorkspaceDefaultsCasUpdateCommandCandidate,
  type VersionedResourceReference,
} from "@data-agent/contracts/workspaces";
import { createPostgresAgentProfileRegistry } from "@data-agent/platform/agents";
import {
  adaptPgCatalogPool,
  createPostgresCatalogScanner,
  createPostgresSchemaSnapshotStore,
} from "@data-agent/platform/catalog";
import { createPostgresSkillRegistry } from "@data-agent/platform/extensions";
import { adaptPgPool } from "@data-agent/platform/persistence";
import {
  createPostgresEffectiveConfigResolver,
  createPostgresFalcon24AuthorityEpoch,
} from "@data-agent/platform/runs";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import pg from "pg";
import { z } from "zod";
import { verifyOpenSandboxAnalysisAttestation } from "../../../../scripts/verify-opensandbox-analysis-attestation.js";
import {
  BUILTIN_TEAM_ROLE_MODEL_IDS,
  resolveBuiltinTeamMaterializationInput,
  verifyCurrentBuiltinTeamAuthority,
} from "../lib/builtin-team-authority";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_E1_ACTIVATION";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-00000000e124";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-00000000e125";
const DEFAULT_STAGING_ID = "00000000-0000-4000-8000-00000000e130";
const DEFAULT_DATASOURCE_ID = "37653002-af62-53c9-bf21-519468aa39ab";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const execFileAsync = promisify(execFile);

const configurationSchema = z.strictObject({
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  workspace_id: z.uuid(),
  principal_id: z.uuid(),
  staging_id: z.uuid(),
  datasource_id: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  reader_password: z.string().min(1).max(1_024),
});

const ACCEPTANCE_CONTRACT_SOURCES = Object.freeze({
  qualification: Object.freeze([
    "apps/web/src/cli/falcon24-qualification.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010774_app_data_agent_falcon24_qualification_authority.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority.sql",
    "packages/contracts/src/evals/falcon24-qualification.ts",
    "packages/platform/src/runs/postgres-falcon24-qualification.ts",
  ]),
  campaign: Object.freeze([
    "apps/web/src/cli/falcon24-agent-acceptance.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010766_app_data_agent_falcon24_acceptance_campaign_authority.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority.sql",
    "packages/contracts/src/evals/falcon24-acceptance-campaign.ts",
    "packages/platform/src/runs/postgres-falcon24-acceptance-campaign.ts",
  ]),
  qa_e2e: Object.freeze([
    "apps/web/src/cli/falcon24-browser-trace-gate.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010777_app_data_agent_falcon24_e1_trace.sql",
    "packages/contracts/src/runs/authority-epoch.ts",
  ]),
  trace_ui: Object.freeze([
    "apps/web/src/cli/falcon24-browser-trace-gate.ts",
    "apps/web/src/cli/falcon24-resolution-trace-gate.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010777_app_data_agent_falcon24_e1_trace.sql",
  ]),
  reclamation: Object.freeze([
    "apps/worker/src/evals/falcon24-qualification-reclamation-cli.ts",
    "apps/worker/src/evals/falcon24-sandbox-reclamation-cli.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority.sql",
    "packages/contracts/src/evals/falcon24-acceptance-campaign.ts",
  ]),
});

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function rawHash(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function requireValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function stableFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(message)
    ? message
    : "FALCON24_E1_ACTIVATION_FINALIZATION_FAILED";
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

async function contractHash(root: string, paths: readonly string[]) {
  return sha256ContentHash({
    schema_version: "falcon24-acceptance-contract-source-set@1.0.0",
    source_files: [...paths].sort().map((path) => ({ path, hash: rawHash(resolve(root, path)) })),
  });
}

export async function buildFalcon24E1AcceptanceContractHashes(input: {
  readonly repository_root: string;
  readonly oracle_contract_hash: string;
}) {
  const entries = await Promise.all(
    Object.entries(ACCEPTANCE_CONTRACT_SOURCES).map(async ([key, paths]) => [
      key,
      await contractHash(input.repository_root, paths),
    ]),
  );
  return Object.freeze({
    oracle: input.oracle_contract_hash,
    ...(Object.fromEntries(entries) as {
      qualification: `sha256:${string}`;
      campaign: `sha256:${string}`;
      qa_e2e: `sha256:${string}`;
      trace_ui: `sha256:${string}`;
      reclamation: `sha256:${string}`;
    }),
  });
}

async function frozenCommit(root: string): Promise<string> {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root }),
    execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }),
  ]);
  if (status.trim().length > 0) throw new TypeError("FALCON24_E1_SOURCE_NOT_FROZEN");
  return z
    .string()
    .regex(/^[0-9a-f]{40}$/u)
    .parse(commit.trim());
}

async function ensureSchemaSnapshot(input: {
  readonly pool: pg.Pool;
  readonly reader_pool: pg.Pool;
  readonly sql_pool: ReturnType<typeof adaptPgPool>;
  readonly capability: Parameters<
    ReturnType<typeof createPostgresSchemaSnapshotStore>["commitSuccess"]
  >[0];
  readonly authorizer: ReturnType<typeof createPostgresCapabilityAuthority>["authorizer"];
  readonly datasource_id: string;
  readonly datasource_fingerprint: `sha256:${string}`;
}) {
  const current = await input.pool.query<{
    snapshot_id: string;
    snapshot_content_hash: `sha256:${string}`;
  }>(
    `select snapshot_id::text,snapshot_content_hash
       from catalog.schema_scan_run
      where datasource_id=$1::text and datasource_fingerprint=$2::text
        and terminal='SUCCEEDED' and snapshot_id is not null
      order by committed_at desc limit 1`,
    [input.datasource_id, input.datasource_fingerprint],
  );
  const existing = current.rows[0];
  if (existing) return { ...existing, created: false as const };
  const scanRunId = stableUuid(`falcon24-e1:schema-scan:${input.datasource_fingerprint}`);
  const snapshotId = stableUuid(`falcon24-e1:schema-snapshot:${input.datasource_fingerprint}`);
  const request = {
    schema_version: "schema-scan-request@1.0.0" as const,
    datasource_id: input.datasource_id,
    include_schemas: ["falcon_db_24"],
    page_size: 1_000,
    statement_timeout_ms: 60_000,
    idempotency_key: scanRunId,
  };
  const snapshot = requireValue(
    await createPostgresCatalogScanner(adaptPgCatalogPool(input.reader_pool)).scan({
      request,
      datasource_fingerprint: input.datasource_fingerprint,
      snapshot_id: snapshotId,
      scan_run_id: scanRunId,
      captured_at: new Date().toISOString(),
    }),
  );
  const committed = requireValue(
    await createPostgresSchemaSnapshotStore({
      pool: input.sql_pool,
      authorizer: input.authorizer,
    }).commitSuccess(input.capability, request, snapshot),
  );
  if (
    committed.terminal !== "SUCCEEDED" ||
    !committed.snapshot_id ||
    !committed.snapshot_content_hash
  ) {
    throw new TypeError("FALCON24_E1_SCHEMA_SNAPSHOT_COMMIT_FAILED");
  }
  return {
    snapshot_id: committed.snapshot_id,
    snapshot_content_hash: committed.snapshot_content_hash,
    created: committed.created,
  };
}

async function prepareWorkspaceAuthority(input: {
  readonly pool: pg.Pool;
  readonly sql_pool: ReturnType<typeof adaptPgPool>;
  readonly capability: Parameters<typeof resolveBuiltinTeamMaterializationInput>[0]["capability"];
  readonly authorizer: ReturnType<typeof createPostgresCapabilityAuthority>["authorizer"];
  readonly deployment_id: string;
  readonly staging_id: string;
  readonly datasource_id: string;
  readonly reader_password: string;
}) {
  const resources = await input.pool.query<{
    datasource_id: string;
    datasource_revision: string;
    host: string;
    port: number;
    database_name: string;
    username: string;
    schema_name: string;
    semantic_id: string;
    semantic_revision: string;
    dataset_subject_hash: `sha256:${string}`;
    dataset_evidence_hash: `sha256:${string}`;
    context_policy: VersionedResourceReference;
    egress_policy: VersionedResourceReference;
    safety_policy: VersionedResourceReference;
  }>(
    `select datasource.datasource_id::text,
            datasource.resource_version::text as datasource_revision,
            datasource.host,datasource.port,datasource.database_name,datasource.username,
            datasource.schema_name,pointer.current_release_id::text as semantic_id,
            pointer.current_release_generation::text as semantic_revision,
            receipt.subject_hash as dataset_subject_hash,
            receipt.evidence_hash as dataset_evidence_hash,
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
        and domain.semantic_domain='falcon24' and domain.is_active
       join semantic.semantic_active_pointer pointer
         on pointer.app_id=domain.app_id and pointer.tenant_id=domain.tenant_id
        and pointer.environment=domain.environment and pointer.semantic_domain=domain.semantic_domain
        and pointer.current_release_id is not null
       join app_data_agent.falcon24_e1_staging_receipts receipt
         on receipt.app_id=datasource.app_id and receipt.tenant_id=datasource.tenant_id
        and receipt.environment=datasource.environment and receipt.staging_id=$4::uuid
        and receipt.component='DATASET'
      where datasource.app_id=$1::uuid and datasource.tenant_id=$2::uuid
        and datasource.environment=$3::text and datasource.datasource_id=$5::uuid
        and datasource.status='ACTIVE' and datasource.username='falcon_demo_reader'
        and datasource.schema_name='falcon_db_24'`,
    [
      input.capability.scope.app_id,
      input.capability.scope.tenant_id,
      input.capability.scope.environment,
      input.staging_id,
      input.datasource_id,
    ],
  );
  const resource = resources.rows[0];
  if (resources.rowCount !== 1 || !resource) {
    throw new TypeError("FALCON24_E1_WORKSPACE_RESOURCES_REQUIRED");
  }
  const datasourceFingerprint = await sha256ContentHash({
    schema_version: "falcon24-e1-datasource-fingerprint@1.0.0",
    datasource_id: resource.datasource_id,
    datasource_revision: Number(resource.datasource_revision),
    dataset_subject_hash: resource.dataset_subject_hash,
    catalog_inventory_hash: resource.dataset_evidence_hash,
    host: resource.host,
    port: resource.port,
    database_name: resource.database_name,
    schema_name: resource.schema_name,
  });
  const readerPool = new pg.Pool({
    host: resource.host,
    port: resource.port,
    database: resource.database_name,
    user: resource.username,
    password: input.reader_password,
    ssl: false,
    application_name: "data-agent-falcon24-e1-final-schema-scan",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 65_000,
    max: 1,
  });
  try {
    const snapshot = await ensureSchemaSnapshot({
      pool: input.pool,
      reader_pool: readerPool,
      sql_pool: input.sql_pool,
      capability: input.capability,
      authorizer: input.authorizer,
      datasource_id: input.datasource_id,
      datasource_fingerprint: datasourceFingerprint,
    });
    const baseModels = await input.pool.query<{
      model_profile_id: string;
      config_version: string;
    }>(
      `select model.model_profile_id::text,model.config_version::text
         from app_data_agent.model_catalog_entries model
        where model.app_id=$1::uuid and model.environment=$2::text
          and model.status='ACTIVE' and model.is_system_default
          and model.api_authenticated_config_version=model.config_version
          and model.api_authenticated_at is not null
          and not (model.model_profile_id=any($3::uuid[]))
        order by model.config_version desc,model.model_profile_id limit 1`,
      [
        input.capability.scope.app_id,
        input.capability.scope.environment,
        Object.values(BUILTIN_TEAM_ROLE_MODEL_IDS),
      ],
    );
    const baseModel = baseModels.rows[0];
    if (!baseModel) throw new TypeError("FALCON24_E1_AUTHENTICATED_MODEL_REQUIRED");
    const defaults = createPostgresEffectiveConfigResolver({
      pool: input.sql_pool,
      authorizer: input.authorizer,
    });
    const existing = requireValue(await defaults.getWorkspaceDefaults(input.capability));
    const expected = {
      model: {
        resource_id: baseModel.model_profile_id,
        resource_revision: Number(baseModel.config_version),
      },
      datasource: {
        resource_id: resource.datasource_id,
        resource_revision: Number(resource.datasource_revision),
      },
      semantic: {
        resource_id: resource.semantic_id,
        resource_revision: Number(resource.semantic_revision),
      },
      snapshot: { resource_id: snapshot.snapshot_id, resource_revision: 1 },
    };
    const alreadyReady =
      existing !== null &&
      sameReference(existing.revision.defaults.model, expected.model) &&
      sameReference(existing.revision.defaults.datasource, expected.datasource) &&
      sameReference(existing.revision.defaults.semantic_release, expected.semantic) &&
      sameReference(existing.revision.defaults.schema_snapshot, expected.snapshot) &&
      sameReference(existing.revision.defaults.context_policy, resource.context_policy) &&
      sameReference(existing.revision.defaults.egress_policy, resource.egress_policy) &&
      sameReference(existing.revision.defaults.execution_safety_policy, resource.safety_policy) &&
      existing.revision.defaults.files.length === 0 &&
      existing.revision.defaults.knowledge.length === 0 &&
      existing.revision.defaults.mcp_servers.length === 0 &&
      existing.revision.defaults.skills.length === 0;
    const defaultsRevision = alreadyReady
      ? existing.revision
      : requireValue(
          await defaults.updateWorkspaceDefaults(
            input.capability,
            await buildWorkspaceDefaultsCasUpdateCommandCandidate({
              schema_version: "workspace-defaults-cas-update@1.0.0",
              operation_id: stableUuid(
                `falcon24-e1:defaults:${input.capability.scope.tenant_id}:${(existing?.revision.defaults_revision ?? 0) + 1}`,
              ),
              workspace_id: input.capability.scope.tenant_id,
              expected_defaults_revision: existing?.revision.defaults_revision ?? 0,
              idempotency_key: stableUuid(
                `falcon24-e1:defaults-request:${input.capability.scope.tenant_id}:${(existing?.revision.defaults_revision ?? 0) + 1}`,
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
                  resource_id: resource.context_policy.resource_id,
                  expected_revision: resource.context_policy.resource_revision,
                },
                egress_policy: {
                  resource_id: resource.egress_policy.resource_id,
                  expected_revision: resource.egress_policy.resource_revision,
                },
                execution_safety_policy: {
                  resource_id: resource.safety_policy.resource_id,
                  expected_revision: resource.safety_policy.resource_revision,
                },
              },
            }),
          ),
        ).revision;
    return {
      snapshot,
      defaults: defaultsRevision,
      context_policy: resource.context_policy,
      safety_policy: resource.safety_policy,
    };
  } finally {
    await readerPool.end();
  }
}

export async function runFalcon24E1Finalization(
  environment: NodeJS.ProcessEnv = loadRuntimeEnvironment().environment,
) {
  if (environment[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
    return {
      schema_version: "falcon24-e1-finalization-result@1.0.0" as const,
      terminal: "NOT_RUN" as const,
      reason_code: "FALCON24_E1_ACTIVATION_CONFIRMATION_REQUIRED" as const,
    };
  }
  const configuration = configurationSchema.parse({
    database_url: environment.DATABASE_URL,
    deployment_id: environment.WORKER_DEPLOYMENT_ID ?? DEFAULT_DEPLOYMENT_ID,
    workspace_id: environment.WORKER_TENANT_ID ?? DEFAULT_WORKSPACE_ID,
    principal_id: environment.WORKER_PRINCIPAL_ID ?? DEFAULT_PRINCIPAL_ID,
    staging_id: environment.FALCON24_E1_STAGING_ID ?? DEFAULT_STAGING_ID,
    datasource_id: environment.FALCON24_E1_DATASOURCE_ID ?? DEFAULT_DATASOURCE_ID,
    environment: environment.FALCON24_E1_ENVIRONMENT ?? "local",
    reader_password: environment.FALCON_READER_PASSWORD,
  });
  const retained = await verifyFalcon24RetainedAssetsManifest(
    json(resolve(REPOSITORY_ROOT, "infra/falcon/e1/retained-assets-manifest.json")),
  );
  const runtimeAttestation = await verifyOpenSandboxAnalysisAttestation(REPOSITORY_ROOT);
  if (configuration.environment === "prod" || configuration.environment === "production") {
    throw new TypeError("FALCON24_E1_PRODUCTION_ISOLATION_REQUIRED");
  }
  const sourceCommit = await frozenCommit(REPOSITORY_ROOT);
  const buildIdentity = loadRuntimeBuildIdentity({ expectedRole: "web", environment });
  if (
    buildIdentity.git_dirty ||
    buildIdentity.git_commit !== sourceCommit ||
    buildIdentity.consumer_role !== "web"
  ) {
    throw new TypeError("FALCON24_E1_WEB_BUILD_IDENTITY_MISMATCH");
  }
  const pool = new pg.Pool({
    connectionString: configuration.database_url,
    application_name: "data-agent-falcon24-e1-finalization",
    max: 4,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 120_000,
  });
  let activationAttempt:
    | { attempt_id: string; baseline_id: string; expected_baseline_hash: string }
    | undefined;
  try {
    const sqlPool = adaptPgPool(pool);
    const authority = createPostgresCapabilityAuthority(sqlPool);
    const capability = requireValue(
      await authority.resolveForServerContext({
        deployment_id: configuration.deployment_id,
        tenant_id: configuration.workspace_id,
        principal_id: configuration.principal_id,
        access: "WRITE",
      }),
    );
    if (
      capability.scope.app_id !== APP_ID ||
      capability.scope.environment !== configuration.environment
    ) {
      throw new TypeError("FALCON24_E1_FINALIZATION_SCOPE_MISMATCH");
    }
    const epoch = createPostgresFalcon24AuthorityEpoch({
      pool: sqlPool,
      authorizer: authority.authorizer,
    });
    if (requireValue(await epoch.loadCurrent(capability)) !== null) {
      throw new TypeError("FALCON24_E1_ALREADY_ACTIVE");
    }
    const workspace = await prepareWorkspaceAuthority({
      pool,
      sql_pool: sqlPool,
      capability,
      authorizer: authority.authorizer,
      deployment_id: configuration.deployment_id,
      staging_id: configuration.staging_id,
      datasource_id: configuration.datasource_id,
      reader_password: configuration.reader_password,
    });
    const materializationInput = await resolveBuiltinTeamMaterializationInput({
      pool: sqlPool,
      capability,
      deployment_id: configuration.deployment_id,
      context_policy_ref: workspace.context_policy,
      execution_safety_policy_ref: workspace.safety_policy,
    });
    const built = await buildBuiltinTeamMaterialization(materializationInput);
    const expectedProfileBundleHash = await sha256ContentHash({
      profile_revisions: built.profile_revisions.map((profile) => profile.revision_hash),
      skill_revisions: built.skill_revisions.map((skill) => skill.revision_hash),
    });
    const receiptsResult = await pool.query<{ component: string; receipt_document: unknown }>(
      `select component,receipt_document
         from app_data_agent.falcon24_e1_staging_receipts
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
          and staging_id=$4::uuid order by component`,
      [
        capability.scope.app_id,
        capability.scope.tenant_id,
        capability.scope.environment,
        configuration.staging_id,
      ],
    );
    if (receiptsResult.rows.length !== 6) {
      throw new TypeError("FALCON24_E1_STAGING_INCOMPLETE");
    }
    const receiptEntries = await Promise.all(
      receiptsResult.rows.map(
        async ({ component, receipt_document: document }) =>
          [component, await verifyFalcon24E1StagingReceipt(document)] as const,
      ),
    );
    const receipts = new Map(receiptEntries);
    if (receipts.get("AGENT_PROFILES")?.subject_hash !== expectedProfileBundleHash) {
      throw new TypeError("FALCON24_E1_AGENT_PROFILE_RECEIPT_MISMATCH");
    }
    const skills = createPostgresSkillRegistry({ pool: sqlPool, authorizer: authority.authorizer });
    const profiles = createPostgresAgentProfileRegistry({
      pool: sqlPool,
      authorizer: authority.authorizer,
    });
    requireValue(
      await materializeBuiltinTeamProfiles(
        {
          ...materializationInput,
          capability_input: capability,
          actor_principal_id: capability.principal,
          create_operation_id: (material) =>
            stableUuid(`falcon24-e1:team-materialization:${material}`),
          idempotency_prefix: "falcon24-e1:builtin-team:v1",
        },
        { skills, profiles },
      ),
    );
    const [profileItems, skillItems] = await Promise.all([
      profiles.listManagedV2(capability).then(requireValue),
      skills.list(capability, false).then(requireValue),
    ]);
    const team = await verifyCurrentBuiltinTeamAuthority({
      materialization_input: materializationInput,
      profile_items: profileItems,
      skill_items: skillItems,
    });
    const receiptHash = (component: string): string => {
      const receipt = receipts.get(component);
      if (!receipt) throw new TypeError("FALCON24_E1_STAGING_INCOMPLETE");
      return receipt.receipt_hash;
    };
    const acceptanceContracts = await buildFalcon24E1AcceptanceContractHashes({
      repository_root: REPOSITORY_ROOT,
      oracle_contract_hash: retained.analysis_runtime.oracle_contract_hash,
    });
    const baselineId = stableUuid(
      `falcon24-e1:baseline:${sourceCommit}:${buildIdentity.build_id}:${configuration.staging_id}`,
    );
    const baseline = await buildFalcon24AuthorityBaseline({
      schema_version: "falcon24-authority-baseline@1.0.0",
      baseline_id: baselineId,
      authority_epoch: "E1",
      source_commit: sourceCommit,
      retained_assets_hash: retained.manifest_hash,
      web_build_hash: buildIdentity.build_id,
      staging_receipts: {
        dataset: receiptHash("DATASET"),
        semantic_release: receiptHash("SEMANTIC_RELEASE"),
        llm_configuration: receiptHash("LLM_CONFIGURATION"),
        agent_profiles: receiptHash("AGENT_PROFILES"),
        operator_registry: receiptHash("OPERATOR_REGISTRY"),
        sandbox_runtime: receiptHash("SANDBOX_RUNTIME"),
      },
      acceptance_contracts: acceptanceContracts,
      production_isolation_proven: runtimeAttestation.production_isolation_proven,
      production_gate: runtimeAttestation.production_gate,
    });
    requireValue(
      await epoch.stageBaseline(capability, {
        staging_id: configuration.staging_id,
        baseline,
      }),
    );
    activationAttempt = {
      attempt_id: stableUuid(`falcon24-e1:activation:${baseline.baseline_hash}`),
      baseline_id: baseline.baseline_id,
      expected_baseline_hash: baseline.baseline_hash,
    };
    requireValue(await epoch.beginActivationAttempt(capability, activationAttempt));
    const binding = requireValue(await epoch.activate(capability, activationAttempt));
    return Object.freeze({
      schema_version: "falcon24-e1-finalization-result@1.0.0" as const,
      terminal: "ACTIVE" as const,
      authority: binding,
      source_commit: sourceCommit,
      web_build: {
        build_id: buildIdentity.build_id,
        generation_id: buildIdentity.generation_id,
      },
      staging_id: configuration.staging_id,
      schema_snapshot: workspace.snapshot,
      workspace_defaults: {
        defaults_id: workspace.defaults.defaults_id,
        defaults_revision: workspace.defaults.defaults_revision,
        defaults_hash: workspace.defaults.defaults_hash,
      },
      builtin_team: team,
      production_readiness: baseline.production_gate,
    });
  } catch (error) {
    if (activationAttempt) {
      try {
        const sqlPool = adaptPgPool(pool);
        const authority = createPostgresCapabilityAuthority(sqlPool);
        const capability = requireValue(
          await authority.resolveForServerContext({
            deployment_id: configuration.deployment_id,
            tenant_id: configuration.workspace_id,
            principal_id: configuration.principal_id,
            access: "WRITE",
          }),
        );
        await createPostgresFalcon24AuthorityEpoch({
          pool: sqlPool,
          authorizer: authority.authorizer,
        }).holdActivationAttempt(capability, {
          ...activationAttempt,
          failure_code: stableFailureCode(error),
        });
      } catch {
        // The original error is the authoritative failure; a terminal attempt may already be closed.
      }
    }
    throw error;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const environment = loadRuntimeEnvironment({
      cwd: REPOSITORY_ROOT,
      environment: process.env,
    }).environment;
    Object.assign(process.env, environment);
    const result = await runFalcon24E1Finalization(environment);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.terminal === "NOT_RUN") process.exitCode = 2;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "falcon24-e1-finalization-result@1.0.0",
        terminal: "HOLD",
        reason_code: stableFailureCode(error),
        production_readiness: "HOLD",
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1]?.endsWith("finalize-falcon24-e1.ts") ||
  process.argv[1]?.endsWith("finalize-falcon24-e1.js")
) {
  await main();
}
