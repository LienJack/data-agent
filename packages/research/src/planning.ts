import type {
  EvidencePlanV2Payload,
  HypothesisSetRef,
  HypothesisSetV2Payload,
  HypothesisV2,
  L2ResearchDocumentCandidate,
  ObservationContract,
  ProofObligationV2,
  ResearchBriefRef,
  ResearchBriefV2Payload,
} from "@data-agent/contracts";
import {
  artifactReferenceIdentity,
  embeddedNodeReferenceIdentity,
  evidencePlanV2PayloadSchema,
  hypothesisSetRefSchema,
  hypothesisSetV2PayloadSchema,
  hypothesisV2Schema,
  proofObligationV2Schema,
  researchBriefRefSchema,
  researchBriefV2PayloadSchema,
  U6_WIRE_LIMITS,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "./errors.js";
import { preflightResearchInput } from "./input-budget.js";
import {
  type ResolvedResearchDocumentCandidate,
  resolveResearchDocumentCandidate,
} from "./internal/document-resolution.js";
import { computeResearchKernelHash } from "./internal/hash.js";
import { stableCompare } from "./internal/reference-identity.js";
import { exactObjectKeys } from "./internal/value-shape.js";

export type ResearchBriefCandidateInput = Omit<
  ResearchBriefV2Payload,
  "artifact_type" | "protocol_version"
>;

export type HypothesisCandidateInput = Omit<HypothesisV2, "planning_status">;

export interface HypothesisSetCandidateInput {
  readonly brief_ref: ResearchBriefRef;
  readonly hypotheses: readonly HypothesisCandidateInput[];
  readonly mechanism_validator_version: string;
}

export interface EvidencePlanCandidateInput {
  readonly brief_document: L2ResearchDocumentCandidate;
  readonly hypothesis_set_document: L2ResearchDocumentCandidate;
  readonly obligations: readonly ProofObligationCandidateInput[];
  readonly planner_version: string;
}

export interface EvidencePlanResolvedFactsInput {
  readonly brief_ref: ResearchBriefRef;
  readonly hypothesis_set_ref: HypothesisSetRef;
  readonly brief_payload: ResearchBriefV2Payload;
  readonly hypothesis_set_payload: HypothesisSetV2Payload;
  readonly obligations: readonly ProofObligationCandidateInput[];
  readonly planner_version: string;
}

export type ProofObligationCandidateInput = Omit<ProofObligationV2, "observation_contract"> & {
  readonly observation_contract: Omit<ObservationContract, "contract_hash">;
};

async function resolvePlanningDocumentCandidate<
  ArtifactType extends "ResearchBrief" | "HypothesisSet",
>(
  input: unknown,
  expectedArtifactType: ArtifactType,
): Promise<ResearchKernelResult<ResolvedResearchDocumentCandidate<ArtifactType>>> {
  const resolution = await resolveResearchDocumentCandidate(input, expectedArtifactType);
  if (!resolution.ok) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      `${expectedArtifactType} 必须是 exact content-addressed Candidate Document：${resolution.error.message}`,
    );
  }
  return resolution;
}

/**
 * Repo-internal protocol canonicalizer shared by the Planning compiler and
 * downstream document resolvers. It is deliberately not exported at package
 * root.
 */
export function canonicalizeProofObligationGraph(obligations: readonly ProofObligationV2[]) {
  return obligations
    .map((obligation) => ({
      ...obligation,
      hypothesis_refs: [...obligation.hypothesis_refs].sort((left, right) =>
        stableCompare(embeddedNodeReferenceIdentity(left), embeddedNodeReferenceIdentity(right)),
      ),
      success_criterion_refs: [...obligation.success_criterion_refs].sort((left, right) =>
        stableCompare(embeddedNodeReferenceIdentity(left), embeddedNodeReferenceIdentity(right)),
      ),
      discriminating_test_ids: [...obligation.discriminating_test_ids].sort(stableCompare),
      depends_on: [...obligation.depends_on].sort((left, right) =>
        stableCompare(left.node_id, right.node_id),
      ),
    }))
    .sort((left, right) => stableCompare(left.obligation_id, right.obligation_id));
}

export async function compileResearchBriefCandidate(
  input: ResearchBriefCandidateInput,
): Promise<ResearchKernelResult<ResearchBriefV2Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      { path: ["scope", "dimensions"], max_items: U6_WIRE_LIMITS.max_dimensions },
      { path: ["scope", "metric_refs"], max_items: U6_WIRE_LIMITS.max_metric_refs },
      { path: ["success_criteria"], max_items: U6_WIRE_LIMITS.max_success_criteria },
      {
        path: ["source_independence_policy", "required_disclosures"],
        max_items: U6_WIRE_LIMITS.max_required_disclosures,
      },
    ],
  });
  if (!budget.ok) return budget;

  const candidate = {
    artifact_type: "ResearchBrief",
    protocol_version: "research-brief@2.0.0",
    ...input,
  } as const;
  const parsed = researchBriefV2PayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    return researchKernelFailure(
      "RESEARCH_BRIEF_INVALID",
      parsed.error.issues[0]?.message ?? "无效",
    );
  }
  const brief = parsed.data;
  if (brief.evidence_policy.allowed_kinds.some((kind) => kind !== "QUERY")) {
    return researchKernelFailure(
      "UNSUPPORTED_SOURCE_KIND",
      "U6 ResearchBrief 只允许 QUERY Evidence。",
    );
  }
  if (
    brief.budget.max_source_calls !== 0 ||
    brief.success_criteria.length === 0 ||
    !brief.success_criteria.some(({ materiality }) => materiality === "CRITICAL")
  ) {
    return researchKernelFailure(
      "RESEARCH_BRIEF_INVALID",
      "ResearchBrief 必须使用零 Source 预算并包含 CRITICAL Success Criterion。",
    );
  }
  return researchKernelSuccess(brief);
}

export async function compileHypothesisSetCandidate(
  input: HypothesisSetCandidateInput,
): Promise<ResearchKernelResult<HypothesisSetV2Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [{ path: ["hypotheses"], max_items: U6_WIRE_LIMITS.max_hypotheses }],
  });
  if (!budget.ok) return budget;

  if (
    !exactObjectKeys(input, ["brief_ref", "hypotheses", "mechanism_validator_version"]) ||
    !researchBriefRefSchema.safeParse(input.brief_ref).success ||
    !Array.isArray(input.hypotheses) ||
    !versionIdentifierSchema.safeParse(input.mechanism_validator_version).success
  ) {
    return researchKernelFailure(
      "HYPOTHESIS_SET_INVALID",
      "HypothesisSet 输入必须是 strict Brief Reference 与 Hypothesis 数组。",
    );
  }
  const parsedHypotheses = input.hypotheses.map((hypothesis) =>
    hypothesisV2Schema.safeParse({
      ...hypothesis,
      planning_status: "ADMISSIBLE",
    }),
  );
  if (parsedHypotheses.some((result) => !result.success)) {
    return researchKernelFailure(
      "HYPOTHESIS_SET_INVALID",
      "Hypothesis 候选必须全部通过 strict schema。",
    );
  }
  const hypotheses = parsedHypotheses.flatMap((result) => (result.success ? [result.data] : []));
  if (
    hypotheses.length < 2 ||
    hypotheses.filter(({ materiality }) => materiality === "MATERIAL").length < 2
  ) {
    return researchKernelFailure(
      "HYPOTHESIS_SET_INVALID",
      "HypothesisSet 至少需要两个 MATERIAL 竞争假设。",
    );
  }
  const hypothesisIds = hypotheses.map(({ hypothesis_id }) => hypothesis_id);
  const testIds = hypotheses.flatMap(({ discriminating_test_ids }) => discriminating_test_ids);
  if (
    new Set(hypothesisIds).size !== hypothesisIds.length ||
    new Set(testIds).size !== testIds.length
  ) {
    return researchKernelFailure(
      "HYPOTHESIS_SET_INVALID",
      "Hypothesis ID 与 discriminating_test_id 必须全局唯一。",
    );
  }
  const signatures = hypotheses.map((hypothesis) =>
    JSON.stringify([
      hypothesis.mechanism_class,
      [...hypothesis.predictions].sort(),
      [...hypothesis.falsifiers].sort(),
    ]),
  );
  if (new Set(signatures).size !== signatures.length) {
    return researchKernelFailure(
      "HYPOTHESIS_COLLAPSE",
      "机制、Prediction 与 Falsifier 等价的假设不能重复进入候选宇宙。",
    );
  }
  const hypothesis_universe_hash = await computeResearchKernelHash("u6-hypothesis-universe@1", {
    hypotheses,
    mechanism_validator_version: input.mechanism_validator_version,
  });
  const candidate = {
    artifact_type: "HypothesisSet",
    protocol_version: "hypothesis-set@2.0.0",
    brief_ref: input.brief_ref,
    hypotheses,
    mechanism_validator_version: input.mechanism_validator_version,
    hypothesis_universe_hash,
  } as const;
  const parsed = hypothesisSetV2PayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : researchKernelFailure("HYPOTHESIS_SET_INVALID", parsed.error.issues[0]?.message ?? "无效");
}

/**
 * Source-only resolved-facts reducer. Package consumers must use the
 * document-backed compileEvidencePlanCandidate boundary below.
 */
export async function compileEvidencePlanFromResolvedFactsCandidate(
  input: EvidencePlanResolvedFactsInput,
): Promise<ResearchKernelResult<EvidencePlanV2Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [{ path: ["obligations"], max_items: U6_WIRE_LIMITS.max_obligations }],
  });
  if (!budget.ok) return budget;

  if (
    !exactObjectKeys(input, [
      "brief_ref",
      "hypothesis_set_ref",
      "brief_payload",
      "hypothesis_set_payload",
      "obligations",
      "planner_version",
    ]) ||
    !researchBriefRefSchema.safeParse(input.brief_ref).success ||
    !hypothesisSetRefSchema.safeParse(input.hypothesis_set_ref).success ||
    !Array.isArray(input.obligations) ||
    !versionIdentifierSchema.safeParse(input.planner_version).success
  ) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "EvidencePlan 输入必须是 strict resolved planning closure。",
    );
  }
  const parsedBrief = researchBriefV2PayloadSchema.safeParse(input.brief_payload);
  const parsedHypothesisSet = hypothesisSetV2PayloadSchema.safeParse(input.hypothesis_set_payload);
  if (!parsedBrief.success || !parsedHypothesisSet.success) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "EvidencePlan 必须消费 strict ResearchBrief 与 HypothesisSet。",
    );
  }
  const briefPayload = parsedBrief.data;
  const hypothesisSetPayload = parsedHypothesisSet.data;
  const expectedHypothesisUniverseHash = await computeResearchKernelHash(
    "u6-hypothesis-universe@1",
    {
      hypotheses: hypothesisSetPayload.hypotheses,
      mechanism_validator_version: hypothesisSetPayload.mechanism_validator_version,
    },
  );
  if (hypothesisSetPayload.hypothesis_universe_hash !== expectedHypothesisUniverseHash) {
    return researchKernelFailure("EVIDENCE_PLAN_INVALID", "HypothesisSet universe hash 重算失败。");
  }
  if (input.obligations.length === 0) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "EvidencePlan 至少需要一项 Proof Obligation。",
    );
  }
  if (
    artifactReferenceIdentity(hypothesisSetPayload.brief_ref) !==
    artifactReferenceIdentity(input.brief_ref)
  ) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "EvidencePlan 的 Brief 与 HypothesisSet 必须形成 exact reference 闭包。",
    );
  }
  if (
    briefPayload.artifact_type !== "ResearchBrief" ||
    hypothesisSetPayload.artifact_type !== "HypothesisSet"
  ) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "EvidencePlan 必须消费完整 V2 Brief 与 HypothesisSet。",
    );
  }
  const parsedObligationCandidates = input.obligations.map((obligation) =>
    proofObligationV2Schema.safeParse({
      ...obligation,
      observation_contract: {
        ...(typeof obligation === "object" &&
        obligation !== null &&
        typeof obligation.observation_contract === "object" &&
        obligation.observation_contract !== null
          ? obligation.observation_contract
          : {}),
        contract_hash: `sha256:${"0".repeat(64)}`,
      },
    }),
  );
  if (parsedObligationCandidates.some((result) => !result.success)) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "Proof Obligation 候选必须全部通过 strict schema。",
    );
  }
  const obligations = await Promise.all(
    parsedObligationCandidates.flatMap((result) =>
      result.success
        ? [
            (async (): Promise<ProofObligationV2> => {
              const { contract_hash: _contractHash, ...observationContract } =
                result.data.observation_contract;
              return {
                ...result.data,
                observation_contract: {
                  ...observationContract,
                  contract_hash: await computeResearchKernelHash(
                    "u6-observation-contract@1",
                    observationContract,
                  ),
                },
              };
            })(),
          ]
        : [],
    ),
  );
  const ids = new Set(obligations.map(({ obligation_id }) => obligation_id));
  if (ids.size !== obligations.length) {
    return researchKernelFailure("EVIDENCE_PLAN_INVALID", "Proof Obligation ID 必须唯一。");
  }
  if (obligations.some(({ depends_on }) => depends_on.some(({ node_id }) => !ids.has(node_id)))) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_REPLAN_REQUIRED",
      "EvidencePlan 依赖必须命中同一计划中的 Proof Obligation。",
    );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(obligations.map((obligation) => [obligation.obligation_id, obligation]));
  const visit = (obligationId: string, depth: number): boolean => {
    if (depth > U6_WIRE_LIMITS.max_dependency_depth) return false;
    if (visiting.has(obligationId)) return false;
    if (visited.has(obligationId)) return true;
    visiting.add(obligationId);
    for (const dependency of byId.get(obligationId)?.depends_on ?? []) {
      if (!visit(dependency.node_id, depth + 1)) return false;
    }
    visiting.delete(obligationId);
    visited.add(obligationId);
    return true;
  };
  if ([...ids].some((obligationId) => !visit(obligationId, 1))) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "EvidencePlan 依赖图不能成环且深度不能超过 32。",
    );
  }
  const hypothesisRefs = obligations.flatMap(({ hypothesis_refs }) =>
    hypothesis_refs.map(embeddedNodeReferenceIdentity),
  );
  const successCriterionRefs = obligations.flatMap(({ success_criterion_refs }) =>
    success_criterion_refs.map(embeddedNodeReferenceIdentity),
  );
  const expectedHypotheses = hypothesisSetPayload.hypotheses
    .filter(({ materiality }) => materiality === "MATERIAL")
    .map(
      ({ hypothesis_id }) =>
        `${artifactReferenceIdentity(input.hypothesis_set_ref)}\0${hypothesis_id}`,
    );
  const expectedCriteria = briefPayload.success_criteria
    .filter(({ materiality }) => materiality === "CRITICAL")
    .map(({ criterion_id }) => `${artifactReferenceIdentity(input.brief_ref)}\0${criterion_id}`);
  const expectedTests = hypothesisSetPayload.hypotheses.flatMap(
    ({ discriminating_test_ids }) => discriminating_test_ids,
  );
  const actualHypotheses = new Set(hypothesisRefs);
  const actualCriteria = new Set(successCriterionRefs);
  const allTestIds = obligations.flatMap(({ discriminating_test_ids }) => discriminating_test_ids);
  const actualTests = new Set(allTestIds);
  const allowedHypotheses = new Set(
    hypothesisSetPayload.hypotheses.map(
      ({ hypothesis_id }) =>
        `${artifactReferenceIdentity(input.hypothesis_set_ref)}\0${hypothesis_id}`,
    ),
  );
  const allowedCriteria = new Set(
    briefPayload.success_criteria.map(
      ({ criterion_id }) => `${artifactReferenceIdentity(input.brief_ref)}\0${criterion_id}`,
    ),
  );
  const allowedTests = new Set(expectedTests);
  const criticalHypotheses = obligations
    .filter(({ materiality }) => materiality === "CRITICAL")
    .flatMap(({ hypothesis_refs }) => hypothesis_refs.map(embeddedNodeReferenceIdentity));
  const criticalCriteria = obligations
    .filter(({ materiality }) => materiality === "CRITICAL")
    .flatMap(({ success_criterion_refs }) =>
      success_criterion_refs.map(embeddedNodeReferenceIdentity),
    );
  const count = (values: readonly string[], identity: string) =>
    values.filter((value) => value === identity).length;
  const testOwnerById = new Map(
    hypothesisSetPayload.hypotheses.flatMap((hypothesis) =>
      hypothesis.discriminating_test_ids.map((testId) => [
        testId,
        `${artifactReferenceIdentity(input.hypothesis_set_ref)}\0${hypothesis.hypothesis_id}`,
      ]),
    ),
  );
  const testClosureInvalid = obligations.some((obligation) => {
    const referencedHypotheses = new Set(
      obligation.hypothesis_refs.map(embeddedNodeReferenceIdentity),
    );
    return obligation.discriminating_test_ids.some((testId) => {
      const owner = testOwnerById.get(testId);
      return !owner || !referencedHypotheses.has(owner);
    });
  });
  const materialHypothesisSet = new Set(expectedHypotheses);
  const criticalCriterionSet = new Set(expectedCriteria);
  const obligationMaterialityInvalid = obligations.some(
    ({ materiality, hypothesis_refs, success_criterion_refs }) =>
      materiality !== "CRITICAL" &&
      (hypothesis_refs.some((reference) =>
        materialHypothesisSet.has(embeddedNodeReferenceIdentity(reference)),
      ) ||
        success_criterion_refs.some((reference) =>
          criticalCriterionSet.has(embeddedNodeReferenceIdentity(reference)),
        )),
  );
  if (
    hypothesisRefs.some((identity) => !allowedHypotheses.has(identity)) ||
    successCriterionRefs.some((identity) => !allowedCriteria.has(identity)) ||
    [...actualTests].some((testId) => !allowedTests.has(testId)) ||
    expectedHypotheses.some((identity) => !actualHypotheses.has(identity)) ||
    expectedCriteria.some((identity) => !actualCriteria.has(identity)) ||
    expectedTests.some((testId) => !actualTests.has(testId)) ||
    expectedHypotheses.some((identity) => count(criticalHypotheses, identity) < 1) ||
    expectedTests.some((testId) => count(allTestIds, testId) !== 1) ||
    expectedCriteria.some((identity) => count(criticalCriteria, identity) === 0) ||
    testClosureInvalid ||
    obligationMaterialityInvalid
  ) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "EvidencePlan 必须精确覆盖完整节点，并禁止把 MATERIAL Hypothesis、CRITICAL Criterion 或其 Test 降级到 SUPPORTING。",
    );
  }
  const obligation_graph_hash = await computeResearchKernelHash(
    "u6-obligation-graph@1",
    canonicalizeProofObligationGraph(obligations),
  );
  const candidate = {
    artifact_type: "EvidencePlan",
    protocol_version: "evidence-plan@2.0.0",
    brief_ref: input.brief_ref,
    hypothesis_set_ref: input.hypothesis_set_ref,
    obligations,
    planner_version: input.planner_version,
    obligation_graph_hash,
  } as const;
  const parsed = evidencePlanV2PayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : researchKernelFailure("EVIDENCE_PLAN_INVALID", parsed.error.issues[0]?.message ?? "无效");
}

export async function compileEvidencePlanCandidate(
  input: EvidencePlanCandidateInput,
): Promise<ResearchKernelResult<EvidencePlanV2Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [{ path: ["obligations"], max_items: U6_WIRE_LIMITS.max_obligations }],
  });
  if (!budget.ok) return budget;
  if (
    !exactObjectKeys(input, [
      "brief_document",
      "hypothesis_set_document",
      "obligations",
      "planner_version",
    ]) ||
    !Array.isArray(input.obligations) ||
    !versionIdentifierSchema.safeParse(input.planner_version).success
  ) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "EvidencePlan 必须消费 strict Planning Document closure。",
    );
  }

  const [brief, hypothesisSet] = await Promise.all([
    resolvePlanningDocumentCandidate(input.brief_document, "ResearchBrief"),
    resolvePlanningDocumentCandidate(input.hypothesis_set_document, "HypothesisSet"),
  ]);
  if (!brief.ok) return brief;
  if (!hypothesisSet.ok) return hypothesisSet;
  if (
    brief.value.document.payload.artifact_type !== "ResearchBrief" ||
    hypothesisSet.value.document.payload.artifact_type !== "HypothesisSet"
  ) {
    return researchKernelFailure("EVIDENCE_PLAN_INVALID", "Planning Document 类型解析漂移。");
  }

  const briefRef = researchBriefRefSchema.safeParse(brief.value.ref);
  const hypothesisSetRef = hypothesisSetRefSchema.safeParse(hypothesisSet.value.ref);
  if (!briefRef.success || !hypothesisSetRef.success) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "Planning Document Envelope 不能派生 typed exact Reference。",
    );
  }
  return compileEvidencePlanFromResolvedFactsCandidate({
    brief_ref: briefRef.data,
    hypothesis_set_ref: hypothesisSetRef.data,
    brief_payload: brief.value.document.payload,
    hypothesis_set_payload: hypothesisSet.value.document.payload,
    obligations: input.obligations,
    planner_version: input.planner_version,
  });
}
