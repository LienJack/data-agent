import { createHash } from "node:crypto";
import {
  FALCON_DATABASE_COUNT,
  FALCON_DATASET_VERSION,
  FALCON_SOURCE_COMMIT,
  type FalconSourceManifest,
  sha256ContentHash,
} from "@data-agent/contracts";
import { loadFalconPreview } from "@data-agent/evals";
import type { ClientBase } from "pg";
import { z } from "zod";

export const FALCON_DATASOURCE_ID = "00000000-0000-4000-8000-00000000fa01";
export const FALCON_SECRET_REF_ID = "00000000-0000-4000-8000-00000000fa02";
export const FALCON_CREDENTIAL_REF_ID = "00000000-0000-4000-8000-00000000fa03";
export const FALCON_LOCAL_PASSWORD = "data-agent-falcon-demo-change-me";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const SECRET_LOCATOR = "env:FALCON_READER_PASSWORD";

const scopeSchema = z.strictObject({
  appId: z.literal(APP_ID),
  workspaceId: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  principalId: z.uuid(),
});
const configurationSchema = z.strictObject({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  database: z.literal("data_agent"),
  password: z.string().min(16).max(1_024),
});

export type FalconWorkspaceScope = z.infer<typeof scopeSchema>;
export type FalconConnectionConfiguration = z.infer<typeof configurationSchema>;

function providerLocatorHash(): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(SECRET_LOCATOR).digest("hex")}`;
}

export function resolveFalconConnectionConfiguration(
  environment: NodeJS.ProcessEnv,
  deploymentEnvironment: string,
): FalconConnectionConfiguration {
  const password = environment.FALCON_READER_PASSWORD?.trim();
  if (deploymentEnvironment !== "local" && (!password || password === FALCON_LOCAL_PASSWORD)) {
    throw new Error("FALCON_PRODUCTION_PASSWORD_REQUIRED");
  }
  return configurationSchema.parse({
    host: environment.FALCON_HOST?.trim() || "127.0.0.1",
    port: Number(environment.FALCON_PORT ?? "5432"),
    database: environment.FALCON_DATABASE?.trim() || "data_agent",
    password: password || FALCON_LOCAL_PASSWORD,
  });
}

async function assertWorkspaceAuthority(
  client: ClientBase,
  scope: FalconWorkspaceScope,
): Promise<void> {
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
  if (authority.rows[0]?.allowed !== true) throw new Error("FALCON_WORKSPACE_AUTHORITY_INVALID");
}

async function assertImportReady(
  client: ClientBase,
  manifest: FalconSourceManifest,
): Promise<void> {
  const result = await client.query<{ ready: boolean }>(
    `select exists (
       select 1 from app_data_agent.falcon_import_receipts
       where source_digest = $1::text and source_commit = $2::text
         and dataset_version = $3::text and database_count = $4::integer
         and status = 'READY'
     ) as ready`,
    [manifest.source_digest, FALCON_SOURCE_COMMIT, FALCON_DATASET_VERSION, FALCON_DATABASE_COUNT],
  );
  if (result.rows[0]?.ready !== true) throw new Error("FALCON_IMPORT_NOT_READY");
}

export async function attachFalconToWorkspace(
  client: ClientBase,
  scopeInput: unknown,
  configurationInput: unknown,
) {
  const scope = scopeSchema.parse(scopeInput);
  const configuration = configurationSchema.parse(configurationInput);
  const dataset = await loadFalconPreview();
  await assertImportReady(client, dataset.manifest);
  await assertWorkspaceAuthority(client, scope);
  await client.query(
    "select pg_catalog.set_config('data_agent.allow_falcon_bootstrap', 'true', true)",
  );
  await client.query("select app_data_agent.configure_falcon_demo_reader($1::text)", [
    configuration.password,
  ]);
  await client.query(
    `insert into app_data_agent.secret_refs (
       app_id, tenant_id, environment, secret_ref_id, owner_principal_id,
       secret_name, provider_ref_hash, version, status
     ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid,
       'FalconDemoReader', $6::text, 1, 'ACTIVE')
     on conflict (app_id, tenant_id, environment, secret_ref_id) do nothing`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      FALCON_SECRET_REF_ID,
      scope.principalId,
      providerLocatorHash(),
    ],
  );
  const secret = await client.query<{ valid: boolean }>(
    `select exists (
       select 1 from app_data_agent.secret_refs
       where app_id = $1::uuid and tenant_id = $2::uuid and environment = $3::text
         and secret_ref_id = $4::uuid and owner_principal_id = $5::uuid
         and secret_name = 'FalconDemoReader' and provider_ref_hash = $6::text
         and version = 1 and status = 'ACTIVE'
     ) as valid`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      FALCON_SECRET_REF_ID,
      scope.principalId,
      providerLocatorHash(),
    ],
  );
  if (secret.rows[0]?.valid !== true) throw new Error("FALCON_SECRET_REF_CONFLICT");
  await client.query(
    `insert into app_data_agent.datasource_connections (
       app_id, tenant_id, environment, datasource_id, name, datasource_type,
       host, port, database_name, username, credential_ref_id, secret_ref_id,
       secret_version, rotation_state, ssl_mode, schema_name, status,
       last_tested_at, created_by_principal_id
     ) values (
       $1::uuid, $2::uuid, $3::text, $4::uuid, 'Falcon 28 库固定快照',
       'postgresql', $5::text, $6::integer, $7::text, 'falcon_demo_reader',
       $8::uuid, $9::uuid, 1, 'ACTIVE', 'disable', 'falcon_db_24',
       'ACTIVE', pg_catalog.clock_timestamp(), $10::uuid
     ) on conflict (app_id, tenant_id, environment, datasource_id) do update set
       name = excluded.name, host = excluded.host, port = excluded.port,
       database_name = excluded.database_name, username = excluded.username,
       credential_ref_id = excluded.credential_ref_id, secret_ref_id = excluded.secret_ref_id,
       secret_version = excluded.secret_version, rotation_state = excluded.rotation_state,
       ssl_mode = excluded.ssl_mode, schema_name = excluded.schema_name, status = 'ACTIVE',
       last_tested_at = excluded.last_tested_at, updated_at = pg_catalog.clock_timestamp()`,
    [
      scope.appId,
      scope.workspaceId,
      scope.environment,
      FALCON_DATASOURCE_ID,
      configuration.host,
      configuration.port,
      configuration.database,
      FALCON_CREDENTIAL_REF_ID,
      FALCON_SECRET_REF_ID,
      scope.principalId,
    ],
  );
  const datasourceFingerprint = await sha256ContentHash({
    datasource_id: FALCON_DATASOURCE_ID,
    source_digest: dataset.manifest.source_digest,
    database: configuration.database,
    schemas: dataset.manifest.files.map((file) => file.schema_name),
  });
  return Object.freeze({
    schema_version: "falcon-workspace-bootstrap-result@1.0.0" as const,
    terminal: "SUCCEEDED" as const,
    workspace_id: scope.workspaceId,
    datasource_id: FALCON_DATASOURCE_ID,
    secret_ref: {
      secret_ref_id: FALCON_SECRET_REF_ID,
      provider: "env",
      locator: "FALCON_READER_PASSWORD",
      version: 1,
      status: "ACTIVE",
    },
    source_digest: dataset.manifest.source_digest,
    datasource_fingerprint: datasourceFingerprint,
    logical_database_count: FALCON_DATABASE_COUNT,
    default_schema: "falcon_db_24" as const,
    credential_rotated: true as const,
  });
}

export async function verifyFalconWorkspace(client: ClientBase, scopeInput: unknown) {
  const scope = scopeSchema.parse(scopeInput);
  const dataset = await loadFalconPreview();
  await assertImportReady(client, dataset.manifest);
  await assertWorkspaceAuthority(client, scope);
  const binding = await client.query<{
    datasource_id: string;
    username: string;
    schema_name: string;
    status: string;
    secret_ref_id: string;
    secret_status: string;
  }>(
    `select datasource.datasource_id::text, datasource.username, datasource.schema_name,
            datasource.status, datasource.secret_ref_id::text, secret.status as secret_status
       from app_data_agent.datasource_connections as datasource
       join app_data_agent.secret_refs as secret
         on secret.app_id = datasource.app_id and secret.tenant_id = datasource.tenant_id
        and secret.environment = datasource.environment
        and secret.secret_ref_id = datasource.secret_ref_id
      where datasource.app_id = $1::uuid and datasource.tenant_id = $2::uuid
        and datasource.environment = $3::text and datasource.datasource_id = $4::uuid`,
    [scope.appId, scope.workspaceId, scope.environment, FALCON_DATASOURCE_ID],
  );
  const row = binding.rows[0];
  if (
    row?.username !== "falcon_demo_reader" ||
    row.status !== "ACTIVE" ||
    row.secret_status !== "ACTIVE"
  ) {
    throw new Error("FALCON_WORKSPACE_BINDING_NOT_READY");
  }
  return Object.freeze({
    schema_version: "falcon-workspace-verification@1.0.0" as const,
    terminal: "READY" as const,
    workspace_id: scope.workspaceId,
    datasource_id: row.datasource_id,
    username: row.username,
    masked_secret_ref: `${row.secret_ref_id.slice(0, 8)}…`,
    default_schema: row.schema_name,
    logical_databases: dataset.manifest.files.map((file) => ({
      db_id: file.db_id,
      schema_name: file.schema_name,
      table_count: file.table_count,
      column_count: file.column_count,
      row_count: file.row_count,
      status: "READY" as const,
    })),
    source_digest: dataset.manifest.source_digest,
  });
}
