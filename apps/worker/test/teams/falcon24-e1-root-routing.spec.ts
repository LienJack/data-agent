import { access, readFile } from "node:fs/promises";
import {
  admitRootAgentDelegations,
  buildBuiltinTeamMaterialization,
  normalizeRootAgentProviderTurn,
} from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItemV2,
  type ArtifactReference,
  buildSubagentCapabilityCatalogSnapshot,
  projectSubagentCapabilityCatalogItem,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";

const id = (suffix: number) => `89000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const principalId = id(4);
const profileIds = [
  "governed-analysis-agent",
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

function resources(offset: number) {
  return Object.fromEntries(
    profileIds.map((profileId, index) => [
      profileId,
      {
        resource_id: id(offset + index),
        resource_revision: 1,
        resource_hash: hash(String((offset + index) % 10)),
      },
    ]),
  ) as Record<
    (typeof profileIds)[number],
    { resource_id: string; resource_revision: number; resource_hash: string }
  >;
}

async function frozenAuthority() {
  const materialized = await buildBuiltinTeamMaterialization({
    scope,
    model_profile_refs: resources(10),
    context_policy_refs: resources(20),
    execution_safety_policy_refs: resources(30),
  });
  const profiles = materialized.profile_revisions.map(
    (revision): AgentProductProfileRegistryItemV2 => ({
      schema_version: "agent-product-profile-registry-item@2.0.0",
      revision,
      head: {
        schema_version: "agent-product-profile-head@2.0.0",
        scope,
        profile_id: revision.profile_id,
        active_revision: revision.revision,
        active_revision_hash: revision.revision_hash,
        lifecycle: "ENABLED",
        version: 1,
        updated_at: "2026-08-26T00:00:00.000Z",
      },
    }),
  );
  const catalog = await buildSubagentCapabilityCatalogSnapshot({
    schema_version: "subagent-capability-catalog-snapshot@1.0.0",
    catalog_id: id(40),
    scope,
    run_id: runId,
    principal_id: principalId,
    policy_version: "falcon24-e1-root-v3@1.0.0",
    items: await Promise.all(
      profiles
        .toSorted((left, right) =>
          left.revision.profile_id.localeCompare(right.revision.profile_id),
        )
        .map(projectSubagentCapabilityCatalogItem),
    ),
  });
  return { catalog, profiles };
}

function budget(maxToolCalls: number) {
  return {
    timeout_ms: 60_000,
    max_steps: maxToolCalls + 1,
    max_input_tokens: 8_192,
    max_output_tokens: 4_096,
    max_tool_calls: maxToolCalls,
    max_context_bytes: 32_768,
  };
}

function nativeCall(input: {
  readonly tool_call_id: string;
  readonly profile_id: (typeof profileIds)[number];
  readonly objective: string;
  readonly requested_artifact_types: readonly (
    | "AnalysisReport"
    | "QueryEvidence"
    | "SemanticQueryContext"
  )[];
  readonly input_artifact_refs?: readonly ArtifactReference[];
}) {
  const toolCounts = {
    "governed-analysis-agent": 1,
    "governed-text2sql-agent": 3,
    "report-writing-agent": 2,
    "semantic-management-agent": 1,
  } as const;
  return {
    tool_call_id: input.tool_call_id,
    tool_name: "delegate_to_subagent@2",
    arguments: {
      profile_id: input.profile_id,
      objective: input.objective,
      requested_artifact_types: [...input.requested_artifact_types].sort(),
      input_artifact_refs: input.input_artifact_refs ?? [],
      requested_budget: budget(toolCounts[input.profile_id]),
    },
  };
}

async function normalize(toolCalls: readonly ReturnType<typeof nativeCall>[]) {
  const { catalog, profiles } = await frozenAuthority();
  const decision = await normalizeRootAgentProviderTurn({
    scope,
    run_id: runId,
    catalog,
    output_text: "",
    tool_calls: toolCalls,
  });
  const admitted = await admitRootAgentDelegations({
    decision,
    catalog,
    profiles,
    run_ceiling: budget(8),
    profile_ceiling: (profile) => budget(profile.revision.direct_tool_allowlist.length),
    artifact_is_accepted: async () => true,
  });
  return { admitted, decision };
}

describe("Falcon24 E1 Root V3 routing boundary", () => {
  it("accepts a general concept as a direct Root answer with zero delegation", async () => {
    const { catalog } = await frozenAuthority();
    const decision = await normalizeRootAgentProviderTurn({
      scope,
      run_id: runId,
      catalog,
      output_text: JSON.stringify({
        kind: "FINAL_ANSWER",
        sections: [
          {
            kind: "GENERAL_TEXT",
            text: "同比增长是本期指标相对上年同期的变化比例。",
            basis: "GENERAL_KNOWLEDGE",
            source_message_refs: [],
          },
        ],
        public_summary: "解释同比增长。",
      }),
      tool_calls: [],
    });

    expect(decision).toMatchObject({ kind: "FINAL_ANSWER" });
  });

  it("admits relationship evidence through Semantic only and never Text2SQL", async () => {
    const { admitted } = await normalize([
      nativeCall({
        tool_call_id: "semantic-relationship",
        profile_id: "semantic-management-agent",
        objective: "从冻结 E1 Release 解释订单与客户的关系、Join 和血缘。",
        requested_artifact_types: ["SemanticQueryContext"],
      }),
    ]);

    expect(admitted.map(({ profile }) => profile.revision.profile_id)).toEqual([
      "semantic-management-agent",
    ]);
    expect(admitted[0]?.receipt.tool_allowlist).toEqual(["semantic.catalog.read"]);
  });

  it("admits a database aggregate through Text2SQL and requires QueryEvidence", async () => {
    const { admitted } = await normalize([
      nativeCall({
        tool_call_id: "aggregate-query",
        profile_id: "governed-text2sql-agent",
        objective: "查询当前受治理数据库的订单总量。",
        requested_artifact_types: ["QueryEvidence"],
      }),
    ]);

    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({
      profile: { revision: { profile_id: "governed-text2sql-agent" } },
      receipt: { requested_artifact_types: ["QueryEvidence"] },
    });
  });

  it("admits all five analytical objectives through sequential Root decisions", async () => {
    const objectives = [
      "复盘最近 18 个完整月经营表现并解释收入变化驱动。",
      "评估最近 12 个月配送体验并做调整后检验。",
      "识别最近 12 个月库存损坏异常并控制多重检验。",
      "评估营销投入对业务结果的滞后效应。",
      "分析客户 M0-M6 留存并披露观察窗口异常。",
    ];

    for (const [index, objective] of objectives.entries()) {
      const queryId = `query-${index + 1}`;
      const queryTurn = await normalize([
        nativeCall({
          tool_call_id: queryId,
          profile_id: "governed-text2sql-agent",
          objective: `为目标准备受治理数据：${objective}`,
          requested_artifact_types: ["QueryEvidence"],
        }),
      ]);
      const evidenceRef: ArtifactReference = {
        artifact_id: id(100 + index),
        artifact_type: "QueryEvidence",
        ...scope,
        run_id: runId,
        revision: 1,
        content_hash: hash(String((index + 1) % 10)),
      };
      const analysisTurn = await normalize([
        nativeCall({
          tool_call_id: `analysis-${index + 1}`,
          profile_id: "governed-analysis-agent",
          objective,
          requested_artifact_types: ["AnalysisReport"],
          input_artifact_refs: [evidenceRef],
        }),
      ]);

      expect(queryTurn.admitted.map(({ profile }) => profile.revision.profile_id)).toEqual([
        "governed-text2sql-agent",
      ]);
      expect(analysisTurn.admitted.map(({ profile }) => profile.revision.profile_id)).toEqual([
        "governed-analysis-agent",
      ]);
      expect(analysisTurn.admitted[0]?.receipt.input_artifact_refs).toEqual([evidenceRef]);
    }
  });

  it("passes an earlier accepted QueryEvidence to a later Report turn", async () => {
    const queryTurn = await normalize([
      nativeCall({
        tool_call_id: "report-query",
        profile_id: "governed-text2sql-agent",
        objective: "准备正式报告需要的已执行数据证据。",
        requested_artifact_types: ["QueryEvidence"],
      }),
    ]);
    const evidenceRef: ArtifactReference = {
      artifact_id: id(120),
      artifact_type: "QueryEvidence",
      ...scope,
      run_id: runId,
      revision: 1,
      content_hash: hash("e"),
    };
    const reportTurn = await normalize([
      nativeCall({
        tool_call_id: "formal-report",
        profile_id: "report-writing-agent",
        objective: "从已验收证据撰写正式报告。",
        requested_artifact_types: ["AnalysisReport"],
        input_artifact_refs: [evidenceRef],
      }),
    ]);

    expect(queryTurn.admitted).toHaveLength(1);
    expect(reportTurn.admitted[0]?.receipt.input_artifact_refs).toEqual([evidenceRef]);
  });

  it("keeps Direct QA and Falcon case-bound runtimes outside the production import boundary", async () => {
    const [workerEntry, provider, rootHarness, teamRuntime, teamTools, rootPackage, workerPackage] =
      await Promise.all([
        readFile(new URL("../../src/run-worker-cli.ts", import.meta.url), "utf8"),
        readFile(
          new URL("../../src/providers/direct-run-bound-provider-dispatcher.ts", import.meta.url),
          "utf8",
        ),
        readFile(
          new URL(
            "../../../../packages/agent-runtime/src/teams/root-agent-harness.ts",
            import.meta.url,
          ),
          "utf8",
        ),
        readFile(new URL("../../src/teams/production-team-runtime.ts", import.meta.url), "utf8"),
        readFile(new URL("../../src/teams/production-team-tools.ts", import.meta.url), "utf8"),
        readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
        readFile(new URL("../../package.json", import.meta.url), "utf8"),
      ]);
    const productionSources = [workerEntry, provider, rootHarness, teamRuntime, teamTools].join(
      "\n",
    );

    expect(provider).toContain("createRootModelProviderPort(providerInput)");
    expect(workerEntry).toContain("createProductionGovernedAnalysisRuntime");
    expect(workerEntry).toContain("governed_analysis: governedAnalysisRuntime");
    expect(workerEntry).not.toContain("falcon24-analysis-runtime");
    expect(workerEntry).not.toContain("falcon24-analysis-case-resolver");
    expect(productionSources).not.toMatch(
      /direct-qa-answer|asksForRelationships|classifyAgentQuestion/u,
    );
    expect(productionSources).not.toMatch(/query_kind|FALCON24_ANALYSIS_QUERY_SPECS/u);
    expect(productionSources).not.toMatch(/resolveFalcon24AnalysisCase/u);
    expect(rootPackage).not.toContain("falcon24:analysis:gate");
    expect(workerPackage).not.toContain("falcon24:analysis:gate");

    const retiredFiles = [
      "../../src/evals/falcon24-analysis-runtime.ts",
      "../../src/evals/falcon24-analysis-case-resolver.ts",
      "../../src/evals/falcon24-analysis-queries.ts",
      "../../src/evals/falcon24-analysis-program.ts",
      "../../src/evals/falcon24-analysis-data-oracle.ts",
      "../../src/evals/falcon24-arrow-backed-analysis-oracle.ts",
      "../../src/evals/falcon24-governed-agent-analysis.ts",
      "../../src/evals/falcon24-governed-query-port.ts",
      "../../src/evals/falcon24-analysis-acceptance-recorder.ts",
      "../../src/evals/falcon24-analysis-gate-cli.ts",
    ];
    await Promise.all(
      retiredFiles.map(async (path) => {
        await expect(access(new URL(path, import.meta.url))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }),
    );
  });
});
