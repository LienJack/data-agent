import {
  evidencePlanV2PayloadSchema,
  hypothesisSetV2PayloadSchema,
  researchBriefV2PayloadSchema,
} from "@data-agent/contracts";
import {
  compileEvidencePlanCandidate as compileEvidencePlanFromDocumentsCandidate,
  compileHypothesisSetCandidate,
  compileResearchBriefCandidate,
} from "@data-agent/research";
import { describe, expect, it } from "vitest";
import {
  compileEvidencePlanFromResolvedFactsCandidate as compileEvidencePlanCandidate,
  type EvidencePlanResolvedFactsInput,
} from "../src/planning.js";
import { deriveExactResearchDocumentRef, sealResearchDocument } from "./document-fixtures.js";
import { hypotheses, reference, researchBriefInput } from "./fixtures.js";

async function compiledPlanningClosure() {
  const brief = await compileResearchBriefCandidate(researchBriefInput());
  if (!brief.ok) {
    throw new Error("规划测试前置 Brief Candidate 生成失败。");
  }
  const brief_document = await sealResearchDocument(brief.value, 21);
  const brief_ref = await deriveExactResearchDocumentRef(brief_document, "ResearchBrief");
  const hypothesisSet = await compileHypothesisSetCandidate({
    brief_ref,
    hypotheses: hypotheses(),
    mechanism_validator_version: "mechanism-validator@1.0.0",
  });
  if (!hypothesisSet.ok) {
    throw new Error("规划测试前置 HypothesisSet Candidate 生成失败。");
  }
  const hypothesis_set_document = await sealResearchDocument(hypothesisSet.value, 22);
  const hypothesis_set_ref = await deriveExactResearchDocumentRef(
    hypothesis_set_document,
    "HypothesisSet",
  );
  const observation = (
    alias: "promotion-share" | "refund-share",
    support: number,
    refute: number,
  ) => ({
    metric_ref: {
      container_ref: reference("SemanticRelease", "23"),
      node_id: alias,
    },
    aggregation: "RATIO" as const,
    unit: "ratio",
    support_predicate: { operator: "GTE" as const, threshold: support },
    refute_predicate: { operator: "LTE" as const, threshold: refute },
    null_behavior: "FAIL" as const,
  });
  const obligations: EvidencePlanResolvedFactsInput["obligations"] = [
    {
      obligation_id: "promotion-obligation",
      hypothesis_refs: [{ container_ref: hypothesis_set_ref, node_id: "promotion-mix" }],
      success_criterion_refs: [{ container_ref: brief_ref, node_id: "explain-decline" }],
      discriminating_test_ids: ["promotion-share"],
      materiality: "CRITICAL",
      evidence_kind: "QUERY",
      depends_on: [],
      observation_contract: observation("promotion-share", 0.6, 0.3),
      failure_behavior: "BLOCK_READY",
    },
    {
      obligation_id: "refund-obligation",
      hypothesis_refs: [{ container_ref: hypothesis_set_ref, node_id: "late-refund" }],
      success_criterion_refs: [{ container_ref: brief_ref, node_id: "explain-decline" }],
      discriminating_test_ids: ["refund-share"],
      materiality: "CRITICAL",
      evidence_kind: "QUERY",
      depends_on: [{ node_id: "promotion-obligation" }],
      observation_contract: observation("refund-share", 0.4, 0.2),
      failure_behavior: "BLOCK_READY",
    },
  ];
  return {
    brief_ref,
    hypothesis_set_ref,
    brief_document,
    hypothesis_set_document,
    brief: brief.value,
    hypothesisSet: hypothesisSet.value,
    obligations,
  };
}

describe("Research planning kernel", () => {
  it("生成 strict ResearchBrief@2 Candidate，且不声称已提交", async () => {
    const result = await compileResearchBriefCandidate(researchBriefInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(researchBriefV2PayloadSchema.parse(result.value)).toEqual(result.value);
    expect(result.value).not.toHaveProperty("status");
    expect(result.value).not.toHaveProperty("is_committed");
  });

  it("从候选事实重算 Hypothesis Universe Hash，并拒绝机制坍缩", async () => {
    const input = {
      brief_ref: reference("ResearchBrief", "21"),
      hypotheses: hypotheses(),
      mechanism_validator_version: "mechanism-validator@1.0.0",
    } as const;
    const first = await compileHypothesisSetCandidate(input);
    const second = await compileHypothesisSetCandidate(input);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(hypothesisSetV2PayloadSchema.parse(first.value)).toEqual(first.value);

    const original = input.hypotheses[0];
    if (!original) throw new Error("Hypothesis fixture 为空。");
    const collapsed = await compileHypothesisSetCandidate({
      ...input,
      hypotheses: [
        original,
        {
          ...original,
          hypothesis_id: "copy",
          statement: "换一段文本也不能绕过机制等价检查",
          discriminating_test_ids: ["copy-test"],
        },
      ],
    });
    expect(collapsed).toMatchObject({
      ok: false,
      error: { code: "HYPOTHESIS_COLLAPSE" },
    });
  });

  it("生成完整无环 EvidencePlan@2，并重算 Observation Contract Hash", async () => {
    const closure = await compiledPlanningClosure();
    const plan = await compileEvidencePlanFromDocumentsCandidate({
      brief_document: closure.brief_document,
      hypothesis_set_document: closure.hypothesis_set_document,
      planner_version: "planner@1.0.0",
      obligations: closure.obligations,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(evidencePlanV2PayloadSchema.parse(plan.value)).toEqual(plan.value);
    expect(plan.value.obligations).toHaveLength(2);
    expect(plan.value.obligations[0]?.observation_contract.contract_hash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it("Document-backed EvidencePlan 拒绝保留 exact Reference 但替换自洽 Brief/Hypothesis payload", async () => {
    const closure = await compiledPlanningClosure();
    const alternativeBrief = await compileResearchBriefCandidate({
      ...researchBriefInput(),
      scope: {
        ...researchBriefInput().scope,
        subject: "替换后的自洽研究范围",
      },
    });
    if (!alternativeBrief.ok) throw new Error(alternativeBrief.error.message);
    expect(
      await compileEvidencePlanFromDocumentsCandidate({
        brief_document: {
          ...closure.brief_document,
          payload: alternativeBrief.value,
        },
        hypothesis_set_document: closure.hypothesis_set_document,
        obligations: closure.obligations,
        planner_version: "planner@1.0.0",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });

    const [firstHypothesis, ...remainingHypotheses] = hypotheses();
    if (!firstHypothesis) throw new Error("Hypothesis fixture 为空。");
    const alternative = await compileHypothesisSetCandidate({
      brief_ref: closure.brief_ref,
      hypotheses: [
        {
          ...firstHypothesis,
          mechanism_class: "forged-mechanism",
          statement: "替换后的自洽假设宇宙",
          predictions: ["替换 prediction"],
          falsifiers: ["替换 falsifier"],
        },
        ...remainingHypotheses,
      ],
      mechanism_validator_version: "mechanism-validator@1.0.0",
    });
    if (!alternative.ok) throw new Error(alternative.error.message);

    expect(
      await compileEvidencePlanFromDocumentsCandidate({
        brief_document: closure.brief_document,
        hypothesis_set_document: {
          ...closure.hypothesis_set_document,
          payload: alternative.value,
        },
        obligations: closure.obligations,
        planner_version: "planner@1.0.0",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });
  });

  it("拒绝悬空依赖、成环、不完整覆盖与 MATERIAL/CRITICAL 降级", async () => {
    const closure = await compiledPlanningClosure();
    const common = {
      brief_ref: closure.brief_ref,
      hypothesis_set_ref: closure.hypothesis_set_ref,
      brief_payload: closure.brief,
      hypothesis_set_payload: closure.hypothesisSet,
      planner_version: "planner@1.0.0",
    } as const;
    const [firstObligation, secondObligation] = closure.obligations;
    if (!firstObligation || !secondObligation) {
      throw new Error("EvidencePlan obligation fixture 不完整。");
    }
    const dangling = await compileEvidencePlanCandidate({
      ...common,
      obligations: [
        {
          ...firstObligation,
          depends_on: [{ node_id: "missing" }],
        },
        secondObligation,
      ],
    });
    expect(dangling).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_REPLAN_REQUIRED" },
    });

    const cyclic = await compileEvidencePlanCandidate({
      ...common,
      obligations: [
        {
          ...firstObligation,
          depends_on: [{ node_id: "refund-obligation" }],
        },
        secondObligation,
      ],
    });
    expect(cyclic).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });

    const incomplete = await compileEvidencePlanCandidate({
      ...common,
      obligations: [firstObligation],
    });
    expect(incomplete).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });

    const downgraded = await compileEvidencePlanCandidate({
      ...common,
      obligations: [
        {
          ...firstObligation,
          materiality: "SUPPORTING",
        },
        secondObligation,
      ],
    });
    expect(downgraded).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });
  });

  it("允许多 Test 分拆与 Criterion 重用，并拒绝 ALTERNATIVE Test 重复/错配", async () => {
    const closure = await compiledPlanningClosure();
    const [firstObligation, secondObligation] = closure.obligations;
    const [firstHypothesis] = closure.hypothesisSet.hypotheses;
    if (!firstObligation || !secondObligation || !firstHypothesis) {
      throw new Error("Planning split fixture 不完整。");
    }
    const { planning_status: _firstPlanningStatus, ...firstHypothesisCandidate } = firstHypothesis;
    const common = {
      brief_ref: closure.brief_ref,
      hypothesis_set_ref: closure.hypothesis_set_ref,
      brief_payload: closure.brief,
      planner_version: "planner@1.0.0",
    } as const;
    const splitHypothesisSetResult = await compileHypothesisSetCandidate({
      brief_ref: closure.brief_ref,
      hypotheses: [
        {
          ...firstHypothesisCandidate,
          discriminating_test_ids: ["promotion-share", "promotion-stability"],
        },
        ...closure.hypothesisSet.hypotheses
          .slice(1)
          .map(({ planning_status: _planningStatus, ...hypothesis }) => hypothesis),
      ],
      mechanism_validator_version: closure.hypothesisSet.mechanism_validator_version,
    });
    expect(splitHypothesisSetResult.ok).toBe(true);
    if (!splitHypothesisSetResult.ok) return;
    const splitHypothesisSet = splitHypothesisSetResult.value;
    const split = await compileEvidencePlanCandidate({
      ...common,
      hypothesis_set_payload: splitHypothesisSet,
      obligations: [
        firstObligation,
        secondObligation,
        {
          ...firstObligation,
          obligation_id: "promotion-stability-obligation",
          discriminating_test_ids: ["promotion-stability"],
          depends_on: [{ node_id: firstObligation.obligation_id }],
        },
      ],
    });
    expect(split).toMatchObject({ ok: true });
    expect(
      await compileEvidencePlanCandidate({
        ...common,
        hypothesis_set_payload: splitHypothesisSet,
        obligations: closure.obligations,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });
    expect(
      await compileEvidencePlanCandidate({
        ...common,
        hypothesis_set_payload: splitHypothesisSet,
        obligations: [
          firstObligation,
          secondObligation,
          {
            ...firstObligation,
            obligation_id: "wrong-owner-obligation",
            hypothesis_refs: secondObligation.hypothesis_refs,
            discriminating_test_ids: ["promotion-stability"],
            depends_on: [],
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });

    const alternative = {
      ...firstHypothesis,
      hypothesis_id: "seasonality",
      mechanism_class: "seasonality",
      statement: "季节性是备选解释",
      predictions: ["季节指数下降"],
      falsifiers: ["季节指数稳定"],
      discriminating_test_ids: ["seasonality-test"],
      materiality: "ALTERNATIVE" as const,
    };
    const alternativeSetResult = await compileHypothesisSetCandidate({
      brief_ref: closure.brief_ref,
      hypotheses: [
        ...closure.hypothesisSet.hypotheses.map(
          ({ planning_status: _planningStatus, ...hypothesis }) => hypothesis,
        ),
        alternative,
      ],
      mechanism_validator_version: closure.hypothesisSet.mechanism_validator_version,
    });
    expect(alternativeSetResult.ok).toBe(true);
    if (!alternativeSetResult.ok) return;
    const alternativeSet = alternativeSetResult.value;
    const alternativeRef = {
      container_ref: closure.hypothesis_set_ref,
      node_id: alternative.hypothesis_id,
    };
    const duplicateAlternativeTest = await compileEvidencePlanCandidate({
      ...common,
      hypothesis_set_payload: alternativeSet,
      obligations: [
        ...closure.obligations,
        {
          ...firstObligation,
          obligation_id: "seasonality-a",
          hypothesis_refs: [alternativeRef],
          discriminating_test_ids: ["seasonality-test"],
          depends_on: [],
        },
        {
          ...firstObligation,
          obligation_id: "seasonality-b",
          hypothesis_refs: [alternativeRef],
          discriminating_test_ids: ["seasonality-test"],
          depends_on: [],
        },
      ],
    });
    expect(duplicateAlternativeTest).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });
  });

  it("Obligation Graph Hash 对规范等价排列保持不变，CRITICAL Criterion 可跨不同 Obligation 重用", async () => {
    const closure = await compiledPlanningClosure();
    const common = {
      brief_ref: closure.brief_ref,
      hypothesis_set_ref: closure.hypothesis_set_ref,
      brief_payload: closure.brief,
      hypothesis_set_payload: closure.hypothesisSet,
      planner_version: "planner@1.0.0",
    } as const;
    const first = await compileEvidencePlanCandidate({
      ...common,
      obligations: closure.obligations,
    });
    const second = await compileEvidencePlanCandidate({
      ...common,
      obligations: [...closure.obligations].reverse().map((obligation) => ({
        ...obligation,
        hypothesis_refs: [...obligation.hypothesis_refs].reverse(),
        success_criterion_refs: [...obligation.success_criterion_refs].reverse(),
        discriminating_test_ids: [...obligation.discriminating_test_ids].reverse(),
        depends_on: [...obligation.depends_on].reverse(),
      })),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.obligation_graph_hash).toBe(second.value.obligation_graph_hash);
    expect(
      first.value.obligations
        .flatMap(({ success_criterion_refs }) => success_criterion_refs)
        .filter(({ node_id }) => node_id === "explain-decline"),
    ).toHaveLength(2);
  });

  it("malformed planning input 与 tampered Hypothesis universe hash 均 fail-close", async () => {
    expect(await compileResearchBriefCandidate(null as never)).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_BRIEF_INVALID" },
    });
    const closure = await compiledPlanningClosure();
    expect(
      await compileEvidencePlanCandidate({
        brief_ref: closure.brief_ref,
        hypothesis_set_ref: closure.hypothesis_set_ref,
        brief_payload: closure.brief,
        hypothesis_set_payload: {
          ...closure.hypothesisSet,
          hypothesis_universe_hash: `sha256:${"0".repeat(64)}`,
        },
        obligations: closure.obligations,
        planner_version: "planner@1.0.0",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });
    expect(await compileEvidencePlanCandidate(null as never)).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_PLAN_INVALID" },
    });
  });
});
