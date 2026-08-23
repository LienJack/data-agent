import { describe, expect, it } from "vitest";
import {
  computeSchemaFeaturePacketDigest,
  computeSemanticChangeProposalDigest,
  schemaFeaturePacketMaterialSchema,
  semanticCandidateOperationSchema,
  semanticChangeProposalMaterialSchema,
  semanticCompileRequestSchema,
  semanticEvidenceRefSchema,
} from "../src/artifacts/semantic-candidate-generation.js";

const id = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";
const hash = `sha256:${"a".repeat(64)}`;

function operation() {
  return {
    schema_version: "semantic-candidate-operation@1.0.0",
    operation_id: id,
    action: "CREATE",
    target_type: "BUSINESS_ENTITY_TYPE",
    target_id: "order",
    payload: {
      entity_id: "order",
      name: "Order",
      aliases: ["订单"],
      domain: "commerce",
      owner: "data-platform",
      lifecycle: "active",
      business_relationship_types: [],
    },
    evidence_refs: ["evidence.order"],
    field_evidence: { name: ["evidence.order"] },
    confidence: 0.91,
    assumptions: [],
    open_questions: [],
    impact: {
      risk_level: "LOW",
      affected_object_ids: ["order"],
      summary: "新增订单业务实体候选。",
    },
  } as const;
}

describe("semantic candidate generation contracts", () => {
  it("keeps compile requests free of server authority fields", () => {
    const request = {
      schema_version: "semantic-compile-request@1.0.0",
      semantic_domain: "commerce",
      snapshot_id: id,
      idempotency_key: id2,
    } as const;

    expect(semanticCompileRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      semanticCompileRequestSchema.parse({ ...request, snapshot_digest: hash }),
    ).toThrow();
    expect(() =>
      semanticCompileRequestSchema.parse({ ...request, principal: "attacker" }),
    ).toThrow();
  });

  it("accepts typed operations and rejects arbitrary execution material", () => {
    expect(semanticCandidateOperationSchema.parse(operation())).toEqual(operation());
    expect(() =>
      semanticCandidateOperationSchema.parse({ ...operation(), sql: "DROP TABLE orders" }),
    ).toThrow();
    expect(() =>
      semanticCandidateOperationSchema.parse({ ...operation(), action: "PUBLISH" }),
    ).toThrow();
  });

  it("requires payloads for writes and forbids replacement payloads for MARK_STALE", () => {
    expect(() =>
      semanticCandidateOperationSchema.parse({ ...operation(), payload: null }),
    ).toThrow();
    expect(() =>
      semanticCandidateOperationSchema.parse({ ...operation(), action: "MARK_STALE" }),
    ).toThrow();
    expect(
      semanticCandidateOperationSchema.parse({
        ...operation(),
        action: "MARK_STALE",
        payload: null,
      }).action,
    ).toBe("MARK_STALE");
  });

  it("binds evidence source kinds to structured locators", () => {
    const evidence = {
      evidence_id: "evidence.order",
      source_kind: "PHYSICAL_SCHEMA",
      source_id: id,
      source_digest: hash,
      locator: {
        locator_kind: "PHYSICAL_RELATION",
        relation: { schema_name: "public", relation_name: "orders" },
      },
      observation: "存在 orders 表。",
      confidence: 1,
    } as const;
    expect(semanticEvidenceRefSchema.parse(evidence)).toEqual(evidence);
    expect(() =>
      semanticEvidenceRefSchema.parse({ ...evidence, source_kind: "DOCUMENT_CHUNK" }),
    ).toThrow();
  });

  it("produces stable feature and proposal digests", async () => {
    const packet = schemaFeaturePacketMaterialSchema.parse({
      schema_version: "schema-feature-packet@1.0.0",
      scope: {
        app_id: id,
        tenant_id: id2,
        environment: "development",
        semantic_domain: "commerce",
      },
      snapshot_id: id,
      snapshot_digest: hash,
      drift_event_id: null,
      drift_digest: null,
      base_release: null,
      features: [],
    });
    expect(await computeSchemaFeaturePacketDigest(packet)).toBe(
      await computeSchemaFeaturePacketDigest({ ...packet }),
    );

    const proposal = semanticChangeProposalMaterialSchema.parse({
      schema_version: "semantic-change-proposal@1.0.0",
      compile_run_id: id,
      source_revision_id: id2,
      feature_digest: await computeSchemaFeaturePacketDigest(packet),
      snapshot_id: id,
      snapshot_digest: hash,
      drift_event_id: null,
      drift_digest: null,
      base_release: null,
      agent_receipt: {
        provider_id: "openai",
        model_id: "gpt-5",
        model_profile_digest: hash,
        prompt_digest: hash,
        tool_policy_digest: hash,
        compiler_digest: hash,
        candidate_policy_digest: hash,
      },
      evidence: [
        {
          evidence_id: "evidence.order",
          source_kind: "PHYSICAL_SCHEMA",
          source_id: id,
          source_digest: hash,
          locator: {
            locator_kind: "PHYSICAL_RELATION",
            relation: { schema_name: "public", relation_name: "orders" },
          },
          observation: "存在 orders 表。",
          confidence: 1,
        },
      ],
      operations: [operation()],
      summary: "从物理模式生成业务实体候选。",
    });
    const digest = await computeSemanticChangeProposalDigest(proposal);
    expect(digest).toBe(await computeSemanticChangeProposalDigest({ ...proposal }));
    expect(digest).not.toBe(
      await computeSemanticChangeProposalDigest({ ...proposal, summary: "不同摘要" }),
    );
  });
});
