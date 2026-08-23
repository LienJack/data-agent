import { basename, resolve } from "node:path";
import nextEnvironment from "@next/env";
import { Client } from "pg";
import { z } from "zod";
import {
  attachEcommerceDemoToWorkspace,
  resolveEcommerceDemoConnectionConfiguration,
} from "../lib/ecommerce-demo-bootstrap";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_ECOMMERCE_DEMO_BOOTSTRAP";
const configSchema = z.strictObject({
  databaseUrl: z.string().min(1),
  workspaceSlug: z.string().trim().min(2).max(63),
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

nextEnvironment.loadEnvConfig(repositoryRoot(), process.env.NODE_ENV !== "production");
if (process.env[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
  report({
    schema_version: "ecommerce-demo-workspace-bootstrap-result@1.0.0",
    terminal: "NOT_RUN",
    reason_code: "EXPLICIT_CONFIRMATION_REQUIRED",
    confirmation_variable: CONFIRMATION_VARIABLE,
  });
  process.exitCode = 2;
} else {
  const config = configSchema.safeParse({
    databaseUrl: process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_URL,
    workspaceSlug:
      process.env.DATA_AGENT_ECOMMERCE_WORKSPACE_SLUG ??
      process.env.DATA_AGENT_BOOTSTRAP_WORKSPACE_SLUG ??
      "main-workspace",
  });
  if (!config.success) {
    report({
      schema_version: "ecommerce-demo-workspace-bootstrap-result@1.0.0",
      terminal: "HOLD",
      reason_code: "ECOMMERCE_DEMO_BOOTSTRAP_CONFIGURATION_INVALID",
    });
    process.exitCode = 64;
  } else {
    const client = new Client({
      connectionString: config.data.databaseUrl,
      application_name: "data-agent-ecommerce-demo-bootstrap",
      connectionTimeoutMillis: 5_000,
      statement_timeout: 60_000,
    });
    try {
      await client.connect();
      const target = await client.query<{
        app_id: string;
        workspace_id: string;
        environment: string;
        principal_id: string;
      }>(
        `select workspace.app_id, workspace.workspace_id, workspace.environment, membership.principal_id
         from app_data_agent.workspaces as workspace
         join app_data_agent.memberships as membership
           on membership.app_id = workspace.app_id and membership.tenant_id = workspace.workspace_id
          and membership.environment = workspace.environment
         join app_data_agent.app_users as app_user
           on app_user.app_id = membership.app_id and app_user.environment = membership.environment
          and app_user.principal_id = membership.principal_id
         where workspace.slug = $1::text and workspace.lifecycle = 'ACTIVE'
           and membership.workspace_role = 'WORKSPACE_ADMIN' and membership.revoked_at is null
           and app_user.system_role = 'SUPER_ADMIN' and app_user.status = 'ACTIVE'`,
        [config.data.workspaceSlug],
      );
      if (target.rowCount !== 1 || !target.rows[0])
        throw new Error("ECOMMERCE_DEMO_BOOTSTRAP_TARGET_AMBIGUOUS");
      const row = target.rows[0];
      await client.query("begin");
      const result = await attachEcommerceDemoToWorkspace(
        client,
        {
          appId: row.app_id,
          workspaceId: row.workspace_id,
          environment: row.environment,
          principalId: row.principal_id,
        },
        resolveEcommerceDemoConnectionConfiguration(process.env, row.environment),
      );
      await client.query("commit");
      report(result);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      const message = error instanceof Error ? error.message : "";
      report({
        schema_version: "ecommerce-demo-workspace-bootstrap-result@1.0.0",
        terminal: "HOLD",
        reason_code: /^[A-Z][A-Z0-9_]{2,127}$/u.test(message)
          ? message
          : "ECOMMERCE_DEMO_BOOTSTRAP_FAILED",
      });
      process.exitCode = 2;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
