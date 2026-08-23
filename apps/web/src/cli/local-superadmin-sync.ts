import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { Client } from "pg";
import { z } from "zod";

const configurationSchema = z.strictObject({
  databaseUrl: z.string().min(1),
  deploymentId: z.uuid(),
  email: z.email().transform((value) => value.toLowerCase()),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_.]+$/),
  displayName: z.string().trim().min(1).max(128),
  password: z.string().min(1),
  workspaceSlug: z
    .string()
    .trim()
    .min(2)
    .max(63)
    .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/),
  workspaceName: z.string().trim().min(1).max(128),
});

export type SafeSyncResult = Readonly<{
  schema_version: "local-superadmin-sync-result@1.0.0";
  terminal: "SUCCEEDED" | "SKIPPED" | "HOLD";
  reason_code: string;
  action?: "CREATED" | "UPDATED" | "UNCHANGED";
  email?: string;
  username?: string;
  principal_id?: string;
  workspace_id?: string;
}>;

interface SuperadminRow {
  readonly principal_id: string;
  readonly auth_user_id: string;
  readonly app_username: string | null;
  readonly auth_username: string | null;
  readonly email: string;
  readonly auth_email: string;
  readonly password_hash: string | null;
  readonly workspace_id: string | null;
}

function hold(reasonCode: string): SafeSyncResult {
  return {
    schema_version: "local-superadmin-sync-result@1.0.0",
    terminal: "HOLD",
    reason_code: reasonCode,
  };
}

async function createFirstSuperadmin(
  client: Client,
  configuration: z.infer<typeof configurationSchema>,
): Promise<SafeSyncResult> {
  const authUserId = randomUUID();
  const principalId = randomUUID();
  const operationId = randomUUID();
  const proposedWorkspaceId = randomUUID();
  const passwordHash = await hashPassword(configuration.password);
  await client.query("begin");
  try {
    await client.query("set local lock_timeout = '2000ms'");
    await client.query("set local idle_in_transaction_session_timeout = '30000ms'");
    await client.query(
      `insert into data_agent_auth."user" (
         "id","name","email","emailVerified","username","displayUsername",
         "role","banned","createdAt","updatedAt"
       ) values ($1::uuid,$2::text,$3::text,true,$4::text,$4::text,'admin',false,
         pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp())`,
      [authUserId, configuration.displayName, configuration.email, configuration.username],
    );
    await client.query(
      `insert into data_agent_auth."account" (
         "id","accountId","providerId","userId","password","createdAt","updatedAt"
       ) values ($1::uuid,$2::text,'credential',$2::uuid,$3::text,
         pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp())`,
      [randomUUID(), authUserId, passwordHash],
    );
    const deployment = await client.query<{ app_id: string; environment: string }>(
      `select app_id,environment from platform.deployment_mappings
       where deployment_id=$1::uuid and is_active and revoked_at is null and environment='local'`,
      [configuration.deploymentId],
    );
    const scope = deployment.rows[0];
    if (deployment.rowCount !== 1 || !scope) throw new Error("DEPLOYMENT_INVALID");
    const workspace = await client.query<{ workspace_id: string }>(
      `select workspace_id from app_data_agent.workspaces
       where app_id=$1::uuid and environment=$2::text and slug=$3::text and lifecycle='ACTIVE'`,
      [scope.app_id, scope.environment, configuration.workspaceSlug],
    );
    let workspaceId = workspace.rows[0]?.workspace_id;
    if (!workspaceId) {
      workspaceId = proposedWorkspaceId;
      await client.query(
        `insert into app_data_agent.workspaces (
           app_id,workspace_id,environment,slug,display_name
         ) values ($1::uuid,$2::uuid,$3::text,$4::text,$5::text)`,
        [
          scope.app_id,
          workspaceId,
          scope.environment,
          configuration.workspaceSlug,
          configuration.workspaceName,
        ],
      );
    }
    await client.query(
      "select pg_catalog.set_config('data_agent.allow_superadmin_bootstrap','true',true)",
    );
    await client.query(
      `select app_data_agent.bootstrap_super_admin(
         $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::text
       )`,
      [
        configuration.deploymentId,
        authUserId,
        principalId,
        configuration.email,
        configuration.displayName,
        operationId,
        `local-superadmin-create-${authUserId}`,
      ],
    );
    await client.query("commit");
    return {
      schema_version: "local-superadmin-sync-result@1.0.0",
      terminal: "SUCCEEDED",
      reason_code: "DEV_SUPERADMIN_SYNC_CREATED",
      action: "CREATED",
      email: configuration.email,
      username: configuration.username,
      principal_id: principalId,
      workspace_id: workspaceId,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function synchronizeExisting(
  client: Client,
  configuration: z.infer<typeof configurationSchema>,
  target: SuperadminRow,
): Promise<SafeSyncResult> {
  if (!target.workspace_id) return hold("DEV_SUPERADMIN_SYNC_WORKSPACE_INVALID");
  const passwordMatches =
    target.password_hash !== null &&
    (await verifyPassword({ hash: target.password_hash, password: configuration.password }));
  if (
    target.app_username === configuration.username &&
    target.auth_username === configuration.username &&
    target.email === configuration.email &&
    target.auth_email === configuration.email &&
    passwordMatches
  ) {
    return {
      schema_version: "local-superadmin-sync-result@1.0.0",
      terminal: "SUCCEEDED",
      reason_code: "DEV_SUPERADMIN_SYNC_UNCHANGED",
      action: "UNCHANGED",
      email: configuration.email,
      username: configuration.username,
      principal_id: target.principal_id,
      workspace_id: target.workspace_id,
    };
  }
  const passwordHash = await hashPassword(configuration.password);
  await client.query("begin");
  try {
    await client.query(
      "select pg_catalog.set_config('data_agent.allow_local_superadmin_sync','true',true)",
    );
    const result = await client.query<{
      result: { principal_id: string; workspace_id: string };
    }>(
      `select app_data_agent.sync_local_super_admin_credentials(
         $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::uuid,$7::text
       ) as result`,
      [
        configuration.deploymentId,
        configuration.email,
        configuration.username,
        passwordHash,
        configuration.workspaceSlug,
        randomUUID(),
        `local-superadmin-sync-${randomUUID()}`,
      ],
    );
    await client.query("commit");
    const synced = result.rows[0]?.result;
    if (!synced) throw new Error("SYNC_RESULT_MISSING");
    return {
      schema_version: "local-superadmin-sync-result@1.0.0",
      terminal: "SUCCEEDED",
      reason_code: "DEV_SUPERADMIN_SYNC_UPDATED",
      action: "UPDATED",
      email: configuration.email,
      username: configuration.username,
      principal_id: synced.principal_id,
      workspace_id: synced.workspace_id,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

export async function runLocalSuperadminSync(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<SafeSyncResult> {
  if (environment.DATA_AGENT_LOCAL_SUPERADMIN_SYNC?.trim() !== "YES") {
    return {
      schema_version: "local-superadmin-sync-result@1.0.0",
      terminal: "SKIPPED",
      reason_code: "DEV_SUPERADMIN_SYNC_DISABLED",
    };
  }
  if (environment.NODE_ENV === "production")
    return hold("DEV_SUPERADMIN_SYNC_PRODUCTION_FORBIDDEN");
  const configuration = configurationSchema.safeParse({
    databaseUrl: environment.AUTH_DATABASE_URL ?? environment.DATABASE_URL,
    deploymentId: environment.WORKSPACE_DEPLOYMENT_ID ?? environment.SEMANTIC_DEPLOYMENT_ID,
    email: environment.DATA_AGENT_BOOTSTRAP_EMAIL,
    username: environment.DATA_AGENT_BOOTSTRAP_USERNAME,
    displayName: environment.DATA_AGENT_BOOTSTRAP_NAME,
    password: environment.DATA_AGENT_BOOTSTRAP_PASSWORD,
    workspaceSlug: environment.DATA_AGENT_BOOTSTRAP_WORKSPACE_SLUG ?? "main-workspace",
    workspaceName: environment.DATA_AGENT_BOOTSTRAP_WORKSPACE_NAME ?? "Main Workspace",
  });
  if (!configuration.success) return hold("DEV_SUPERADMIN_SYNC_CONFIGURATION_INVALID");
  const client = new Client({
    connectionString: configuration.data.databaseUrl,
    application_name: "data-agent-local-superadmin-sync",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });
  try {
    await client.connect();
    const executor = await client.query<{ session_user: string; current_user: string }>(
      "select session_user,current_user",
    );
    if (
      executor.rows[0]?.session_user !== "postgres" ||
      executor.rows[0]?.current_user !== "postgres"
    ) {
      return hold("DEV_SUPERADMIN_SYNC_EXECUTOR_UNSAFE");
    }
    const targets = await client.query<SuperadminRow>(
      `select app_user.principal_id,app_user.auth_user_id,
         app_user.username as app_username,auth_user."username" as auth_username,
         app_user.email,auth_user."email" as auth_email,
         account."password" as password_hash,workspace.workspace_id
       from app_data_agent.app_users as app_user
       join platform.deployment_mappings as deployment
         on deployment.app_id=app_user.app_id and deployment.environment=app_user.environment
        and deployment.deployment_id=$1::uuid and deployment.is_active and deployment.revoked_at is null
       join data_agent_auth."user" as auth_user on auth_user."id"=app_user.auth_user_id
       left join data_agent_auth."account" as account
         on account."userId"=auth_user."id" and account."providerId"='credential'
       left join app_data_agent.workspaces as workspace
         on workspace.app_id=app_user.app_id and workspace.environment=app_user.environment
        and workspace.slug=$2::text and workspace.lifecycle='ACTIVE'
       where app_user.system_role='SUPER_ADMIN' and app_user.status='ACTIVE'`,
      [configuration.data.deploymentId, configuration.data.workspaceSlug],
    );
    if (targets.rowCount === 0) return await createFirstSuperadmin(client, configuration.data);
    if (targets.rowCount !== 1 || !targets.rows[0]) return hold("DEV_SUPERADMIN_SYNC_AMBIGUOUS");
    return await synchronizeExisting(client, configuration.data, targets.rows[0]);
  } catch {
    return hold("DEV_SUPERADMIN_SYNC_FAILED");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  loadRuntimeEnvironment();
  const result = await runLocalSuperadminSync(process.env);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.terminal === "HOLD") process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
