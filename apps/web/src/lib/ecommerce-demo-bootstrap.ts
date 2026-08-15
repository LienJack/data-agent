import { createHash } from "node:crypto";
import type { ClientBase } from "pg";
import { z } from "zod";

export const ECOMMERCE_DEMO_DATASOURCE_ID = "00000000-0000-4000-8000-00000000ec01";
export const ECOMMERCE_DEMO_SECRET_REF_ID = "00000000-0000-4000-8000-00000000ec02";
export const ECOMMERCE_DEMO_CREDENTIAL_REF_ID = "00000000-0000-4000-8000-00000000ec03";
export const ECOMMERCE_DEMO_BUNDLE_DIGEST =
  "sha256:54632f39e190c872d2b5c176090ebc2d3b77e135b9bb5aecc96d6bf6d0fa4518";
export const ECOMMERCE_DEMO_LOCAL_PASSWORD = "data-agent-ecommerce-demo-change-me";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const SECRET_LOCATOR = "env:DATA_AGENT_ECOMMERCE_READER_PASSWORD";

const scopeSchema = z.strictObject({
  appId: z.literal(APP_ID),
  workspaceId: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  principalId: z.uuid(),
});
const configurationSchema = z.strictObject({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  database: z.string().trim().min(1).max(255),
  password: z.string().min(16).max(1_024),
});

export type EcommerceDemoBootstrapScope = z.infer<typeof scopeSchema>;
export type EcommerceDemoConnectionConfiguration = z.infer<typeof configurationSchema>;

export interface EcommerceDemoBootstrapResult {
  readonly schema_version: "ecommerce-demo-workspace-bootstrap-result@1.0.0";
  readonly terminal: "SUCCEEDED";
  readonly reason_code: "ECOMMERCE_DEMO_ATTACHED" | "ECOMMERCE_DEMO_ALREADY_ATTACHED";
  readonly workspace_id: string;
  readonly datasource_id: string;
  readonly bundle_digest: string;
  readonly credential_rotated: true;
}

export function resolveEcommerceDemoConnectionConfiguration(
  environment: NodeJS.ProcessEnv,
  deploymentEnvironment: string,
): EcommerceDemoConnectionConfiguration {
  const password = environment.DATA_AGENT_ECOMMERCE_READER_PASSWORD?.trim();
  if (deploymentEnvironment !== "local" && (!password || password === ECOMMERCE_DEMO_LOCAL_PASSWORD)) {
    throw new Error("ECOMMERCE_DEMO_PRODUCTION_PASSWORD_REQUIRED");
  }
  return configurationSchema.parse({
    host: environment.DATA_AGENT_ECOMMERCE_HOST?.trim() || "127.0.0.1",
    port: Number(environment.DATA_AGENT_ECOMMERCE_PORT ?? "5432"),
    database: environment.DATA_AGENT_ECOMMERCE_DATABASE?.trim() || "data_agent",
    password: password || ECOMMERCE_DEMO_LOCAL_PASSWORD,
  });
}

function providerLocatorHash(): string {
  return `sha256:${createHash("sha256").update(SECRET_LOCATOR).digest("hex")}`;
}

export async function attachEcommerceDemoToWorkspace(
  client: ClientBase,
  scopeInput: unknown,
  configurationInput: unknown,
): Promise<EcommerceDemoBootstrapResult> {
  const scope = scopeSchema.parse(scopeInput);
  const configuration = configurationSchema.parse(configurationInput);
  const ready = await client.query<{ ready: boolean }>(
    `select exists (
       select 1
       from app_data_agent.demo_dataset_active_versions as active
       join app_data_agent.demo_dataset_versions as version
         on version.dataset_id = active.dataset_id and version.bundle_digest = active.bundle_digest
       where active.dataset_id = 'agenticdatabench-ecommerce'
         and active.bundle_digest = $1::text
         and version.status = 'READY'
         and version.raw_table_count = 12
         and version.mart_table_count = 14
         and version.view_count = 5
     ) as ready`,
    [ECOMMERCE_DEMO_BUNDLE_DIGEST],
  );
  if (ready.rows[0]?.ready !== true) throw new Error("ECOMMERCE_DEMO_DATASET_NOT_READY");

  const authority = await client.query<{ allowed: boolean }>(
    `select exists (
       select 1 from app_data_agent.workspaces as workspace
       join app_data_agent.memberships as membership
         on membership.app_id = workspace.app_id
        and membership.tenant_id = workspace.workspace_id
        and membership.environment = workspace.environment
       where workspace.app_id = $1::uuid and workspace.workspace_id = $2::uuid
         and workspace.environment = $3::text and workspace.lifecycle = 'ACTIVE'
         and membership.principal_id = $4::uuid and membership.revoked_at is null
         and membership.workspace_role = 'WORKSPACE_ADMIN'
     ) as allowed`,
    [scope.appId, scope.workspaceId, scope.environment, scope.principalId],
  );
  if (authority.rows[0]?.allowed !== true) throw new Error("ECOMMERCE_DEMO_WORKSPACE_AUTHORITY_INVALID");

  const existing = await client.query<{ exists: boolean }>(
    `select exists (
       select 1 from app_data_agent.demo_workspace_receipts
       where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
         and dataset_id = 'agenticdatabench-ecommerce' and bundle_digest = $4::text
     ) as exists`,
    [scope.appId, scope.workspaceId, scope.environment, ECOMMERCE_DEMO_BUNDLE_DIGEST],
  );

  await client.query(
    "select pg_catalog.set_config('data_agent.allow_demo_workspace_bootstrap', 'true', true)",
  );
  await client.query("select app_data_agent.configure_ecommerce_demo_reader($1::text)", [
    configuration.password,
  ]);
  await client.query(
    `insert into app_data_agent.secret_refs (
       app_id, tenant_id, environment, secret_ref_id, owner_principal_id,
       secret_name, provider_ref_hash, version, status
     ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid,
       'EcommerceDemoReader', $6::text, 1, 'ACTIVE')
     on conflict (app_id, tenant_id, environment, secret_ref_id) do nothing`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      ECOMMERCE_DEMO_SECRET_REF_ID,
      scope.principalId,
      providerLocatorHash(),
    ],
  );
  const secret = await client.query<{ valid: boolean }>(
    `select exists (
       select 1 from app_data_agent.secret_refs
       where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
         and secret_ref_id = $4::uuid and owner_principal_id = $5::uuid
         and secret_name = 'EcommerceDemoReader' and provider_ref_hash = $6::text
         and version = 1 and status = 'ACTIVE'
     ) as valid`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      ECOMMERCE_DEMO_SECRET_REF_ID,
      scope.principalId,
      providerLocatorHash(),
    ],
  );
  if (secret.rows[0]?.valid !== true) throw new Error("ECOMMERCE_DEMO_SECRET_REF_CONFLICT");
  await client.query(
    `insert into app_data_agent.datasource_connections (
       app_id, tenant_id, environment, datasource_id, name, datasource_type,
       host, port, database_name, username, credential_ref_id, secret_ref_id,
       secret_version, rotation_state, ssl_mode, schema_name, status,
       last_tested_at, created_by_principal_id
     ) values (
       $1::uuid, $2::uuid, $3::text, $4::uuid, 'AgenticDataBench E-commerce Demo',
       'postgresql', $5::text, $6::integer, $7::text, 'data_agent_ecommerce_reader',
       $8::uuid, $9::uuid, 1, 'ACTIVE', 'disable', 'demo_adb_ecommerce_mart',
       'ACTIVE', pg_catalog.clock_timestamp(), $10::uuid
     ) on conflict (app_id, tenant_id, environment, datasource_id) do update set
       name = excluded.name,
       host = excluded.host,
       port = excluded.port,
       database_name = excluded.database_name,
       username = excluded.username,
       credential_ref_id = excluded.credential_ref_id,
       secret_ref_id = excluded.secret_ref_id,
       secret_version = excluded.secret_version,
       rotation_state = excluded.rotation_state,
       ssl_mode = excluded.ssl_mode,
       schema_name = excluded.schema_name,
       status = 'ACTIVE',
       last_tested_at = excluded.last_tested_at,
       updated_at = pg_catalog.clock_timestamp()`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      ECOMMERCE_DEMO_DATASOURCE_ID,
      configuration.host,
      configuration.port,
      configuration.database,
      ECOMMERCE_DEMO_CREDENTIAL_REF_ID,
      ECOMMERCE_DEMO_SECRET_REF_ID,
      scope.principalId,
    ],
  );
  await client.query(
    `insert into app_data_agent.demo_workspace_receipts (
       app_id, tenant_id, environment, dataset_id, bundle_digest, datasource_id,
       secret_ref_id, created_by_principal_id, status
     ) values (
       $1::uuid, $2::uuid, $3::text, 'agenticdatabench-ecommerce', $4::text,
       $5::uuid, $6::uuid, $7::uuid, 'READY'
     ) on conflict (app_id, tenant_id, environment, dataset_id, bundle_digest) do nothing`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      ECOMMERCE_DEMO_BUNDLE_DIGEST,
      ECOMMERCE_DEMO_DATASOURCE_ID,
      ECOMMERCE_DEMO_SECRET_REF_ID,
      scope.principalId,
    ],
  );

  return {
    schema_version: "ecommerce-demo-workspace-bootstrap-result@1.0.0",
    terminal: "SUCCEEDED",
    reason_code: existing.rows[0]?.exists ? "ECOMMERCE_DEMO_ALREADY_ATTACHED" : "ECOMMERCE_DEMO_ATTACHED",
    workspace_id: scope.workspaceId,
    datasource_id: ECOMMERCE_DEMO_DATASOURCE_ID,
    bundle_digest: ECOMMERCE_DEMO_BUNDLE_DIGEST,
    credential_rotated: true,
  };
}
