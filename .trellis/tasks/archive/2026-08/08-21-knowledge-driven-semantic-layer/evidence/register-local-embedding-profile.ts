import pg from "../../../../apps/worker/node_modules/pg/lib/index.js";
import { buildEmbeddingProfileRevision } from "../../../../packages/contracts/src/index.ts";
import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  withAppTransaction,
} from "../../../../packages/platform/src/index.ts";

const connectionString = process.env.DATABASE_URL;
const tenantId = process.env.WORKER_TENANT_ID;
const principalId = process.env.WORKER_PRINCIPAL_ID;
if (!connectionString || !tenantId || !principalId) {
  throw new Error("LOCAL_EMBEDDING_PROFILE_ENV_NOT_READY");
}

const raw = new pg.Pool({ connectionString });
try {
  const pool = adaptPgPool(raw);
  const authority = createPostgresCapabilityAuthority(pool);
  const capability = await authority.resolveForServerContext({
    deployment_id: "00000000-0000-4000-8000-000000000001",
    tenant_id: tenantId,
    principal_id: principalId,
    access: "WRITE",
  });
  if (!capability.ok) throw new Error(capability.error.code);
  const profile = await buildEmbeddingProfileRevision({
    schema_version: "embedding-profile-revision@1.0.0",
    scope: capability.value.scope,
    profile_id: "00000000-0000-4000-8000-00000000e801",
    revision: 1,
    provider: "local-fixture",
    model_id: "deterministic-8",
    dimensions: 8,
    normalization: "NONE",
    parser_version: "markdown-parser@1.0.0",
    chunker_version: "markdown-blocks@1.0.0",
    projection_policy_version: "knowledge-projection@1.0.0",
    status: "READY",
    created_at: "2026-08-22T00:00:00.000Z",
  });
  const registered = await withAppTransaction(
    pool,
    authority.authorizer,
    capability.value,
    { access: "WRITE", operation_name: "knowledge.register_local_fixture_profile" },
    async ({ client }) =>
      (
        await client.query<{ value: unknown }>(
          "select app_data_agent.register_knowledge_embedding_profile($1::jsonb) as value",
          [profile],
        )
      ).rows[0]?.value,
  );
  if (!registered.ok) throw new Error(registered.error.code);
  process.stdout.write(
    `${JSON.stringify({ profile_id: profile.profile_id, status: profile.status, dimensions: profile.dimensions })}\n`,
  );
} finally {
  await raw.end();
}
