import { basename, resolve } from "node:path";
import nextEnvironment from "@next/env";
import { Pool } from "pg";
import { z } from "zod";
import { publishEcommerceGraphV2 } from "../lib/ecommerce-graph-v2-publish";
import { prepareEcommerceGraphV2 } from "../lib/ecommerce-graph-v2-runtime";

const configSchema = z.strictObject({
  database_url: z.string().min(1),
  app_id: z.uuid(),
  tenant_id: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  principal_id: z.uuid(),
  base_release_id: z.uuid(),
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
const config = configSchema.parse({
  database_url: process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_URL,
  app_id: process.env.SEMANTIC_APP_ID ?? "00000000-0000-4000-8000-00000000da01",
  tenant_id: process.env.SEMANTIC_TENANT_ID,
  environment: process.env.SEMANTIC_ENVIRONMENT ?? "local",
  principal_id: process.env.SEMANTIC_PRINCIPAL_ID,
  base_release_id:
    process.env.ECOMMERCE_GRAPH_BASE_RELEASE_ID ?? "00000000-0000-4000-8000-00000000ec25",
});
const pool = new Pool({
  connectionString: config.database_url,
  application_name: "data-agent-ecommerce-graph-v2-migration",
  connectionTimeoutMillis: 5_000,
  statement_timeout: 75_000,
});

try {
  const prepared = await prepareEcommerceGraphV2({
    pool,
    scope: {
      app_id: config.app_id,
      tenant_id: config.tenant_id,
      environment: config.environment,
    },
    base_release_id: config.base_release_id,
  });
  if (process.env.DATA_AGENT_ALLOW_ECOMMERCE_GRAPH_V2_PUBLISH === "YES") {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const published = await publishEcommerceGraphV2(
        client,
        {
          app_id: config.app_id,
          tenant_id: config.tenant_id,
          environment: config.environment,
          principal_id: config.principal_id,
          base_release_id: config.base_release_id,
        },
        prepared,
      );
      await client.query("commit");
      report({
        schema_version: "ecommerce-graph-v2-migration-result@1.0.0",
        terminal: "PUBLISHED",
        ...published,
        coverage_receipt_digest: prepared.coverage_receipt.receipt_digest,
      });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } else {
    report({
      schema_version: "ecommerce-graph-v2-migration-result@1.0.0",
      terminal: "READY_TO_PUBLISH",
      graph_id: prepared.source_graph.metadata.graph_id,
      source_digest: prepared.compilation.source_digest,
      snapshot_id: prepared.snapshot.snapshot_id,
      snapshot_content_hash: prepared.snapshot.snapshot_content_hash,
      node_count: prepared.compilation.native_projection.node_count,
      edge_count: prepared.compilation.native_projection.edge_count,
      coverage_receipt_digest: prepared.coverage_receipt.receipt_digest,
      ontology_node_counts: prepared.coverage_receipt.active_node_counts,
      ontology_edge_family_counts: prepared.coverage_receipt.active_edge_family_counts,
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  report({
    schema_version: "ecommerce-graph-v2-migration-result@1.0.0",
    terminal: "HOLD",
    reason_code: /^[A-Z][A-Z0-9_:-]{2,255}$/u.test(message)
      ? message
      : "ECOMMERCE_GRAPH_V2_MIGRATION_FAILED",
    ...(process.env.DATA_AGENT_GRAPH_V2_DIAGNOSTICS === "YES"
      ? {
          diagnostic: {
            error_name: error instanceof Error ? error.name : "UnknownError",
            message: message.slice(0, 512),
          },
        }
      : {}),
  });
  process.exitCode = 2;
} finally {
  await pool.end();
}
