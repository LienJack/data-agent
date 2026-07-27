import {
  type AtomicClaimRef,
  artifactReferenceIdentity,
  type CoverageStatePayload,
  type ProofObligationRef,
  type SupportDecisionPayload,
  type SupportDecisionRef,
} from "@data-agent/contracts";
import {
  type PreStopReadinessInput,
  type QueryCandidateFacts,
  unresolvedCoverageObligationRefs,
} from "@data-agent/research";
import { describe, expect, it, vi } from "vitest";
import {
  composeControlledResearchClosure,
  controlledResearchBriefPayload,
} from "../src/server/controlled-composition.js";
import { runControlledProtocolKernel } from "../src/server.js";
import { deriveResearchStopDecisionFromResolvedFactsCandidate } from "../src/stop.js";
import {
  controlledBaseEvaluation,
  controlledMutationCases,
  controlledPairCases,
} from "./controlled.js";
import { hashes, reference } from "./fixtures.js";

async function unresolvedFixture(): Promise<{
  readonly coverage: CoverageStatePayload;
  readonly support_resolutions: {
    readonly claim_ref: AtomicClaimRef;
    readonly support_decision_ref: SupportDecisionRef;
    readonly support_decision: SupportDecisionPayload;
  }[];
  readonly pre_stop_readiness: PreStopReadinessInput;
}> {
  const cases = await controlledMutationCases();
  const citation = cases.find(({ case_id }) => case_id === "citation-only");
  if (!citation) throw new Error("citation-only fixture 缺失。");
  const evaluation = await runControlledProtocolKernel(citation.kernel_input);
  const coverage = evaluation.artifact_candidates.coverage;
  if (!coverage) throw new Error("citation-only Coverage 缺失。");
  const closure = await composeControlledResearchClosure(citation.kernel_input);
  if ("error" in closure) throw new Error("citation-only closure 生成失败。");
  const materialEvidenceIdentities = new Set(
    closure.claim1.payload.evidence_refs.map(artifactReferenceIdentity),
  );
  return {
    coverage,
    support_resolutions: closure.supportResolutions.map(({ ref, payload }) => ({
      claim_ref: payload.claim_ref,
      support_decision_ref: ref,
      support_decision: payload,
    })),
    pre_stop_readiness: {
      brief: await controlledResearchBriefPayload(),
      material_query_evidence: closure.coverageInput.query_evidence
        .filter(({ ref }) => materialEvidenceIdentities.has(artifactReferenceIdentity(ref)))
        .map(({ payload }) => payload),
      supplied_disclosures: ["L2_NON_CAUSAL"],
    },
  };
}

function queryCandidate(
  suffix: string,
  obligations: readonly ProofObligationRef[],
  overrides: Partial<QueryCandidateFacts> = {},
): QueryCandidateFacts {
  return {
    query_contract_ref: reference("QueryContract", suffix),
    obligation_refs: [...obligations],
    semantic_admissible: true,
    expected_information_gain_microunits: 100,
    required_budget: {
      steps: 1,
      model_calls: 0,
      sql_executions: 1,
      source_calls: 0,
      elapsed_ms: 100,
      provider_tokens: 0,
      provider_cost_microusd: 0,
    },
    waiting_on_codes: [],
    reason_codes: ["EVIDENCE_COVERAGE_INSUFFICIENT"],
    ...overrides,
  };
}

describe("Research stop kernel", () => {
  it("基线只得到 STOP_READY Candidate；partial/continue/replan 三分支互斥", async () => {
    const [mutations, pairs] = await Promise.all([
      controlledMutationCases(),
      controlledPairCases(),
    ]);
    const partial = mutations.find(({ case_id }) => case_id === "citation-only");
    if (!partial) throw new Error("citation-only fixture 缺失。");
    const continuePair = pairs.find(({ case_id }) => case_id.endsWith("--continue"));
    const replanPair = pairs.find(({ case_id }) => case_id.endsWith("--replan"));
    if (!continuePair || !replanPair) throw new Error("pair fixture 缺失。");
    const [base, partialResult, continueResult, replanResult] = await Promise.all([
      controlledBaseEvaluation(),
      runControlledProtocolKernel(partial.kernel_input),
      runControlledProtocolKernel(continuePair.kernel_input),
      runControlledProtocolKernel(replanPair.kernel_input),
    ]);
    expect(base.stop_decision_candidate).toBe("STOP_READY");
    expect(partialResult.stop_decision_candidate).toBe("STOP_PARTIAL");
    expect(continueResult.stop_decision_candidate).toBe("CONTINUE");
    expect(replanResult.stop_decision_candidate).toBe("REPLAN");
  }, 60_000);

  it("相同 EIG 使用完整 QueryContract Reference identity 确定性 tie-break", async () => {
    const { coverage, support_resolutions, pre_stop_readiness } = await unresolvedFixture();
    const unresolved = unresolvedCoverageObligationRefs(coverage);
    const lowIdentity = queryCandidate("71", unresolved);
    const revisionVariant = {
      ...lowIdentity,
      query_contract_ref: {
        ...lowIdentity.query_contract_ref,
        revision: 2,
        content_hash: hashes.b,
      },
    };
    const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
      throw new Error("localeCompare 禁止用于协议排序");
    });
    const result = await deriveResearchStopDecisionFromResolvedFactsCandidate({
      coverage_ref: reference("CoverageState", "73"),
      coverage,
      candidate_queries: [revisionVariant, lowIdentity],
      support_resolutions,
      required_disclosures: ["L2_NON_CAUSAL"],
      pre_stop_readiness,
      enumerator_version: "test-enumerator@1.0.0",
      eig_policy_version: "test-eig@1.0.0",
    }).finally(() => localeCompare.mockRestore());
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.decision !== "CONTINUE") return;
    expect(artifactReferenceIdentity(result.value.selected_next_query_ref)).toBe(
      artifactReferenceIdentity(lowIdentity.query_contract_ref),
    );
  });

  it("WAITING_EXTERNAL_CAPABILITY 导出 NEEDS_MORE_RESEARCH，纯不可采纳候选导出 INCONCLUSIVE", async () => {
    const { coverage, support_resolutions, pre_stop_readiness } = await unresolvedFixture();
    const unresolved = unresolvedCoverageObligationRefs(coverage);
    const common = {
      coverage_ref: reference("CoverageState", "74"),
      coverage,
      support_resolutions,
      required_disclosures: ["L2_NON_CAUSAL"],
      pre_stop_readiness,
      enumerator_version: "test-enumerator@1.0.0",
      eig_policy_version: "test-eig@1.0.0",
    } as const;
    const waiting = await deriveResearchStopDecisionFromResolvedFactsCandidate({
      ...common,
      candidate_queries: [
        queryCandidate("75", unresolved, {
          waiting_on_codes: ["EXTERNAL_PROVIDER"],
        }),
      ],
    });
    expect(waiting).toMatchObject({
      ok: true,
      value: {
        decision: "STOP_NEEDS_MORE_RESEARCH",
        non_ready_terminal: "NEEDS_MORE_RESEARCH",
      },
    });

    const inconclusive = await deriveResearchStopDecisionFromResolvedFactsCandidate({
      ...common,
      candidate_queries: [
        queryCandidate("76", unresolved, {
          semantic_admissible: false,
          expected_information_gain_microunits: 0,
        }),
      ],
    });
    expect(inconclusive).toMatchObject({
      ok: true,
      value: {
        decision: "STOP_INCONCLUSIVE",
        non_ready_terminal: "INCONCLUSIVE",
      },
    });

    expect(
      await deriveResearchStopDecisionFromResolvedFactsCandidate({
        ...common,
        candidate_queries: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });
  });

  it("STALE Coverage 被拒绝并要求平台撤销，不默认降级为 PARTIAL", async () => {
    const cases = await controlledMutationCases();
    const stale = cases.find(({ case_id }) => case_id === "stale-cross-revision");
    if (!stale) throw new Error("stale fixture 缺失。");
    const evaluation = await runControlledProtocolKernel(stale.kernel_input);
    expect(evaluation.stop_decision_candidate).toBeNull();
    expect(evaluation.kernel_outcome).toMatchObject({
      kind: "REVOCATION_REQUIRED",
      reason_code: "EVIDENCE_REVISION_STALE",
    });
  });

  it("拒绝不属于 Coverage exact closure 的 supported Claim/Decision 注入", async () => {
    const { coverage, support_resolutions, pre_stop_readiness } = await unresolvedFixture();
    const unresolved = unresolvedCoverageObligationRefs(coverage);
    const [firstResolution, ...remainingResolutions] = support_resolutions;
    if (!firstResolution) throw new Error("Controlled support closure 为空。");
    const result = await deriveResearchStopDecisionFromResolvedFactsCandidate({
      coverage_ref: reference("CoverageState", "77"),
      coverage,
      candidate_queries: [queryCandidate("78", unresolved)],
      support_resolutions: [
        {
          ...firstResolution,
          support_decision_ref: reference("SupportDecision", "79"),
        },
        ...remainingResolutions,
      ],
      required_disclosures: ["L2_NON_CAUSAL"],
      pre_stop_readiness,
      enumerator_version: "test-enumerator@1.0.0",
      eig_policy_version: "test-eig@1.0.0",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });
  });

  it("拒绝省略 Coverage 中任一 material Support resolution", async () => {
    const { coverage, support_resolutions, pre_stop_readiness } = await unresolvedFixture();
    const unresolved = unresolvedCoverageObligationRefs(coverage);
    expect(support_resolutions.length).toBeGreaterThan(1);
    const result = await deriveResearchStopDecisionFromResolvedFactsCandidate({
      coverage_ref: reference("CoverageState", "80"),
      coverage,
      candidate_queries: [queryCandidate("81", unresolved)],
      support_resolutions: support_resolutions.slice(0, 1),
      required_disclosures: ["L2_NON_CAUSAL"],
      pre_stop_readiness,
      enumerator_version: "test-enumerator@1.0.0",
      eig_policy_version: "test-eig@1.0.0",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });
  });

  it("JS 调用伪造 Coverage counts 或 Support payload 时 fail-close", async () => {
    const { coverage, support_resolutions, pre_stop_readiness } = await unresolvedFixture();
    const forgedCoverage = {
      ...coverage,
      obligations: coverage.obligations.map((obligation) => ({
        ...obligation,
        state: "SATISFIED" as const,
        reason_codes: ["OBLIGATION_SATISFIED" as const],
      })),
      derived_counts: {
        ...coverage.derived_counts,
        critical_open: 0,
        critical_satisfied: coverage.derived_counts.critical_total,
        critical_failed: 0,
      },
    };
    const common = {
      coverage_ref: reference("CoverageState", "82"),
      candidate_queries: [],
      support_resolutions,
      required_disclosures: ["L2_NON_CAUSAL"],
      pre_stop_readiness,
      enumerator_version: "test-enumerator@1.0.0",
      eig_policy_version: "test-eig@1.0.0",
    } as const;
    expect(
      await deriveResearchStopDecisionFromResolvedFactsCandidate({
        ...common,
        coverage: forgedCoverage,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });
    const [firstResolution, ...rest] = support_resolutions;
    if (!firstResolution) throw new Error("Support resolution 缺失。");
    expect(
      await deriveResearchStopDecisionFromResolvedFactsCandidate({
        ...common,
        coverage,
        support_resolutions: [
          {
            ...firstResolution,
            support_decision: {
              ...firstResolution.support_decision,
              forged_authority: true,
            } as typeof firstResolution.support_decision,
          },
          ...rest,
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });
    expect(
      await deriveResearchStopDecisionFromResolvedFactsCandidate({
        ...common,
        coverage,
        support_resolutions: [
          {
            ...firstResolution,
            support_decision: {
              ...firstResolution.support_decision,
              evaluator_version: "tampered-support@1.0.0",
            },
          },
          ...rest,
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });
  });

  it("malformed runtime input 与负数/NaN Candidate Budget 均 fail-close 而不抛异常", async () => {
    expect(await deriveResearchStopDecisionFromResolvedFactsCandidate(null as never)).toMatchObject(
      {
        ok: false,
        error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
      },
    );
    const { coverage, support_resolutions, pre_stop_readiness } = await unresolvedFixture();
    const unresolved = unresolvedCoverageObligationRefs(coverage);
    const common = {
      coverage_ref: reference("CoverageState", "83"),
      coverage,
      support_resolutions,
      required_disclosures: ["L2_NON_CAUSAL"],
      pre_stop_readiness,
      enumerator_version: "test-enumerator@1.0.0",
      eig_policy_version: "test-eig@1.0.0",
    } as const;
    for (const maliciousCandidate of [
      queryCandidate("84", unresolved, {
        required_budget: {
          steps: -1,
          model_calls: 0,
          sql_executions: 0,
          source_calls: 0,
          elapsed_ms: 0,
          provider_tokens: 0,
          provider_cost_microusd: 0,
        },
      }),
      queryCandidate("85", unresolved, {
        expected_information_gain_microunits: Number.NaN,
      }),
    ]) {
      expect(
        await deriveResearchStopDecisionFromResolvedFactsCandidate({
          ...common,
          candidate_queries: [maliciousCandidate],
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
      });
    }
  });
});
