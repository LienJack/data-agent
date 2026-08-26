import {
  agentProductProfileRegistryItemSchema,
  agentProductProfileRegistryItemV2Schema,
  buildAgentProductProfileCommitCommand,
  buildAgentProductProfileRevision,
  buildAgentProductProfileRevisionV2,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPostgresAgentProfileRegistry } from "../../src/agents/postgres-agent-profile-registry.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const ids = { app: id(1), tenant: id(2), owner: id(3), analyst: id(4), deployment: id(5) };
const scope = { app_id: ids.app, tenant_id: ids.tenant, environment: "test" } as const;

function authorities() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      { subject: ids.owner, deployment_id: ids.deployment, tenant_id: ids.tenant, role: "OWNER" },
      {
        subject: ids.analyst,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const owner = registry.resolveForDeployment(ids.deployment, { subject: ids.owner });
  const analyst = registry.resolveForDeployment(ids.deployment, { subject: ids.analyst });
  if (!owner.ok || !analyst.ok) throw new Error("authority fixture failed");
  return {
    owner: owner.value,
    analyst: analyst.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(handler: (text: string) => SqlQueryResult | undefined) {
  const calls: string[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string) {
      calls.push(text);
      const result = handler(text);
      if (result) return result as SqlQueryResult<Row>;
      if (text.includes("backend_context_matches"))
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

async function fixture() {
  const revision = await buildAgentProductProfileRevision({
    schema_version: "agent-product-profile-revision@1.0.0",
    scope,
    profile_id: "report-writing-agent",
    revision: 1,
    runtime_profile_ref: {
      profile_id: "report-writing-agent",
      revision: 1,
      profile_hash: hash("1"),
    },
    model_profile_ref: { resource_id: id(10), resource_revision: 1, resource_hash: hash("2") },
    prompt_ref: { prompt_id: "prompt.report", revision: 1, prompt_hash: hash("3") },
    workflow_ref: { workflow_id: "workflow.report", revision: 1, workflow_hash: hash("4") },
    direct_tool_allowlist: ["evidence.read", "report.project"],
    skill_refs: [{ skill_id: id(11), revision: 1, revision_hash: hash("5") }],
    context_policy_ref: { resource_id: id(12), resource_revision: 1, resource_hash: hash("6") },
    execution_safety_policy_ref: {
      resource_id: id(13),
      resource_revision: 1,
      resource_hash: hash("7"),
    },
    expected_output_artifact_types: ["AnalysisReport"],
    verifier_contract_hash: hash("8"),
    approval_status: "APPROVED",
  });
  const command = await buildAgentProductProfileCommitCommand({
    schema_version: "agent-product-profile-commit-command@1.0.0",
    operation_id: id(20),
    idempotency_key: "profile:commit:001",
    actor_principal_id: ids.owner,
    revision,
    expected_head_version: 0,
    target_lifecycle: "ENABLED",
  });
  const item = agentProductProfileRegistryItemSchema.parse({
    schema_version: "agent-product-profile-registry-item@1.0.0",
    revision,
    head: {
      schema_version: "agent-product-profile-head@1.0.0",
      scope,
      profile_id: revision.profile_id,
      active_revision: 1,
      active_revision_hash: revision.revision_hash,
      lifecycle: "ENABLED",
      version: 1,
      updated_at: "2026-08-18T12:00:00.000Z",
    },
  });
  return { command, item };
}

async function fixtureV2() {
  const revision = await buildAgentProductProfileRevisionV2({
    schema_version: "agent-product-profile-revision@2.0.0",
    scope,
    profile_id: "governed-analysis-agent",
    revision: 3,
    discovery: {
      schema_version: "subagent-discovery-descriptor@1.0.0",
      display_name: "Governed Analysis",
      description: "Consumes accepted QueryEvidence for governed analysis.",
      when_to_use: ["Use for governed multi-step analysis."],
      when_not_to_use: ["Do not use for a simple lookup."],
      examples: [],
      accepted_input_artifact_types: ["QueryEvidence"],
      produced_artifact_types: ["AnalysisReport"],
      access_mode: "READ_ONLY",
    },
    runtime_profile_ref: {
      profile_id: "governed-analysis-agent",
      revision: 2,
      profile_hash: hash("1"),
    },
    model_profile_ref: { resource_id: id(30), resource_revision: 1, resource_hash: hash("2") },
    prompt_ref: { prompt_id: "prompt.analysis", revision: 1, prompt_hash: hash("3") },
    workflow_ref: { workflow_id: "workflow.analysis", revision: 1, workflow_hash: hash("4") },
    direct_tool_allowlist: ["analysis.program.execute"],
    skill_refs: [{ skill_id: id(31), revision: 2, revision_hash: hash("5") }],
    context_policy_ref: { resource_id: id(32), resource_revision: 1, resource_hash: hash("6") },
    execution_safety_policy_ref: {
      resource_id: id(33),
      resource_revision: 1,
      resource_hash: hash("7"),
    },
    expected_output_artifact_types: ["AnalysisReport"],
    verifier_contract_hash: hash("8"),
    approval_status: "APPROVED",
  });
  return agentProductProfileRegistryItemV2Schema.parse({
    schema_version: "agent-product-profile-registry-item@2.0.0",
    revision,
    head: {
      schema_version: "agent-product-profile-head@2.0.0",
      scope,
      profile_id: revision.profile_id,
      active_revision: revision.revision,
      active_revision_hash: revision.revision_hash,
      lifecycle: "DISABLED",
      version: 4,
      updated_at: "2026-08-18T12:00:00.000Z",
    },
  });
}

describe("PostgreSQL Agent Profile Registry", () => {
  it("lists owner-managed v2 heads without discoverability filtering", async () => {
    const item = await fixtureV2();
    const { owner, authorizer } = authorities();
    const { calls, pool } = scriptedPool((text) =>
      text.includes("list_agent_profile_revisions_v2(false)")
        ? {
            rows: [
              {
                value: {
                  schema_version: "agent-product-profile-list-result@2.0.0",
                  items: [item],
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );

    await expect(
      createPostgresAgentProfileRegistry({ pool, authorizer }).listManagedV2(owner),
    ).resolves.toMatchObject({ ok: true, value: [item] });
    expect(calls.some((text) => text.includes("list_agent_profile_revisions_v2(false)"))).toBe(
      true,
    );
  });

  it("denies Analyst access to managed v2 heads before SQL", async () => {
    const { analyst, authorizer } = authorities();
    const { calls, pool } = scriptedPool(() => undefined);

    await expect(
      createPostgresAgentProfileRegistry({ pool, authorizer }).listManagedV2(analyst),
    ).resolves.toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("commits and lists exact hash-verified profile revisions", async () => {
    const { command, item } = await fixture();
    const { owner, authorizer } = authorities();
    const { pool } = scriptedPool((text) => {
      if (text.includes("commit_agent_profile_revision"))
        return {
          rows: [
            {
              value: {
                schema_version: "agent-product-profile-commit-result@1.0.0",
                disposition: "COMMITTED",
                operation_id: command.operation_id,
                command_hash: command.command_hash,
                item,
              },
            },
          ],
          rowCount: 1,
        };
      if (text.includes("list_agent_profile_revisions"))
        return {
          rows: [
            { value: { schema_version: "agent-product-profile-list-result@1.0.0", items: [item] } },
          ],
          rowCount: 1,
        };
      return undefined;
    });
    const registry = createPostgresAgentProfileRegistry({ pool, authorizer });
    await expect(registry.commit(owner, command)).resolves.toMatchObject({ ok: true, value: item });
    await expect(registry.list(owner, true)).resolves.toMatchObject({ ok: true, value: [item] });
  });

  it("denies Analyst mutation before the profile RPC", async () => {
    const { command } = await fixture();
    const { analyst, authorizer } = authorities();
    const { calls, pool } = scriptedPool(() => undefined);
    const result = await createPostgresAgentProfileRegistry({ pool, authorizer }).commit(
      analyst,
      command,
    );
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rejects database result substitution", async () => {
    const { command, item } = await fixture();
    const { owner, authorizer } = authorities();
    const { pool } = scriptedPool((text) =>
      text.includes("commit_agent_profile_revision")
        ? {
            rows: [
              {
                value: {
                  schema_version: "agent-product-profile-commit-result@1.0.0",
                  disposition: "COMMITTED",
                  operation_id: id(99),
                  command_hash: command.command_hash,
                  item,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const result = await createPostgresAgentProfileRegistry({ pool, authorizer }).commit(
      owner,
      command,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_PROFILE_DATABASE_CONTRACT_INVALID" },
    });
  });
});
