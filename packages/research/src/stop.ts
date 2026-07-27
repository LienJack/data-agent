import {
  type AtomicClaimRef,
  type AtomicClaimV2Payload,
  artifactReferenceIdentity,
  atomicClaimRefSchema,
  type CandidateQueryAssessment,
  type CoverageStatePayload,
  type CoverageStateRef,
  canonicalizeJson,
  coverageStatePayloadSchema,
  coverageStateRefSchema,
  deriveCoverageCounts,
  embeddedNodeReferenceIdentity,
  identifierSchema,
  type L2ResearchDocumentCandidate,
  type ProofObligationRef,
  proofObligationRefSchema,
  type QueryContractRef,
  type QueryEvidenceRef,
  type QueryEvidenceV2Payload,
  queryContractRefSchema,
  type ResearchBudgetBalance,
  type ResearchBudgetDemand,
  type ResearchStopDecisionPayload,
  type ResearchStopDecisionRef,
  researchBudgetDemandSchema,
  researchStopDecisionPayloadSchema,
  type SupportDecisionPayload,
  type SupportDecisionRef,
  supportDecisionPayloadSchema,
  supportDecisionRefSchema,
  U6_WIRE_LIMITS,
  type U6ResearchReasonCode,
  u6ResearchReasonCodeSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import {
  type DeriveCoverageStateInput,
  deriveCoverageStateCandidate,
  deriveCoverageStateCandidateWithReplayContext,
} from "./coverage.js";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "./errors.js";
import { preflightResearchInput } from "./input-budget.js";
import { resolveResearchDocumentCandidate } from "./internal/document-resolution.js";
import { computeResearchKernelHash } from "./internal/hash.js";
import {
  compareReferenceIdentity,
  exactReferenceSet,
  sameReferenceScope,
} from "./internal/reference-identity.js";
import {
  memoizeSuccessfulResearchReplay,
  type ResearchRequestReplayContext,
} from "./internal/request-replay-context.js";
import { exactObjectKeys } from "./internal/value-shape.js";
import { derivePreStopReadinessFacts, type PreStopReadinessInput } from "./pre-stop-readiness.js";

export interface QueryCandidateFacts {
  readonly query_contract_ref: QueryContractRef;
  readonly obligation_refs: readonly ProofObligationRef[];
  readonly semantic_admissible: boolean;
  readonly expected_information_gain_microunits: number;
  readonly required_budget: ResearchBudgetDemand;
  readonly waiting_on_codes: readonly string[];
  readonly reason_codes: readonly U6ResearchReasonCode[];
}

export interface SupportedClaimResolution {
  readonly claim_ref: AtomicClaimRef;
  readonly support_decision_ref: SupportDecisionRef;
  readonly support_decision: SupportDecisionPayload;
}

export interface ReplanFacts {
  readonly trigger: "PLAN_INVALIDATED" | "QUERY_COMPILATION_GAP";
  readonly executable_with_remaining_budget: true;
}

export interface DeriveResearchStopDecisionResolvedFactsInput {
  readonly coverage_ref: CoverageStateRef;
  readonly coverage: CoverageStatePayload;
  readonly candidate_queries: readonly QueryCandidateFacts[];
  readonly support_resolutions: readonly SupportedClaimResolution[];
  readonly required_disclosures: readonly string[];
  readonly pre_stop_readiness: PreStopReadinessInput;
  readonly replan?: ReplanFacts;
  readonly enumerator_version: string;
  readonly eig_policy_version: string;
}

export interface PreStopReadinessDocumentInput {
  readonly brief_document: L2ResearchDocumentCandidate;
  readonly material_query_evidence_documents: readonly L2ResearchDocumentCandidate[];
  readonly supplied_disclosures: readonly string[];
}

export interface DeriveResearchStopDecisionInput {
  readonly coverage_document: L2ResearchDocumentCandidate;
  readonly coverage_resolution: DeriveCoverageStateInput;
  readonly candidate_queries: readonly QueryCandidateFacts[];
  readonly support_decision_documents: readonly L2ResearchDocumentCandidate[];
  readonly required_disclosures: readonly string[];
  readonly pre_stop_readiness: PreStopReadinessDocumentInput;
  readonly replan?: ReplanFacts;
  readonly enumerator_version: string;
  readonly eig_policy_version: string;
}

export interface ResearchStopDecisionDocumentResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: DeriveResearchStopDecisionInput;
}

export interface ResolvedResearchStopDecisionDocument {
  readonly ref: ResearchStopDecisionRef;
  readonly payload: ResearchStopDecisionPayload;
  readonly derivation_input: DeriveResearchStopDecisionInput;
}

function demandWithinBalance(
  demand: ResearchBudgetDemand,
  remaining: ResearchBudgetBalance,
): boolean {
  return (
    demand.steps <= remaining.steps &&
    demand.model_calls <= remaining.model_calls &&
    demand.sql_executions <= remaining.sql_executions &&
    demand.source_calls <= remaining.source_calls &&
    demand.elapsed_ms <= remaining.elapsed_ms &&
    demand.provider_tokens <= remaining.provider_tokens &&
    demand.provider_cost_microusd <= remaining.provider_cost_microusd
  );
}

async function deriveCandidateAssessment(
  candidate: QueryCandidateFacts,
  remaining: ResearchBudgetBalance,
): Promise<CandidateQueryAssessment> {
  const fits = demandWithinBalance(candidate.required_budget, remaining);
  let admissibility: CandidateQueryAssessment["admissibility"];
  if (!candidate.semantic_admissible || candidate.expected_information_gain_microunits <= 0) {
    admissibility = "INADMISSIBLE";
  } else if (candidate.waiting_on_codes.length > 0) {
    admissibility = "WAITING_EXTERNAL_CAPABILITY";
  } else if (fits) {
    admissibility = "EXECUTABLE_NOW";
  } else {
    admissibility = "BUDGET_BLOCKED";
  }
  const material: Omit<CandidateQueryAssessment, "assessment_hash"> = {
    query_contract_ref: candidate.query_contract_ref,
    obligation_refs: [...candidate.obligation_refs],
    admissibility,
    expected_information_gain_microunits: candidate.expected_information_gain_microunits,
    required_budget: candidate.required_budget,
    waiting_on_codes:
      admissibility === "WAITING_EXTERNAL_CAPABILITY" ? [...candidate.waiting_on_codes] : [],
    reason_codes: [...candidate.reason_codes],
  };
  return {
    ...material,
    assessment_hash: await computeResearchKernelHash("u6-candidate-assessment@1", material),
  };
}

function unresolvedRefs(coverage: CoverageStatePayload): ProofObligationRef[] {
  return coverage.obligations
    .filter(({ state }) => state === "OPEN" || state === "BLOCKED" || state === "FAILED")
    .map(({ obligation_ref }) => obligation_ref);
}

const PARTIAL_REASON_PRECEDENCE: readonly U6ResearchReasonCode[] = [
  "MATERIAL_CONFLICT_UNDISCLOSED",
  "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
  "EVIDENCE_SUPPORT_INSUFFICIENT",
  "CRITICAL_OBLIGATION_FAILED",
  "SOURCE_INDEPENDENCE_POLICY_UNSATISFIED",
  "BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED",
  "BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION",
];

function derivePartialReason(coverage: CoverageStatePayload): U6ResearchReasonCode {
  const reasons = new Set(coverage.obligations.flatMap(({ reason_codes }) => reason_codes));
  return (
    PARTIAL_REASON_PRECEDENCE.find((reason) => reasons.has(reason)) ??
    "BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION"
  );
}

function invalidStopCandidate(message: string): ResearchKernelResult<never> {
  return researchKernelFailure("RESEARCH_STOP_INPUT_INCONSISTENT", message);
}

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function stopInputShapeIsValid(
  value: unknown,
): value is DeriveResearchStopDecisionResolvedFactsInput {
  if (
    !exactObjectKeys(value, [
      "coverage_ref",
      "coverage",
      "candidate_queries",
      "support_resolutions",
      "required_disclosures",
      "pre_stop_readiness",
      "enumerator_version",
      "eig_policy_version",
      ...(typeof value === "object" && value !== null && Object.hasOwn(value, "replan")
        ? ["replan"]
        : []),
    ])
  ) {
    return false;
  }
  const input = value as DeriveResearchStopDecisionResolvedFactsInput;
  return (
    Array.isArray(input.candidate_queries) &&
    Array.isArray(input.support_resolutions) &&
    Array.isArray(input.required_disclosures)
  );
}

function queryCandidateFactsAreValid(
  candidate: QueryCandidateFacts,
  scopeAnchor: CoverageStateRef,
): boolean {
  const obligationIdentities = candidate.obligation_refs.map(embeddedNodeReferenceIdentity);
  return (
    exactObjectKeys(candidate, [
      "query_contract_ref",
      "obligation_refs",
      "semantic_admissible",
      "expected_information_gain_microunits",
      "required_budget",
      "waiting_on_codes",
      "reason_codes",
    ]) &&
    queryContractRefSchema.safeParse(candidate.query_contract_ref).success &&
    sameReferenceScope(scopeAnchor, candidate.query_contract_ref) &&
    Array.isArray(candidate.obligation_refs) &&
    candidate.obligation_refs.length > 0 &&
    candidate.obligation_refs.every(
      (reference) =>
        proofObligationRefSchema.safeParse(reference).success &&
        sameReferenceScope(scopeAnchor, reference.container_ref),
    ) &&
    new Set(obligationIdentities).size === obligationIdentities.length &&
    typeof candidate.semantic_admissible === "boolean" &&
    Number.isSafeInteger(candidate.expected_information_gain_microunits) &&
    candidate.expected_information_gain_microunits >= 0 &&
    candidate.expected_information_gain_microunits <= 1_000_000 &&
    researchBudgetDemandSchema.safeParse(candidate.required_budget).success &&
    Array.isArray(candidate.waiting_on_codes) &&
    candidate.waiting_on_codes.every((code) => identifierSchema.safeParse(code).success) &&
    new Set(candidate.waiting_on_codes).size === candidate.waiting_on_codes.length &&
    Array.isArray(candidate.reason_codes) &&
    candidate.reason_codes.length > 0 &&
    candidate.reason_codes.every(
      (reason) => u6ResearchReasonCodeSchema.safeParse(reason).success,
    ) &&
    new Set(candidate.reason_codes).size === candidate.reason_codes.length
  );
}

function coverageCountsMatchProjection(coverage: CoverageStatePayload): boolean {
  return (
    JSON.stringify(deriveCoverageCounts(coverage.obligations)) ===
    JSON.stringify(coverage.derived_counts)
  );
}

async function coveragePublicProjectionIsValid(coverage: CoverageStatePayload): Promise<boolean> {
  if (
    !coverageCountsMatchProjection(coverage) ||
    coverage.version_frontier_hash !==
      (await computeResearchKernelHash("u6-version-frontier@1", coverage.version_frontier)) ||
    !exactReferenceSet(
      coverage.obligation_execution_decision_refs,
      coverage.obligations.flatMap(
        ({ obligation_execution_decision_refs }) => obligation_execution_decision_refs,
      ),
    ) ||
    !exactReferenceSet(
      coverage.query_evidence_refs,
      coverage.obligations.flatMap(({ query_evidence_refs }) => query_evidence_refs),
    ) ||
    !exactReferenceSet(
      coverage.support_decision_refs,
      coverage.obligations.flatMap(({ support_decision_refs }) => support_decision_refs),
    ) ||
    !exactReferenceSet(
      coverage.material_conflict_refs,
      coverage.obligations.flatMap(({ conflict_refs }) => conflict_refs),
    )
  ) {
    return false;
  }
  return coverage.obligations.every((obligation) => {
    switch (obligation.state) {
      case "SATISFIED":
        return (
          obligation.reason_codes.length === 1 &&
          obligation.reason_codes[0] === "OBLIGATION_SATISFIED" &&
          obligation.obligation_execution_decision_refs.length > 0 &&
          obligation.query_evidence_refs.length > 0 &&
          obligation.support_decision_refs.length > 0 &&
          obligation.conflict_refs.length === 0
        );
      case "STALE":
        return (
          obligation.reason_codes.includes("EVIDENCE_REVISION_STALE") &&
          obligation.query_evidence_refs.length > 0
        );
      case "FAILED":
        return !obligation.reason_codes.includes("OBLIGATION_SATISFIED");
      case "OPEN":
      case "BLOCKED":
        return obligation.reason_codes.includes("EVIDENCE_COVERAGE_INSUFFICIENT");
      default:
        return false;
    }
  });
}

export async function deriveResearchStopDecisionFromResolvedFactsCandidate(
  input: DeriveResearchStopDecisionResolvedFactsInput,
): Promise<ResearchKernelResult<ResearchStopDecisionPayload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      { path: ["candidate_queries"], max_items: U6_WIRE_LIMITS.max_obligations },
      { path: ["support_resolutions"], max_items: U6_WIRE_LIMITS.max_obligations },
      {
        path: ["required_disclosures"],
        max_items: U6_WIRE_LIMITS.max_required_disclosures,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (!stopInputShapeIsValid(input)) {
    return invalidStopCandidate("Stop 输入必须是 exact object 与数组。");
  }
  if (
    !coverageStateRefSchema.safeParse(input.coverage_ref).success ||
    !versionIdentifierSchema.safeParse(input.enumerator_version).success ||
    !versionIdentifierSchema.safeParse(input.eig_policy_version).success ||
    input.candidate_queries.some(
      (candidate) => !queryCandidateFactsAreValid(candidate, input.coverage_ref),
    ) ||
    new Set(
      input.candidate_queries.map(({ query_contract_ref }) =>
        artifactReferenceIdentity(query_contract_ref),
      ),
    ).size !== input.candidate_queries.length ||
    input.support_resolutions.some(
      (resolution) =>
        !exactObjectKeys(resolution, ["claim_ref", "support_decision_ref", "support_decision"]) ||
        !atomicClaimRefSchema.safeParse(resolution.claim_ref).success ||
        !supportDecisionRefSchema.safeParse(resolution.support_decision_ref).success ||
        !sameReferenceScope(input.coverage_ref, resolution.claim_ref) ||
        !sameReferenceScope(input.coverage_ref, resolution.support_decision_ref),
    ) ||
    input.required_disclosures.some(
      (disclosure) => !identifierSchema.safeParse(disclosure).success,
    ) ||
    new Set(input.required_disclosures).size !== input.required_disclosures.length ||
    (input.replan !== undefined &&
      (!exactObjectKeys(input.replan, ["trigger", "executable_with_remaining_budget"]) ||
        !["PLAN_INVALIDATED", "QUERY_COMPILATION_GAP"].includes(input.replan.trigger) ||
        input.replan.executable_with_remaining_budget !== true))
  ) {
    return invalidStopCandidate(
      "Stop Reference、Candidate Query、Support Resolution 或策略字段无效。",
    );
  }
  const parsedCoverage = coverageStatePayloadSchema.safeParse(input.coverage);
  const parsedSupportDecisions = input.support_resolutions.map(({ support_decision }) =>
    supportDecisionPayloadSchema.safeParse(support_decision),
  );
  if (!parsedCoverage.success || parsedSupportDecisions.some((result) => !result.success)) {
    return invalidStopCandidate("Stop 必须消费 strict Coverage 与 SupportDecision wire payload。");
  }
  const coverage = parsedCoverage.data;
  if (!sameReferenceScope(input.coverage_ref, coverage.evidence_plan_ref)) {
    return invalidStopCandidate("Coverage Reference 与 Coverage payload 必须属于同一 Scope/Run。");
  }
  const preStopReadiness = await derivePreStopReadinessFacts(input.pre_stop_readiness);
  const supportHashesValid = await Promise.all(
    parsedSupportDecisions.map(async (result) => {
      if (!result.success) return false;
      const {
        artifact_type: _artifactType,
        protocol_version: _protocolVersion,
        input_closure_hash: declaredHash,
        ...hashMaterial
      } = result.data;
      return (
        declaredHash === (await computeResearchKernelHash("u6-support-decision@1", hashMaterial))
      );
    }),
  );
  if (
    !preStopReadiness.ok ||
    !exactStringSet(input.required_disclosures, input.pre_stop_readiness.supplied_disclosures) ||
    !(await coveragePublicProjectionIsValid(coverage)) ||
    supportHashesValid.some((valid) => !valid)
  ) {
    return invalidStopCandidate(
      "Coverage public projection 或 SupportDecision input closure hash 重算失败。",
    );
  }
  if (coverage.obligations.some(({ state }) => state === "STALE")) {
    return researchKernelFailure(
      "RESEARCH_STOP_INPUT_STALE",
      "Coverage 包含 STALE Obligation，必须转交 Revocation Authority。",
    );
  }
  const coverageUnresolved = unresolvedRefs(coverage);
  const readinessUnresolved =
    preStopReadiness.value.ready || coverageUnresolved.length > 0
      ? []
      : preStopReadiness.value.remediation_obligation_refs.slice(0, 1);
  const unresolved = [...coverageUnresolved, ...readinessUnresolved];
  const unresolvedIdentities = new Set(unresolved.map(embeddedNodeReferenceIdentity));
  const canonicalCandidateFacts = input.candidate_queries
    .map((candidate) => ({
      ...candidate,
      obligation_refs: [...candidate.obligation_refs].sort((left, right) => {
        const leftIdentity = embeddedNodeReferenceIdentity(left);
        const rightIdentity = embeddedNodeReferenceIdentity(right);
        return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
      }),
      waiting_on_codes: [...candidate.waiting_on_codes].sort(),
      reason_codes: [...candidate.reason_codes].sort(),
    }))
    .sort((left, right) =>
      compareReferenceIdentity(left.query_contract_ref, right.query_contract_ref),
    );
  const candidateQueries = await Promise.all(
    canonicalCandidateFacts.map((candidate) =>
      deriveCandidateAssessment(candidate, coverage.budget_ledger.remaining),
    ),
  );
  if (
    candidateQueries.some(({ obligation_refs }) =>
      obligation_refs.some(
        (reference) => !unresolvedIdentities.has(embeddedNodeReferenceIdentity(reference)),
      ),
    )
  ) {
    return invalidStopCandidate("Candidate Query 只能覆盖 unresolved Obligation。");
  }
  const assessed = new Set(
    candidateQueries.flatMap(({ obligation_refs }) =>
      obligation_refs.map(embeddedNodeReferenceIdentity),
    ),
  );
  if (
    input.replan === undefined &&
    unresolved.length > 0 &&
    (assessed.size !== unresolvedIdentities.size ||
      [...unresolvedIdentities].some((identity) => !assessed.has(identity)))
  ) {
    return invalidStopCandidate(
      "Candidate Enumerator 必须精确覆盖每个 unresolved Obligation，不能用输入省略表示无候选。",
    );
  }
  const noCandidateRefs = unresolved.filter(
    (reference) => !assessed.has(embeddedNodeReferenceIdentity(reference)),
  );
  const coverageClaimIdentities = new Set(
    coverage.atomic_claim_refs.map(artifactReferenceIdentity),
  );
  const coverageSupportIdentities = new Set(
    coverage.support_decision_refs.map(artifactReferenceIdentity),
  );
  const supportResolutionIdentities = new Set<string>();
  const resolvedSupportIdentities = new Set<string>();
  if (
    input.support_resolutions.some(({ claim_ref, support_decision_ref, support_decision }) => {
      const claimIdentity = artifactReferenceIdentity(claim_ref);
      const supportIdentity = artifactReferenceIdentity(support_decision_ref);
      const pairIdentity = `${claimIdentity}\0${supportIdentity}`;
      if (
        supportResolutionIdentities.has(pairIdentity) ||
        resolvedSupportIdentities.has(supportIdentity)
      ) {
        return true;
      }
      supportResolutionIdentities.add(pairIdentity);
      resolvedSupportIdentities.add(supportIdentity);
      return (
        !coverageClaimIdentities.has(claimIdentity) ||
        !coverageSupportIdentities.has(supportIdentity) ||
        artifactReferenceIdentity(support_decision.claim_ref) !== claimIdentity
      );
    }) ||
    resolvedSupportIdentities.size !== coverageSupportIdentities.size ||
    [...coverageSupportIdentities].some((identity) => !resolvedSupportIdentities.has(identity))
  ) {
    return invalidStopCandidate(
      "support_resolutions 必须精确枚举 Coverage 的唯一 Claim×SupportDecision closure。",
    );
  }
  const supportDecisionByIdentity = new Map(
    input.support_resolutions.map(({ support_decision_ref, support_decision }) => [
      artifactReferenceIdentity(support_decision_ref),
      support_decision,
    ]),
  );
  if (
    coverage.obligations.some(
      ({ state, support_decision_refs }) =>
        state === "SATISFIED" &&
        (support_decision_refs.length === 0 ||
          support_decision_refs.some((reference) => {
            const decision = supportDecisionByIdentity.get(
              artifactReferenceIdentity(reference),
            )?.decision;
            return decision !== "SUPPORTED" && decision !== "REFUTED";
          })),
    )
  ) {
    return invalidStopCandidate(
      "SATISFIED Coverage 必须绑定 hash-verified SUPPORTED/REFUTED SupportDecision。",
    );
  }
  const supported = input.support_resolutions
    .filter(({ support_decision }) => support_decision.decision === "SUPPORTED")
    .sort((left, right) =>
      compareReferenceIdentity(left.support_decision_ref, right.support_decision_ref),
    );
  const canonicalRequiredDisclosures = [...input.required_disclosures].sort();
  const supportedSubset = {
    claim_refs: supported.map(({ claim_ref }) => claim_ref),
    support_decision_refs: supported.map(({ support_decision_ref }) => support_decision_ref),
    required_disclosures: canonicalRequiredDisclosures,
    subset_hash: await computeResearchKernelHash("u6-supported-subset@1", {
      supported: supported.map(({ claim_ref, support_decision_ref }) => ({
        claim_ref,
        support_decision_ref,
      })),
      required_disclosures: canonicalRequiredDisclosures,
    }),
  };
  const candidateSet = {
    enumerator_version: input.enumerator_version,
    unresolved_obligation_refs: unresolved,
    no_candidate_obligation_refs: noCandidateRefs,
    candidate_set_hash: await computeResearchKernelHash("u6-candidate-set@1", {
      unresolved,
      candidateQueries,
      noCandidateRefs,
    }),
  };
  const common = {
    artifact_type: "ResearchStopDecision",
    protocol_version: "research-stop@1.0.0",
    coverage_ref: input.coverage_ref,
    budget_ledger: coverage.budget_ledger,
    candidate_queries: candidateQueries,
    candidate_set: candidateSet,
    supported_subset: supportedSubset,
    eig_policy_version: input.eig_policy_version,
  } as const;

  const allCriticalSatisfied =
    coverage.derived_counts.critical_total > 0 &&
    coverage.derived_counts.critical_satisfied === coverage.derived_counts.critical_total &&
    coverage.material_conflict_refs.length === 0 &&
    preStopReadiness.value.ready;
  const executable = candidateQueries
    .filter(({ admissibility }) => admissibility === "EXECUTABLE_NOW")
    .sort((left, right) => {
      const eig =
        right.expected_information_gain_microunits - left.expected_information_gain_microunits;
      return eig !== 0
        ? eig
        : compareReferenceIdentity(left.query_contract_ref, right.query_contract_ref);
    });
  const waiting = candidateQueries.filter(
    ({ admissibility }) => admissibility === "WAITING_EXTERNAL_CAPABILITY",
  );
  const budgetBlocked = candidateQueries.filter(
    ({ admissibility }) => admissibility === "BUDGET_BLOCKED",
  );
  const nonInadmissible = candidateQueries.filter(
    ({ admissibility }) => admissibility !== "INADMISSIBLE",
  );
  const hardBudgetExhausted =
    coverage.budget_ledger.remaining.steps === 0 && !coverage.budget_ledger.top_up_allowed;
  type StopDecisionWithoutHash = ResearchStopDecisionPayload extends infer Decision
    ? Decision extends unknown
      ? Omit<Decision, "decision_input_hash">
      : never
    : never;
  let branch: StopDecisionWithoutHash | undefined;
  if (allCriticalSatisfied) {
    branch = {
      ...common,
      decision: "STOP_READY",
      reason_codes: ["OBLIGATION_SATISFIED"],
    };
  } else if (executable[0]) {
    branch = {
      ...common,
      decision: "CONTINUE",
      selected_next_query_ref: executable[0].query_contract_ref,
      reason_codes: ["ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE"],
    };
  } else if (
    input.replan &&
    waiting.length === 0 &&
    budgetBlocked.length === 0 &&
    unresolved.length > 0
  ) {
    const replanMaterial = {
      trigger: input.replan.trigger,
      executable_with_remaining_budget: true as const,
    };
    branch = {
      ...common,
      decision: "REPLAN",
      replan_obligation_refs: unresolved,
      replan_assessment: {
        ...replanMaterial,
        assessment_hash: await computeResearchKernelHash("u6-replan-assessment@1", replanMaterial),
      },
      reason_codes: ["EVIDENCE_PLAN_REPLAN_REQUIRED"],
    };
  } else if (
    waiting.length > 0 ||
    (budgetBlocked.length > 0 && coverage.budget_ledger.top_up_allowed)
  ) {
    const waitingCodes = [...new Set(waiting.flatMap(({ waiting_on_codes }) => waiting_on_codes))];
    branch = {
      ...common,
      decision: "STOP_NEEDS_MORE_RESEARCH",
      non_ready_terminal: "NEEDS_MORE_RESEARCH",
      resume_requirement_codes:
        waitingCodes.length > 0 ? waitingCodes : ["ADDITIONAL_RESEARCH_BUDGET"],
      reason_codes: ["EVIDENCE_COVERAGE_INSUFFICIENT"],
    };
  } else if (
    (budgetBlocked.length > 0 || hardBudgetExhausted) &&
    nonInadmissible.every(({ admissibility }) => admissibility === "BUDGET_BLOCKED") &&
    !coverage.budget_ledger.top_up_allowed &&
    unresolved.length > 0 &&
    supportedSubset.claim_refs.length > 0 &&
    supportedSubset.claim_refs.length === supportedSubset.support_decision_refs.length &&
    supportedSubset.required_disclosures.length > 0
  ) {
    const reason = preStopReadiness.value.reason_codes[0] ?? derivePartialReason(coverage);
    branch = {
      ...common,
      decision: "STOP_PARTIAL",
      non_ready_terminal: "PARTIAL",
      partial_disclosure_codes: [...new Set([...canonicalRequiredDisclosures, reason])].sort(),
      reason_codes: [reason],
    };
  } else if (
    unresolved.length > 0 &&
    candidateQueries.every(({ admissibility }) => admissibility === "INADMISSIBLE")
  ) {
    branch = {
      ...common,
      decision: "STOP_INCONCLUSIVE",
      non_ready_terminal: "INCONCLUSIVE",
      inadmissibility_summary_hash: await computeResearchKernelHash(
        "u6-inadmissibility-summary@1",
        candidateQueries,
      ),
      reason_codes: ["ANALYSIS_INCONCLUSIVE"],
    };
  }
  if (!branch) {
    return invalidStopCandidate("Stop 输入未命中任何互斥分支，不能默认降级为 PARTIAL。");
  }
  const candidate = {
    ...branch,
    decision_input_hash: await computeResearchKernelHash("u6-stop-decision@1", branch),
  };
  const parsed = researchStopDecisionPayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : invalidStopCandidate(parsed.error.issues[0]?.message ?? "Stop Candidate 无效。");
}

const STOP_DOCUMENT_INPUT_KEYS = [
  "coverage_document",
  "coverage_resolution",
  "candidate_queries",
  "support_decision_documents",
  "required_disclosures",
  "pre_stop_readiness",
  "enumerator_version",
  "eig_policy_version",
] as const;

function stopDocumentInputShapeIsValid(value: unknown): value is DeriveResearchStopDecisionInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const hasReplan = Object.hasOwn(value, "replan");
  const expected = new Set([...STOP_DOCUMENT_INPUT_KEYS, ...(hasReplan ? ["replan"] : [])]);
  if (!exactObjectKeys(value, [...expected])) {
    return false;
  }
  const input = value as DeriveResearchStopDecisionInput;
  return (
    Array.isArray(input.candidate_queries) &&
    Array.isArray(input.support_decision_documents) &&
    Array.isArray(input.required_disclosures) &&
    exactObjectKeys(input.pre_stop_readiness, [
      "brief_document",
      "material_query_evidence_documents",
      "supplied_disclosures",
    ]) &&
    Array.isArray(input.pre_stop_readiness.material_query_evidence_documents) &&
    Array.isArray(input.pre_stop_readiness.supplied_disclosures)
  );
}

/**
 * Public Stop boundary. Coverage is re-derived from its complete document
 * closure and compared byte-for-byte with the supplied Coverage Candidate
 * document. Support, Brief and material QueryEvidence refs are envelope-derived.
 */
async function deriveResearchStopDecisionCandidateUncached(
  input: DeriveResearchStopDecisionInput,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResearchStopDecisionPayload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      { path: ["candidate_queries"], max_items: U6_WIRE_LIMITS.max_obligations },
      {
        path: ["support_decision_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["required_disclosures"],
        max_items: U6_WIRE_LIMITS.max_required_disclosures,
      },
      {
        path: ["pre_stop_readiness", "material_query_evidence_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["pre_stop_readiness", "supplied_disclosures"],
        max_items: U6_WIRE_LIMITS.max_required_disclosures,
      },
      {
        path: ["coverage_resolution", "obligation_execution_decision_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["coverage_resolution", "query_evidence_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["coverage_resolution", "atomic_claim_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["coverage_resolution", "evidence_relation_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations * 2,
      },
      {
        path: ["coverage_resolution", "evidence_check_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations * 4,
      },
      {
        path: ["coverage_resolution", "support_decision_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["coverage_resolution", "hypothesis_assessment_resolutions"],
        max_items: U6_WIRE_LIMITS.max_hypotheses,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (!stopDocumentInputShapeIsValid(input)) {
    return invalidStopCandidate("Stop 输入必须是 exact document closure、数组与策略字段。");
  }
  const [coverageDocument, planDocument, briefDocument] = await Promise.all([
    resolveResearchDocumentCandidate(input.coverage_document, "CoverageState", requestContext),
    resolveResearchDocumentCandidate(
      input.coverage_resolution.evidence_plan_document,
      "EvidencePlan",
      requestContext,
    ),
    resolveResearchDocumentCandidate(
      input.pre_stop_readiness.brief_document,
      "ResearchBrief",
      requestContext,
    ),
  ]);
  if (!coverageDocument.ok || !planDocument.ok || !briefDocument.ok) {
    return invalidStopCandidate(
      "Stop Coverage/EvidencePlan/ResearchBrief 必须是 strict content-addressed Candidate Document。",
    );
  }
  if (
    coverageDocument.value.document.payload.artifact_type !== "CoverageState" ||
    planDocument.value.document.payload.artifact_type !== "EvidencePlan" ||
    briefDocument.value.document.payload.artifact_type !== "ResearchBrief"
  ) {
    return invalidStopCandidate("Stop document closure Artifact Type 漂移。");
  }
  const regeneratedCoverage = requestContext
    ? await deriveCoverageStateCandidateWithReplayContext(input.coverage_resolution, requestContext)
    : await deriveCoverageStateCandidate(input.coverage_resolution);
  if (
    !regeneratedCoverage.ok ||
    canonicalizeJson(regeneratedCoverage.value) !==
      canonicalizeJson(coverageDocument.value.document.payload)
  ) {
    return invalidStopCandidate(
      "Coverage Document 必须由 hash-bound coverage_resolution 完整重算。",
    );
  }
  if (
    artifactReferenceIdentity(planDocument.value.document.payload.brief_ref) !==
    artifactReferenceIdentity(briefDocument.value.ref)
  ) {
    return invalidStopCandidate(
      "Pre-stop ResearchBrief 必须是 EvidencePlan 绑定的 exact Brief Document。",
    );
  }

  const supportResolutions: SupportedClaimResolution[] = [];
  for (const document of input.support_decision_documents) {
    const resolution = await resolveResearchDocumentCandidate(
      document,
      "SupportDecision",
      requestContext,
    );
    if (!resolution.ok || resolution.value.document.payload.artifact_type !== "SupportDecision") {
      return invalidStopCandidate(
        resolution.ok ? "SupportDecision Document 类型漂移。" : resolution.error.message,
      );
    }
    supportResolutions.push({
      claim_ref: resolution.value.document.payload.claim_ref,
      support_decision_ref: resolution.value.ref as SupportDecisionRef,
      support_decision: resolution.value.document.payload,
    });
  }

  const claimByIdentity = new Map<string, AtomicClaimV2Payload>();
  for (const { document } of input.coverage_resolution.atomic_claim_resolutions) {
    const resolution = await resolveResearchDocumentCandidate(
      document,
      "AtomicClaim",
      requestContext,
    );
    if (!resolution.ok || resolution.value.document.payload.artifact_type !== "AtomicClaim") {
      return invalidStopCandidate(
        resolution.ok ? "AtomicClaim Document 类型漂移。" : resolution.error.message,
      );
    }
    claimByIdentity.set(
      artifactReferenceIdentity(resolution.value.ref),
      resolution.value.document.payload,
    );
  }
  const expectedMaterialEvidenceRefs = supportResolutions
    .filter(({ support_decision }) => ["SUPPORTED", "REFUTED"].includes(support_decision.decision))
    .flatMap(({ claim_ref }) => {
      const claim = claimByIdentity.get(artifactReferenceIdentity(claim_ref));
      return claim?.evidence_refs ?? [];
    });
  const materialEvidencePayloads: QueryEvidenceV2Payload[] = [];
  const actualMaterialEvidenceRefs: QueryEvidenceRef[] = [];
  const coverageEvidenceDocumentByIdentity = new Map<string, L2ResearchDocumentCandidate>();
  for (const { document } of input.coverage_resolution.query_evidence_resolutions) {
    const resolution = await resolveResearchDocumentCandidate(
      document,
      "QueryEvidence",
      requestContext,
    );
    if (!resolution.ok) return invalidStopCandidate(resolution.error.message);
    coverageEvidenceDocumentByIdentity.set(
      artifactReferenceIdentity(resolution.value.ref),
      resolution.value.document,
    );
  }
  for (const document of input.pre_stop_readiness.material_query_evidence_documents) {
    const resolution = await resolveResearchDocumentCandidate(
      document,
      "QueryEvidence",
      requestContext,
    );
    if (
      !resolution.ok ||
      resolution.value.document.payload.artifact_type !== "QueryEvidence" ||
      !coverageEvidenceDocumentByIdentity.has(artifactReferenceIdentity(resolution.value.ref))
    ) {
      return invalidStopCandidate(
        resolution.ok
          ? "Pre-stop material QueryEvidence 必须来自已重算 Coverage closure。"
          : resolution.error.message,
      );
    }
    actualMaterialEvidenceRefs.push(resolution.value.ref as QueryEvidenceRef);
    materialEvidencePayloads.push(resolution.value.document.payload);
  }
  if (!exactReferenceSet(expectedMaterialEvidenceRefs, actualMaterialEvidenceRefs)) {
    return invalidStopCandidate(
      "Pre-stop material QueryEvidence 必须精确等于 SUPPORTED Claim 的 evidence closure。",
    );
  }

  return deriveResearchStopDecisionFromResolvedFactsCandidate({
    coverage_ref: coverageDocument.value.ref as CoverageStateRef,
    coverage: regeneratedCoverage.value,
    candidate_queries: input.candidate_queries,
    support_resolutions: supportResolutions,
    required_disclosures: input.required_disclosures,
    pre_stop_readiness: {
      brief: briefDocument.value.document.payload,
      material_query_evidence: materialEvidencePayloads,
      supplied_disclosures: input.pre_stop_readiness.supplied_disclosures,
    },
    ...(input.replan ? { replan: input.replan } : {}),
    enumerator_version: input.enumerator_version,
    eig_policy_version: input.eig_policy_version,
  });
}

export function deriveResearchStopDecisionCandidate(
  input: DeriveResearchStopDecisionInput,
): Promise<ResearchKernelResult<ResearchStopDecisionPayload>> {
  return deriveResearchStopDecisionCandidateUncached(input);
}

export function deriveResearchStopDecisionCandidateWithReplayContext(
  input: DeriveResearchStopDecisionInput,
  requestContext: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResearchStopDecisionPayload>> {
  return memoizeSuccessfulResearchReplay(requestContext, "stage:stop", input, () =>
    deriveResearchStopDecisionCandidateUncached(input, requestContext),
  );
}

/**
 * Explicit legacy source-module name retained for internal fixture callers.
 * The package root exposes only deriveResearchStopDecisionCandidate.
 */
export const deriveResearchStopDecisionFromDocumentsCandidate = deriveResearchStopDecisionCandidate;

/**
 * Replays the complete Stop derivation before exposing a resolved Candidate.
 *
 * A content-addressed envelope and a self-consistent `decision_input_hash` are
 * insufficient authority: callers must provide the exact production
 * derivation input, including the complete Coverage resolution and pre-stop
 * Brief closure.
 */
async function resolveResearchStopDecisionDocumentResolutionUncached(
  resolution: ResearchStopDecisionDocumentResolution,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedResearchStopDecisionDocument>> {
  const budget = preflightResearchInput(resolution, {
    array_limits: [
      {
        path: ["derivation_input", "candidate_queries"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["derivation_input", "support_decision_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["derivation_input", "pre_stop_readiness", "material_query_evidence_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (!exactObjectKeys(resolution, ["document", "derivation_input"])) {
    return invalidStopCandidate(
      "ResearchStopDecision resolution 必须是 exact document + derivation_input。",
    );
  }
  const [document, derived] = await Promise.all([
    resolveResearchDocumentCandidate(resolution.document, "ResearchStopDecision", requestContext),
    requestContext
      ? deriveResearchStopDecisionCandidateWithReplayContext(
          resolution.derivation_input,
          requestContext,
        )
      : deriveResearchStopDecisionCandidate(resolution.derivation_input),
  ]);
  if (
    !document.ok ||
    !derived.ok ||
    document.value.document.payload.artifact_type !== "ResearchStopDecision" ||
    canonicalizeJson(document.value.document.payload) !== canonicalizeJson(derived.value)
  ) {
    return invalidStopCandidate(
      "ResearchStopDecision Document 必须与 production Stop derivation 精确一致。",
    );
  }
  return researchKernelSuccess({
    ref: document.value.ref as ResearchStopDecisionRef,
    payload: document.value.document.payload,
    derivation_input: resolution.derivation_input,
  });
}

export function resolveResearchStopDecisionDocumentResolution(
  resolution: ResearchStopDecisionDocumentResolution,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedResearchStopDecisionDocument>> {
  return memoizeSuccessfulResearchReplay(
    requestContext,
    "resolution:research-stop-decision",
    resolution,
    () => resolveResearchStopDecisionDocumentResolutionUncached(resolution, requestContext),
  );
}
