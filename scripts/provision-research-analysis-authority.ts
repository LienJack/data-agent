import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { z } from "zod";
import { loadRunWorkerEnvironment } from "../apps/worker/src/run-worker-environment.js";
import { researchAuthorityCapabilityIdsSchema } from "../apps/worker/src/runs/research-authority-capabilities.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01" as const;
const PROTOCOL_VERSION = "u6-authority-manifest@1.0.0" as const;

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("AUTHORITY_MANIFEST_JSON_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
    .join(",")}}`;
}

const environmentSchema = z.strictObject({
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  tenant_id: z.uuid(),
  principal_id: z.uuid(),
  manifest_id: z.uuid(),
  ttl_hours: z.coerce.number().int().min(1).max(720),
});

const bindingRowSchema = z.strictObject({
  app_id: z.literal(APP_ID),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  membership_role: z.enum(["owner", "analyst"]),
});

const provisioningResultSchema = z.strictObject({
  protocol_version: z.literal("u6-authority-capability-set@1.0.0"),
  manifest_id: z.uuid(),
  scope: z.strictObject({
    app_id: z.literal(APP_ID),
    tenant_id: z.uuid(),
    environment: z.string(),
  }),
  principal_id: z.uuid(),
  deployment_id: z.uuid(),
  profile: z.literal("RESEARCH_ANALYSIS_WORKER"),
  capabilities: researchAuthorityCapabilityIdsSchema,
  expires_at: z.iso.datetime({ offset: true }),
  created: z.boolean(),
});

export type ResearchAnalysisAuthorityManifestBody = Readonly<{
  protocol_version: typeof PROTOCOL_VERSION;
  manifest_id: string;
  scope: Readonly<{ app_id: typeof APP_ID; tenant_id: string; environment: string }>;
  principal_id: string;
  deployment_id: string;
  profile: "RESEARCH_ANALYSIS_WORKER";
  membership_role: "OWNER" | "ANALYST";
  expires_at: string;
}>;

export function buildResearchAnalysisAuthorityManifestBody(input: {
  readonly manifest_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly principal_id: string;
  readonly deployment_id: string;
  readonly membership_role: "owner" | "analyst";
  readonly expires_at: string;
}): ResearchAnalysisAuthorityManifestBody {
  return Object.freeze({
    protocol_version: PROTOCOL_VERSION,
    manifest_id: input.manifest_id,
    scope: Object.freeze({
      app_id: APP_ID,
      tenant_id: input.tenant_id,
      environment: input.environment,
    }),
    principal_id: input.principal_id,
    deployment_id: input.deployment_id,
    profile: "RESEARCH_ANALYSIS_WORKER",
    membership_role: input.membership_role.toUpperCase() as "OWNER" | "ANALYST",
    expires_at: input.expires_at,
  });
}

export function researchAnalysisAuthorityManifestHash(
  body: ResearchAnalysisAuthorityManifestBody,
): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(`${PROTOCOL_VERSION}\0${canonicalizeJson(body)}`)
    .digest("hex")}`;
}

function parseEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  return environmentSchema.parse({
    database_url: environment.DATABASE_URL,
    deployment_id: environment.WORKER_DEPLOYMENT_ID,
    tenant_id: environment.WORKER_TENANT_ID,
    principal_id: environment.WORKER_PRINCIPAL_ID,
    manifest_id: environment.WORKER_AUTHORITY_MANIFEST_ID ?? randomUUID(),
    ttl_hours: environment.WORKER_AUTHORITY_TTL_HOURS ?? 24,
  });
}

export async function provisionResearchAnalysisAuthority(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<z.infer<typeof provisioningResultSchema>> {
  const config = parseEnvironment(environment);
  const pool = new pg.Pool({ connectionString: config.database_url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const bindingResult = await client.query(
      `select deployment.app_id::text as app_id,
              deployment.environment,
              membership.membership_role
         from platform.deployment_mappings as deployment
         join app_data_agent.memberships as membership
           on membership.app_id=deployment.app_id
          and membership.environment=deployment.environment
        where deployment.deployment_id=$1::uuid
          and deployment.is_active
          and membership.tenant_id=$2::uuid
          and membership.principal_id=$3::uuid
          and membership.revoked_at is null`,
      [config.deployment_id, config.tenant_id, config.principal_id],
    );
    if (bindingResult.rowCount !== 1) throw new TypeError("RESEARCH_AUTHORITY_BINDING_NOT_FOUND");
    const binding = bindingRowSchema.parse(bindingResult.rows[0]);
    const body = buildResearchAnalysisAuthorityManifestBody({
      manifest_id: config.manifest_id,
      tenant_id: config.tenant_id,
      environment: binding.environment,
      principal_id: config.principal_id,
      deployment_id: config.deployment_id,
      membership_role: binding.membership_role,
      expires_at: new Date(Date.now() + config.ttl_hours * 60 * 60 * 1_000).toISOString(),
    });
    const envelope = {
      ...body,
      request_hash: researchAnalysisAuthorityManifestHash(body),
    };
    await client.query("set local role data_agent_u6_provisioner");
    const result = await client.query(
      "select app_data_agent.provision_u6_authority_manifest($1::jsonb) as result",
      [envelope],
    );
    const parsed = provisioningResultSchema.parse(result.rows[0]?.result);
    await client.query("commit");
    return parsed;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const result = await provisionResearchAnalysisAuthority(
    loadRunWorkerEnvironment(process.env, process.cwd()),
  );
  process.stderr.write(
    `${result.created ? "issued" : "replayed"} research authority through ${result.expires_at}\n`,
  );
  process.stdout.write(`${JSON.stringify(result.capabilities)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
