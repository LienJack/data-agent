import {
  groundingPackageSchema,
  logicalPlanSchema,
  semanticQuerySchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  createGroundingPackagePayload,
  createLogicalPlanPayload,
  createSemanticQueryPayload,
} from "../src/artifacts/payload-projection.js";
import { groundQueryContract } from "../src/grounding/ground-query-contract.js";
import { buildLogicalPlan } from "../src/planning/build-logical-plan.js";
import { validateLogicalPlan } from "../src/planning/validate-logical-plan.js";
import { buildSemanticQuery } from "../src/semantic/build-semantic-query.js";
import {
  analystPolicy,
  artifactReference,
  commerceCatalog,
  netRevenueContract,
} from "./support/commerce-fixture.js";

async function readyDrafts() {
  const result = await groundQueryContract({
    query_contract: netRevenueContract(),
    catalog: commerceCatalog,
    policy: analystPolicy,
    retrieval_candidates: [
      { object_id: "metric.net_revenue", score: 1 },
      { object_id: "dimension.customer_segment", score: 0.9 },
    ],
    max_context_objects: 32,
  });
  if (result.state !== "READY") {
    throw new Error(`测试 Fixture 必须完成 Grounding，实际为 ${result.state}。`);
  }
  const semanticQuery = buildSemanticQuery({
    query_contract: netRevenueContract(),
    grounding: result.grounding,
  });
  const logicalPlan = buildLogicalPlan({
    semantic_query: semanticQuery,
    grounding: result.grounding,
  });
  const validation = validateLogicalPlan({
    logical_plan: logicalPlan,
    grounding: result.grounding,
    semantic_query: semanticQuery,
    query_contract: netRevenueContract(),
  });
  if (validation.state !== "VALID") {
    throw new Error(`测试 Fixture 的 LogicalPlan 必须通过验证：${validation.reason_code}`);
  }
  return {
    grounding: result.grounding,
    semanticQuery,
    logicalPlan: validation.logical_plan,
  };
}

describe("Text2SQL 公共 Artifact Payload 投影", () => {
  it("把 Grounding draft 与四个完整权威引用投影为严格公共 Payload", async () => {
    const { grounding } = await readyDrafts();
    const payload = createGroundingPackagePayload({
      draft: grounding,
      query_contract_ref: artifactReference("QueryContract"),
      semantic_release_ref: artifactReference("SemanticRelease"),
      schema_snapshot_ref: artifactReference("SchemaSnapshot"),
      policy_receipt_ref: artifactReference("PolicyReceipt"),
    });

    expect(groundingPackageSchema.parse(payload)).toEqual(payload);
    expect(payload).toMatchObject({
      artifact_type: "GroundingPackage",
      grounding_hash: grounding.grounding_hash,
      query_contract_ref: {
        artifact_type: "QueryContract",
      },
      semantic_release_ref: {
        artifact_type: "SemanticRelease",
      },
      schema_snapshot_ref: {
        artifact_type: "SchemaSnapshot",
      },
      policy_receipt_ref: {
        artifact_type: "PolicyReceipt",
      },
    });
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it("把 SemanticQuery draft 与 QueryContract/GroundingPackage 引用投影为严格公共 Payload", async () => {
    const { semanticQuery } = await readyDrafts();
    const payload = createSemanticQueryPayload({
      draft: semanticQuery,
      query_contract_ref: artifactReference("QueryContract"),
      grounding_package_ref: artifactReference("GroundingPackage"),
    });

    expect(semanticQuerySchema.parse(payload)).toEqual(payload);
    expect(payload).toMatchObject({
      artifact_type: "SemanticQuery",
      grounding_hash: semanticQuery.grounding_hash,
      query_contract_ref: { artifact_type: "QueryContract" },
      grounding_package_ref: { artifact_type: "GroundingPackage" },
    });
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it("把 LogicalPlan draft 与完整 SemanticQuery 引用投影为严格公共 Payload", async () => {
    const { logicalPlan } = await readyDrafts();
    const payload = createLogicalPlanPayload({
      draft: logicalPlan,
      semantic_query_ref: artifactReference("SemanticQuery"),
    });

    expect(logicalPlanSchema.parse(payload)).toEqual(payload);
    expect(payload).toMatchObject({
      artifact_type: "LogicalPlan",
      grounding_hash: logicalPlan.grounding_hash,
      semantic_query_ref: {
        artifact_type: "SemanticQuery",
      },
    });
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it("任一 draft 注入公共 Schema 未声明字段时失败关闭", async () => {
    const { grounding } = await readyDrafts();

    expect(() =>
      createGroundingPackagePayload({
        draft: { ...grounding, unauthorized_projection: true },
        query_contract_ref: artifactReference("QueryContract"),
        semantic_release_ref: artifactReference("SemanticRelease"),
        schema_snapshot_ref: artifactReference("SchemaSnapshot"),
        policy_receipt_ref: artifactReference("PolicyReceipt"),
      } as never),
    ).toThrow();
  });

  it("缺字段或 Artifact 类型错误的引用不能穿过投影边界", async () => {
    const { semanticQuery, logicalPlan } = await readyDrafts();

    expect(() =>
      createSemanticQueryPayload({
        draft: semanticQuery,
        query_contract_ref: artifactReference("QueryContract"),
        grounding_package_ref: {
          artifact_type: "GroundingPackage",
          artifact_id: "10000000-0000-4000-8000-000000000005",
        },
      } as never),
    ).toThrow();

    expect(() =>
      createLogicalPlanPayload({
        draft: logicalPlan,
        semantic_query_ref: artifactReference("QueryContract"),
      } as never),
    ).toThrow();
  });

  it("未经确定性验证的 LogicalPlan Candidate 不能投影为公共 Artifact", async () => {
    const { grounding, semanticQuery } = await readyDrafts();
    const candidate = buildLogicalPlan({
      semantic_query: semanticQuery,
      grounding,
    });

    expect(() =>
      createLogicalPlanPayload({
        draft: candidate,
        semantic_query_ref: artifactReference("SemanticQuery"),
      } as never),
    ).toThrow("LOGICAL_PLAN_VALIDATION_REQUIRED");
  });
});
