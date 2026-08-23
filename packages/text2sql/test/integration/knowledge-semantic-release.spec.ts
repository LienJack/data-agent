import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildSemanticContextAuthoritySnapshot,
  buildSemanticContextPackage,
  type QueryContractPayload,
} from "@data-agent/contracts";
import { buildSemanticContextText2SqlBinding } from "@data-agent/contracts/server";
import {
  buildLogicalPlan,
  buildSemanticQuery,
  compilePostgresqlLogicalPlan,
  validateLogicalPlan,
} from "@data-agent/text2sql";
import { describe, expect, it } from "vitest";
import { groundQueryContract } from "../../src/grounding/ground-query-contract.js";
import { analystPolicy, commerceCatalog, netRevenueContract } from "../support/commerce-fixture.js";
import { committedLogicalPlanAuthorityFixture } from "../support/compiler-authority-fixture.js";

const containerName = process.env.KNOWLEDGE_SEMANTIC_E2E_CONTAINER;
const databaseName = process.env.KNOWLEDGE_SEMANTIC_E2E_DATABASE ?? "data_agent_test";
const skipSetup = process.env.KNOWLEDGE_SEMANTIC_E2E_SKIP_SETUP === "1";
const appId = "00000000-0000-4000-8000-00000000da01";
const tenantId = "00000000-0000-4000-8000-00000000aa11";
const principalId = "00000000-0000-4000-8000-000000001001";
const datasourceId = "00000000-0000-4000-8000-000000006750";
const semanticDomain = "knowledge_publish_test";
const hash = (character: string) => `sha256:${character.repeat(64)}`;

type PublishedSnapshot = Readonly<{
  release_id: string;
  release_generation: number;
  release_digest: `sha256:${string}`;
}>;

type PublishedMetric = Readonly<{
  metric_id: string;
  name: string;
  aliases: readonly string[];
  mapping_refs: readonly string[];
  mapping_hash: `sha256:${string}`;
  formula_hash: `sha256:${string}`;
}>;

function runPsql(sql: string, variables: readonly string[] = []): string {
  if (!containerName) throw new Error("KNOWLEDGE_SEMANTIC_E2E_CONTAINER_REQUIRED");
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      ...variables.flatMap((variable) => ["-v", variable]),
      "-U",
      "postgres",
      "-d",
      databaseName,
    ],
    { input: sql, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`PSQL_FAILED:${result.stderr.trim()}\n${result.stdout.trim()}`);
  }
  return result.stdout.trim();
}

function parseLastJson<T>(output: string): T {
  const line = output
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error("PSQL_JSON_RESULT_REQUIRED");
  return JSON.parse(line) as T;
}

async function buildCompilerInput(publishedMetrics: readonly PublishedMetric[]) {
  const scope = { app_id: appId, tenant_id: tenantId, environment: "test" } as const;
  const catalog = {
    ...commerceCatalog,
    scope,
    datasource_id: datasourceId,
    tables: commerceCatalog.tables.map((table) => ({
      ...table,
      physical_name:
        table.table_id === "orders"
          ? "knowledge_semantic_orders"
          : table.table_id === "customers"
            ? "knowledge_semantic_customers"
            : table.physical_name,
    })),
  };
  const policy = {
    ...analystPolicy,
    scope,
    datasource_id: datasourceId,
    principal_id: principalId,
  };
  const baseContract = netRevenueContract();
  const queryContract: QueryContractPayload = netRevenueContract({
    datasource_id: datasourceId,
    evidence_plan_ref: {
      ...baseContract.evidence_plan_ref,
      app_id: appId,
      tenant_id: tenantId,
      environment: "test",
    },
  });
  const grounded = await groundQueryContract({
    query_contract: queryContract,
    catalog,
    policy,
    retrieval_candidates: [],
    max_context_objects: 64,
  });
  if (grounded.state !== "READY") {
    throw new Error(`GROUNDING_NOT_READY:${JSON.stringify(grounded)}`);
  }
  const semanticQuery = buildSemanticQuery({
    query_contract: queryContract,
    grounding: grounded.grounding,
  });
  const planCandidate = buildLogicalPlan({
    semantic_query: semanticQuery,
    grounding: grounded.grounding,
  });
  const validated = validateLogicalPlan({
    logical_plan: planCandidate,
    grounding: grounded.grounding,
    semantic_query: semanticQuery,
    query_contract: queryContract,
  });
  if (validated.state !== "VALID") {
    throw new Error(`LOGICAL_PLAN_INVALID:${validated.reason_code}`);
  }
  const logicalPlanAuthority = await committedLogicalPlanAuthorityFixture(validated.logical_plan, {
    scope,
    principal_id: principalId,
  });
  return {
    scope,
    queryContract,
    grounding: grounded.grounding,
    logicalPlanBinding: await logicalPlanAuthority.bind(),
    selectedMetric: publishedMetrics.find((metric) => metric.metric_id === "metric.net_revenue"),
  };
}

async function buildResolvedBinding(
  published: PublishedSnapshot,
  metric: PublishedMetric | null,
  question: string,
) {
  const scope = { app_id: appId, tenant_id: tenantId, environment: "test" } as const;
  const normalizedMetric = metric
    ? {
        ...metric,
        aliases: [...metric.aliases].sort(),
        mapping_refs: [...metric.mapping_refs].sort(),
      }
    : null;
  const knowledgeRefs = normalizedMetric
    ? [
        {
          resource_id: "00000000-0000-4000-8000-000000006796",
          resource_revision: 1,
          resource_hash: hash("b"),
        },
      ]
    : [];
  const snapshot = await buildSemanticContextAuthoritySnapshot({
    schema_version: "semantic-context-authority-snapshot@1.0.0",
    scope,
    semantic_domain: semanticDomain,
    question,
    defaults_ref: {
      defaults_id: "00000000-0000-4000-8000-000000006790",
      defaults_revision: 1,
      defaults_hash: hash("1"),
    },
    semantic_release: {
      resource_id: published.release_id,
      resource_revision: published.release_generation,
      resource_hash: published.release_digest,
      datasource_id: datasourceId,
      semantic_generation: published.release_generation,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: "00000000-0000-4000-8000-000000006791",
      resource_revision: 1,
      resource_hash: hash("2"),
      datasource_id: datasourceId,
      semantic_release_id: published.release_id,
      semantic_generation: published.release_generation,
    },
    context_policy: {
      resource_id: "00000000-0000-4000-8000-000000006792",
      resource_revision: 1,
      resource_hash: hash("3"),
      max_context_tokens: 4096,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: "00000000-0000-4000-8000-000000006793",
      resource_revision: 1,
      resource_hash: hash("4"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    published_metrics: normalizedMetric ? [normalizedMetric] : [],
    published_ontology: [],
    published_relationships: [],
    knowledge_refs: knowledgeRefs,
    projection_hashes: normalizedMetric
      ? [...new Set([normalizedMetric.mapping_hash, normalizedMetric.formula_hash])].sort()
      : [published.release_digest],
  });
  const packageDocument = await buildSemanticContextPackage({
    schema_version: "semantic-context-package@1.0.0",
    scope,
    semantic_domain: semanticDomain,
    question_hash: snapshot.question_hash,
    defaults_ref: snapshot.defaults_ref,
    semantic_release: snapshot.semantic_release,
    schema_snapshot: snapshot.schema_snapshot,
    context_policy: snapshot.context_policy,
    egress_policy: snapshot.egress_policy,
    provider: snapshot.provider,
    authority_snapshot_hash: snapshot.snapshot_hash,
    route_decision: normalizedMetric
      ? {
          schema_version: "semantic-context-route-decision@1.0.0",
          state: "READY",
          route: "METRIC",
          selected_metric_id: normalizedMetric.metric_id,
          selected_ontology_ids: [],
          clarification_candidates: [],
          lexical_evidence: [],
          capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
          reason_codes: ["EXACT_PUBLISHED_METRIC"],
        }
      : {
          schema_version: "semantic-context-route-decision@1.0.0",
          state: "REJECTED",
          route: "NONE",
          selected_metric_id: null,
          selected_ontology_ids: [],
          clarification_candidates: [],
          lexical_evidence: [],
          capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
          reason_codes: ["PUBLISHED_METRIC_NOT_FOUND"],
        },
    capacity: {
      schema_version: "context-capacity-plan@1.0.0",
      policy_version: "utf8-byte-upper-bound@1.0.0",
      max_context_tokens: 4096,
      max_context_bytes: 4096,
      mandatory_bytes: normalizedMetric ? 64 : 0,
      included_bytes: normalizedMetric ? 64 : 0,
      cropped_bytes: 0,
      items: normalizedMetric
        ? [
            {
              item_kind: "METRIC",
              item_id: normalizedMetric.metric_id,
              item_hash: normalizedMetric.mapping_hash,
              byte_size: 64,
              priority: 9000,
              mandatory: true,
              disposition: "MANDATORY",
              reason_code: "ROUTE_SELECTED",
            },
          ]
        : [],
    },
    evidence: [],
    knowledge_refs: knowledgeRefs,
  });
  return buildSemanticContextText2SqlBinding({ package: packageDocument, snapshot });
}

function sqlLiteral(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "string") throw new Error("FIXTURE_PARAMETER_TYPE_UNSUPPORTED");
  return `'${value.replaceAll("'", "''")}'`;
}

describe.skipIf(!containerName)("Knowledge Semantic Release Text2SQL PostgreSQL E2E", () => {
  it("binds the exact published release, compiles the selected metric and executes real SQL", async () => {
    const fixturePath = fileURLToPath(
      new URL(
        "../../../../infra/supabase/test-support/18zzzza-knowledge-semantic-release-assertions.sql",
        import.meta.url,
      ),
    );
    if (!skipSetup) {
      const setupOutput = runPsql(readFileSync(fixturePath, "utf8"), [
        "KNOWLEDGE_SEMANTIC_KEEP_PUBLISHED=1",
      ]);
      expect(setupOutput).toContain("KNOWLEDGE_SEMANTIC_RELEASE_ASSERTIONS_PASSED");
    }

    const published = parseLastJson<PublishedSnapshot>(
      runPsql(`
select pg_catalog.jsonb_build_object(
  'release_id',pointer.current_release_id,
  'release_generation',pointer.current_release_generation,
  'release_digest',release.release_digest
)::text
from semantic.semantic_active_pointer pointer
join semantic.semantic_source_release release
  on release.app_id=pointer.app_id and release.tenant_id=pointer.tenant_id
  and release.environment=pointer.environment and release.semantic_domain=pointer.semantic_domain
  and release.release_id=pointer.current_release_id
where pointer.app_id='${appId}'::uuid and pointer.tenant_id='${tenantId}'::uuid
  and pointer.environment='test' and pointer.semantic_domain='${semanticDomain}';
`),
    );
    const metrics = parseLastJson<PublishedMetric[]>(
      runPsql(`
select app_data_agent.semantic_context_metric_projection(
  '${appId}'::uuid,'${tenantId}'::uuid,'test','${semanticDomain}',
  '${published.release_id}'::uuid
)::text;
`),
    );
    const compilerInput = await buildCompilerInput(metrics);
    if (!compilerInput.selectedMetric) throw new Error("PUBLISHED_NET_REVENUE_METRIC_REQUIRED");
    const resolvedBinding = await buildResolvedBinding(
      published,
      compilerInput.selectedMetric,
      "按客户分层统计 2026 年 6 月已支付订单的净收入",
    );
    const compiled = await compilePostgresqlLogicalPlan({
      logical_plan_binding: compilerInput.logicalPlanBinding,
      grounding: compilerInput.grounding,
      semantic_context_binding: resolvedBinding,
    });
    if (compiled.state !== "COMPILED") {
      throw new Error(`TEXT2SQL_COMPILE_FAILED:${compiled.reason_code}`);
    }
    const artifact = compiled.compilation.sql_artifact;
    const parameters = compiled.compilation.parameter_order.map((entry) =>
      sqlLiteral(artifact.parameters[entry.placeholder]),
    );
    const execution = runPsql(`
begin;
set local search_path=public,pg_catalog;
prepare knowledge_semantic_query as ${artifact.sql};
execute knowledge_semantic_query(${parameters.join(",")});
deallocate knowledge_semantic_query;
rollback;
`);
    expect(execution).toContain("enterprise|150");
    expect(execution).toContain("smb|30");
    expect(compiled.compilation.proof.semantic_context_binding_hash).toBe(
      resolvedBinding.binding_hash,
    );
    expect(resolvedBinding.semantic_release.resource_id).toBe(published.release_id);
    expect(resolvedBinding.semantic_release.resource_revision).toBe(published.release_generation);

    runPsql(`
begin;
insert into semantic.semantic_review_task (
  app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,approval_mode,
  packet_digest,packet_payload,decision_window_status,review_outcome,
  decision_expires_at,publish_expires_at,quorum_rules_snapshot,veto_rules_snapshot,
  exclusion_set,created_by,closed_at
) values (
  '${appId}','${tenantId}','test','${semanticDomain}',
  '00000000-0000-4000-8000-00000000677a','ROLLBACK_REVIEW','HUMAN_REVIEW',
  '${hash("e")}','{"fixture":"text2sql-rollback"}'::jsonb,'CLOSED','APPROVED',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()+interval '1 day',
  '{"required_approvals":1}'::jsonb,'{"min_veto_count":1}'::jsonb,'[]'::jsonb,
  '${principalId}',pg_catalog.clock_timestamp()
);
insert into semantic.semantic_rollback_authorization (
  app_id,tenant_id,environment,semantic_domain,authorization_id,packet_id,
  from_release_id,from_release_generation,to_release_id,to_release_generation,
  current_release_id,current_release_generation,authorization_digest,decision_set_digest,
  nonce,expires_at
)
select pointer.app_id,pointer.tenant_id,pointer.environment,pointer.semantic_domain,
  '00000000-0000-4000-8000-00000000677c','00000000-0000-4000-8000-00000000677a',
  pointer.current_release_id,pointer.current_release_generation,
  '00000000-0000-4000-8000-000000006759',1,
  pointer.current_release_id,pointer.current_release_generation,
  '${hash("d")}','${hash("c")}',
  '00000000-0000-4000-8000-00000000677b',pg_catalog.clock_timestamp()+interval '1 day'
from semantic.semantic_active_pointer pointer
where pointer.app_id='${appId}'::uuid and pointer.tenant_id='${tenantId}'::uuid
  and pointer.environment='test' and pointer.semantic_domain='${semanticDomain}'
  and pointer.current_release_id='${published.release_id}'::uuid
  and pointer.current_release_generation=2;
set local role data_agent_backend;
select * from platform.revalidate_backend_authority(
  '${appId}'::uuid,'${tenantId}'::uuid,'test',
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '${principalId}'::uuid,'owner',1,1,true
);
select pg_catalog.set_config('data_agent.app_id','${appId}',true);
select pg_catalog.set_config('data_agent.tenant_id','${tenantId}',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.principal_id','${principalId}',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config(
  'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true
);
select pg_catalog.set_config('app.semantic_domain','${semanticDomain}',true);
select semantic.human_execute_rollback(pg_catalog.jsonb_build_object(
  'schema_version','human-execute-rollback@1.0.0',
  'scope',pg_catalog.jsonb_build_object(
    'app_id','${appId}','tenant_id','${tenantId}','workspace_id','${tenantId}',
    'environment','test'
  ),'semantic_domain','${semanticDomain}',
  'authorization_id','00000000-0000-4000-8000-00000000677c',
  'nonce','00000000-0000-4000-8000-00000000677b',
  'rollback_reason','Text2SQL exact Release binding rollback proof'
));
commit;
`);
    const rolledBack = parseLastJson<PublishedSnapshot>(
      runPsql(`
select pg_catalog.jsonb_build_object(
  'release_id',pointer.current_release_id,
  'release_generation',pointer.current_release_generation,
  'release_digest',release.release_digest
)::text
from semantic.semantic_active_pointer pointer
join semantic.semantic_source_release release
  on release.app_id=pointer.app_id and release.tenant_id=pointer.tenant_id
  and release.environment=pointer.environment and release.semantic_domain=pointer.semantic_domain
  and release.release_id=pointer.current_release_id
where pointer.app_id='${appId}'::uuid and pointer.tenant_id='${tenantId}'::uuid
  and pointer.environment='test' and pointer.semantic_domain='${semanticDomain}';
`),
    );
    const rolledBackMetrics = parseLastJson<PublishedMetric[]>(
      runPsql(`
select app_data_agent.semantic_context_metric_projection(
  '${appId}'::uuid,'${tenantId}'::uuid,'test','${semanticDomain}',
  '${rolledBack.release_id}'::uuid
)::text;
`),
    );
    expect(rolledBack).toMatchObject({
      release_id: "00000000-0000-4000-8000-000000006759",
      release_generation: 1,
    });
    expect(rolledBackMetrics.some((metric) => metric.metric_id === "metric.net_revenue")).toBe(
      false,
    );
    await expect(
      buildResolvedBinding(rolledBack, null, "按客户分层统计 2026 年 6 月已支付订单的净收入"),
    ).rejects.toThrow("SEMANTIC_CONTEXT_ROUTE_NOT_QUERYABLE");

    console.info(
      JSON.stringify({
        evidence_version: "knowledge-semantic-text2sql-e2e@1.0.0",
        release_id: published.release_id,
        release_generation: published.release_generation,
        release_digest: published.release_digest,
        evidence_selection_id: "00000000-0000-4000-8000-000000006796",
        evidence_selection_hash: hash("b"),
        semantic_context_binding_hash: resolvedBinding.binding_hash,
        logical_plan_hash: compiled.compilation.proof.logical_plan_hash,
        ast_hash: artifact.ast_hash,
        sql_query_hash: artifact.query_hash,
        execution_state: "SUCCEEDED",
        result_summary: [
          { customer_segment: "enterprise", net_revenue: "150" },
          { customer_segment: "smb", net_revenue: "30" },
        ],
        rollback_release_id: rolledBack.release_id,
        rollback_release_generation: rolledBack.release_generation,
        rerun_state: "NEEDS_CLARIFICATION",
        rerun_reason_code: "PUBLISHED_METRIC_NOT_FOUND",
      }),
    );
  });
});
