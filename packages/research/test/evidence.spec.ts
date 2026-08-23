import {
  type AtomicClaimV2Payload,
  computeL2ResearchSemanticHash,
  type EvidenceRelationV2Payload,
  OBLIGATION_SEMANTIC_CHECKS,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  assessHypothesis,
  deriveEvidenceCheckReceipt,
  deriveSupportDecision,
  evaluateObligationExecution,
  materialSchemaFrontierMatches,
} from "../src/evidence.js";
import { hashes, reference } from "./fixtures.js";

const briefRef = reference("ResearchBrief", "41");
const planRef = reference("EvidencePlan", "42");
const hypothesisSetRef = reference("HypothesisSet", "43");
const obligationRef = {
  container_ref: planRef,
  node_id: "promotion-obligation",
};
const claimRef = reference("AtomicClaim", "44");
const evidenceRef = reference("QueryEvidence", "45");
const relationRef = reference("EvidenceRelation", "46");
const deterministicCheckRef = reference("EvidenceCheckReceipt", "47");
const provenanceCheckRef = reference("EvidenceCheckReceipt", "48");

function atomicClaim(): AtomicClaimV2Payload {
  return {
    artifact_type: "AtomicClaim",
    protocol_version: "atomic-claim@2.0.0",
    claim_id: "promotion-claim",
    observation_bindings: [
      {
        binding_id: "promotion-binding",
        evidence_ref: evidenceRef,
        metric_ref: {
          container_ref: reference("SemanticRelease", "49"),
          node_id: "promotion-share",
        },
        output_alias: "promotion_share",
        row_key_hash: hashes.a,
        observed_value: {
          value_kind: "NUMBER",
          number_value: 0.7,
          text_value: null,
          unit: "ratio",
        },
        time_window_hash: hashes.a,
        dimension_slice_hash: hashes.b,
        result_cell_hash: hashes.c,
      },
    ],
    predicate: {
      claim_mode: "DESCRIPTIVE",
      observation_binding_id: "promotion-binding",
      operator: "GTE",
      asserted_value: {
        value_kind: "NUMBER",
        number_value: 0.6,
        text_value: null,
        unit: "ratio",
      },
    },
    claim_renderer_version: "claim-test@1.0.0",
    statement: "促销贡献份额至少为 0.6。",
    statement_hash: hashes.a,
    evidence_refs: [evidenceRef],
    limitations: ["L2_NON_CAUSAL"],
  };
}

function relation(
  proposed_relation: EvidenceRelationV2Payload["proposed_relation"] = "SUPPORTS",
): EvidenceRelationV2Payload {
  return {
    artifact_type: "EvidenceRelation",
    protocol_version: "evidence-relation@2.0.0",
    claim_ref: claimRef,
    evidence_ref: evidenceRef,
    proposed_relation,
    rationale: "确定性 Observation Contract 的结果。",
    obligation_ref: obligationRef,
  };
}

describe("Evidence kernel", () => {
  it("从完整语义检查重算 OED，任何成功 SQL 的语义错配仍为 FAIL", async () => {
    const allMatch = Object.fromEntries(
      OBLIGATION_SEMANTIC_CHECKS.map((check) => [check, true]),
    ) as Record<(typeof OBLIGATION_SEMANTIC_CHECKS)[number], boolean>;
    const common = {
      brief_ref: briefRef,
      obligation_ref: obligationRef,
      query_contract_ref: reference("QueryContract", "50"),
      sql_artifact_ref: reference("SqlArtifact", "53"),
      semantic_release_ref: reference("SemanticRelease", "51"),
      policy_receipt_ref: reference("PolicyReceipt", "52"),
      observation_contract_hash: hashes.a,
      evaluator_version: "oed-test@1.0.0",
    } as const;
    const passed = await evaluateObligationExecution({
      ...common,
      matches: allMatch,
    });
    expect(passed).toMatchObject({ ok: true, value: { verdict: "PASS" } });

    const mismatched = await evaluateObligationExecution({
      ...common,
      matches: { ...allMatch, canonical_predicates: false },
    });
    expect(mismatched).toMatchObject({
      ok: true,
      value: {
        verdict: "FAIL",
        reason_codes: ["OBLIGATION_QUERY_SEMANTICS_MISMATCH"],
      },
    });
    if (!mismatched.ok) return;
    const reasons = [
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      "EVIDENCE_PLAN_REPLAN_REQUIRED",
    ] as const;
    const forward = await computeL2ResearchSemanticHash({
      ...mismatched.value,
      reason_codes: reasons,
    });
    const reversed = await computeL2ResearchSemanticHash({
      ...mismatched.value,
      reason_codes: [...reasons].reverse(),
    });
    expect(forward).toBe(reversed);
    expect(mismatched.value.decision_semantic_hash).toBe(
      await computeL2ResearchSemanticHash(mismatched.value),
    );
  });

  it("Relation 必须有恰好两类 PASS Check 才能生成 SUPPORTED 决策", async () => {
    const deterministic = await deriveEvidenceCheckReceipt({
      relation_ref: relationRef,
      check_kind: "DETERMINISTIC_CHECK",
      passed: true,
      observed_contract_hash: hashes.a,
      evaluated_refs: [relationRef],
      evaluator_version: "check-test@1.0.0",
    });
    const provenance = await deriveEvidenceCheckReceipt({
      relation_ref: relationRef,
      check_kind: "PROVENANCE_CHECK",
      passed: true,
      observed_contract_hash: hashes.a,
      evaluated_refs: [relationRef],
      evaluator_version: "check-test@1.0.0",
    });
    expect(deterministic.ok && provenance.ok).toBe(true);
    if (!deterministic.ok || !provenance.ok) return;

    const decision = await deriveSupportDecision({
      claim_ref: claimRef,
      claim: atomicClaim(),
      relations: [{ ref: relationRef, payload: relation() }],
      checks: [
        { ref: deterministicCheckRef, payload: deterministic.value },
        { ref: provenanceCheckRef, payload: provenance.value },
      ],
      evaluator_version: "support-test@1.0.0",
    });
    expect(decision).toMatchObject({
      ok: true,
      value: {
        decision: "SUPPORTED",
        obligation_refs: [obligationRef],
      },
    });

    const missingCheck = await deriveSupportDecision({
      claim_ref: claimRef,
      claim: atomicClaim(),
      relations: [{ ref: relationRef, payload: relation() }],
      checks: [{ ref: deterministicCheckRef, payload: deterministic.value }],
      evaluator_version: "support-test@1.0.0",
    });
    expect(missingCheck).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });
  });

  it.each([
    ["SUPPORTS", "QUALIFIES", "INSUFFICIENT"],
    ["SUPPORTS", "CONTEXT_ONLY", "INSUFFICIENT"],
    ["SUPPORTS", "REFUTES", "CONFLICTED"],
    ["REFUTES", "QUALIFIES", "INSUFFICIENT"],
  ] as const)(
    "混合 %s + %s Relation 不得升级为单向支持或反证",
    async (firstKind, secondKind, expectedDecision) => {
      const secondEvidenceRef = reference("QueryEvidence", "71");
      const secondRelationRef = reference("EvidenceRelation", "72");
      const firstBinding = atomicClaim().observation_bindings[0];
      if (!firstBinding) throw new Error("Mixed Relation fixture 缺失。");
      const claim: AtomicClaimV2Payload = {
        ...atomicClaim(),
        observation_bindings: [
          firstBinding,
          {
            ...firstBinding,
            binding_id: "mixed-relation-binding",
            evidence_ref: secondEvidenceRef,
            result_cell_hash: hashes.b,
          },
        ],
        predicate: {
          claim_mode: "COMPARATIVE",
          left_binding_id: firstBinding.binding_id,
          right_binding_id: "mixed-relation-binding",
          operator: "GTE",
          absolute_delta: 0,
          relative_delta: null,
        },
        evidence_refs: [evidenceRef, secondEvidenceRef],
      };
      const relations = [
        {
          ref: relationRef,
          payload: relation(firstKind),
        },
        {
          ref: secondRelationRef,
          payload: {
            ...relation(secondKind),
            evidence_ref: secondEvidenceRef,
          },
        },
      ];
      const receiptInputs = relations.flatMap(({ ref }) => [
        { relation_ref: ref, check_kind: "DETERMINISTIC_CHECK" as const },
        { relation_ref: ref, check_kind: "PROVENANCE_CHECK" as const },
      ]);
      const receipts = await Promise.all(
        receiptInputs.map(({ relation_ref, check_kind }) =>
          deriveEvidenceCheckReceipt({
            relation_ref,
            check_kind,
            passed: true,
            observed_contract_hash: hashes.a,
            evaluated_refs: [relation_ref],
            evaluator_version: "check-test@1.0.0",
          }),
        ),
      );
      if (receipts.some((receipt) => !receipt.ok)) {
        throw new Error("Mixed Relation receipt 生成失败。");
      }
      const checks = receipts.flatMap((receipt, index) =>
        receipt.ok
          ? [
              {
                ref: reference("EvidenceCheckReceipt", String(73 + index)),
                payload: receipt.value,
              },
            ]
          : [],
      );

      expect(
        await deriveSupportDecision({
          claim_ref: claimRef,
          claim,
          relations,
          checks,
          evaluator_version: "support-test@1.0.0",
        }),
      ).toMatchObject({
        ok: true,
        value: {
          decision: expectedDecision,
          reason_codes:
            expectedDecision === "CONFLICTED"
              ? ["MATERIAL_CONFLICT_UNDISCLOSED"]
              : ["EVIDENCE_SUPPORT_INSUFFICIENT"],
        },
      });
    },
  );

  it("拒绝同一 exact Claim×Evidence 同时声明冲突的 active Relation", async () => {
    const result = await deriveSupportDecision({
      claim_ref: claimRef,
      claim: atomicClaim(),
      relations: [
        { ref: relationRef, payload: relation("SUPPORTS") },
        {
          ref: reference("EvidenceRelation", "53"),
          payload: relation("CONFLICTS"),
        },
      ],
      checks: [],
      evaluator_version: "support-test@1.0.0",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_RELATION_IDENTITY_CONFLICT" },
    });
  });

  it("Claim 有两条 Evidence 时任一 current Check 失败都只能得到 INSUFFICIENT", async () => {
    const secondEvidenceRef = reference("QueryEvidence", "61");
    const secondRelationRef = reference("EvidenceRelation", "62");
    const firstBinding = atomicClaim().observation_bindings[0];
    if (!firstBinding) throw new Error("Evidence mixed-check fixture 缺失。");
    const secondBinding = {
      ...firstBinding,
      binding_id: "comparison-binding",
      evidence_ref: secondEvidenceRef,
      observed_value: {
        value_kind: "NUMBER" as const,
        number_value: 0.5,
        text_value: null,
        unit: "ratio",
      },
    };
    const delta = 0.7 - 0.5;
    const claim: AtomicClaimV2Payload = {
      ...atomicClaim(),
      observation_bindings: [firstBinding, secondBinding],
      predicate: {
        claim_mode: "COMPARATIVE",
        left_binding_id: firstBinding.binding_id,
        right_binding_id: secondBinding.binding_id,
        operator: "GTE",
        absolute_delta: delta,
        relative_delta: delta / 0.5,
      },
      evidence_refs: [evidenceRef, secondEvidenceRef],
    };
    const secondRelation: EvidenceRelationV2Payload = {
      ...relation(),
      evidence_ref: secondEvidenceRef,
    };
    const checkInputs = [
      [relationRef, "DETERMINISTIC_CHECK", true],
      [relationRef, "PROVENANCE_CHECK", true],
      [secondRelationRef, "DETERMINISTIC_CHECK", true],
      [secondRelationRef, "PROVENANCE_CHECK", false],
    ] as const;
    const checks = await Promise.all(
      checkInputs.map(([resolvedRelationRef, check_kind, passed]) =>
        deriveEvidenceCheckReceipt({
          relation_ref: resolvedRelationRef,
          check_kind,
          passed,
          observed_contract_hash: hashes.a,
          evaluated_refs: [resolvedRelationRef],
          evaluator_version: "check-test@1.0.0",
          ...(passed ? {} : { failure_reason: "EVIDENCE_SUPPORT_INSUFFICIENT" as const }),
        }),
      ),
    );
    if (checks.some((check) => !check.ok)) {
      throw new Error("Evidence mixed-check receipt 生成失败。");
    }
    const resolvedChecks = checks.flatMap((check, index) =>
      check.ok
        ? [
            {
              ref: reference("EvidenceCheckReceipt", String(63 + index)),
              payload: check.value,
            },
          ]
        : [],
    );
    expect(
      await deriveSupportDecision({
        claim_ref: claimRef,
        claim,
        relations: [
          { ref: relationRef, payload: relation() },
          { ref: secondRelationRef, payload: secondRelation },
        ],
        checks: resolvedChecks,
        evaluator_version: "support-test@1.0.0",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        decision: "INSUFFICIENT",
        reason_codes: ["EVIDENCE_SUPPORT_INSUFFICIENT"],
      },
    });
  });

  it("HypothesisAssessment 只消费自己的 Obligation Closure，并保留 unresolved", () => {
    const unresolved = assessHypothesis({
      hypothesis_ref: {
        container_ref: hypothesisSetRef,
        node_id: "promotion-mix",
      },
      decisions: [],
      hypothesis_obligation_refs: [obligationRef],
      unresolved_obligation_refs: [obligationRef],
    });
    expect(unresolved).toMatchObject({
      ok: true,
      value: {
        status: "UNRESOLVED",
        unresolved_obligation_refs: [obligationRef],
      },
    });

    const outsideObligation = {
      container_ref: reference("EvidencePlan", "54"),
      node_id: "outside",
    };
    expect(
      assessHypothesis({
        hypothesis_ref: {
          container_ref: hypothesisSetRef,
          node_id: "promotion-mix",
        },
        decisions: [],
        hypothesis_obligation_refs: [obligationRef],
        unresolved_obligation_refs: [outsideObligation],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });
  });

  it("Schema Frontier 使用完整 Reference identity，而不是只比较 artifact_id", () => {
    const schema = reference("SchemaSnapshot", "55");
    expect(
      materialSchemaFrontierMatches({ schema_snapshot_ref: schema }, [
        { schema_snapshot_ref: schema },
      ]),
    ).toBe(true);
    expect(
      materialSchemaFrontierMatches({ schema_snapshot_ref: schema }, [
        {
          schema_snapshot_ref: {
            ...schema,
            revision: 2,
            content_hash: hashes.b,
          },
        },
      ]),
    ).toBe(false);
  });
});
