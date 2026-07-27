import {
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  computeL2ResearchSemanticHash,
  computeSandboxExecutionReceiptHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  computeSqlArtifactQueryHash,
  embeddedNodeReferenceIdentity,
  OBLIGATION_SEMANTIC_CHECKS,
  type ObligationExecutionDecisionPayload,
  type ObligationExecutionDecisionRef,
  obligationExecutionDecisionRefSchema,
  policyReceiptRefSchema,
  type QueryEvidenceV2Payload,
  queryContractRefSchema,
  queryEvidenceRefSchema,
  queryEvidenceV2PayloadSchema,
  researchBriefRefSchema,
  type SandboxResult,
  type SuccessfulSandboxExecutionReceipt,
  sandboxResultSchema,
  semanticReleaseRefSchema,
  sha256ContentHash,
  sqlArtifactRefSchema,
  successfulSandboxExecutionReceiptSchema,
  U6_WIRE_LIMITS,
  versionFrontierSchema,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "../errors.js";
import { evaluateObligationExecution } from "../evidence.js";
import { preflightResearchInput } from "../input-budget.js";
import {
  type ResolvedResearchDocumentCandidate,
  resolveL2ArtifactDocumentCandidate,
  resolveResearchDocumentCandidate,
} from "../internal/document-resolution.js";
import {
  sameIdentitySet,
  sameReference,
  sameReferenceScope,
} from "../internal/reference-identity.js";
import { memoizeSuccessfulResearchReplay } from "../internal/request-replay-context.js";
import { lookupTransientOedAssuranceMetadata } from "../internal/transient-oed-assurance.js";
import {
  createProofDerivationReplayContext,
  type ProofDerivationReplayContext,
  type ResolvedQueryEvidenceDerivation,
  replayWithinBoundary,
} from "./proof-replay.js";
import {
  type BuildObligationExecutionDecisionCandidateInput,
  type BuildQueryEvidenceCandidateInput,
  hasExactInputReferenceClosure,
  hasExactKeys,
  OBLIGATION_EXECUTION_INPUT_KEYS,
  OBLIGATION_EXECUTION_INPUT_KEYS_WITH_ASSURANCE,
  OBLIGATION_EXECUTION_RESOLUTION_KEYS,
  type ObligationExecutionDecisionDocumentResolution,
  QUERY_EVIDENCE_INPUT_KEYS,
  QUERY_EVIDENCE_L2_KEYS,
  QUERY_EVIDENCE_PROVENANCE_HASH_DOMAIN,
  QUERY_EVIDENCE_RESOLUTION_KEYS,
  QUERY_EVIDENCE_SANDBOX_KEYS,
  QUERY_EVIDENCE_SCHEMA_HASH_DOMAIN,
  type QueryEvidenceDerivationResolution,
  RESOLVED_OBLIGATION_KEYS,
  resolveProofObligation,
  sameStringArray,
} from "./shared.js";

export async function computeResultSchemaHash(result: SandboxResult): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    hash_domain: QUERY_EVIDENCE_SCHEMA_HASH_DOMAIN,
    schema_version: result.schema_version,
    columns: result.columns,
  });
}

async function deriveProvenanceGroup(receipt: SuccessfulSandboxExecutionReceipt): Promise<string> {
  const hash = await sha256ContentHash({
    hash_domain: QUERY_EVIDENCE_PROVENANCE_HASH_DOMAIN,
    datasource_id: receipt.datasource_id,
    executor: receipt.executor,
    executor_role: receipt.executor_role,
    authority_role_policy_version: receipt.authority_role_policy_version,
  });
  return `sandbox:${hash.slice("sha256:".length)}`;
}

/**
 * Derives all twelve pre-Sandbox semantic checks from resolved documents and
 * one process-local controlled-profile assurance.
 *
 * The pure Research package cannot verify the production compiler/policy
 * authority closure. Without an identity-protected server assurance every
 * check therefore fails closed; SQL aliases, comments, string literals and
 * same-scope references are never treated as semantic or authorization proof.
 */
export async function buildObligationExecutionDecisionCandidate(
  input: BuildObligationExecutionDecisionCandidateInput,
): Promise<ResearchKernelResult<ObligationExecutionDecisionPayload>> {
  return buildObligationExecutionDecisionCandidateWithReplayContext(
    input,
    createProofDerivationReplayContext(),
  );
}

export async function buildObligationExecutionDecisionCandidateWithReplayContext(
  input: BuildObligationExecutionDecisionCandidateInput,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ObligationExecutionDecisionPayload>> {
  const budget = preflightResearchInput(input);
  if (!budget.ok) return budget;

  if (
    (!hasExactKeys(input, OBLIGATION_EXECUTION_INPUT_KEYS) &&
      !hasExactKeys(input, OBLIGATION_EXECUTION_INPUT_KEYS_WITH_ASSURANCE)) ||
    !hasExactKeys(input.obligation, RESOLVED_OBLIGATION_KEYS)
  ) {
    return researchKernelFailure(
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      "OED builder 必须消费 exact Brief/Plan/Query/SQL/Frontier 输入。",
    );
  }
  const [briefResolution, obligationResolution, queryContractResolution, sqlArtifactResolution] =
    await Promise.all([
      resolveResearchDocumentCandidate(
        input.brief_document,
        "ResearchBrief",
        context.request_context,
      ),
      resolveProofObligation(input.obligation, context.request_context),
      resolveL2ArtifactDocumentCandidate(
        input.query_contract_document,
        "QueryContract",
        context.request_context,
      ),
      resolveL2ArtifactDocumentCandidate(
        input.sql_artifact_document,
        "SqlArtifact",
        context.request_context,
      ),
    ]);
  if (!briefResolution.ok) return briefResolution;
  if (!obligationResolution.ok) return obligationResolution;
  if (!queryContractResolution.ok) return queryContractResolution;
  if (!sqlArtifactResolution.ok) return sqlArtifactResolution;

  const semanticReleaseRef = semanticReleaseRefSchema.safeParse(input.semantic_release_ref);
  const policyReceiptRef = policyReceiptRefSchema.safeParse(input.policy_receipt_ref);
  const brief = briefResolution.value.document.payload;
  const queryContract = queryContractResolution.value.document.payload;
  const sqlArtifact = sqlArtifactResolution.value.document.payload;
  if (
    !semanticReleaseRef.success ||
    !policyReceiptRef.success ||
    brief.artifact_type !== "ResearchBrief" ||
    queryContract.artifact_type !== "QueryContract" ||
    sqlArtifact.artifact_type !== "SqlArtifact"
  ) {
    return researchKernelFailure(
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      "OED builder 的 Brief/Query/SQL/Semantic/Policy 类型无效。",
    );
  }
  if (
    !hasExactInputReferenceClosure(queryContractResolution.value.document, [
      queryContract.evidence_plan_ref,
    ]) ||
    !hasExactInputReferenceClosure(sqlArtifactResolution.value.document, [
      sqlArtifact.logical_plan_ref,
    ]) ||
    (await computeSqlArtifactQueryHash(sqlArtifact)) !== sqlArtifact.query_hash
  ) {
    return researchKernelFailure(
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      "OED builder 要求 QueryContract/SqlArtifact 具有 exact input closure 与 query_hash。",
    );
  }

  const obligation = obligationResolution.value;
  const observationContract = obligation.obligation.observation_contract;
  const planRef = obligation.plan_ref;
  const briefRef = briefResolution.value.ref;
  const typedBriefRef = researchBriefRefSchema.safeParse(briefRef);
  const typedQueryContractRef = queryContractRefSchema.safeParse(queryContractResolution.value.ref);
  const typedSqlArtifactRef = sqlArtifactRefSchema.safeParse(sqlArtifactResolution.value.ref);
  if (!typedBriefRef.success || !typedQueryContractRef.success || !typedSqlArtifactRef.success) {
    return researchKernelFailure(
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      "OED builder 不能从 Brief/QueryContract/SqlArtifact Document 派生 typed exact Reference。",
    );
  }
  const scopedReferences: ArtifactReference[] = [
    briefRef,
    planRef,
    queryContractResolution.value.ref,
    sqlArtifactResolution.value.ref,
    sqlArtifact.logical_plan_ref,
    semanticReleaseRef.data,
    policyReceiptRef.data,
    observationContract.metric_ref.container_ref,
  ];
  if (
    scopedReferences.some((reference) => !sameReferenceScope(planRef, reference)) ||
    !sameReference(obligation.plan_brief_ref, briefRef) ||
    !sameReference(queryContract.evidence_plan_ref, planRef) ||
    !sameReference(brief.policy_ref, policyReceiptRef.data) ||
    !sameReference(observationContract.metric_ref.container_ref, semanticReleaseRef.data) ||
    !brief.scope.metric_refs.some(
      (reference) =>
        embeddedNodeReferenceIdentity(reference) ===
        embeddedNodeReferenceIdentity(observationContract.metric_ref),
    )
  ) {
    return researchKernelFailure(
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      "OED builder 的 Brief/Plan/Metric/Policy/Semantic exact binding 不闭合。",
    );
  }

  const assurance = lookupTransientOedAssuranceMetadata(input.assurance);
  const bindingIdentities = assurance?.binding_identities;
  const assuranceMatchesExactClosure =
    assurance?.boundary === "KERNEL_CANDIDATE_ONLY" &&
    assurance.persistence_authority === "NONE" &&
    assurance.can_authorize_execution === false &&
    bindingIdentities?.brief_ref === artifactReferenceIdentity(briefRef) &&
    bindingIdentities.evidence_plan_ref === artifactReferenceIdentity(planRef) &&
    bindingIdentities.query_contract_ref ===
      artifactReferenceIdentity(queryContractResolution.value.ref) &&
    bindingIdentities.sql_artifact_ref ===
      artifactReferenceIdentity(sqlArtifactResolution.value.ref) &&
    bindingIdentities.semantic_release_ref === artifactReferenceIdentity(semanticReleaseRef.data) &&
    bindingIdentities.policy_receipt_ref === artifactReferenceIdentity(policyReceiptRef.data) &&
    assurance.compiler_evidence_hash === sqlArtifact.query_hash &&
    assurance.policy_evidence_hash === policyReceiptRef.data.content_hash;
  const checks = Object.fromEntries(
    OBLIGATION_SEMANTIC_CHECKS.map((check) => [
      check,
      assuranceMatchesExactClosure && assurance?.semantic_checks[check] === "MATCH",
    ]),
  ) as Readonly<Record<(typeof OBLIGATION_SEMANTIC_CHECKS)[number], boolean>>;
  return evaluateObligationExecution({
    brief_ref: typedBriefRef.data,
    obligation_ref: obligation.obligation_ref,
    query_contract_ref: typedQueryContractRef.data,
    sql_artifact_ref: typedSqlArtifactRef.data,
    semantic_release_ref: semanticReleaseRef.data,
    policy_receipt_ref: policyReceiptRef.data,
    observation_contract_hash: obligation.observation_contract_hash,
    matches: checks,
    evaluator_version: input.evaluator_version,
  });
}

export interface ResolvedObligationExecutionDecisionDerivation {
  readonly ref: ObligationExecutionDecisionRef;
  readonly payload: ObligationExecutionDecisionPayload;
}

/**
 * Replays the production OED builder and compares the canonical payload before
 * any downstream proof artifact may consume the decision.
 */
async function resolveObligationExecutionDecisionDerivationUncached(
  resolution: ObligationExecutionDecisionDocumentResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedObligationExecutionDecisionDerivation>> {
  const budget = preflightResearchInput(resolution);
  if (!budget.ok) return budget;
  if (!hasExactKeys(resolution, OBLIGATION_EXECUTION_RESOLUTION_KEYS)) {
    return researchKernelFailure(
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      "OED derivation resolution 必须是 exact document+derivation_input。",
    );
  }
  const [document, derived] = await Promise.all([
    resolveResearchDocumentCandidate(
      resolution.document,
      "ObligationExecutionDecision",
      context.request_context,
    ),
    buildObligationExecutionDecisionCandidateWithReplayContext(
      resolution.derivation_input,
      context,
    ),
  ]);
  if (!document.ok) return document;
  if (
    !derived.ok ||
    document.value.document.payload.artifact_type !== "ObligationExecutionDecision" ||
    canonicalizeJson(document.value.document.payload) !== canonicalizeJson(derived.value)
  ) {
    return researchKernelFailure(
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      derived.ok ? "OED Document 与 production derivation 不一致。" : derived.error.message,
    );
  }
  const ref = obligationExecutionDecisionRefSchema.safeParse(document.value.ref);
  return ref.success
    ? researchKernelSuccess({ ref: ref.data, payload: derived.value })
    : researchKernelFailure(
        "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
        "OED derived Reference 类型无效。",
      );
}

export function resolveObligationExecutionDecisionDerivationWithReplayContext(
  resolution: ObligationExecutionDecisionDocumentResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedObligationExecutionDecisionDerivation>> {
  return memoizeSuccessfulResearchReplay(
    context.request_context,
    "proof:obligation-execution",
    resolution,
    () => resolveObligationExecutionDecisionDerivationUncached(resolution, context),
  );
}

export function resolveObligationExecutionDecisionDerivation(
  resolution: ObligationExecutionDecisionDocumentResolution,
): Promise<ResearchKernelResult<ResolvedObligationExecutionDecisionDerivation>> {
  return resolveObligationExecutionDecisionDerivationUncached(
    resolution,
    createProofDerivationReplayContext(),
  );
}

/**
 * Builds a QueryEvidence payload Candidate from two resolved closure segments:
 * content-addressed L2 documents and a strict successful Sandbox receipt/result.
 *
 * Content-address validation is not persistence/current-authority validation.
 * This function does not issue an authority brand, COMMITTED status, READY state,
 * or any public terminal.
 */
export async function buildQueryEvidenceCandidate(
  input: BuildQueryEvidenceCandidateInput,
): Promise<ResearchKernelResult<QueryEvidenceV2Payload>> {
  return buildQueryEvidenceCandidateWithReplayContext(input, createProofDerivationReplayContext());
}

export async function buildQueryEvidenceCandidateWithReplayContext(
  input: BuildQueryEvidenceCandidateInput,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<QueryEvidenceV2Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["dependency_evidence_documents"],
        max_items: U6_WIRE_LIMITS.max_dependencies_per_obligation,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !hasExactKeys(input, QUERY_EVIDENCE_INPUT_KEYS) ||
    !hasExactKeys(input.obligation, RESOLVED_OBLIGATION_KEYS) ||
    !hasExactKeys(input.l2, QUERY_EVIDENCE_L2_KEYS) ||
    !hasExactKeys(input.sandbox, QUERY_EVIDENCE_SANDBOX_KEYS) ||
    !Array.isArray(input.dependency_evidence_documents)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "QueryEvidence Candidate 输入包含缺失或未声明字段。",
    );
  }

  const [
    obligationResolution,
    oedResolution,
    queryContractResolution,
    sqlArtifactResolution,
    validationReceiptResolution,
    executionReceiptResolution,
  ] = await Promise.all([
    resolveProofObligation(input.obligation, context.request_context),
    resolveObligationExecutionDecisionDerivationWithReplayContext(
      input.obligation_execution_decision_resolution,
      context,
    ),
    resolveL2ArtifactDocumentCandidate(
      input.l2.query_contract_document,
      "QueryContract",
      context.request_context,
    ),
    resolveL2ArtifactDocumentCandidate(
      input.l2.sql_artifact_document,
      "SqlArtifact",
      context.request_context,
    ),
    resolveL2ArtifactDocumentCandidate(
      input.l2.validation_receipt_document,
      "ValidationReceipt",
      context.request_context,
    ),
    resolveL2ArtifactDocumentCandidate(
      input.l2.execution_receipt_document,
      "ExecutionReceipt",
      context.request_context,
    ),
  ]);
  if (!obligationResolution.ok) return obligationResolution;
  if (!oedResolution.ok) return oedResolution;
  if (!queryContractResolution.ok) return queryContractResolution;
  if (!sqlArtifactResolution.ok) return sqlArtifactResolution;
  if (!validationReceiptResolution.ok) return validationReceiptResolution;
  if (!executionReceiptResolution.ok) return executionReceiptResolution;

  const observedVersion = versionFrontierSchema.safeParse(input.observed_version);
  const sandboxReceipt = successfulSandboxExecutionReceiptSchema.safeParse(
    input.sandbox.sandbox_execution_receipt,
  );
  const sandboxResult = sandboxResultSchema.safeParse(input.sandbox.sandbox_result);
  if (!observedVersion.success || !sandboxReceipt.success || !sandboxResult.success) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "QueryEvidence 必须消费 strict VersionFrontier、Successful Sandbox Receipt 与 Result。",
    );
  }

  const oed = oedResolution.value.payload;
  const queryContract = queryContractResolution.value.document.payload;
  const sqlArtifact = sqlArtifactResolution.value.document.payload;
  const validationReceipt = validationReceiptResolution.value.document.payload;
  const executionReceipt = executionReceiptResolution.value.document.payload;
  if (
    oed.artifact_type !== "ObligationExecutionDecision" ||
    queryContract.artifact_type !== "QueryContract" ||
    sqlArtifact.artifact_type !== "SqlArtifact" ||
    validationReceipt.artifact_type !== "ValidationReceipt" ||
    executionReceipt.artifact_type !== "ExecutionReceipt"
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "QueryEvidence resolved closure 的 Artifact Type 漂移。",
    );
  }

  if (
    !hasExactInputReferenceClosure(queryContractResolution.value.document, [
      queryContract.evidence_plan_ref,
    ]) ||
    !hasExactInputReferenceClosure(sqlArtifactResolution.value.document, [
      sqlArtifact.logical_plan_ref,
    ]) ||
    !hasExactInputReferenceClosure(executionReceiptResolution.value.document, [
      executionReceipt.sql_artifact_ref,
      executionReceipt.execution_permit_ref,
      executionReceipt.sandbox_execution_receipt_ref,
      executionReceipt.result_artifact_ref,
    ]) ||
    !hasExactInputReferenceClosure(validationReceiptResolution.value.document, [
      validationReceipt.sql_artifact_ref,
      validationReceipt.execution_receipt_ref,
      ...validationReceipt.gate_receipt_refs,
    ])
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "L2 Document envelope.input_refs 必须严格等于各 Payload 的 Reference 闭包。",
    );
  }

  const obligation = obligationResolution.value;
  const observationContract = obligation.obligation.observation_contract;
  const observedDecisionHash = await computeL2ResearchSemanticHash(oed);
  if (
    observedDecisionHash !== oed.decision_semantic_hash ||
    oed.verdict !== "PASS" ||
    !sameReference(oed.brief_ref, obligation.plan_brief_ref) ||
    embeddedNodeReferenceIdentity(oed.obligation_ref) !==
      embeddedNodeReferenceIdentity(obligation.obligation_ref) ||
    !sameReference(oed.query_contract_ref, queryContractResolution.value.ref) ||
    !sameReference(oed.sql_artifact_ref, sqlArtifactResolution.value.ref) ||
    oed.observation_contract_hash !== observationContract.contract_hash ||
    !sameReference(oed.semantic_release_ref, observedVersion.data.semantic_release_ref) ||
    !sameReference(oed.policy_receipt_ref, observedVersion.data.policy_receipt_ref)
  ) {
    return researchKernelFailure(
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      "QueryEvidence 只能消费同 Obligation、QueryContract、SqlArtifact 与 Frontier 的 replayed OED PASS。",
    );
  }
  if (
    !sameReference(queryContract.evidence_plan_ref, obligation.plan_ref) ||
    queryContract.unit !== observationContract.unit
  ) {
    return researchKernelFailure(
      "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      "QueryContract 必须绑定 exact EvidencePlan，且单位与 Observation Contract 一致。",
    );
  }

  const observedSqlQueryHash = await computeSqlArtifactQueryHash(sqlArtifact);
  if (
    observedSqlQueryHash !== sqlArtifact.query_hash ||
    !sameReference(executionReceipt.sql_artifact_ref, sqlArtifactResolution.value.ref) ||
    !sameReference(validationReceipt.sql_artifact_ref, sqlArtifactResolution.value.ref) ||
    !sameReference(validationReceipt.execution_receipt_ref, executionReceiptResolution.value.ref)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "SqlArtifact、ExecutionReceipt 与 ValidationReceipt 必须形成 exact hash-bound 闭包。",
    );
  }

  const receipt = sandboxReceipt.data;
  const result = sandboxResult.data;
  const receiptHash = await computeSandboxExecutionReceiptHash(receipt);
  const resultHash = await computeSandboxResultHash(result);
  let observedBytes: number;
  try {
    observedBytes = computeSandboxResultBytes({
      columns: result.columns,
      rows: result.rows,
    });
  } catch {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "SandboxResult columns/rows 不能生成规范字节事实。",
    );
  }
  if (
    receiptHash !== receipt.execution_hash ||
    resultHash !== result.result_hash ||
    observedBytes !== result.bytes ||
    !sameReference(receipt.receipt_ref, executionReceipt.sandbox_execution_receipt_ref) ||
    !sameReference(result.result_ref, executionReceipt.result_artifact_ref) ||
    !sameReference(receipt.result_artifact_ref, result.result_ref) ||
    !sameReference(receipt.sql_artifact_ref, sqlArtifactResolution.value.ref) ||
    !sameReference(receipt.execution_permit_ref, executionReceipt.execution_permit_ref) ||
    receipt.execution_id !== result.execution_id ||
    receipt.schema_version !== result.schema_version ||
    receipt.schema_version !== executionReceipt.schema_version ||
    receipt.datasource_id !== queryContract.datasource_id ||
    receipt.datasource_id !== executionReceipt.datasource_id ||
    receipt.resource_usage.rows !== result.row_count ||
    receipt.resource_usage.rows !== executionReceipt.row_count ||
    receipt.resource_usage.bytes !== result.bytes ||
    executionReceipt.query_hash !== sqlArtifact.query_hash ||
    executionReceipt.result_hash !== result.result_hash ||
    receipt.snapshot_token !== executionReceipt.snapshot_token ||
    receipt.watermark !== executionReceipt.watermark ||
    receipt.replay_state !== executionReceipt.replay_state ||
    Date.parse(receipt.completed_at) > Date.parse(executionReceipt.observed_at)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "L2 Execution 与 Sandbox Receipt/Result 必须逐字段匹配同一终态执行。",
    );
  }

  const frontierReplayState =
    receipt.replay_state === "REPLAYABLE"
      ? "REPLAYABLE"
      : receipt.replay_state === "REPLAY_UNAVAILABLE"
        ? "REPLAY_UNAVAILABLE"
        : null;
  if (
    frontierReplayState === null ||
    observedVersion.data.data_snapshot.datasource_id !== receipt.datasource_id ||
    observedVersion.data.data_snapshot.replay_state !== frontierReplayState ||
    observedVersion.data.data_snapshot.snapshot_token !== receipt.snapshot_token ||
    !sameReference(
      receipt.authority_revalidation.policy_receipt_ref,
      observedVersion.data.policy_receipt_ref,
    ) ||
    !sameReference(
      observationContract.metric_ref.container_ref,
      observedVersion.data.semantic_release_ref,
    )
  ) {
    return researchKernelFailure(
      "EVIDENCE_REVISION_STALE",
      "VersionFrontier 必须与 Sandbox datasource/snapshot/replay 及执行时 Policy 精确一致。",
    );
  }

  const resultColumnNames = result.columns.map(({ name }) => name);
  if (!sameStringArray(queryContract.result_contract.columns, resultColumnNames)) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "SandboxResult columns 必须严格匹配 QueryContract.result_contract.columns。",
    );
  }

  const dependencyDocuments: ResolvedResearchDocumentCandidate<"QueryEvidence">[] = [];
  for (const dependencyInput of input.dependency_evidence_documents) {
    const dependency = await resolveResearchDocumentCandidate(
      dependencyInput,
      "QueryEvidence",
      context.request_context,
    );
    if (!dependency.ok) {
      return researchKernelFailure("EVIDENCE_COVERAGE_INSUFFICIENT", dependency.error.message);
    }
    if (dependency.value.document.payload.artifact_type !== "QueryEvidence") {
      return researchKernelFailure(
        "EVIDENCE_COVERAGE_INSUFFICIENT",
        "Dependency Research Document 类型漂移。",
      );
    }
    dependencyDocuments.push(dependency.value);
  }
  const expectedDependencyObligations = new Set(
    obligation.obligation.depends_on.map(({ node_id }) =>
      embeddedNodeReferenceIdentity({
        container_ref: obligation.plan_ref,
        node_id,
      }),
    ),
  );
  const actualDependencyObligations = new Set(
    dependencyDocuments.map(({ document }) => {
      const payload = document.payload;
      if (payload.artifact_type !== "QueryEvidence") return "";
      return embeddedNodeReferenceIdentity(payload.obligation_ref);
    }),
  );
  const dependencyReferenceIdentities = dependencyDocuments.map(({ ref }) =>
    artifactReferenceIdentity(ref),
  );
  if (
    new Set(dependencyReferenceIdentities).size !== dependencyReferenceIdentities.length ||
    actualDependencyObligations.has("") ||
    actualDependencyObligations.size !== dependencyDocuments.length ||
    !sameIdentitySet(expectedDependencyObligations, actualDependencyObligations) ||
    dependencyDocuments.some(({ document }) => {
      const payload = document.payload;
      return (
        payload.artifact_type !== "QueryEvidence" ||
        !sameReference(payload.obligation_ref.container_ref, obligation.plan_ref)
      );
    })
  ) {
    return researchKernelFailure(
      "EVIDENCE_COVERAGE_INSUFFICIENT",
      "Dependency QueryEvidence Documents 必须与 depends_on exact 一一闭合。",
    );
  }
  const dependencyByNodeId = new Map<string, ResolvedResearchDocumentCandidate<"QueryEvidence">>();
  for (const dependency of dependencyDocuments) {
    const payload = dependency.document.payload;
    if (payload.artifact_type === "QueryEvidence") {
      dependencyByNodeId.set(payload.obligation_ref.node_id, dependency);
    }
  }
  const orderedDependencyDocuments = obligation.obligation.depends_on
    .map(({ node_id }) => dependencyByNodeId.get(node_id))
    .filter(
      (dependency): dependency is ResolvedResearchDocumentCandidate<"QueryEvidence"> =>
        dependency !== undefined,
    );
  if (orderedDependencyDocuments.length !== dependencyDocuments.length) {
    return researchKernelFailure(
      "EVIDENCE_COVERAGE_INSUFFICIENT",
      "Dependency QueryEvidence Documents 无法按 EvidencePlan depends_on 确定性排序。",
    );
  }

  const scopeAnchor = obligation.plan_ref;
  const scopedReferences: ArtifactReference[] = [
    oedResolution.value.ref,
    queryContractResolution.value.ref,
    sqlArtifactResolution.value.ref,
    validationReceiptResolution.value.ref,
    executionReceiptResolution.value.ref,
    receipt.receipt_ref,
    result.result_ref,
    observedVersion.data.semantic_release_ref,
    observedVersion.data.schema_snapshot_ref,
    observedVersion.data.policy_receipt_ref,
    ...orderedDependencyDocuments.map(({ ref }) => ref),
  ];
  if (scopedReferences.some((reference) => !sameReferenceScope(scopeAnchor, reference))) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "QueryEvidence 的 resolved closure 必须属于同一 Scope/Run。",
    );
  }

  const candidate = queryEvidenceV2PayloadSchema.safeParse({
    artifact_type: "QueryEvidence",
    protocol_version: "query-evidence@2.0.0",
    obligation_ref: obligation.obligation_ref,
    obligation_execution_decision_ref: oedResolution.value.ref,
    query_contract_ref: queryContractResolution.value.ref,
    sql_artifact_ref: sqlArtifactResolution.value.ref,
    validation_receipt_ref: validationReceiptResolution.value.ref,
    execution_receipt_ref: executionReceiptResolution.value.ref,
    sandbox_execution_receipt_ref: receipt.receipt_ref,
    sandbox_result_ref: result.result_ref,
    dependency_evidence_refs: orderedDependencyDocuments.map(({ ref }) => ref),
    provenance_group: await deriveProvenanceGroup(receipt),
    observed_version: observedVersion.data,
    observation: {
      result_hash: result.result_hash,
      row_count: result.rows.length,
      schema_hash: await computeResultSchemaHash(result),
    },
  });
  return candidate.success
    ? researchKernelSuccess(candidate.data)
    : researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        candidate.error.issues[0]?.message ?? "QueryEvidence Candidate 无效。",
      );
}

async function resolveQueryEvidenceDerivationUncached(
  resolution: QueryEvidenceDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedQueryEvidenceDerivation>> {
  const budget = preflightResearchInput(resolution);
  if (!budget.ok) return budget;
  if (!hasExactKeys(resolution, QUERY_EVIDENCE_RESOLUTION_KEYS)) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "QueryEvidence derivation resolution 必须是 exact document+derivation_input。",
    );
  }
  const [document, derived] = await Promise.all([
    resolveResearchDocumentCandidate(resolution.document, "QueryEvidence", context.request_context),
    buildQueryEvidenceCandidateWithReplayContext(resolution.derivation_input, context),
  ]);
  if (!document.ok) return document;
  if (
    !derived.ok ||
    document.value.document.payload.artifact_type !== "QueryEvidence" ||
    canonicalizeJson(document.value.document.payload) !== canonicalizeJson(derived.value)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      derived.ok
        ? "QueryEvidence Document 与 production derivation 不一致。"
        : derived.error.message,
    );
  }
  const ref = queryEvidenceRefSchema.safeParse(document.value.ref);
  return ref.success
    ? researchKernelSuccess({ ref: ref.data, payload: derived.value })
    : researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        "QueryEvidence derived Reference 类型无效。",
      );
}

export function resolveQueryEvidenceDerivationWithReplayContext(
  resolution: QueryEvidenceDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedQueryEvidenceDerivation>> {
  if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) {
    return resolveQueryEvidenceDerivationUncached(resolution, context);
  }
  return replayWithinBoundary(context, "query-evidence", context.query_evidence, resolution, () =>
    resolveQueryEvidenceDerivationUncached(resolution, context),
  );
}
