import {
  type AtomicClaimV2Payload,
  artifactReferenceIdentity,
  atomicClaimV2PayloadSchema,
  type ClaimObservationBinding,
  type ClaimScalarValue,
  canonicalizeJson,
  type ObservationPredicate,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "./errors.js";

export interface ObservationEvaluationInput {
  readonly value: number | null;
  readonly predicate: ObservationPredicate;
  readonly null_behavior: "FAIL" | "IGNORE" | "ZERO";
  readonly ratio_denominator?: number | null;
}

export interface ObservationEvaluation {
  readonly matched: boolean;
  readonly normalized_value: number;
}

export function evaluateObservationPredicate(
  input: ObservationEvaluationInput,
): ResearchKernelResult<ObservationEvaluation> {
  if (
    input.ratio_denominator === 0 ||
    input.ratio_denominator === null ||
    (input.ratio_denominator !== undefined && !Number.isFinite(input.ratio_denominator))
  ) {
    return researchKernelFailure(
      "OBSERVATION_RATIO_DENOMINATOR_INVALID",
      "RATIO 分母必须是非零有限数。",
    );
  }

  let normalizedValue = input.value;
  if (normalizedValue === null) {
    if (input.null_behavior === "FAIL") {
      return researchKernelFailure(
        "OBSERVATION_NULL_REJECTED",
        "Observation Contract 拒绝 NULL 聚合标量。",
      );
    }
    if (input.null_behavior === "IGNORE") {
      return researchKernelFailure(
        "OBSERVATION_EMPTY_AFTER_NULL_FILTER",
        "忽略 NULL 后没有可用于 Predicate 的标量。",
      );
    }
    normalizedValue = 0;
  }
  if (!Number.isFinite(normalizedValue)) {
    return researchKernelFailure("ATOMIC_CLAIM_OBSERVATION_MISMATCH", "Observation 必须是有限数。");
  }

  let matched: boolean;
  switch (input.predicate.operator) {
    case "GT":
      matched = normalizedValue > input.predicate.threshold;
      break;
    case "GTE":
      matched = normalizedValue >= input.predicate.threshold;
      break;
    case "LT":
      matched = normalizedValue < input.predicate.threshold;
      break;
    case "LTE":
      matched = normalizedValue <= input.predicate.threshold;
      break;
    case "EQ":
      matched = normalizedValue === input.predicate.threshold;
      break;
    case "BETWEEN":
      matched =
        normalizedValue >= input.predicate.threshold[0] &&
        normalizedValue <= input.predicate.threshold[1];
      break;
  }
  return researchKernelSuccess({
    matched,
    normalized_value: normalizedValue,
  });
}

export interface HypothesisObservationInput {
  readonly value: number | null;
  readonly support_predicate: ObservationPredicate;
  readonly refute_predicate: ObservationPredicate;
  readonly null_behavior: "FAIL" | "IGNORE" | "ZERO";
}

export type HypothesisObservationStatus = "SURVIVED" | "REFUTED" | "UNRESOLVED";

export function assessHypothesisObservation(
  input: HypothesisObservationInput,
): ResearchKernelResult<HypothesisObservationStatus> {
  const support = evaluateObservationPredicate({
    value: input.value,
    predicate: input.support_predicate,
    null_behavior: input.null_behavior,
  });
  if (!support.ok) return support;
  const refute = evaluateObservationPredicate({
    value: input.value,
    predicate: input.refute_predicate,
    null_behavior: input.null_behavior,
  });
  if (!refute.ok) return refute;
  if (support.value.matched && refute.value.matched) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "Support 与 Refute Predicate 不能同时命中。",
    );
  }
  if (support.value.matched) return researchKernelSuccess("SURVIVED");
  if (refute.value.matched) return researchKernelSuccess("REFUTED");
  return researchKernelSuccess("UNRESOLVED");
}

export interface ContributionClosureInput {
  readonly baseline_net_revenue: number;
  readonly current_net_revenue: number;
  readonly decline_amount: number;
  readonly promotion_contribution: number;
  readonly late_refund_contribution: number;
  readonly other_contribution: number;
  readonly promotion_decline_share: number;
  readonly late_refund_decline_share: number;
}

export interface ContributionClosure {
  readonly decline_amount: number;
  readonly promotion_decline_share: number;
  readonly late_refund_decline_share: number;
}

export function deriveContributionClosure(
  input: ContributionClosureInput,
): ResearchKernelResult<ContributionClosure> {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value)) || input.decline_amount === 0) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "Controlled contribution 输入必须是有限数且 decline_amount 不能为零。",
    );
  }
  const observedDecline = input.baseline_net_revenue - input.current_net_revenue;
  const contributionSum =
    input.promotion_contribution + input.late_refund_contribution + input.other_contribution;
  const promotionShare = input.promotion_contribution / input.decline_amount;
  const lateRefundShare = input.late_refund_contribution / input.decline_amount;
  if (
    observedDecline !== input.decline_amount ||
    contributionSum !== input.decline_amount ||
    promotionShare !== input.promotion_decline_share ||
    lateRefundShare !== input.late_refund_decline_share
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "收入差额、贡献闭包与依赖查询份额必须逐值一致。",
    );
  }
  return researchKernelSuccess({
    decline_amount: observedDecline,
    promotion_decline_share: promotionShare,
    late_refund_decline_share: lateRefundShare,
  });
}

export interface AuthoritativeObservationCell extends ClaimObservationBinding {}

function scalarNumber(value: ClaimScalarValue): number | null {
  return value.value_kind === "NUMBER" ? value.number_value : null;
}

function scalarEqual(left: ClaimScalarValue, right: ClaimScalarValue): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function compare(operator: "GT" | "GTE" | "LT" | "LTE" | "EQ", left: number, right: number) {
  switch (operator) {
    case "GT":
      return left > right;
    case "GTE":
      return left >= right;
    case "LT":
      return left < right;
    case "LTE":
      return left <= right;
    case "EQ":
      return left === right;
  }
}

export function verifyAtomicClaimObservation(
  candidate: AtomicClaimV2Payload,
  authoritativeCells: readonly AuthoritativeObservationCell[],
): ResearchKernelResult<AtomicClaimV2Payload> {
  const parsedCandidate = atomicClaimV2PayloadSchema.safeParse(candidate);
  if (!parsedCandidate.success) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "AtomicClaim 必须通过 strict wire schema。",
    );
  }
  const claim = parsedCandidate.data;
  const authoritativeByBinding = new Map(authoritativeCells.map((cell) => [cell.binding_id, cell]));
  const candidateEvidence = [...new Set(claim.evidence_refs.map(artifactReferenceIdentity))].sort();
  const authoritativeEvidence = [
    ...new Set(
      authoritativeCells.map(({ evidence_ref }) => artifactReferenceIdentity(evidence_ref)),
    ),
  ].sort();
  if (
    authoritativeByBinding.size !== authoritativeCells.length ||
    authoritativeByBinding.size !== claim.observation_bindings.length ||
    canonicalizeJson(candidateEvidence) !== canonicalizeJson(authoritativeEvidence) ||
    claim.observation_bindings.some((binding) => {
      const authoritative = authoritativeByBinding.get(binding.binding_id);
      return (
        !authoritative ||
        artifactReferenceIdentity(binding.evidence_ref) !==
          artifactReferenceIdentity(authoritative.evidence_ref) ||
        canonicalizeJson(binding) !== canonicalizeJson(authoritative)
      );
    })
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "AtomicClaim 必须逐字段绑定权威 Result Cell。",
    );
  }

  const bindings = authoritativeByBinding;
  const predicate = claim.predicate;
  let predicateMatches = false;
  switch (predicate.claim_mode) {
    case "DESCRIPTIVE": {
      const observed = bindings.get(predicate.observation_binding_id)?.observed_value;
      if (observed !== undefined) {
        if (predicate.operator === "EQ") {
          predicateMatches = scalarEqual(observed, predicate.asserted_value);
        } else {
          const observedNumber = scalarNumber(observed);
          const assertedNumber = scalarNumber(predicate.asserted_value);
          predicateMatches =
            observedNumber !== null &&
            assertedNumber !== null &&
            observed.unit === predicate.asserted_value.unit &&
            compare(predicate.operator, observedNumber, assertedNumber);
        }
      }
      break;
    }
    case "COMPARATIVE": {
      const leftValue = bindings.get(predicate.left_binding_id)?.observed_value;
      const rightValue = bindings.get(predicate.right_binding_id)?.observed_value;
      const left = leftValue === undefined ? null : scalarNumber(leftValue);
      const right = rightValue === undefined ? null : scalarNumber(rightValue);
      if (
        leftValue !== undefined &&
        rightValue !== undefined &&
        left !== null &&
        right !== null &&
        leftValue.unit === rightValue.unit
      ) {
        const delta = left - right;
        const relative = right === 0 ? null : delta / Math.abs(right);
        predicateMatches =
          compare(predicate.operator, left, right) &&
          predicate.absolute_delta === delta &&
          predicate.relative_delta === relative;
      }
      break;
    }
    case "DIAGNOSTIC": {
      const outcomeValue = bindings.get(predicate.outcome_change_binding_id)?.observed_value;
      const contributionValues = predicate.contribution_binding_ids.map(
        (bindingId) => bindings.get(bindingId)?.observed_value,
      );
      const outcome = outcomeValue === undefined ? null : scalarNumber(outcomeValue);
      const contributions = contributionValues.map((value) =>
        value === undefined ? null : scalarNumber(value),
      );
      if (
        outcomeValue !== undefined &&
        outcome !== null &&
        contributionValues.every(
          (value): value is ClaimScalarValue =>
            value !== undefined && value.unit === outcomeValue.unit,
        ) &&
        contributions.every((value): value is number => value !== null) &&
        predicate.tolerance === 0
      ) {
        const contributionSum = contributions.reduce((sum, value) => sum + value, 0);
        predicateMatches =
          predicate.operator === "SUM_EQUALS"
            ? contributionSum === outcome && predicate.asserted_value === outcome
            : outcome !== 0 && predicate.asserted_value === contributionSum / outcome;
      }
      break;
    }
  }
  if (!predicateMatches) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "AtomicClaim Predicate 与权威 Observation 不一致。",
    );
  }
  return researchKernelSuccess(claim);
}
