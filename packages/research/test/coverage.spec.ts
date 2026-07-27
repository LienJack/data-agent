import { unresolvedCoverageObligationRefs } from "@data-agent/research";
import { describe, expect, it } from "vitest";
import {
  type DeriveCoverageStateResolvedFactsInput as DeriveCoverageStateInput,
  deriveCoverageStateFromResolvedFactsCandidate as deriveCoverageStateCandidate,
} from "../src/coverage.js";
import {
  composeControlledResearchClosure,
  runControlledProtocolKernel,
} from "../src/server/controlled-composition.js";
import { materializeControlledProtocolInput } from "../src/server.js";
import { controlledHandle, controlledMutationCases } from "./controlled.js";
import { reference } from "./fixtures.js";

async function resolvedCoverageInput(): Promise<DeriveCoverageStateInput> {
  const input = materializeControlledProtocolInput(await controlledHandle());
  const closure = await composeControlledResearchClosure(input);
  if ("error" in closure) throw new Error("Controlled closure 生成失败。");
  return closure.coverageInput;
}

async function expectClosureRejected(input: DeriveCoverageStateInput) {
  expect(await deriveCoverageStateCandidate(input)).toMatchObject({
    ok: false,
    error: { code: "COVERAGE_INPUT_INVALID" },
  });
}

describe("Coverage kernel", () => {
  it("从 resolved artifact closure 重算两项 CRITICAL SATISFIED 与稳定 hash", async () => {
    const input = await resolvedCoverageInput();
    const [first, second] = await Promise.all([
      deriveCoverageStateCandidate(input),
      deriveCoverageStateCandidate(input),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const coverage = first.value;
    expect(coverage.derived_counts).toMatchObject({
      critical_total: 2,
      critical_satisfied: 2,
      critical_open: 0,
      critical_blocked: 0,
      critical_failed: 0,
      critical_stale: 0,
    });
    expect(coverage.obligations.map(({ state }) => state)).toEqual(["SATISFIED", "SATISFIED"]);
    expect(coverage.coverage_input_hash).toBe(second.value.coverage_input_hash);
    expect(unresolvedCoverageObligationRefs(coverage)).toEqual([]);
  });

  it("状态优先级为 STALE > FAILED > BLOCKED > SATISFIED > OPEN", async () => {
    const cases = await controlledMutationCases();
    const hiddenConflict = cases.find(({ case_id }) => case_id === "hidden-conflict");
    const stale = cases.find(({ case_id }) => case_id === "stale-cross-revision");
    const budget = cases.find(({ case_id }) => case_id === "budget-false-complete");
    if (!hiddenConflict || !stale || !budget) {
      throw new Error("Controlled mutation fixture 不完整。");
    }

    const [conflictResult, staleResult, budgetResult] = await Promise.all([
      runControlledProtocolKernel(hiddenConflict.kernel_input),
      runControlledProtocolKernel(stale.kernel_input),
      runControlledProtocolKernel(budget.kernel_input),
    ]);
    expect(conflictResult.artifact_candidates.coverage?.obligations[1]).toMatchObject({
      state: "FAILED",
      reason_codes: ["MATERIAL_CONFLICT_UNDISCLOSED"],
    });
    expect(conflictResult.artifact_candidates.coverage?.material_conflict_refs).toHaveLength(1);

    expect(staleResult.artifact_candidates.coverage?.obligations.map(({ state }) => state)).toEqual(
      ["STALE", "STALE"],
    );
    expect(staleResult.kernel_outcome.kind).toBe("REVOCATION_REQUIRED");

    const budgetCoverage = budgetResult.artifact_candidates.coverage;
    if (!budgetCoverage) throw new Error("budget Coverage 缺失。");
    expect(unresolvedCoverageObligationRefs(budgetCoverage)).toHaveLength(1);
    expect(budgetResult.artifact_candidates.coverage?.obligations[1]).toMatchObject({
      state: "OPEN",
      reason_codes: ["EVIDENCE_COVERAGE_INSUFFICIENT"],
    });
    expect(budgetResult.stop_decision_candidate).toBe("STOP_PARTIAL");
  }, 30_000);

  it("Coverage 重放与 Support builder 对 SUPPORTS + REFUTES 保持同一 CONFLICTED 分类", async () => {
    const hiddenConflict = (await controlledMutationCases()).find(
      ({ case_id }) => case_id === "hidden-conflict",
    );
    if (!hiddenConflict) throw new Error("hidden-conflict fixture 缺失。");
    const closure = await composeControlledResearchClosure(hiddenConflict.kernel_input);
    if ("error" in closure) throw new Error("hidden-conflict closure 生成失败。");

    const conflictRelation = closure.coverageInput.evidence_relations.find(
      ({ payload }) => payload.proposed_relation === "CONFLICTS",
    );
    if (!conflictRelation) throw new Error("CONFLICTS Relation 缺失。");
    const result = await deriveCoverageStateCandidate({
      ...closure.coverageInput,
      evidence_relations: closure.coverageInput.evidence_relations.map((relation) =>
        relation.ref.artifact_id === conflictRelation.ref.artifact_id
          ? {
              ...relation,
              payload: {
                ...relation.payload,
                proposed_relation: "SUPPORTS",
              },
            }
          : relation,
      ),
    });
    if (!result.ok) throw new Error(result.error.message);

    expect(result).toMatchObject({
      ok: true,
      value: {
        obligations: expect.arrayContaining([
          expect.objectContaining({
            state: "FAILED",
            reason_codes: ["MATERIAL_CONFLICT_UNDISCLOSED"],
          }),
        ]),
      },
    });
  }, 30_000);

  it("拒绝跨 Obligation OED 与不属于 Claim evidence_refs 的 Relation", async () => {
    const base = await resolvedCoverageInput();
    const [firstEvidence, secondEvidence] = base.query_evidence;
    const [firstOed, secondOed] = base.obligation_execution_decisions;
    const [firstRelation] = base.evidence_relations;
    if (!firstEvidence || !secondEvidence || !firstOed || !secondOed || !firstRelation) {
      throw new Error("Coverage attack fixture 不完整。");
    }
    await expectClosureRejected({
      ...base,
      query_evidence: [
        {
          ...firstEvidence,
          payload: {
            ...firstEvidence.payload,
            obligation_execution_decision_ref: secondOed.ref,
          },
        },
        secondEvidence,
      ],
    });
    await expectClosureRejected({
      ...base,
      evidence_relations: [
        {
          ...firstRelation,
          payload: {
            ...firstRelation.payload,
            evidence_ref: secondEvidence.ref,
          },
        },
        ...base.evidence_relations.slice(1),
      ],
    });
    await expectClosureRejected({
      ...base,
      query_evidence: [
        firstEvidence,
        {
          ...secondEvidence,
          payload: {
            ...secondEvidence.payload,
            dependency_evidence_refs: [],
          },
        },
      ],
    });
    await expectClosureRejected({
      ...base,
      obligation_execution_decisions: [
        {
          ...firstOed,
          payload: {
            ...firstOed.payload,
            verdict: "FAIL",
            reason_codes: ["OBLIGATION_QUERY_SEMANTICS_MISMATCH"],
          },
        },
        ...base.obligation_execution_decisions.slice(1),
      ],
    });
  });

  it("依赖边允许从同一依赖 Obligation 的多张 QE 中精确选择一张，但不能漏边或一边选两张", async () => {
    const base = await resolvedCoverageInput();
    const [firstEvidence, secondEvidence] = base.query_evidence;
    if (!firstEvidence || !secondEvidence) {
      throw new Error("Coverage dependency fixture 不完整。");
    }
    const additionalEvidence = {
      ref: reference("QueryEvidence", "91"),
      payload: firstEvidence.payload,
    };
    expect(
      await deriveCoverageStateCandidate({
        ...base,
        query_evidence: [firstEvidence, additionalEvidence, secondEvidence],
      }),
    ).toMatchObject({ ok: true });

    await expectClosureRejected({
      ...base,
      query_evidence: [
        firstEvidence,
        additionalEvidence,
        {
          ...secondEvidence,
          payload: {
            ...secondEvidence.payload,
            dependency_evidence_refs: [firstEvidence.ref, additionalEvidence.ref],
          },
        },
      ],
    });
  });

  it("执行失败通过 raw failure resolution 导出 FAILED，不伪造成功 QueryEvidence", async () => {
    const failureCase = (await controlledMutationCases()).find(
      ({ case_id }) => case_id === "critical-query-failure",
    );
    if (!failureCase) throw new Error("critical-query-failure fixture 缺失。");
    const closure = await composeControlledResearchClosure(failureCase.kernel_input);
    if ("error" in closure) throw new Error("critical-query-failure closure 生成失败。");
    expect(closure.coverageInput.execution_failure_resolutions).toHaveLength(1);
    expect(closure.coverageInput.query_evidence).toHaveLength(1);

    const evaluation = await runControlledProtocolKernel(failureCase.kernel_input);
    expect(evaluation.artifact_candidates.coverage?.obligations[1]).toMatchObject({
      state: "FAILED",
      query_evidence_refs: [],
      support_decision_refs: [],
      reason_codes: ["CRITICAL_OBLIGATION_FAILED"],
    });
  });

  it("拒绝 Support→Relation/Check 跨闭包及 Relation 缺失/重复 DET+PROV", async () => {
    const base = await resolvedCoverageInput();
    const [firstSupport] = base.support_decisions;
    const [, secondRelation] = base.evidence_relations;
    const [, , secondDeterministic, secondProvenance] = base.evidence_checks;
    const [firstCheck, secondCheck] = base.evidence_checks;
    if (
      !firstSupport ||
      !secondRelation ||
      !secondDeterministic ||
      !secondProvenance ||
      !firstCheck ||
      !secondCheck
    ) {
      throw new Error("Coverage support/check fixture 不完整。");
    }
    await expectClosureRejected({
      ...base,
      support_decisions: [
        {
          ...firstSupport,
          payload: {
            ...firstSupport.payload,
            relation_refs: [secondRelation.ref],
            check_receipt_refs: [secondDeterministic.ref, secondProvenance.ref],
          },
        },
        ...base.support_decisions.slice(1),
      ],
    });
    await expectClosureRejected({
      ...base,
      evidence_checks: base.evidence_checks.filter(
        ({ ref }) => ref.artifact_id !== secondCheck.ref.artifact_id,
      ),
    });
    await expectClosureRejected({
      ...base,
      evidence_checks: [
        firstCheck,
        {
          ...secondCheck,
          payload: {
            ...secondCheck.payload,
            check_kind: "DETERMINISTIC_CHECK",
          },
        },
        ...base.evidence_checks.slice(2),
      ],
    });
    await expectClosureRejected({
      ...base,
      support_decisions: base.support_decisions.slice(1),
    });
  });

  it("拒绝重复 exact ref 的不同 payload 与跨 Hypothesis Support", async () => {
    const base = await resolvedCoverageInput();
    const [firstOed] = base.obligation_execution_decisions;
    const [firstAssessment] = base.hypothesis_assessments;
    const [, secondSupport] = base.support_decisions;
    if (!firstOed || !firstAssessment || !secondSupport) {
      throw new Error("Coverage duplicate/hypothesis fixture 不完整。");
    }
    await expectClosureRejected({
      ...base,
      obligation_execution_decisions: [
        ...base.obligation_execution_decisions,
        {
          ref: firstOed.ref,
          payload: {
            ...firstOed.payload,
            verdict: "FAIL",
            reason_codes: ["OBLIGATION_QUERY_SEMANTICS_MISMATCH"],
          },
        },
      ],
    });
    await expectClosureRejected({
      ...base,
      hypothesis_assessments: [
        {
          ...firstAssessment,
          payload: {
            ...firstAssessment.payload,
            support_decision_refs: [secondSupport.ref],
          },
        },
        ...base.hypothesis_assessments.slice(1),
      ],
    });
  });

  it("outer resolved Reference 必须 strict、同 Scope，且不能交换 Ref×Payload 配对", async () => {
    const base = await resolvedCoverageInput();
    const [firstEvidence, secondEvidence] = base.query_evidence;
    if (!firstEvidence || !secondEvidence) {
      throw new Error("Coverage outer-ref fixture 不完整。");
    }
    await expectClosureRejected({
      ...base,
      query_evidence: [
        {
          ...firstEvidence,
          ref: {
            ...firstEvidence.ref,
            tenant_id: "00000000-0000-4000-8000-000000000099",
          },
        },
        secondEvidence,
      ],
    });
    await expectClosureRejected({
      ...base,
      query_evidence: [
        { ref: secondEvidence.ref, payload: firstEvidence.payload },
        { ref: firstEvidence.ref, payload: secondEvidence.payload },
      ],
    });
    await expectClosureRejected({
      ...base,
      query_evidence: [
        {
          ...firstEvidence,
          injected_authority: true,
        } as typeof firstEvidence,
        secondEvidence,
      ],
    });
  });

  it("拒绝 Support decision/reason 伪造与 Assessment 漏 Support/伪 status", async () => {
    const base = await resolvedCoverageInput();
    const [firstSupport] = base.support_decisions;
    const [firstAssessment] = base.hypothesis_assessments;
    if (!firstSupport || !firstAssessment) {
      throw new Error("Coverage semantic fixture 不完整。");
    }
    await expectClosureRejected({
      ...base,
      support_decisions: [
        {
          ...firstSupport,
          payload: {
            ...firstSupport.payload,
            decision: "INSUFFICIENT",
            reason_codes: ["EVIDENCE_SUPPORT_INSUFFICIENT"],
          },
        },
        ...base.support_decisions.slice(1),
      ],
    });
    await expectClosureRejected({
      ...base,
      hypothesis_assessments: [
        {
          ...firstAssessment,
          payload: {
            ...firstAssessment.payload,
            support_decision_refs: [],
            status: "UNRESOLVED",
            unresolved_obligation_refs: [
              base.evidence_plan.obligations[0]
                ? {
                    container_ref: base.evidence_plan_ref,
                    node_id: base.evidence_plan.obligations[0].obligation_id,
                  }
                : {
                    container_ref: base.evidence_plan_ref,
                    node_id: "missing",
                  },
            ],
            reason_codes: ["EVIDENCE_COVERAGE_INSUFFICIENT"],
          },
        },
        ...base.hypothesis_assessments.slice(1),
      ],
    });
  });

  it("拒绝同 Claim×Evidence 多 active Relation 与重复 Blocker", async () => {
    const base = await resolvedCoverageInput();
    const [firstRelation] = base.evidence_relations;
    const [firstObligation] = base.evidence_plan.obligations;
    if (!firstRelation || !firstObligation) {
      throw new Error("Coverage relation/blocker fixture 不完整。");
    }
    await expectClosureRejected({
      ...base,
      evidence_relations: [
        ...base.evidence_relations,
        {
          ref: reference("EvidenceRelation", "88"),
          payload: {
            ...firstRelation.payload,
            proposed_relation: "CONFLICTS",
          },
        },
      ],
    });
    const blocker = {
      obligation_ref: {
        container_ref: base.evidence_plan_ref,
        node_id: firstObligation.obligation_id,
      },
      waiting_on_codes: ["EXTERNAL_PROVIDER"],
    };
    await expectClosureRejected({
      ...base,
      blockers: [blocker, { ...blocker }],
    });
  });

  it("拒绝 Claim adverse evidence 无 Relation，或 Support 省略该 Claim 的任一 Relation", async () => {
    const base = await resolvedCoverageInput();
    const [firstClaim] = base.atomic_claims;
    const [, secondEvidence] = base.query_evidence;
    if (!firstClaim || !secondEvidence) {
      throw new Error("Coverage adverse-evidence fixture 不完整。");
    }
    const firstBinding = firstClaim.payload.observation_bindings[0];
    if (!firstBinding) throw new Error("AtomicClaim observation binding 缺失。");
    await expectClosureRejected({
      ...base,
      atomic_claims: [
        {
          ...firstClaim,
          payload: {
            ...firstClaim.payload,
            evidence_refs: [...firstClaim.payload.evidence_refs, secondEvidence.ref],
            observation_bindings: [
              ...firstClaim.payload.observation_bindings,
              {
                ...firstBinding,
                binding_id: "adverse-evidence-binding",
                evidence_ref: secondEvidence.ref,
              },
            ],
          },
        },
        ...base.atomic_claims.slice(1),
      ],
    });

    const mutations = await controlledMutationCases();
    const hiddenConflict = mutations.find(({ case_id }) => case_id === "hidden-conflict");
    if (!hiddenConflict) throw new Error("hidden-conflict fixture 缺失。");
    const conflictClosure = await composeControlledResearchClosure(hiddenConflict.kernel_input);
    if ("error" in conflictClosure) throw new Error("hidden-conflict closure 生成失败。");
    const conflictSupport = conflictClosure.coverageInput.support_decisions[1];
    if (!conflictSupport) throw new Error("hidden-conflict SupportDecision 缺失。");
    await expectClosureRejected({
      ...conflictClosure.coverageInput,
      support_decisions: [
        conflictClosure.coverageInput.support_decisions[0] as typeof conflictSupport,
        {
          ...conflictSupport,
          payload: {
            ...conflictSupport.payload,
            relation_refs: conflictSupport.payload.relation_refs.slice(0, 1),
            check_receipt_refs: conflictSupport.payload.check_receipt_refs.slice(0, 2),
          },
        },
      ],
    });
  });

  it("JS 调用方伪造 authority-shaped payload 的未知字段时 strict fail-close", async () => {
    const base = await resolvedCoverageInput();
    const [firstSupport] = base.support_decisions;
    if (!firstSupport) throw new Error("Support fixture 缺失。");
    await expectClosureRejected({
      ...base,
      support_decisions: [
        {
          ...firstSupport,
          payload: {
            ...firstSupport.payload,
            forged_authority: true,
          } as typeof firstSupport.payload,
        },
        ...base.support_decisions.slice(1),
      ],
    });
  });
});
