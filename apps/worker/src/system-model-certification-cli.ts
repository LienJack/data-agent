import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import {
  createModelProviderBindings,
  createModelProviderExecutionBinding,
  getModelProviderBinding,
  SYSTEM_MODEL_DEPLOYMENT_OVERRIDES,
} from "@data-agent/agent-runtime";
import {
  type AppCapability,
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresRunEventStore,
  createPostgresRunQueue,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import nextEnvironment from "@next/env";
import { Pool } from "pg";
import { z } from "zod";
import { runCredentialedProviderCertification } from "./credentialed-provider-certification.js";
import { createPostgresModelCertificationReceiptStore } from "./postgres-model-certification-receipt-store.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000002";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000003";
const CONFIRMATION_VARIABLE = "DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_CONFIRM";

const configurationSchema = z.strictObject({
  databaseUrl: z.string().min(1),
  tenantId: z.uuid(),
  principalId: z.uuid(),
  certificationRunId: z.uuid(),
  certificationWorkerFence: z.coerce.number().int().nonnegative().safe(),
});

function repositoryRoot(): string {
  const cwd = resolve(process.cwd());
  return basename(cwd) === "worker" && basename(resolve(cwd, "..")) === "apps"
    ? resolve(cwd, "../..")
    : cwd;
}

function loadRootEnvironment(): void {
  nextEnvironment.loadEnvConfig(repositoryRoot(), true);
  process.env.DEEPSEEK_API_KEY ||= process.env.DeepSeekAPIKey?.trim();
  process.env.MOONSHOT_API_KEY ||= process.env.KimiAPIKey?.trim();
}

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function deploymentHash(deploymentId: string): string {
  return `sha256:${createHash("sha256").update(`local-system-model:${deploymentId}`).digest("hex")}`;
}

async function resolveLocalDeployment(adminPool: Pool): Promise<string> {
  const existing = await adminPool.query<{ deployment_id: string }>(
    `select deployment_id
       from platform.deployment_mappings
      where app_id = $1::uuid and environment = 'local' and is_active
      order by created_at
      limit 1`,
    [APP_ID],
  );
  if (existing.rows[0]) return existing.rows[0].deployment_id;

  const deploymentId = randomUUID();
  await adminPool.query(
    `insert into platform.deployment_mappings (
       deployment_id, app_id, environment, deployment_key_hash
     ) values ($1::uuid, $2::uuid, 'local', $3::text)`,
    [deploymentId, APP_ID, deploymentHash(deploymentId)],
  );
  return deploymentId;
}

interface ExecutionCatalogRow {
  readonly provider: "deepseek" | "kimi";
  readonly model_profile_id: string;
  readonly config_version: string | number;
  readonly model_id: string;
  readonly resource_hash: string;
  readonly deployment_hash: string;
}

async function loadSystemExecutionBindings(adminPool: Pool, deploymentId: string) {
  const baseBindings = createModelProviderBindings(SYSTEM_MODEL_DEPLOYMENT_OVERRIDES);
  const rows = await adminPool.query<ExecutionCatalogRow>(
    `select catalog.provider,
            catalog.model_profile_id,
            catalog.config_version,
            catalog.model_id,
            platform.canonical_sha256(revision.snapshot) as resource_hash,
            app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
              'deployment_id',deployment.deployment_id,
              'app_id',deployment.app_id,
              'environment',deployment.environment,
              'deployment_key_hash',deployment.deployment_key_hash
            )) as deployment_hash
       from app_data_agent.model_catalog_entries catalog
       join app_data_agent.model_config_versions revision
         on revision.app_id=catalog.app_id
        and revision.environment=catalog.environment
        and revision.model_profile_id=catalog.model_profile_id
        and revision.config_version=catalog.config_version
       join platform.deployment_mappings deployment
         on deployment.deployment_id=$1::uuid
        and deployment.app_id=catalog.app_id
        and deployment.environment=catalog.environment
      where catalog.is_system_default
        and catalog.provider in ('deepseek','kimi')
        and catalog.status in ('ACTIVE','UNBILLABLE')
      order by catalog.provider`,
    [deploymentId],
  );
  return rows.rows.map((row) => {
    const template = getModelProviderBinding(row.provider, baseBindings);
    const configVersion = Number(row.config_version);
    return createModelProviderExecutionBinding({
      template: { ...template, profile_id: row.model_profile_id },
      model_config_version: configVersion,
      model_id: row.model_id,
      model_resource_hash: row.resource_hash,
      execution_profile_hash: row.resource_hash,
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      connection: {
        kind: "SYSTEM_DEPLOYMENT",
        deployment_id: deploymentId,
        deployment_revision: 1,
        deployment_hash: row.deployment_hash,
      },
      operational_constraints: template.operational_constraints,
    });
  });
}

async function activateCertificationRun(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
  readonly expected_run_id: string;
}) {
  const queue = createPostgresRunQueue(input.pool, input.authorizer, input.capability, {
    lease_duration_ms: 900_000,
  });
  const leased = await queue.lease({
    scope: input.capability.scope,
    worker_id: "system-model-certifier",
  });
  if (!leased.ok) throw new Error(leased.error.code);
  if (!leased.value || leased.value.run_id !== input.expected_run_id) {
    throw new Error("MODEL_CERTIFICATION_RUN_NOT_LEASED");
  }
  const store = createPostgresRunEventStore(input.pool, input.authorizer, input.capability);
  const projected = await store.readProjection({
    scope: input.capability.scope,
    run_id: leased.value.run_id,
  });
  if (!projected.ok || !projected.value) {
    throw new Error(projected.ok ? "MODEL_CERTIFICATION_PROJECTION_MISSING" : projected.error.code);
  }
  const appended = await store.append({
    lease: leased.value,
    expected_projection: projected.value,
    event: {
      schema_version: "1.0.0",
      event_id: randomUUID(),
      event_type: "run.leased",
      scope: leased.value.scope,
      run_id: leased.value.run_id,
      sequence: projected.value.projection.version + 1,
      worker_fence: leased.value.worker_fence,
      idempotency_key: `model-certification:${leased.value.attempt_id}:${leased.value.worker_fence}`,
      occurred_at: new Date().toISOString(),
      payload: {
        command_id: leased.value.command_id,
        lease_id: leased.value.attempt_id,
        worker_id: leased.value.worker_id,
        attempt: leased.value.attempt_no,
      },
    },
  });
  if (!appended.ok) throw new Error(appended.error.code);
  return leased.value;
}

async function main(): Promise<void> {
  if (process.env[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
    report({
      schema_version: "1.0.0",
      terminal: "NOT_RUN",
      reason_code: "EXPLICIT_CONFIRMATION_REQUIRED",
      confirmation_variable: CONFIRMATION_VARIABLE,
    });
    process.exitCode = 2;
    return;
  }
  if (process.env.NODE_ENV === "production") {
    report({ schema_version: "1.0.0", terminal: "HOLD", reason_code: "LOCAL_ONLY_COMMAND" });
    process.exitCode = 2;
    return;
  }

  loadRootEnvironment();
  const configuration = configurationSchema.safeParse({
    databaseUrl: process.env.DATA_AGENT_DATABASE_URL ?? process.env.DATABASE_URL,
    tenantId: process.env.TEST_CENTER_TENANT_ID ?? DEFAULT_TENANT_ID,
    principalId: process.env.TEST_CENTER_PRINCIPAL_ID ?? DEFAULT_PRINCIPAL_ID,
    certificationRunId: process.env.DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_RUN_ID,
    certificationWorkerFence: process.env.DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_WORKER_FENCE,
  });
  if (
    !configuration.success ||
    !process.env.DEEPSEEK_API_KEY?.trim() ||
    !process.env.MOONSHOT_API_KEY?.trim()
  ) {
    report({
      schema_version: "1.0.0",
      terminal: "HOLD",
      reason_code: "SYSTEM_MODEL_CERTIFICATION_CONFIGURATION_INVALID",
      required_authority_variables: [
        "DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_RUN_ID",
        "DATA_AGENT_SYSTEM_MODEL_CERTIFICATION_WORKER_FENCE",
      ],
    });
    process.exitCode = 64;
    return;
  }

  const adminPool = new Pool({
    connectionString: configuration.data.databaseUrl,
    max: 2,
    application_name: "data-agent-local-system-model-certification",
  });
  try {
    const deploymentId = await resolveLocalDeployment(adminPool);
    const existingMembership = await adminPool.query<{ exists: boolean }>(
      `select exists (
         select 1
           from app_data_agent.memberships
          where app_id = $1::uuid
            and tenant_id = $2::uuid
            and environment = 'local'
            and principal_id = $3::uuid
            and revoked_at is null
       ) as exists`,
      [APP_ID, configuration.data.tenantId, configuration.data.principalId],
    );
    if (!existingMembership.rows[0]?.exists) {
      await adminPool.query(
        "select platform.provision_membership($1::uuid, $2::uuid, $3::uuid, 'owner')",
        [deploymentId, configuration.data.tenantId, configuration.data.principalId],
      );
    }

    const sqlPool = adaptPgPool(adminPool);
    const authority = createPostgresCapabilityAuthority(sqlPool);
    const capabilityResult = await authority.resolveForServerContext({
      deployment_id: deploymentId,
      tenant_id: configuration.data.tenantId,
      principal_id: configuration.data.principalId,
      access: "WRITE",
    });
    if (!capabilityResult.ok) throw new Error(capabilityResult.error.code);
    const capability = capabilityResult.value;
    const certificationLease = await activateCertificationRun({
      pool: sqlPool,
      authorizer: authority.authorizer,
      capability,
      expected_run_id: configuration.data.certificationRunId,
    });
    const receiptStore = createPostgresModelCertificationReceiptStore({
      pool: sqlPool,
      authorizer: authority.authorizer,
      capability,
    });
    const bindings = await loadSystemExecutionBindings(adminPool, deploymentId);
    const certificationReport = await runCredentialedProviderCertification({
      scope: capability.scope,
      run_id: configuration.data.certificationRunId,
      worker_fence: certificationLease.worker_fence,
      bindings,
      resolve_credential: async (credentialEnvironment) =>
        process.env[credentialEnvironment]?.trim() ?? null,
      receipt_store: receiptStore,
    });
    report({
      schema_version: "1.0.0",
      terminal: certificationReport.terminal,
      deployment_id: deploymentId,
      run_id: configuration.data.certificationRunId,
      certification: certificationReport,
    });
    process.exitCode = certificationReport.terminal === "PASS" ? 0 : 2;
  } catch {
    report({
      schema_version: "1.0.0",
      terminal: "HOLD",
      reason_code: "SYSTEM_MODEL_CERTIFICATION_EXECUTION_FAILED",
    });
    process.exitCode = 2;
  } finally {
    await adminPool.end().catch(() => undefined);
  }
}

await main();
