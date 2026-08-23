import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { Pool } from "pg";

interface FixtureRow {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly conversation_id: string;
  readonly owner_principal_id: string;
  readonly resource_version: string;
  readonly datasource_id: string;
  readonly deployment_id: string;
  readonly membership_role: string;
}

const SYSTEM_MODEL_PROFILE_ID = "30000000-0000-4000-8000-000000000003";

function environmentFile(path: string): Record<string, string | undefined> {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const environment = {
  ...environmentFile(resolve(repositoryRoot, ".env")),
  ...environmentFile(resolve(repositoryRoot, ".env.local")),
  ...process.env,
};
const connectionString = environment.DATA_AGENT_DATABASE_URL ?? environment.DATABASE_URL;
if (!connectionString) throw new Error("DATA_AGENT_DATABASE_URL_OR_DATABASE_URL_REQUIRED");

const pool = new Pool({
  connectionString,
  max: 1,
  application_name: "data-agent-qa-resource-switch-smoke",
});
const client = await pool.connect();

try {
  await client.query("begin");
  const guardsSource = readFileSync(
    resolve(
      repositoryRoot,
      "infra/supabase/apps/data-agent/migration-sources/10648/20-conversation-guards.sql.inc",
    ),
    "utf8",
  );
  const switchSource = readFileSync(
    resolve(
      repositoryRoot,
      "infra/supabase/apps/data-agent/migration-sources/10648/30-resource-switch.sql.inc",
    ),
    "utf8",
  ).replace(
    "create function app_data_agent.switch_qa_conversation_resources",
    "create or replace function app_data_agent.switch_qa_conversation_resources",
  );
  await client.query(guardsSource);
  await client.query(switchSource);
  const fixture = await client.query<FixtureRow>(`
    select conversation.app_id, conversation.tenant_id, conversation.environment,
           conversation.conversation_id, conversation.owner_principal_id,
           conversation.resource_version, datasource.datasource_id,
           deployment.deployment_id, membership.membership_role
      from app_data_agent.qa_conversations as conversation
      join app_data_agent.datasource_connections as datasource
        on datasource.app_id = conversation.app_id
       and datasource.tenant_id = conversation.tenant_id
       and datasource.environment = conversation.environment
       and datasource.datasource_id = conversation.datasource_id
       and datasource.status = 'ACTIVE'
      join platform.deployment_mappings as deployment
        on deployment.app_id = conversation.app_id
       and deployment.environment = conversation.environment
       and deployment.is_active
      join app_data_agent.memberships as membership
        on membership.app_id = conversation.app_id
       and membership.tenant_id = conversation.tenant_id
       and membership.environment = conversation.environment
       and membership.principal_id = conversation.owner_principal_id
       and membership.revoked_at is null
     where exists (
       select 1 from app_data_agent.qa_messages as message
        where message.app_id = conversation.app_id
          and message.tenant_id = conversation.tenant_id
          and message.environment = conversation.environment
          and message.conversation_id = conversation.conversation_id
     )
     order by conversation.updated_at desc
     limit 1
  `);
  const selected = fixture.rows[0];
  if (!selected) throw new Error("QA_RESOURCE_SWITCH_SMOKE_FIXTURE_MISSING");

  await client.query(
    `insert into app_data_agent.model_catalog_entries (
       app_id, environment, model_profile_id, provider, model_id, display_name,
       base_url, capabilities, credential_ref, status, config_version,
       is_system_default, created_by
     ) values (
       $1::uuid, $2::text, $3::uuid, 'deepseek', 'deepseek-v4-flash',
       'DeepSeek system model smoke', 'https://api.deepseek.com',
       '{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false}'::jsonb,
       null, 'ACTIVE', 1, true, $4::uuid
     ) on conflict (app_id, environment, model_profile_id) do nothing`,
    [selected.app_id, selected.environment, SYSTEM_MODEL_PROFILE_ID, selected.owner_principal_id],
  );
  await client.query(
    `insert into app_data_agent.model_config_versions (
       app_id, environment, model_profile_id, config_version, snapshot, actor_principal_id
     ) values (
       $1::uuid, $2::text, $3::uuid, 1,
       '{"provider":"deepseek","model_id":"deepseek-v4-flash"}'::jsonb,
       $4::uuid
     ) on conflict do nothing`,
    [selected.app_id, selected.environment, SYSTEM_MODEL_PROFILE_ID, selected.owner_principal_id],
  );

  // Mirror the reviewed migration ACL inside this rollback-only transaction so
  // older local ledgers cannot hide the RLS/authority behavior under test.
  await client.query(
    "grant select, insert, update on table app_data_agent.qa_resource_switch_operations to data_agent_backend",
  );
  await client.query("set local role data_agent_backend");
  const capabilitySettings = {
    app_id: selected.app_id,
    tenant_id: selected.tenant_id,
    environment: selected.environment,
    principal_id: selected.owner_principal_id,
    role: selected.membership_role,
    deployment_id: selected.deployment_id,
  };
  for (const [key, value] of Object.entries(capabilitySettings)) {
    await client.query("select pg_catalog.set_config($1::text, $2::text, true)", [
      `data_agent.${key}`,
      value,
    ]);
  }

  const replacementCommand = {
    schema_version: "qa-conversation-resource-switch@1.0.0",
    operation_id: randomUUID(),
    idempotency_key: `qa-resource-smoke-${randomUUID()}`,
    conversation_id: selected.conversation_id,
    datasource_id: selected.datasource_id,
    model_profile_id: SYSTEM_MODEL_PROFILE_ID,
    expected_resource_version: Number(selected.resource_version),
  };
  const switched = await client.query<{ readonly result: Record<string, unknown> }>(
    "select app_data_agent.switch_qa_conversation_resources($1::jsonb) as result",
    [replacementCommand],
  );
  const result = switched.rows[0]?.result as
    | {
        readonly kind?: string;
        readonly replaced_id?: string;
        readonly conversation?: { readonly conversation_id?: string };
      }
    | undefined;
  const replayed = await client.query<{ readonly result: Record<string, unknown> }>(
    "select app_data_agent.switch_qa_conversation_resources($1::jsonb) as result",
    [replacementCommand],
  );
  const alternateDatasource = await client.query<{ readonly datasource_id: string }>(
    `select datasource_id from app_data_agent.datasource_connections
      where status = 'ACTIVE' and datasource_id <> $1::uuid
      order by created_at limit 1`,
    [selected.datasource_id],
  );
  const alternateDatasourceId = alternateDatasource.rows[0]?.datasource_id;
  if (!alternateDatasourceId || !result?.conversation?.conversation_id) {
    throw new Error("QA_RESOURCE_SWITCH_SMOKE_ALTERNATE_DATASOURCE_MISSING");
  }
  const updated = await client.query<{ readonly result: Record<string, unknown> }>(
    "select app_data_agent.switch_qa_conversation_resources($1::jsonb) as result",
    [
      {
        schema_version: "qa-conversation-resource-switch@1.0.0",
        operation_id: randomUUID(),
        idempotency_key: `qa-resource-smoke-${randomUUID()}`,
        conversation_id: result.conversation.conversation_id,
        datasource_id: alternateDatasourceId,
        model_profile_id: SYSTEM_MODEL_PROFILE_ID,
        expected_resource_version: 1,
      },
    ],
  );
  const updatedResult = updated.rows[0]?.result as
    | { readonly kind?: string; readonly conversation?: { readonly conversation_id?: string } }
    | undefined;
  const oldMessages = await client.query<{ readonly count: number }>(
    "select count(*)::int as count from app_data_agent.qa_messages where conversation_id = $1::uuid",
    [selected.conversation_id],
  );
  const replacementMessages = await client.query<{ readonly count: number }>(
    "select count(*)::int as count from app_data_agent.qa_messages where conversation_id = $1::uuid",
    [result?.conversation?.conversation_id],
  );
  const proof = {
    kind: result?.kind,
    idempotent_replay: JSON.stringify(replayed.rows[0]?.result) === JSON.stringify(result),
    empty_switch_kind: updatedResult?.kind,
    empty_switch_preserved_id:
      updatedResult?.conversation?.conversation_id === result?.conversation?.conversation_id,
    replaced_preserved: result?.replaced_id === selected.conversation_id,
    old_message_count: oldMessages.rows[0]?.count,
    replacement_message_count: replacementMessages.rows[0]?.count,
  };
  if (
    proof.kind !== "CREATED_REPLACEMENT" ||
    !proof.idempotent_replay ||
    proof.empty_switch_kind !== "UPDATED_CURRENT" ||
    !proof.empty_switch_preserved_id ||
    !proof.replaced_preserved ||
    !proof.old_message_count ||
    proof.replacement_message_count !== 0
  ) {
    throw new Error("QA_RESOURCE_SWITCH_SMOKE_FAILED");
  }
  process.stdout.write(`${JSON.stringify(proof)}\n`);
} finally {
  await client.query("rollback").catch(() => undefined);
  client.release();
  await pool.end();
}
