import {
  buildProductTeamArtifactDocument,
  buildSemanticQueryContext,
  type RootAgentDecisionCandidate,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createRootAnswerVerifier,
  rootAnswerVerifierInternals,
} from "../../src/teams/root-answer-verifier.js";

const id = (suffix: number) => `97000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

async function report() {
  return buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: id(10),
      artifact_type: "AnalysisReport",
      ...scope,
      run_id: id(3),
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "semantic-management-agent",
    task_id: id(11),
    source_refs: [],
    provenance: null,
    projection: {
      kind: "REPORT",
      title: "冻结语义图关系证据",
      sections: [
        {
          heading: "关系",
          body_text: "[JOIN] orders -> customers",
          source_refs: [],
        },
      ],
    },
    committed_at: "2026-08-22T12:00:00.000Z",
  });
}

async function semanticContextDocument() {
  const datasourceId = id(30);
  const context = await buildSemanticQueryContext({
    schema_version: "semantic-query-context@1.0.0",
    scope,
    run_id: id(3),
    semantic_domain: "commerce",
    semantic_release: {
      resource_id: id(31),
      resource_revision: 2,
      resource_hash: hash("3"),
      datasource_id: datasourceId,
      semantic_generation: 2,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(32),
      resource_revision: 4,
      resource_hash: hash("4"),
      datasource_id: datasourceId,
      semantic_release_id: id(31),
      semantic_generation: 2,
    },
    datasource: { resource_id: datasourceId, resource_revision: 1, resource_hash: hash("5") },
    semantic_context_ref: {
      package_id: id(33),
      package_hash: hash("6"),
      receipt_id: id(34),
      receipt_hash: hash("7"),
      retrieval_receipt_hash: hash("8"),
      inference_receipt_hash: hash("9"),
    },
    requested_object_ids: [],
    metrics: [],
    dimensions: [],
    formulas: [],
    relationships: [],
    physical_bindings: [],
    time_semantics: [],
    quality_constraints: [],
    unresolved_ambiguities: [],
  });
  return buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: id(35),
      artifact_type: "SemanticQueryContext",
      ...scope,
      run_id: id(3),
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "semantic-management-agent",
    task_id: id(36),
    source_refs: [],
    provenance: null,
    projection: { kind: "SEMANTIC_CONTEXT", context },
    committed_at: "2026-08-27T12:00:00.000Z",
  });
}

describe("Root answer verifier", () => {
  it("accepts general knowledge without requiring a Subagent", async () => {
    const verifier = createRootAnswerVerifier({
      artifacts: { resolveCommitted: async () => ({ ok: true, value: null }) },
    });
    const candidate: RootAgentDecisionCandidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "FINAL_ANSWER",
      scope,
      run_id: id(3),
      catalog_snapshot_hash: hash("1"),
      sections: [
        {
          kind: "GENERAL_TEXT",
          text: "同比是与上年同一时期比较。",
          basis: "GENERAL_KNOWLEDGE",
          source_message_refs: [],
        },
      ],
      public_summary: "主 Agent 直接解释通用概念。",
    };
    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [],
        accepted_artifact_refs: [],
      }),
    ).resolves.toMatchObject({
      status: "ACCEPTED",
      rendered_text: "同比是与上年同一时期比较。",
    });
  });

  it("accepts provided context only when the cited message is frozen as visible", async () => {
    const verifier = createRootAnswerVerifier({
      artifacts: { resolveCommitted: async () => ({ ok: true, value: null }) },
    });
    const messageId = id(20);
    const candidate: RootAgentDecisionCandidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "FINAL_ANSWER",
      scope,
      run_id: id(3),
      catalog_snapshot_hash: hash("1"),
      sections: [
        {
          kind: "GENERAL_TEXT",
          text: "你刚才要求优先读取语义图。",
          basis: "PROVIDED_CONTEXT",
          source_message_refs: [messageId],
        },
      ],
      public_summary: "主 Agent 根据可见用户消息直接回答。",
    };
    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [],
        accepted_artifact_refs: [],
      }),
    ).resolves.toMatchObject({
      status: "EVIDENCE_REQUIRED",
      reason_code: "ROOT_ANSWER_MESSAGE_SOURCE_NOT_VISIBLE",
    });
    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [messageId],
        accepted_artifact_refs: [],
      }),
    ).resolves.toMatchObject({
      status: "ACCEPTED",
      rendered_text: "你刚才要求优先读取语义图。",
    });
  });

  it("requires the exact accepted Artifact before rendering workspace facts", async () => {
    const document = await report();
    const verifier = createRootAnswerVerifier({
      artifacts: { resolveCommitted: async () => ({ ok: true, value: document }) },
    });
    const candidate: RootAgentDecisionCandidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "FINAL_ANSWER",
      scope,
      run_id: id(3),
      catalog_snapshot_hash: hash("1"),
      sections: [
        {
          kind: "ARTIFACT_FACTS",
          artifact_ref: document.artifact_ref,
          fact_selectors: ["projection.sections"],
        },
      ],
      public_summary: "基于已验收语义图证据回答。",
    };
    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [],
        accepted_artifact_refs: [],
      }),
    ).resolves.toMatchObject({
      status: "EVIDENCE_REQUIRED",
      reason_code: "ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED",
    });
    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [],
        accepted_artifact_refs: [document.artifact_ref],
      }),
    ).resolves.toMatchObject({
      status: "ACCEPTED",
      rendered_text: "[JOIN] orders -> customers",
    });
  });

  it("rejects an accepted-looking Artifact from another Run before repository access", async () => {
    const document = await report();
    const resolveCommitted = vi.fn(async () => ({ ok: true as const, value: document }));
    const verifier = createRootAnswerVerifier({ artifacts: { resolveCommitted } });
    const staleRef = { ...document.artifact_ref, run_id: id(99) };
    const candidate: RootAgentDecisionCandidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "FINAL_ANSWER",
      scope,
      run_id: id(3),
      catalog_snapshot_hash: hash("1"),
      sections: [
        {
          kind: "ARTIFACT_FACTS",
          artifact_ref: staleRef,
          fact_selectors: ["projection.sections"],
        },
      ],
      public_summary: "拒绝跨 Run 证据。",
    };

    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [],
        accepted_artifact_refs: [staleRef],
      }),
    ).resolves.toMatchObject({
      status: "EVIDENCE_REQUIRED",
      reason_code: "ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED",
    });
    expect(resolveCommitted).not.toHaveBeenCalled();
  });

  it("renders semantic-only answers from exact Host-projected facts", async () => {
    const document = await semanticContextDocument();
    const verifier = createRootAnswerVerifier({
      artifacts: { resolveCommitted: async () => ({ ok: true, value: document }) },
    });
    const candidate: RootAgentDecisionCandidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "FINAL_ANSWER",
      scope,
      run_id: id(3),
      catalog_snapshot_hash: hash("1"),
      sections: [
        {
          kind: "ARTIFACT_FACTS",
          artifact_ref: document.artifact_ref,
          fact_selectors: ["projection.context.semantic_release"],
        },
      ],
      public_summary: "基于 Host 投影的语义版本回答。",
    };
    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [],
        accepted_artifact_refs: [document.artifact_ref],
      }),
    ).resolves.toMatchObject({
      status: "ACCEPTED",
      rendered_text: expect.stringContaining(id(31)),
    });
  });

  it("renders only the friendly current-Run explanation for request-scoped semantics", () => {
    const explanation =
      "订单收入同比按月汇总后，与上年同月比较；上年同期为0时返回空值。该解释只用于当前请求。";
    const rendered = rootAnswerVerifierInternals.renderArtifactFacts(
      {
        projection: {
          kind: "SEMANTIC_CONTEXT",
          context: {
            request_scoped_interpretations: [{ user_explanation: explanation }],
          },
        },
      } as never,
      ["projection.context.request_scoped_interpretations"],
    );

    expect(rendered).toBe(explanation);
    expect(rendered).not.toMatch(/索引|未受治理|INDEX_NOT_FOUND/u);
  });

  it("renders governed metric and relationship facts as readable semantic evidence", () => {
    const rendered = rootAnswerVerifierInternals.renderArtifactFacts(
      {
        projection: {
          kind: "SEMANTIC_CONTEXT",
          context: {
            metrics: [
              {
                metric_id: "metric.average_order_value",
                name: "客单价",
                aggregation: "avg",
                grain: { granularity: "order" },
                formula: { expression: "AVG(orders.amount)" },
                time_domain: null,
              },
              {
                metric_id: "metric.customer_order_total",
                name: "客户订单总金额",
                aggregation: "sum",
                grain: { granularity: "customer" },
                formula: { expression: "SUM(orders.amount)" },
                time_domain: null,
              },
            ],
            relationships: [
              {
                relationship_id: "relationship.order_customer",
                name: "订单客户",
                left_table_id: "orders",
                left_column_ids: ["customer_id"],
                right_table_id: "customers",
                right_column_ids: ["id"],
                cardinality: "many-to-one",
              },
            ],
          },
        },
      } as never,
      ["projection.context.metrics", "projection.context.relationships"],
    );

    expect(rendered).toContain("指标「客单价」");
    expect(rendered).toContain("正式公式：AVG(orders.amount)");
    expect(rendered).toContain("指标「客户订单总金额」");
    expect(rendered).toContain("粒度 customer；正式公式：SUM(orders.amount)");
    expect(rendered).toContain("orders[customer_id] → customers[id]");
  });

  it("renders the governed complete-period boundary instead of hiding it behind an id", () => {
    const rendered = rootAnswerVerifierInternals.renderArtifactFacts(
      {
        projection: {
          kind: "SEMANTIC_CONTEXT",
          context: {
            time_semantics: [
              {
                time_domain_id: "time.complete_month_frontier",
                calendar: "gregorian",
                timezone: "Asia/Shanghai",
                description: "Observed complete-month frontier; windows are half-open.",
              },
            ],
          },
        },
      } as never,
      ["projection.context.time_semantics"],
    );

    expect(rendered).toContain("Observed complete-month frontier; windows are half-open.");
  });
});
