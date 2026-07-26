import {
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  computeGateEvaluationHash,
  computeGateInputHash,
  computeGroundingHash,
  deepFreeze,
  type GateReceiptPayload,
  gateReceiptSchema,
  groundingPackageSchema,
  logicalPlanSchema,
  queryContractSchema,
  type SqlArtifactPayloadContract,
  semanticQuerySchema,
  sha256ContentHash,
  sqlArtifactSchema,
} from "@data-agent/contracts";
import { isAuthoritativeLogicalPlanBinding } from "../compiler/internal.js";
import { compilePostgresqlLogicalPlan } from "../compiler/postgresql.js";
import type { PostgresqlCompilerInput } from "../compiler/types.js";
import {
  isTrustedGateArtifactAuthority,
  resolveCommittedArtifact,
  type TrustedGateArtifactAuthority,
} from "../gates/internal.js";
import { groundingPackageDraftSchema } from "../grounding/types.js";
import {
  computeRepairEpisodeHash,
  computeRepairFrozenBundleHash,
  computeRepairPatchScriptHash,
  computeRepairReceiptHash,
  computeRepairTraceHash,
} from "./integrity.js";
import type {
  RepairFrozenBundle,
  RepairPatchOperation,
  RepairSessionCreateClaim,
  RepairSessionSnapshot,
  RepairSessionTransition,
  RepairSessionTransitionClaim,
  RepairTrace,
  RepairTraceData,
  TrustedRepairAuthority,
} from "./types.js";
import { BOUNDED_REPAIR_LIMITS, repairSessionSnapshotSchema, repairTraceSchema } from "./types.js";

const trustedRepairAuthorities = new WeakSet<object>();
const trustedRepairTraces = new WeakSet<object>();

export interface RepairSessionStoreAdapter {
  createSession(claim: RepairSessionCreateClaim): Promise<boolean>;
  compareAndSwap(claim: RepairSessionTransitionClaim): Promise<boolean>;
  loadSession(
    claim: Readonly<{ repair_id: string; episode_hash: string }>,
  ): Promise<unknown | null>;
}

type VerifyExactArtifactRevision = (
  reference: ArtifactReference,
  artifact: unknown,
) => Promise<boolean>;

function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRepairCompilerInput(input: unknown): PostgresqlCompilerInput {
  if (
    !isObjectRecord(input) ||
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, "logical_plan_binding") ||
    !Object.hasOwn(input, "grounding")
  ) {
    throw new TypeError("TEXT2SQL_REPAIR_COMPILER_INPUT_AUTHORITY_REQUIRED");
  }
  const logicalPlanBindingDescriptor = Object.getOwnPropertyDescriptor(
    input,
    "logical_plan_binding",
  );
  const groundingDescriptor = Object.getOwnPropertyDescriptor(input, "grounding");
  if (
    !logicalPlanBindingDescriptor ||
    !("value" in logicalPlanBindingDescriptor) ||
    !groundingDescriptor ||
    !("value" in groundingDescriptor) ||
    !isAuthoritativeLogicalPlanBinding(logicalPlanBindingDescriptor.value)
  ) {
    throw new TypeError("TEXT2SQL_REPAIR_COMPILER_INPUT_AUTHORITY_REQUIRED");
  }
  const grounding = groundingPackageDraftSchema.safeParse(groundingDescriptor.value);
  if (!grounding.success) {
    throw new TypeError("TEXT2SQL_REPAIR_COMPILER_INPUT_AUTHORITY_REQUIRED");
  }
  return deepFreeze({
    logical_plan_binding: logicalPlanBindingDescriptor.value,
    grounding: grounding.data,
  });
}

function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function gateInputMaterial(receipt: GateReceiptPayload): Record<string, unknown> {
  return {
    artifact_type: receipt.artifact_type,
    sql_artifact_ref: receipt.sql_artifact_ref,
    execution_receipt_ref: receipt.execution_receipt_ref,
    gate: receipt.gate,
    gate_version: receipt.gate_version,
    evaluator_version: receipt.evaluator_version,
    evidence_refs: receipt.evidence_refs,
  };
}

function gateEvaluationMaterial(receipt: GateReceiptPayload): unknown {
  return {
    ...gateInputMaterial(receipt),
    input_hash: receipt.input_hash,
    evaluator_input_hash: receipt.evaluator_input_hash,
    evaluator_evaluation_hash: receipt.evaluator_evaluation_hash,
    verdict: receipt.verdict,
    reason_code: receipt.reason_code,
    observations: receipt.observations,
    evaluated_at: receipt.evaluated_at,
  };
}

function logicalPlanContent(
  logicalPlan: ReturnType<typeof logicalPlanSchema.parse>,
): Omit<ReturnType<typeof logicalPlanSchema.parse>, "artifact_type" | "semantic_query_ref"> {
  const {
    artifact_type: _artifactType,
    semantic_query_ref: _semanticQueryReference,
    ...content
  } = logicalPlan;
  return content;
}

export function deriveRepairPatchOperations(
  parent: SqlArtifactPayloadContract,
  canonical: SqlArtifactPayloadContract,
): readonly RepairPatchOperation[] {
  const patches: RepairPatchOperation[] = [];
  if (parent.dialect !== canonical.dialect || parent.sql !== canonical.sql) {
    patches.push({
      operation: "RESTORE_DIALECT_AND_SQL",
      authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
    });
  }
  if (canonicalizeJson(parent.parameters) !== canonicalizeJson(canonical.parameters)) {
    patches.push({
      operation: "RESTORE_PARAMETERS",
      authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
    });
  }
  if (
    parent.compiler_version !== canonical.compiler_version ||
    parent.ast_hash !== canonical.ast_hash
  ) {
    patches.push({
      operation: "RESTORE_COMPILER_METADATA",
      authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
    });
  }
  if (parent.query_hash !== canonical.query_hash) {
    patches.push({
      operation: "RESTORE_QUERY_HASH",
      authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
    });
  }
  return patches;
}

const REPAIRABLE_GATES: ReadonlySet<GateReceiptPayload["gate"]> = new Set([
  "STRUCTURAL",
  "EXECUTION",
  "RESULT",
]);

export function isMechanicallyRepairableGate(gate: GateReceiptPayload["gate"]): boolean {
  return REPAIRABLE_GATES.has(gate);
}

export function repairRouteForGate(
  gate: GateReceiptPayload["gate"],
): "REPLAN" | "CLARIFY" | "HUMAN" {
  switch (gate) {
    case "INTENT":
      return "CLARIFY";
    case "SEMANTIC":
    case "RESOURCE":
      return "REPLAN";
    case "POLICY":
      return "HUMAN";
    default:
      return "REPLAN";
  }
}

export async function deriveNextRepairTrace(
  before: RepairTraceData,
  receipt: RepairSessionTransition["receipt"],
): Promise<RepairTraceData> {
  if (
    before.terminal_reason_code !== null ||
    receipt.previous_trace_hash !== before.trace_hash ||
    receipt.attempt !== before.attempt_count + 1
  ) {
    throw new TypeError("TEXT2SQL_REPAIR_TERMINAL_OR_TRACE_TRANSITION_INVALID");
  }
  const material = {
    repair_version: before.repair_version,
    frozen_bundle: before.frozen_bundle,
    attempt_count: before.attempt_count + 1,
    expected_parent_candidate_hash:
      receipt.outcome === "CANDIDATE" && receipt.child_candidate_hash
        ? receipt.child_candidate_hash
        : before.expected_parent_candidate_hash,
    attempt_receipt_hashes: [...before.attempt_receipt_hashes, receipt.receipt_hash],
    terminal_reason_code:
      receipt.outcome === "ROUTED"
        ? ("REPAIR_SESSION_TERMINATED" as const)
        : receipt.outcome === "TERMINAL"
          ? receipt.terminal_reason_code
          : null,
  };
  return repairTraceSchema.parse({
    ...material,
    trace_hash: await computeRepairTraceHash(material),
  });
}

async function resolveExactCommittedArtifact(
  authority: TrustedGateArtifactAuthority,
  verifyExactArtifactRevision: VerifyExactArtifactRevision,
  reference: ArtifactReference,
): Promise<unknown | null> {
  const payload = await resolveCommittedArtifact(authority, reference);
  if (payload === null || !(await verifyExactArtifactRevision(reference, payload))) {
    return null;
  }
  return payload;
}

async function resolveFrozenBundle(
  authority: TrustedGateArtifactAuthority,
  verifyExactArtifactRevision: VerifyExactArtifactRevision,
  principalId: string,
  bundle: RepairFrozenBundle,
): Promise<SqlArtifactPayloadContract | null> {
  if (
    bundle.principal_id !== principalId ||
    (await computeRepairEpisodeHash(bundle)) !== bundle.episode_hash ||
    (await computeRepairFrozenBundleHash(bundle)) !== bundle.frozen_bundle_hash
  ) {
    return null;
  }
  const references = [
    bundle.query_contract_ref,
    bundle.grounding_package_ref,
    bundle.semantic_query_ref,
    bundle.logical_plan_ref,
    bundle.root_sql_artifact_ref,
  ];
  const [queryContractInput, groundingInput, semanticInput, logicalPlanInput, sqlArtifactInput] =
    await Promise.all(
      references.map((reference) =>
        resolveExactCommittedArtifact(authority, verifyExactArtifactRevision, reference),
      ),
    );
  const queryContract = queryContractSchema.safeParse(queryContractInput);
  const grounding = groundingPackageSchema.safeParse(groundingInput);
  const semantic = semanticQuerySchema.safeParse(semanticInput);
  const logicalPlan = logicalPlanSchema.safeParse(logicalPlanInput);
  const sqlArtifact = sqlArtifactSchema.safeParse(sqlArtifactInput);
  if (
    !queryContract.success ||
    !grounding.success ||
    !semantic.success ||
    !logicalPlan.success ||
    !sqlArtifact.success ||
    !sameReference(grounding.data.query_contract_ref, bundle.query_contract_ref) ||
    !sameReference(semantic.data.query_contract_ref, bundle.query_contract_ref) ||
    !sameReference(semantic.data.grounding_package_ref, bundle.grounding_package_ref) ||
    !sameReference(logicalPlan.data.semantic_query_ref, bundle.semantic_query_ref) ||
    !sameReference(sqlArtifact.data.logical_plan_ref, bundle.logical_plan_ref) ||
    (await sha256ContentHash(queryContract.data)) !== bundle.query_contract_hash ||
    (await sha256ContentHash(grounding.data)) !== bundle.grounding_package_hash ||
    (await sha256ContentHash(semantic.data)) !== bundle.semantic_query_hash ||
    (await sha256ContentHash(logicalPlanContent(logicalPlan.data))) !== bundle.logical_plan_hash ||
    (await sha256ContentHash(sqlArtifact.data)) !== bundle.root_sql_artifact_payload_hash ||
    grounding.data.grounding_hash !== bundle.grounding_hash ||
    semantic.data.grounding_hash !== bundle.grounding_hash ||
    logicalPlan.data.grounding_hash !== bundle.grounding_hash ||
    grounding.data.policy_version !== bundle.policy_version ||
    (await sha256ContentHash(logicalPlan.data.semantic_signature)) !==
      bundle.semantic_signature_hash
  ) {
    return null;
  }
  return deepFreeze(sqlArtifact.data);
}

async function resolveParent(
  authority: TrustedGateArtifactAuthority,
  verifyExactArtifactRevision: VerifyExactArtifactRevision,
  reference: ArtifactReference,
  bundle: RepairFrozenBundle,
  expectedParentCandidateHash: string,
  attemptCount: number,
): Promise<SqlArtifactPayloadContract | null> {
  const root = bundle.root_sql_artifact_ref;
  if (
    reference.artifact_type !== "SqlArtifact" ||
    reference.app_id !== root.app_id ||
    reference.tenant_id !== root.tenant_id ||
    reference.environment !== root.environment ||
    reference.run_id !== root.run_id ||
    reference.artifact_id !== root.artifact_id ||
    reference.revision !== root.revision + attemptCount
  ) {
    return null;
  }
  const parsed = sqlArtifactSchema.safeParse(
    await resolveExactCommittedArtifact(authority, verifyExactArtifactRevision, reference),
  );
  if (
    !parsed.success ||
    !sameReference(parsed.data.logical_plan_ref, bundle.logical_plan_ref) ||
    (await sha256ContentHash(parsed.data)) !== expectedParentCandidateHash ||
    (attemptCount === 0 &&
      (!sameReference(reference, root) ||
        expectedParentCandidateHash !== bundle.root_sql_artifact_payload_hash))
  ) {
    return null;
  }
  return deepFreeze(parsed.data);
}

async function resolveFailureGate(
  authority: TrustedGateArtifactAuthority,
  verifyExactArtifactRevision: VerifyExactArtifactRevision,
  reference: ArtifactReference,
  bundle: RepairFrozenBundle,
  parentReference: ArtifactReference,
): Promise<GateReceiptPayload | null> {
  if (
    reference.artifact_type !== "GateReceipt" ||
    reference.app_id !== bundle.root_sql_artifact_ref.app_id ||
    reference.tenant_id !== bundle.root_sql_artifact_ref.tenant_id ||
    reference.environment !== bundle.root_sql_artifact_ref.environment ||
    reference.run_id !== bundle.root_sql_artifact_ref.run_id
  ) {
    return null;
  }
  const payload = await resolveExactCommittedArtifact(
    authority,
    verifyExactArtifactRevision,
    reference,
  );
  const receipt = gateReceiptSchema.safeParse(payload);
  if (
    !receipt.success ||
    receipt.data.verdict === "PASS" ||
    !sameReference(receipt.data.sql_artifact_ref, parentReference) ||
    (await computeGateInputHash(gateInputMaterial(receipt.data))) !== receipt.data.input_hash ||
    (await computeGateEvaluationHash(gateEvaluationMaterial(receipt.data))) !==
      receipt.data.evaluation_hash
  ) {
    return null;
  }
  return deepFreeze(receipt.data);
}

/**
 * @internal 仅供服务端 Composition Root 注册 Artifact Authority 与持久 Session CAS。
 *
 * Compiler 固定为包内 deterministic PostgreSQL compiler；adapter 无法注入 SQL 生成器。
 */
export function registerTrustedRepairAuthority(input: {
  readonly principal_id: string;
  readonly artifact_authority: unknown;
  readonly verifyExactArtifactRevision: VerifyExactArtifactRevision;
  readonly session_store: RepairSessionStoreAdapter;
}): TrustedRepairAuthority {
  if (
    typeof input.principal_id !== "string" ||
    input.principal_id.length === 0 ||
    input.principal_id.length > 256 ||
    !isTrustedGateArtifactAuthority(input.artifact_authority) ||
    typeof input.verifyExactArtifactRevision !== "function" ||
    typeof input.session_store?.createSession !== "function" ||
    typeof input.session_store?.compareAndSwap !== "function" ||
    typeof input.session_store?.loadSession !== "function"
  ) {
    throw new TypeError("TEXT2SQL_REPAIR_AUTHORITY_INVALID");
  }
  const artifactAuthority = input.artifact_authority;
  const authority = Object.freeze({
    principal_id: input.principal_id,
    authorizeFrozenBundle: (bundle: RepairFrozenBundle) =>
      resolveFrozenBundle(
        artifactAuthority,
        input.verifyExactArtifactRevision,
        input.principal_id,
        bundle,
      ),
    authorizeParent: (
      reference: ArtifactReference,
      bundle: RepairFrozenBundle,
      expectedParentCandidateHash: string,
      attemptCount: number,
    ) =>
      resolveParent(
        artifactAuthority,
        input.verifyExactArtifactRevision,
        reference,
        bundle,
        expectedParentCandidateHash,
        attemptCount,
      ),
    resolveFailureGate: (
      reference: ArtifactReference,
      bundle: RepairFrozenBundle,
      parentReference: ArtifactReference,
    ) =>
      resolveFailureGate(
        artifactAuthority,
        input.verifyExactArtifactRevision,
        reference,
        bundle,
        parentReference,
      ),
    async compile(compilerInput: PostgresqlCompilerInput) {
      const result = await compilePostgresqlLogicalPlan(compilerInput);
      if (result.state !== "COMPILED") {
        if (
          result.state === "FAILED" &&
          (result.reason_code === "POSTGRESQL_COMPILER_INPUT_INVALID" ||
            result.reason_code === "POSTGRESQL_COMPILER_LOGICAL_PLAN_AUTHORITY_REQUIRED" ||
            result.reason_code === "POSTGRESQL_COMPILER_LOGICAL_PLAN_VALIDATION_REQUIRED")
        ) {
          throw new TypeError("TEXT2SQL_REPAIR_COMPILER_INPUT_AUTHORITY_REQUIRED");
        }
        return { state: "UNAVAILABLE" as const };
      }
      return {
        state: "COMPILED" as const,
        sql_artifact: result.compilation.sql_artifact as SqlArtifactPayloadContract,
      };
    },
    createSession: (claim: RepairSessionCreateClaim) =>
      input.session_store.createSession(deepFreeze({ ...claim })),
    commitTransition: (claim: RepairSessionTransitionClaim) =>
      input.session_store.compareAndSwap(deepFreeze({ ...claim })),
    loadSession: (claim: { repair_id: string; episode_hash: string }) =>
      input.session_store.loadSession(deepFreeze({ ...claim })),
  }) as TrustedRepairAuthority;
  trustedRepairAuthorities.add(authority);
  return authority;
}

export function isTrustedRepairAuthority(value: unknown): value is TrustedRepairAuthority {
  return typeof value === "object" && value !== null && trustedRepairAuthorities.has(value);
}

export function registerRepairTrace(value: RepairTraceData): RepairTrace {
  const trace = deepFreeze(value) as RepairTrace;
  trustedRepairTraces.add(trace);
  return trace;
}

export function isTrustedRepairTrace(value: unknown): value is RepairTrace {
  return typeof value === "object" && value !== null && trustedRepairTraces.has(value);
}

function sameFrozenBundle(left: RepairFrozenBundle, right: RepairFrozenBundle): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

async function transitionMatchesStateMachine(input: {
  readonly before: RepairTraceData;
  readonly transition: RepairSessionTransition;
  readonly parent: SqlArtifactPayloadContract;
  readonly failure: GateReceiptPayload;
  readonly compilation: Awaited<ReturnType<TrustedRepairAuthority["compile"]>>;
}): Promise<boolean> {
  const { before, transition, parent, failure, compilation } = input;
  const receipt = transition.receipt;
  if (
    before.terminal_reason_code !== null ||
    (await computeRepairPatchScriptHash(receipt.patch_operations)) !== receipt.patch_script_hash
  ) {
    return false;
  }

  if (before.attempt_count >= BOUNDED_REPAIR_LIMITS.max_attempts) {
    return false;
  }

  if (!isMechanicallyRepairableGate(failure.gate)) {
    return (
      receipt.outcome === "ROUTED" &&
      receipt.route === repairRouteForGate(failure.gate) &&
      receipt.terminal_reason_code === null &&
      receipt.deterministic_query_hash === null &&
      receipt.child_candidate_hash === null &&
      receipt.patch_operations.length === 0 &&
      transition.candidate === null
    );
  }

  if (compilation.state !== "COMPILED") {
    return (
      receipt.outcome === "TERMINAL" &&
      receipt.route === null &&
      receipt.terminal_reason_code === "REPAIR_COMPILER_UNAVAILABLE" &&
      receipt.deterministic_query_hash === null &&
      receipt.child_candidate_hash === null &&
      receipt.patch_operations.length === 0 &&
      transition.candidate === null
    );
  }

  const canonical = sqlArtifactSchema.parse(compilation.sql_artifact);
  const patches = deriveRepairPatchOperations(parent, canonical);
  if (patches.length === 0) {
    return (
      receipt.outcome === "TERMINAL" &&
      receipt.route === null &&
      receipt.terminal_reason_code === "REPAIR_NO_PROGRESS" &&
      receipt.deterministic_query_hash === canonical.query_hash &&
      receipt.child_candidate_hash === null &&
      receipt.patch_operations.length === 0 &&
      transition.candidate === null
    );
  }

  const childCandidateHash = await sha256ContentHash(canonical);
  return (
    receipt.outcome === "CANDIDATE" &&
    receipt.route === null &&
    receipt.terminal_reason_code === null &&
    receipt.deterministic_query_hash === canonical.query_hash &&
    receipt.child_candidate_hash === childCandidateHash &&
    canonicalizeJson(receipt.patch_operations) === canonicalizeJson(patches) &&
    transition.candidate !== null &&
    canonicalizeJson(transition.candidate) === canonicalizeJson(canonical)
  );
}

async function validateSessionSnapshot(
  authority: TrustedRepairAuthority,
  compilerInput: PostgresqlCompilerInput,
  snapshot: RepairSessionSnapshot,
): Promise<boolean> {
  const history = snapshot.trace_history;
  const transitions = snapshot.transitions;
  const initial = history[0];
  if (
    !initial ||
    history.length !== transitions.length + 1 ||
    snapshot.repair_id !== initial.frozen_bundle.repair_id ||
    snapshot.episode_hash !== initial.frozen_bundle.episode_hash ||
    snapshot.frozen_bundle_hash !== initial.frozen_bundle.frozen_bundle_hash ||
    initial.attempt_count !== 0 ||
    initial.expected_parent_candidate_hash !==
      initial.frozen_bundle.root_sql_artifact_payload_hash ||
    initial.attempt_receipt_hashes.length !== 0 ||
    initial.terminal_reason_code !== null ||
    (await computeRepairTraceHash(initial)) !== initial.trace_hash ||
    !(await authority.authorizeFrozenBundle(initial.frozen_bundle)) ||
    !(await sameRepairBundleBinding(compilerInput, initial.frozen_bundle))
  ) {
    return false;
  }
  const compilation = await authority.compile(compilerInput);

  for (const trace of history) {
    if (
      !sameFrozenBundle(trace.frozen_bundle, initial.frozen_bundle) ||
      (await computeRepairTraceHash(trace)) !== trace.trace_hash
    ) {
      return false;
    }
  }

  for (const [index, transition] of transitions.entries()) {
    const before = history[index];
    const after = history[index + 1];
    if (!before || !after) return false;
    const receipt = transition.receipt;
    if (
      receipt.repair_id !== snapshot.repair_id ||
      receipt.episode_hash !== snapshot.episode_hash ||
      receipt.frozen_bundle_hash !== snapshot.frozen_bundle_hash ||
      receipt.previous_trace_hash !== before.trace_hash ||
      receipt.parent_candidate_hash !== before.expected_parent_candidate_hash ||
      (await computeRepairReceiptHash(receipt)) !== receipt.receipt_hash
    ) {
      return false;
    }
    const parent = await authority.authorizeParent(
      receipt.parent_sql_artifact_ref,
      initial.frozen_bundle,
      before.expected_parent_candidate_hash,
      before.attempt_count,
    );
    const failure = await authority.resolveFailureGate(
      receipt.failure_gate_receipt_ref,
      initial.frozen_bundle,
      receipt.parent_sql_artifact_ref,
    );
    if (
      !parent ||
      !failure ||
      failure.gate !== receipt.failed_gate ||
      failure.reason_code !== receipt.failure_code ||
      !(await transitionMatchesStateMachine({
        before,
        transition,
        parent,
        failure,
        compilation,
      }))
    ) {
      return false;
    }

    let derived: RepairTraceData;
    try {
      derived = await deriveNextRepairTrace(before, receipt);
    } catch {
      return false;
    }
    if (canonicalizeJson(derived) !== canonicalizeJson(after)) {
      return false;
    }
  }
  return true;
}

async function resolveValidSessionSnapshot(
  authority: TrustedRepairAuthority,
  compilerInput: PostgresqlCompilerInput,
  repairId: string,
  episodeHash: string,
): Promise<RepairSessionSnapshot | null> {
  const parsed = repairSessionSnapshotSchema.safeParse(
    await authority.loadSession({ repair_id: repairId, episode_hash: episodeHash }),
  );
  if (!parsed.success || !(await validateSessionSnapshot(authority, compilerInput, parsed.data))) {
    return null;
  }
  return deepFreeze(parsed.data);
}

export async function loadCurrentRepairSession(input: {
  readonly authority: unknown;
  readonly compiler_input: PostgresqlCompilerInput;
  readonly repair_id: string;
  readonly episode_hash: string;
}): Promise<Readonly<{ trace: RepairTrace; transitions: readonly RepairSessionTransition[] }>> {
  if (!isTrustedRepairAuthority(input.authority)) {
    throw new TypeError("TEXT2SQL_REPAIR_AUTHORITY_REQUIRED");
  }
  const compilerInput = normalizeRepairCompilerInput(input.compiler_input);
  const snapshot = await resolveValidSessionSnapshot(
    input.authority,
    compilerInput,
    input.repair_id,
    input.episode_hash,
  );
  if (!snapshot) {
    throw new TypeError("TEXT2SQL_REPAIR_SESSION_REHYDRATION_FAILED");
  }
  const current = snapshot.trace_history.at(-1);
  if (!current) {
    throw new TypeError("TEXT2SQL_REPAIR_SESSION_REHYDRATION_FAILED");
  }
  return deepFreeze({
    trace: registerRepairTrace(current),
    transitions: snapshot.transitions,
  });
}

export async function isCurrentRepairTrace(
  authority: TrustedRepairAuthority,
  compilerInput: PostgresqlCompilerInput,
  trace: RepairTrace,
): Promise<boolean> {
  const snapshot = await resolveValidSessionSnapshot(
    authority,
    compilerInput,
    trace.frozen_bundle.repair_id,
    trace.frozen_bundle.episode_hash,
  );
  const current = snapshot?.trace_history.at(-1);
  return current !== undefined && canonicalizeJson(current) === canonicalizeJson(trace);
}

export async function authorizeRepairTrace(input: {
  readonly authority: unknown;
  readonly compiler_input: PostgresqlCompilerInput;
  readonly trace: unknown;
}): Promise<RepairTrace> {
  if (!isTrustedRepairAuthority(input.authority)) {
    throw new TypeError("TEXT2SQL_REPAIR_AUTHORITY_REQUIRED");
  }
  const parsed = repairTraceSchema.safeParse(input.trace);
  if (!parsed.success || (await computeRepairTraceHash(parsed.data)) !== parsed.data.trace_hash) {
    throw new TypeError("TEXT2SQL_REPAIR_TRACE_REAUTHORIZATION_FAILED");
  }
  const loaded = await loadCurrentRepairSession({
    authority: input.authority,
    compiler_input: input.compiler_input,
    repair_id: parsed.data.frozen_bundle.repair_id,
    episode_hash: parsed.data.frozen_bundle.episode_hash,
  });
  if (canonicalizeJson(loaded.trace) !== canonicalizeJson(parsed.data)) {
    throw new TypeError("TEXT2SQL_REPAIR_TRACE_REAUTHORIZATION_FAILED");
  }
  return loaded.trace;
}

export async function sameRepairBundleBinding(
  input: unknown,
  bundle: RepairFrozenBundle,
): Promise<boolean> {
  if (!isObjectRecord(input)) return false;
  const compilerInput = input;
  const logicalPlanBinding = compilerInput.logical_plan_binding;
  const grounding = groundingPackageDraftSchema.safeParse(compilerInput.grounding);
  if (!isAuthoritativeLogicalPlanBinding(logicalPlanBinding) || !grounding.success) {
    return false;
  }
  const { grounding_hash: declaredGroundingHash, ...groundingHashMaterial } = grounding.data;
  return (
    (await computeGroundingHash(groundingHashMaterial)) === declaredGroundingHash &&
    sameReference(logicalPlanBinding.reference, bundle.logical_plan_ref) &&
    logicalPlanBinding.policy_binding.principal_id === bundle.principal_id &&
    declaredGroundingHash === bundle.grounding_hash &&
    grounding.data.policy_version === bundle.policy_version &&
    (await sha256ContentHash(logicalPlanBinding.logical_plan)) === bundle.logical_plan_hash &&
    (await sha256ContentHash(logicalPlanBinding.logical_plan.semantic_signature)) ===
      bundle.semantic_signature_hash
  );
}
