import type { AtomicClaimV2Payload, ClaimObservationBinding } from "@data-agent/contracts";
import {
  assessHypothesisObservation,
  deriveContributionClosure,
  evaluateObservationPredicate,
} from "@data-agent/research";
import { describe, expect, it } from "vitest";
import { verifyAtomicClaimObservation } from "../src/observation.js";
import { hashes, reference } from "./fixtures.js";

function authoritativeCell(value = 200): ClaimObservationBinding {
  return {
    binding_id: "decline-cell",
    evidence_ref: reference("QueryEvidence", "31"),
    metric_ref: {
      container_ref: reference("SemanticRelease", "32"),
      node_id: "net-revenue-decline",
    },
    output_alias: "decline_amount",
    row_key_hash: hashes.a,
    observed_value: {
      value_kind: "NUMBER",
      number_value: value,
      text_value: null,
      unit: "yuan",
    },
    time_window_hash: hashes.b,
    dimension_slice_hash: hashes.c,
    result_cell_hash: hashes.a,
  };
}

function descriptiveClaim(cell: ClaimObservationBinding): AtomicClaimV2Payload {
  return {
    artifact_type: "AtomicClaim",
    protocol_version: "atomic-claim@2.0.0",
    claim_id: "decline-amount",
    observation_bindings: [cell],
    predicate: {
      claim_mode: "DESCRIPTIVE",
      observation_binding_id: cell.binding_id,
      operator: "EQ",
      asserted_value: cell.observed_value,
    },
    claim_renderer_version: "test-renderer@1.0.0",
    statement: "净收入下降金额为 200 元。",
    statement_hash: hashes.a,
    evidence_refs: [cell.evidence_ref],
    limitations: ["L2_NON_CAUSAL"],
  };
}

describe("Observation kernel", () => {
  it("闭合 Q1 金额与 Q2 份额，并拒绝依赖查询逐值不一致", () => {
    const valid = deriveContributionClosure({
      baseline_net_revenue: 1000,
      current_net_revenue: 800,
      decline_amount: 200,
      promotion_contribution: 140,
      late_refund_contribution: 20,
      other_contribution: 40,
      promotion_decline_share: 0.7,
      late_refund_decline_share: 0.1,
    });
    expect(valid).toEqual({
      ok: true,
      value: {
        decline_amount: 200,
        promotion_decline_share: 0.7,
        late_refund_decline_share: 0.1,
      },
    });
    expect(
      deriveContributionClosure({
        baseline_net_revenue: 1000,
        current_net_revenue: 800,
        decline_amount: 200,
        promotion_contribution: 140,
        late_refund_contribution: 20,
        other_contribution: 40,
        promotion_decline_share: 0.8,
        late_refund_decline_share: 0.1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
  });

  it("落实 NULL、有限数与 RATIO 分母语义", () => {
    expect(
      evaluateObservationPredicate({
        value: null,
        predicate: { operator: "EQ", threshold: 0 },
        null_behavior: "ZERO",
      }),
    ).toEqual({ ok: true, value: { matched: true, normalized_value: 0 } });
    expect(
      evaluateObservationPredicate({
        value: null,
        predicate: { operator: "EQ", threshold: 0 },
        null_behavior: "FAIL",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "OBSERVATION_NULL_REJECTED" },
    });
    expect(
      evaluateObservationPredicate({
        value: 1,
        predicate: { operator: "GTE", threshold: 0 },
        null_behavior: "FAIL",
        ratio_denominator: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "OBSERVATION_RATIO_DENOMINATOR_INVALID" },
    });
  });

  it("从互斥 Observation Predicate 导出 SURVIVED/REFUTED/UNRESOLVED", () => {
    const input = {
      support_predicate: { operator: "GTE" as const, threshold: 0.6 },
      refute_predicate: { operator: "LTE" as const, threshold: 0.3 },
      null_behavior: "FAIL" as const,
    };
    expect(assessHypothesisObservation({ ...input, value: 0.7 })).toEqual({
      ok: true,
      value: "SURVIVED",
    });
    expect(assessHypothesisObservation({ ...input, value: 0.1 })).toEqual({
      ok: true,
      value: "REFUTED",
    });
    expect(assessHypothesisObservation({ ...input, value: 0.45 })).toEqual({
      ok: true,
      value: "UNRESOLVED",
    });
  });

  it("AtomicClaim 必须逐字段闭合权威 Result Cell；改值或补外部证据都会失败", () => {
    const cell = authoritativeCell();
    const claim = descriptiveClaim(cell);
    expect(verifyAtomicClaimObservation(claim, [cell])).toEqual({
      ok: true,
      value: claim,
    });

    const changedCell: ClaimObservationBinding = {
      ...cell,
      observed_value: {
        value_kind: "NUMBER",
        number_value: 201,
        text_value: null,
        unit: "yuan",
      },
    };
    expect(
      verifyAtomicClaimObservation(
        {
          ...claim,
          observation_bindings: [changedCell],
          predicate: {
            claim_mode: "DESCRIPTIVE",
            observation_binding_id: changedCell.binding_id,
            operator: "EQ",
            asserted_value: changedCell.observed_value,
          },
        },
        [cell],
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
    expect(
      verifyAtomicClaimObservation(
        {
          ...claim,
          evidence_refs: [cell.evidence_ref, reference("QueryEvidence", "39")],
        },
        [cell],
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
  });

  it("DESCRIPTIVE GTE/LTE 按数值与单位执行，不能退化成 EQ", () => {
    const cell = authoritativeCell(200);
    const base = descriptiveClaim(cell);
    const threshold = {
      value_kind: "NUMBER" as const,
      number_value: 150,
      text_value: null,
      unit: "yuan",
    };
    expect(
      verifyAtomicClaimObservation(
        {
          ...base,
          predicate: {
            claim_mode: "DESCRIPTIVE",
            observation_binding_id: cell.binding_id,
            operator: "GTE",
            asserted_value: threshold,
          },
        },
        [cell],
      ),
    ).toMatchObject({ ok: true });
    expect(
      verifyAtomicClaimObservation(
        {
          ...base,
          predicate: {
            claim_mode: "DESCRIPTIVE",
            observation_binding_id: cell.binding_id,
            operator: "LTE",
            asserted_value: threshold,
          },
        },
        [cell],
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
  });

  it("COMPARATIVE 拒绝不同单位，即使数值与 delta 表面一致", () => {
    const left = authoritativeCell(200);
    const right: ClaimObservationBinding = {
      ...authoritativeCell(100),
      binding_id: "baseline-cell",
      evidence_ref: reference("QueryEvidence", "33"),
      observed_value: {
        value_kind: "NUMBER",
        number_value: 100,
        text_value: null,
        unit: "usd",
      },
    };
    const claim: AtomicClaimV2Payload = {
      ...descriptiveClaim(left),
      observation_bindings: [left, right],
      predicate: {
        claim_mode: "COMPARATIVE",
        left_binding_id: left.binding_id,
        right_binding_id: right.binding_id,
        operator: "GT",
        absolute_delta: 100,
        relative_delta: 1,
      },
      evidence_refs: [left.evidence_ref, right.evidence_ref],
    };
    expect(verifyAtomicClaimObservation(claim, [left, right])).toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
  });

  it("DIAGNOSTIC 要求 outcome 与全部 contribution 使用同一单位", () => {
    const outcome = authoritativeCell(200);
    const contributionA: ClaimObservationBinding = {
      ...authoritativeCell(140),
      binding_id: "promotion-cell",
      evidence_ref: reference("QueryEvidence", "34"),
      observed_value: {
        value_kind: "NUMBER",
        number_value: 140,
        text_value: null,
        unit: "yuan",
      },
    };
    const contributionB: ClaimObservationBinding = {
      ...authoritativeCell(60),
      binding_id: "refund-cell",
      evidence_ref: reference("QueryEvidence", "35"),
      observed_value: {
        value_kind: "NUMBER",
        number_value: 60,
        text_value: null,
        unit: "usd",
      },
    };
    const claim: AtomicClaimV2Payload = {
      ...descriptiveClaim(outcome),
      observation_bindings: [outcome, contributionA, contributionB],
      predicate: {
        claim_mode: "DIAGNOSTIC",
        outcome_change_binding_id: outcome.binding_id,
        contribution_binding_ids: [contributionA.binding_id, contributionB.binding_id],
        operator: "SUM_EQUALS",
        asserted_value: 200,
        tolerance: 0,
      },
      evidence_refs: [outcome.evidence_ref, contributionA.evidence_ref, contributionB.evidence_ref],
    };
    expect(
      verifyAtomicClaimObservation(claim, [outcome, contributionA, contributionB]),
    ).toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
  });

  it("AtomicClaim strict schema 拒绝未知字段", () => {
    const cell = authoritativeCell();
    const claim = {
      ...descriptiveClaim(cell),
      injected_verdict: "SUPPORTED",
    } as AtomicClaimV2Payload;
    expect(verifyAtomicClaimObservation(claim, [cell])).toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
  });
});
