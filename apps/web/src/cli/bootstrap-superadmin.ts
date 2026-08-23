import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import nextEnvironment from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { Client } from "pg";
import { z } from "zod";
import {
  attachEcommerceDemoToWorkspace,
  resolveEcommerceDemoConnectionConfiguration,
} from "../lib/ecommerce-demo-bootstrap";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_SUPERADMIN_BOOTSTRAP";

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
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  workspaceName: z.string().trim().min(1).max(128),
});

function repositoryRoot(): string {
  const cwd = resolve(process.cwd());
  return basename(cwd) === "web" && basename(resolve(cwd, "..")) === "apps"
    ? resolve(cwd, "../..")
    : cwd;
}

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  nextEnvironment.loadEnvConfig(repositoryRoot(), process.env.NODE_ENV !== "production");

  if (process.env[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
    report({
      schema_version: "superadmin-bootstrap-result@1.0.0",
      terminal: "NOT_RUN",
      reason_code: "EXPLICIT_CONFIRMATION_REQUIRED",
      confirmation_variable: CONFIRMATION_VARIABLE,
    });
    process.exitCode = 2;
    return;
  }

  const configuration = configurationSchema.safeParse({
    databaseUrl: process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_URL,
    deploymentId: process.env.WORKSPACE_DEPLOYMENT_ID ?? process.env.SEMANTIC_DEPLOYMENT_ID,
    email: process.env.DATA_AGENT_BOOTSTRAP_EMAIL,
    username: process.env.DATA_AGENT_BOOTSTRAP_USERNAME,
    displayName: process.env.DATA_AGENT_BOOTSTRAP_NAME,
    password: process.env.DATA_AGENT_BOOTSTRAP_PASSWORD,
    workspaceSlug: process.env.DATA_AGENT_BOOTSTRAP_WORKSPACE_SLUG ?? "main-workspace",
    workspaceName: process.env.DATA_AGENT_BOOTSTRAP_WORKSPACE_NAME ?? "Main workspace",
  });
  if (!configuration.success) {
    report({
      schema_version: "superadmin-bootstrap-result@1.0.0",
      terminal: "HOLD",
      reason_code: "SUPER_ADMIN_BOOTSTRAP_CONFIGURATION_INVALID",
      required_variables: [
        "DATABASE_URL or AUTH_DATABASE_URL",
        "WORKSPACE_DEPLOYMENT_ID or SEMANTIC_DEPLOYMENT_ID",
        "DATA_AGENT_BOOTSTRAP_EMAIL",
        "DATA_AGENT_BOOTSTRAP_USERNAME (3-30 letters, numbers, _ or .)",
        "DATA_AGENT_BOOTSTRAP_NAME",
        "DATA_AGENT_BOOTSTRAP_PASSWORD (no character-count limit)",
      ],
    });
    process.exitCode = 64;
    return;
  }

  const authUserId = randomUUID();
  const principalId = randomUUID();
  const operationId = randomUUID();
  const workspaceId = randomUUID();
  const idempotencyKey = `superadmin-bootstrap-${authUserId}`;
  const client = new Client({
    connectionString: configuration.data.databaseUrl,
    application_name: "data-agent-superadmin-bootstrap",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });

  try {
    await client.connect();
    const executor = await client.query<{ session_user: string; current_user: string }>(
      "select session_user, current_user",
    );
    if (
      executor.rows[0]?.session_user !== "postgres" ||
      executor.rows[0]?.current_user !== "postgres"
    ) {
      throw new Error("SUPER_ADMIN_BOOTSTRAP_EXECUTOR_UNSAFE");
    }

    const passwordHash = await hashPassword(configuration.data.password);
    await client.query("begin");
    await client.query("set local lock_timeout = '2000ms'");
    await client.query("set local idle_in_transaction_session_timeout = '30000ms'");
    await client.query(
      `insert into data_agent_auth."user" (
         "id", "name", "email", "emailVerified", "username", "displayUsername",
         "role", "banned", "createdAt", "updatedAt"
       ) values ($1::uuid, $2::text, $3::text, true, $4::text, $4::text, 'admin', false,
         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())`,
      [
        authUserId,
        configuration.data.displayName,
        configuration.data.email,
        configuration.data.username,
      ],
    );
    await client.query(
      `insert into data_agent_auth."account" (
         "id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt"
       ) values ($1::uuid, $2::text, 'credential', $2::uuid, $3::text,
         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())`,
      [randomUUID(), authUserId, passwordHash],
    );
    await client.query(
      "select pg_catalog.set_config('data_agent.allow_superadmin_bootstrap', 'true', true)",
    );
    const deployment = await client.query<{ app_id: string; environment: string }>(
      `select app_id, environment from platform.deployment_mappings
       where deployment_id = $1::uuid and is_active and revoked_at is null`,
      [configuration.data.deploymentId],
    );
    if (deployment.rowCount !== 1 || !deployment.rows[0]) {
      throw new Error("SUPER_ADMIN_BOOTSTRAP_DEPLOYMENT_INVALID");
    }
    await client.query(
      `insert into app_data_agent.workspaces (
         app_id, workspace_id, environment, slug, display_name
       ) values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text)`,
      [
        deployment.rows[0].app_id,
        workspaceId,
        deployment.rows[0].environment,
        configuration.data.workspaceSlug,
        configuration.data.workspaceName,
      ],
    );
    const bootstrapped = await client.query<{ result: unknown }>(
      `select app_data_agent.bootstrap_super_admin(
         $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::uuid, $7::text
       ) as result`,
      [
        configuration.data.deploymentId,
        authUserId,
        principalId,
        configuration.data.email,
        configuration.data.displayName,
        operationId,
        idempotencyKey,
      ],
    );
    const ecommerceDemo = await attachEcommerceDemoToWorkspace(
      client,
      {
        appId: deployment.rows[0].app_id,
        workspaceId,
        environment: deployment.rows[0].environment,
        principalId,
      },
      resolveEcommerceDemoConnectionConfiguration(process.env, deployment.rows[0].environment),
    );
    await client.query("commit");
    report({
      schema_version: "superadmin-bootstrap-result@1.0.0",
      terminal: "SUCCEEDED",
      reason_code: "SUPER_ADMIN_BOOTSTRAPPED",
      auth_user_id: authUserId,
      principal_id: principalId,
      workspace_id: workspaceId,
      workspace_slug: configuration.data.workspaceSlug,
      email: configuration.data.email,
      receipt: bootstrapped.rows[0]?.result ?? null,
      ecommerce_demo: ecommerceDemo,
    });
  } catch {
    await client.query("rollback").catch(() => undefined);
    report({
      schema_version: "superadmin-bootstrap-result@1.0.0",
      terminal: "HOLD",
      reason_code: "SUPER_ADMIN_BOOTSTRAP_FAILED",
    });
    process.exitCode = 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

await main();
