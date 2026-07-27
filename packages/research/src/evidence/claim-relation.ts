import {
  type AtomicClaimPredicate,
  type AtomicClaimV2Payload,
  artifactReferenceIdentity,
  atomicClaimPredicateSchema,
  atomicClaimRefSchema,
  atomicClaimV2PayloadSchema,
  type ClaimObservationBinding,
  canonicalizeJson,
  computeSandboxResultHash,
  type EvidenceRelationV2Payload,
  embeddedNodeReferenceIdentity,
  evidenceRelationRefSchema,
  evidenceRelationV2PayloadSchema,
  queryEvidenceRefSchema,
  sandboxResultSchema,
  sha256ContentHash,
  U6_WIRE_LIMITS,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "../errors.js";
import { preflightResearchInput } from "../input-budget.js";
import {
  resolveL2ArtifactDocumentCandidate,
  resolveResearchDocumentCandidate,
} from "../internal/document-resolution.js";
import { computeResearchKernelHash } from "../internal/hash.js";
import {
  sameReference,
  sameReferenceScope,
  stableCompare,
} from "../internal/reference-identity.js";
import type { ResearchRequestReplayContext } from "../internal/request-replay-context.js";
import { verifyAtomicClaimObservation } from "../observation.js";
import { computeResultSchemaHash } from "./oed-query.js";
import {
  createProofDerivationReplayContext,
  type ProofDerivationReplayContext,
  type ResolvedAtomicClaimDerivation,
  type ResolvedEvidenceRelationDerivation,
  replayWithinBoundary,
} from "./proof-replay.js";
import {
  ATOMIC_CLAIM_DOCUMENT_DERIVATION_INPUT_KEYS,
  ATOMIC_CLAIM_INPUT_KEYS,
  ATOMIC_CLAIM_RENDERER_VERSION,
  ATOMIC_CLAIM_RESOLUTION_KEYS,
  type AtomicClaimDerivationResolution,
  type BuildAtomicClaimCandidateInput,
  type BuildEvidenceRelationCandidateInput,
  CLAIM_DIMENSION_SLICE_HASH_DOMAIN,
  CLAIM_INTENT_KEYS,
  CLAIM_OBSERVATION_SELECTOR_KEYS,
  CLAIM_OBSERVATION_SOURCE_KEYS,
  CLAIM_RENDERER_KEYS,
  CLAIM_RESULT_CELL_HASH_DOMAIN,
  CLAIM_ROW_KEY_HASH_DOMAIN,
  CLAIM_TIME_WINDOW_HASH_DOMAIN,
  type ClaimObservationSource,
  EVIDENCE_RELATION_INPUT_KEYS,
  EVIDENCE_RELATION_RESOLUTION_KEYS,
  type EvidenceRelationDerivationResolution,
  hasExactKeys,
  RESOLVED_OBLIGATION_KEYS,
  resolveProofObligation,
  sameStringArray,
  type VerifyAtomicClaimDocumentDerivationInput,
} from "./shared.js";

function scalarStatement(value: ClaimObservationBinding["observed_value"]): string {
  if (value.value_kind === "NUMBER") {
    return `${canonicalizeJson(value.number_value)} ${value.unit}`;
  }
  return canonicalizeJson(value.text_value);
}

function comparisonOperatorStatement(operator: "GT" | "GTE" | "LT" | "LTE" | "EQ"): string {
  switch (operator) {
    case "GT":
      return "大于";
    case "GTE":
      return "大于或等于";
    case "LT":
      return "小于";
    case "LTE":
      return "小于或等于";
    case "EQ":
      return "等于";
  }
}

function renderClaimStatement(
  predicate: AtomicClaimPredicate,
  cells: ReadonlyMap<string, ClaimObservationBinding>,
): string | null {
  switch (predicate.claim_mode) {
    case "DESCRIPTIVE": {
      const cell = cells.get(predicate.observation_binding_id);
      if (!cell) return null;
      return `${cell.output_alias} ${comparisonOperatorStatement(
        predicate.operator,
      )} ${scalarStatement(predicate.asserted_value)}。`;
    }
    case "COMPARATIVE": {
      const left = cells.get(predicate.left_binding_id);
      const right = cells.get(predicate.right_binding_id);
      if (
        !left ||
        !right ||
        left.observed_value.value_kind !== "NUMBER" ||
        right.observed_value.value_kind !== "NUMBER" ||
        left.observed_value.unit !== right.observed_value.unit
      ) {
        return null;
      }
      const relative =
        predicate.relative_delta === null ? "不可定义" : canonicalizeJson(predicate.relative_delta);
      return `${left.output_alias} ${comparisonOperatorStatement(
        predicate.operator,
      )} ${right.output_alias}；绝对差值为 ${canonicalizeJson(
        predicate.absolute_delta,
      )} ${left.observed_value.unit}，相对差值为 ${relative}。`;
    }
    case "DIAGNOSTIC": {
      const outcome = cells.get(predicate.outcome_change_binding_id);
      const contributions = predicate.contribution_binding_ids.map((bindingId) =>
        cells.get(bindingId),
      );
      if (
        outcome?.observed_value.value_kind !== "NUMBER" ||
        contributions.some(
          (cell) =>
            cell?.observed_value.value_kind !== "NUMBER" ||
            cell.observed_value.unit !== outcome.observed_value.unit,
        )
      ) {
        return null;
      }
      const contributionAliases = contributions
        .map((cell) => cell?.output_alias)
        .filter((alias): alias is string => alias !== undefined)
        .join(" + ");
      if (predicate.operator === "SUM_EQUALS") {
        return `${contributionAliases} 合计等于 ${canonicalizeJson(
          predicate.asserted_value,
        )} ${outcome.observed_value.unit}，与 ${outcome.output_alias} 一致。`;
      }
      return `${contributionAliases} 相对 ${outcome.output_alias} 的占比为 ${canonicalizeJson(
        predicate.asserted_value,
      )}。`;
    }
  }
}

async function deriveClaimObservationBinding(
  source: ClaimObservationSource,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ClaimObservationBinding>> {
  if (
    !hasExactKeys(source, CLAIM_OBSERVATION_SOURCE_KEYS) ||
    !hasExactKeys(source.obligation, RESOLVED_OBLIGATION_KEYS) ||
    !hasExactKeys(source.selector, CLAIM_OBSERVATION_SELECTOR_KEYS) ||
    source.selector.row_index !== 0
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "Claim Observation Source 只接受 resolved documents 与最小 selector。",
    );
  }

  const [evidenceResolution, queryResolution, obligationResolution] = await Promise.all([
    resolveResearchDocumentCandidate(
      source.query_evidence_document,
      "QueryEvidence",
      requestContext,
    ),
    resolveL2ArtifactDocumentCandidate(
      source.query_contract_document,
      "QueryContract",
      requestContext,
    ),
    resolveProofObligation(source.obligation, requestContext),
  ]);
  if (!evidenceResolution.ok || !queryResolution.ok || !obligationResolution.ok) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "Claim Observation Source 的 Evidence/QueryContract/Obligation Document 无效。",
    );
  }
  const result = sandboxResultSchema.safeParse(source.sandbox_result);
  if (
    !result.success ||
    (await computeSandboxResultHash(result.data)) !== result.data.result_hash
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "Claim Observation Source 必须消费 hash-bound SandboxResult。",
    );
  }
  const evidence = evidenceResolution.value.document.payload;
  const queryContract = queryResolution.value.document.payload;
  if (
    evidence.artifact_type !== "QueryEvidence" ||
    queryContract.artifact_type !== "QueryContract"
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "Claim Observation Source Artifact Type 漂移。",
    );
  }
  const evidenceRef = queryEvidenceRefSchema.safeParse(evidenceResolution.value.ref);
  if (!evidenceRef.success) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "QueryEvidence Document Reference 类型无效。",
    );
  }
  const obligation = obligationResolution.value;
  const resultColumnNames = result.data.columns.map(({ name }) => name);
  const metricColumnIndex = result.data.columns.findIndex(
    ({ name }) => name === source.selector.output_alias,
  );
  const metricColumn = result.data.columns[metricColumnIndex];
  const row = result.data.rows[0];
  if (!row) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "当前 Candidate 路径只支持单行 Result Cell。",
    );
  }
  const observedValue = row[metricColumnIndex];
  if (
    !sameReference(evidence.query_contract_ref, queryResolution.value.ref) ||
    !sameReference(evidence.sandbox_result_ref, result.data.result_ref) ||
    embeddedNodeReferenceIdentity(evidence.obligation_ref) !==
      embeddedNodeReferenceIdentity(obligation.obligation_ref) ||
    !sameReference(queryContract.evidence_plan_ref, obligation.plan_ref) ||
    evidence.observation.result_hash !== result.data.result_hash ||
    evidence.observation.row_count !== result.data.row_count ||
    evidence.observation.schema_hash !== (await computeResultSchemaHash(result.data)) ||
    !sameStringArray(queryContract.result_contract.columns, resultColumnNames) ||
    result.data.row_count !== 1 ||
    result.data.rows.length !== 1 ||
    source.selector.output_alias !== queryContract.metric ||
    metricColumnIndex < 0 ||
    (metricColumn?.type !== "INTEGER" && metricColumn?.type !== "NUMBER") ||
    typeof observedValue !== "number" ||
    !Number.isFinite(observedValue) ||
    queryContract.unit !== obligation.obligation.observation_contract.unit
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "当前 Candidate 路径只支持与 QueryContract 精确闭合的单行数值 Metric Result Cell。",
    );
  }
  if (
    !sameReferenceScope(evidenceRef.data, queryResolution.value.ref) ||
    !sameReferenceScope(evidenceRef.data, obligation.plan_ref) ||
    !sameReferenceScope(evidenceRef.data, result.data.result_ref)
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "Claim Observation Source 必须属于同一 Scope/Run。",
    );
  }

  const dimensionSlice = queryContract.dimensions.map((outputAlias, index) => ({
    output_alias: outputAlias,
    value: row[index],
  }));
  const time_window_hash = await sha256ContentHash({
    hash_domain: CLAIM_TIME_WINDOW_HASH_DOMAIN,
    time_range: queryContract.time_range,
  });
  const dimension_slice_hash = await sha256ContentHash({
    hash_domain: CLAIM_DIMENSION_SLICE_HASH_DOMAIN,
    dimensions: dimensionSlice,
  });
  const row_key_hash = await sha256ContentHash({
    hash_domain: CLAIM_ROW_KEY_HASH_DOMAIN,
    evidence_ref: evidenceRef.data,
    row_index: source.selector.row_index,
    dimension_slice_hash,
  });
  const claimObservedValue = {
    value_kind: "NUMBER",
    number_value: observedValue,
    text_value: null,
    unit: queryContract.unit,
  } as const;
  const result_cell_hash = await sha256ContentHash({
    hash_domain: CLAIM_RESULT_CELL_HASH_DOMAIN,
    evidence_ref: evidenceRef.data,
    sandbox_result_ref: result.data.result_ref,
    result_hash: result.data.result_hash,
    output_alias: source.selector.output_alias,
    row_key_hash,
    observed_value: claimObservedValue,
    time_window_hash,
    dimension_slice_hash,
  });

  return researchKernelSuccess({
    binding_id: source.selector.binding_id,
    evidence_ref: evidenceRef.data,
    metric_ref: obligation.obligation.observation_contract.metric_ref,
    output_alias: source.selector.output_alias,
    row_key_hash,
    observed_value: claimObservedValue,
    time_window_hash,
    dimension_slice_hash,
    result_cell_hash,
  });
}

/**
 * Builds an AtomicClaim payload Candidate from resolved QueryEvidence and
 * SandboxResult documents. The derived cells are structural Candidate facts,
 * not server-only authority brands.
 */
export async function buildAtomicClaimCandidate(
  input: BuildAtomicClaimCandidateInput,
): Promise<ResearchKernelResult<AtomicClaimV2Payload>> {
  return buildAtomicClaimCandidateWithReplayContext(input, createProofDerivationReplayContext());
}

export async function buildAtomicClaimCandidateWithReplayContext(
  input: BuildAtomicClaimCandidateInput,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<AtomicClaimV2Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["observation_sources"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !hasExactKeys(input, ATOMIC_CLAIM_INPUT_KEYS) ||
    !hasExactKeys(input.claim_intent, CLAIM_INTENT_KEYS) ||
    !hasExactKeys(input.renderer, CLAIM_RENDERER_KEYS) ||
    !Array.isArray(input.observation_sources) ||
    input.renderer.renderer_version !== ATOMIC_CLAIM_RENDERER_VERSION ||
    input.renderer.locale !== "zh-CN"
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "AtomicClaim Candidate 输入包含缺失、未声明或不支持的 renderer 字段。",
    );
  }

  const predicate = atomicClaimPredicateSchema.safeParse(input.predicate);
  if (!predicate.success || input.observation_sources.length === 0) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      predicate.success
        ? "AtomicClaim 至少需要一个 resolved Observation Source。"
        : (predicate.error.issues[0]?.message ?? "AtomicClaim Predicate 无效。"),
    );
  }

  const derivedCells: ClaimObservationBinding[] = [];
  for (const source of input.observation_sources) {
    const derived = await deriveClaimObservationBinding(source, context.request_context);
    if (!derived.ok) return derived;
    derivedCells.push(derived.value);
  }
  const observation_bindings = [...derivedCells].sort((left, right) =>
    stableCompare(left.binding_id, right.binding_id),
  );
  const cellByBinding = new Map(observation_bindings.map((cell) => [cell.binding_id, cell]));
  if (
    cellByBinding.size !== observation_bindings.length ||
    new Set(observation_bindings.map(({ result_cell_hash }) => result_cell_hash)).size !==
      observation_bindings.length
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "Observation binding_id 与 derived Result Cell 必须分别唯一。",
    );
  }
  const evidenceByIdentity = new Map(
    observation_bindings.map(({ evidence_ref }) => [
      artifactReferenceIdentity(evidence_ref),
      evidence_ref,
    ]),
  );
  const evidence_refs = [...evidenceByIdentity.entries()]
    .sort(([left], [right]) => stableCompare(left, right))
    .map(([, reference]) => reference);

  const scopeAnchor = observation_bindings[0]?.evidence_ref;
  if (
    !scopeAnchor ||
    observation_bindings.some(
      ({ evidence_ref, metric_ref }) =>
        !sameReferenceScope(scopeAnchor, evidence_ref) ||
        !sameReferenceScope(scopeAnchor, metric_ref.container_ref),
    )
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "AtomicClaim derived Observation Cells 必须属于同一 Scope/Run。",
    );
  }

  const statement = renderClaimStatement(predicate.data, cellByBinding);
  if (statement === null) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "AtomicClaim renderer 不能解析 Predicate 的 exact Observation Binding 或单位。",
    );
  }
  const statement_hash = await computeResearchKernelHash("u6-atomic-claim-statement@1", {
    renderer_version: input.renderer.renderer_version,
    locale: input.renderer.locale,
    statement,
  });
  const candidate = atomicClaimV2PayloadSchema.safeParse({
    artifact_type: "AtomicClaim",
    protocol_version: "atomic-claim@2.0.0",
    claim_id: input.claim_intent.claim_id,
    observation_bindings,
    predicate: predicate.data,
    claim_renderer_version: input.renderer.renderer_version,
    statement,
    statement_hash,
    evidence_refs,
    limitations: input.claim_intent.limitations,
  });
  if (!candidate.success) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      candidate.error.issues[0]?.message ?? "AtomicClaim Candidate 无效。",
    );
  }

  // verifyAtomicClaimObservation is used only as the deterministic predicate verifier.
  // Passing derived structural cells here does not create an authority brand.
  return verifyAtomicClaimObservation(candidate.data, observation_bindings);
}

/**
 * Repo-internal semantic verifier for a content-addressed AtomicClaim Candidate.
 * It requires the same complete observation sources as the builder, re-derives
 * every binding and renderer field, and compares the entire payload exactly.
 *
 * This remains structural Candidate verification. It does not establish that
 * any supplied document is persisted, current, COMMITTED, or authority-branded.
 */
export async function verifyAtomicClaimDocumentDerivation(
  input: VerifyAtomicClaimDocumentDerivationInput,
): Promise<ResearchKernelResult<AtomicClaimV2Payload>> {
  return verifyAtomicClaimDocumentDerivationWithReplayContext(
    input,
    createProofDerivationReplayContext(),
  );
}

export async function verifyAtomicClaimDocumentDerivationWithReplayContext(
  input: VerifyAtomicClaimDocumentDerivationInput,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<AtomicClaimV2Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["observation_sources"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !hasExactKeys(input, ATOMIC_CLAIM_DOCUMENT_DERIVATION_INPUT_KEYS) ||
    !Array.isArray(input.observation_sources)
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "AtomicClaim derivation verifier 必须消费完整 Claim Document 与 Observation Sources。",
    );
  }
  const resolution = await resolveResearchDocumentCandidate(
    input.claim_document,
    "AtomicClaim",
    context.request_context,
  );
  if (!resolution.ok || resolution.value.document.payload.artifact_type !== "AtomicClaim") {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      resolution.ok ? "AtomicClaim Document 类型漂移。" : resolution.error.message,
    );
  }
  const claim = resolution.value.document.payload;
  if (claim.claim_renderer_version !== ATOMIC_CLAIM_RENDERER_VERSION) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "AtomicClaim Document 使用了当前 verifier 不支持的 renderer_version。",
    );
  }
  const rebuilt = await buildAtomicClaimCandidateWithReplayContext(
    {
      claim_intent: {
        claim_id: claim.claim_id,
        limitations: claim.limitations,
      },
      predicate: claim.predicate,
      observation_sources: input.observation_sources,
      renderer: {
        renderer_version: ATOMIC_CLAIM_RENDERER_VERSION,
        locale: "zh-CN",
      },
    },
    context,
  );
  if (!rebuilt.ok || canonicalizeJson(rebuilt.value) !== canonicalizeJson(claim)) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      rebuilt.ok
        ? "AtomicClaim Document 必须逐字段等于 resolved sources 的确定性重派生结果。"
        : rebuilt.error.message,
    );
  }
  return researchKernelSuccess(claim);
}

/**
 * Builds one Claim×Evidence relation Candidate from complete content-addressed
 * Research Documents. Adverse relations are preserved; this function does not
 * derive support, authority, COMMITTED state, or READY state.
 */
export async function buildEvidenceRelationCandidate(
  input: BuildEvidenceRelationCandidateInput,
): Promise<ResearchKernelResult<EvidenceRelationV2Payload>> {
  return buildEvidenceRelationCandidateWithReplayContext(
    input,
    createProofDerivationReplayContext(),
  );
}

export async function buildEvidenceRelationCandidateWithReplayContext(
  input: BuildEvidenceRelationCandidateInput,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<EvidenceRelationV2Payload>> {
  const budget = preflightResearchInput(input);
  if (!budget.ok) return budget;

  if (
    !hasExactKeys(input, EVIDENCE_RELATION_INPUT_KEYS) ||
    !hasExactKeys(input.obligation, RESOLVED_OBLIGATION_KEYS)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "EvidenceRelation Candidate 输入包含缺失或未声明字段。",
    );
  }

  const [claimResolution, evidenceResolution, obligationResolution] = await Promise.all([
    resolveResearchDocumentCandidate(input.claim_document, "AtomicClaim", context.request_context),
    resolveResearchDocumentCandidate(
      input.evidence_document,
      "QueryEvidence",
      context.request_context,
    ),
    resolveProofObligation(input.obligation, context.request_context),
  ]);
  if (!claimResolution.ok) return claimResolution;
  if (!evidenceResolution.ok) return evidenceResolution;
  if (!obligationResolution.ok) return obligationResolution;
  const claim = claimResolution.value.document.payload;
  const evidence = evidenceResolution.value.document.payload;
  if (claim.artifact_type !== "AtomicClaim" || evidence.artifact_type !== "QueryEvidence") {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "EvidenceRelation resolved Research Document 类型漂移。",
    );
  }

  const evidenceIdentity = artifactReferenceIdentity(evidenceResolution.value.ref);
  if (
    !claim.evidence_refs.some(
      (reference) => artifactReferenceIdentity(reference) === evidenceIdentity,
    ) ||
    embeddedNodeReferenceIdentity(evidence.obligation_ref) !==
      embeddedNodeReferenceIdentity(obligationResolution.value.obligation_ref)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "Relation Evidence 必须由 Claim 列出，并与 resolved EvidencePlan exact Obligation 一致。",
    );
  }
  if (
    !sameReferenceScope(claimResolution.value.ref, evidenceResolution.value.ref) ||
    !sameReferenceScope(claimResolution.value.ref, obligationResolution.value.plan_ref)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "EvidenceRelation 的 Claim、Evidence 与 Obligation 必须属于同一 Scope/Run。",
    );
  }

  const candidate = evidenceRelationV2PayloadSchema.safeParse({
    artifact_type: "EvidenceRelation",
    protocol_version: "evidence-relation@2.0.0",
    claim_ref: claimResolution.value.ref,
    evidence_ref: evidenceResolution.value.ref,
    proposed_relation: input.proposed_relation,
    rationale: input.rationale,
    obligation_ref: obligationResolution.value.obligation_ref,
  });
  return candidate.success
    ? researchKernelSuccess(candidate.data)
    : researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        candidate.error.issues[0]?.message ?? "EvidenceRelation Candidate 无效。",
      );
}

async function resolveAtomicClaimDerivationUncached(
  resolution: AtomicClaimDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedAtomicClaimDerivation>> {
  const budget = preflightResearchInput(resolution);
  if (!budget.ok) return budget;
  if (!hasExactKeys(resolution, ATOMIC_CLAIM_RESOLUTION_KEYS)) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      "AtomicClaim derivation resolution 必须是 exact document+derivation_input。",
    );
  }
  const [document, verified] = await Promise.all([
    resolveResearchDocumentCandidate(resolution.document, "AtomicClaim", context.request_context),
    verifyAtomicClaimDocumentDerivationWithReplayContext(
      {
        claim_document: resolution.document,
        observation_sources: resolution.derivation_input.observation_sources,
      },
      context,
    ),
  ]);
  if (!document.ok) return document;
  if (
    !verified.ok ||
    document.value.document.payload.artifact_type !== "AtomicClaim" ||
    canonicalizeJson(document.value.document.payload) !== canonicalizeJson(verified.value)
  ) {
    return researchKernelFailure(
      "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
      !verified.ok
        ? verified.error.message
        : "AtomicClaim Document 与 production derivation 不一致。",
    );
  }
  const ref = atomicClaimRefSchema.safeParse(document.value.ref);
  return ref.success
    ? researchKernelSuccess({ ref: ref.data, payload: verified.value })
    : researchKernelFailure(
        "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
        "AtomicClaim derived Reference 类型无效。",
      );
}

export function resolveAtomicClaimDerivationWithReplayContext(
  resolution: AtomicClaimDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedAtomicClaimDerivation>> {
  if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) {
    return resolveAtomicClaimDerivationUncached(resolution, context);
  }
  return replayWithinBoundary(context, "atomic-claim", context.atomic_claim, resolution, () =>
    resolveAtomicClaimDerivationUncached(resolution, context),
  );
}

async function resolveEvidenceRelationDerivationUncached(
  resolution: EvidenceRelationDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedEvidenceRelationDerivation>> {
  const budget = preflightResearchInput(resolution);
  if (!budget.ok) return budget;
  if (!hasExactKeys(resolution, EVIDENCE_RELATION_RESOLUTION_KEYS)) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "EvidenceRelation derivation resolution 必须是 exact document+derivation_input。",
    );
  }
  const [document, derived] = await Promise.all([
    resolveResearchDocumentCandidate(
      resolution.document,
      "EvidenceRelation",
      context.request_context,
    ),
    buildEvidenceRelationCandidateWithReplayContext(resolution.derivation_input, context),
  ]);
  if (!document.ok) return document;
  if (
    !derived.ok ||
    document.value.document.payload.artifact_type !== "EvidenceRelation" ||
    canonicalizeJson(document.value.document.payload) !== canonicalizeJson(derived.value)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      derived.ok
        ? "EvidenceRelation Document 与 production derivation 不一致。"
        : derived.error.message,
    );
  }
  const ref = evidenceRelationRefSchema.safeParse(document.value.ref);
  return ref.success
    ? researchKernelSuccess({ ref: ref.data, payload: derived.value })
    : researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        "EvidenceRelation derived Reference 类型无效。",
      );
}

export function resolveEvidenceRelationDerivationWithReplayContext(
  resolution: EvidenceRelationDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedEvidenceRelationDerivation>> {
  if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) {
    return resolveEvidenceRelationDerivationUncached(resolution, context);
  }
  return replayWithinBoundary(
    context,
    "evidence-relation",
    context.evidence_relation,
    resolution,
    () => resolveEvidenceRelationDerivationUncached(resolution, context),
  );
}
