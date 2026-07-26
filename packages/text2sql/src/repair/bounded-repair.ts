import {
  artifactReferenceFor,
  deepFreeze,
  type GateReceiptPayload,
  type SqlArtifactPayloadContract,
  sha256ContentHash,
  sqlArtifactSchema,
} from "@data-agent/contracts";
import {
  computeRepairEpisodeHash,
  computeRepairFrozenBundleHash,
  computeRepairPatchScriptHash,
  computeRepairReceiptHash,
  computeRepairTraceHash,
} from "./integrity.js";
import {
  deriveNextRepairTrace,
  deriveRepairPatchOperations,
  isCurrentRepairTrace,
  isMechanicallyRepairableGate,
  isTrustedRepairAuthority,
  isTrustedRepairTrace,
  normalizeRepairCompilerInput,
  registerRepairTrace,
  repairRouteForGate,
  sameRepairBundleBinding,
} from "./internal.js";
import {
  type AttemptBoundedRepairInput,
  BOUNDED_REPAIR_VERSION,
  type BoundedRepairResult,
  type CreateBoundedRepairTraceInput,
  type RepairFrozenBundle,
  type RepairFrozenBundleInput,
  type RepairReceipt,
  type RepairTerminalReasonCode,
  type RepairTrace,
  repairFrozenBundleSchema,
  repairReceiptSchema,
  repairTraceSchema,
} from "./types.js";

const FULL_REVALIDATION_GATES = [
  "INTENT",
  "SEMANTIC",
  "STRUCTURAL",
  "POLICY",
  "RESOURCE",
  "EXECUTION",
  "RESULT",
] as const;
const EMPTY_HASH = `sha256:${"0".repeat(64)}` as const;

type AuthoritativeFailureGate = Readonly<{
  reference: RepairReceipt["failure_gate_receipt_ref"];
  receipt: GateReceiptPayload;
}>;

export async function sealRepairFrozenBundle(
  input: RepairFrozenBundleInput,
): Promise<RepairFrozenBundle> {
  const draft = repairFrozenBundleSchema.parse({
    ...input,
    episode_hash: EMPTY_HASH,
    frozen_bundle_hash: EMPTY_HASH,
  });
  const withEpisodeHash = {
    ...draft,
    episode_hash: await computeRepairEpisodeHash(draft),
  };
  return deepFreeze(
    repairFrozenBundleSchema.parse({
      ...withEpisodeHash,
      frozen_bundle_hash: await computeRepairFrozenBundleHash(withEpisodeHash),
    }),
  );
}

/**
 * @internal Session 起点必须由 server-only Authority 与持久 Store 唯一创建。
 */
export async function createBoundedRepairTrace(
  input: CreateBoundedRepairTraceInput,
): Promise<RepairTrace> {
  if (!isTrustedRepairAuthority(input.authority)) {
    throw new TypeError("TEXT2SQL_REPAIR_AUTHORITY_REQUIRED");
  }
  const bundle = repairFrozenBundleSchema.parse(input.frozen_bundle);
  if (
    (await computeRepairFrozenBundleHash(bundle)) !== bundle.frozen_bundle_hash ||
    !(await input.authority.authorizeFrozenBundle(bundle))
  ) {
    throw new TypeError("TEXT2SQL_REPAIR_FROZEN_BUNDLE_AUTHORITY_REQUIRED");
  }
  const material = {
    repair_version: BOUNDED_REPAIR_VERSION,
    frozen_bundle: bundle,
    attempt_count: 0,
    expected_parent_candidate_hash: bundle.root_sql_artifact_payload_hash,
    attempt_receipt_hashes: [] as string[],
    terminal_reason_code: null,
  };
  const trace = repairTraceSchema.parse({
    ...material,
    trace_hash: await computeRepairTraceHash(material),
  });
  if (
    !(await input.authority.createSession({
      repair_id: bundle.repair_id,
      episode_hash: bundle.episode_hash,
      frozen_bundle_hash: bundle.frozen_bundle_hash,
      initial_trace: trace,
    }))
  ) {
    throw new TypeError("TEXT2SQL_REPAIR_SESSION_ALREADY_EXISTS");
  }
  return registerRepairTrace(trace);
}

async function createReceipt(
  input: Omit<RepairReceipt, "patch_script_hash" | "receipt_hash">,
): Promise<RepairReceipt> {
  const withPatchHash = {
    ...input,
    patch_script_hash: await computeRepairPatchScriptHash(input.patch_operations),
  };
  return repairReceiptSchema.parse({
    ...withPatchHash,
    receipt_hash: await computeRepairReceiptHash(withPatchHash as RepairReceipt),
  });
}

async function commitRepairTransition(
  authority: AttemptBoundedRepairInput["authority"],
  trace: RepairTrace,
  receipt: RepairReceipt,
  candidate: SqlArtifactPayloadContract | null,
): Promise<RepairTrace | null> {
  const nextTrace = await deriveNextRepairTrace(trace, receipt);
  if (
    !(await authority.commitTransition({
      repair_id: trace.frozen_bundle.repair_id,
      episode_hash: trace.frozen_bundle.episode_hash,
      frozen_bundle_hash: trace.frozen_bundle.frozen_bundle_hash,
      expected_trace_hash: trace.trace_hash,
      expected_attempt_count: trace.attempt_count,
      next_trace: nextTrace,
      transition: {
        receipt,
        candidate,
      },
    }))
  ) {
    return null;
  }
  return registerRepairTrace(nextTrace);
}

function concurrentTransition(): BoundedRepairResult {
  return deepFreeze({
    state: "STALE_HEAD" as const,
    reason_code: "REPAIR_CONCURRENT_TRANSITION" as const,
    reload_required: true as const,
  });
}

async function createTerminalAttempt(input: {
  authority: AttemptBoundedRepairInput["authority"];
  trace: RepairTrace;
  failureGate: AuthoritativeFailureGate;
  parentReference: RepairReceipt["parent_sql_artifact_ref"];
  parentCandidateHash: string;
  deterministicQueryHash: string | null;
  childCandidateHash: string | null;
  reasonCode: Exclude<RepairTerminalReasonCode, "REPAIR_SESSION_TERMINATED">;
}): Promise<BoundedRepairResult> {
  const receipt = await createReceipt({
    repair_version: BOUNDED_REPAIR_VERSION,
    repair_id: input.trace.frozen_bundle.repair_id,
    episode_hash: input.trace.frozen_bundle.episode_hash,
    frozen_bundle_hash: input.trace.frozen_bundle.frozen_bundle_hash,
    attempt: input.trace.attempt_count + 1,
    failure_gate_receipt_ref: input.failureGate.reference,
    failed_gate: input.failureGate.receipt.gate,
    failure_code: input.failureGate.receipt.reason_code,
    parent_sql_artifact_ref: input.parentReference,
    parent_candidate_hash: input.parentCandidateHash,
    deterministic_query_hash: input.deterministicQueryHash,
    child_candidate_hash: input.childCandidateHash,
    patch_operations: [],
    outcome: "TERMINAL",
    route: null,
    terminal_reason_code: input.reasonCode,
    revalidation_state: "NOT_APPLICABLE",
    required_revalidation_gates: [...FULL_REVALIDATION_GATES],
    previous_trace_hash: input.trace.trace_hash,
  });
  const nextTrace = await commitRepairTransition(input.authority, input.trace, receipt, null);
  return nextTrace
    ? deepFreeze({
        state: "TERMINAL" as const,
        reason_code: input.reasonCode,
        receipt,
        trace: nextTrace,
      })
    : concurrentTransition();
}

/**
 * 仅生成需要完整七门重验证的 child Candidate，不产生“已修复”或 Gate PASS 事实。
 */
export async function attemptBoundedRepair(
  input: AttemptBoundedRepairInput,
): Promise<BoundedRepairResult> {
  if (!isTrustedRepairAuthority(input.authority)) {
    throw new TypeError("TEXT2SQL_REPAIR_AUTHORITY_REQUIRED");
  }
  if (!isTrustedRepairTrace(input.trace)) {
    throw new TypeError("TEXT2SQL_REPAIR_TRACE_HEAD_REQUIRED");
  }
  const compilerInput = normalizeRepairCompilerInput(input.compiler_input);
  repairTraceSchema.parse(input.trace);
  const trace = input.trace;
  if (
    (await computeRepairTraceHash(trace)) !== trace.trace_hash ||
    !(await sameRepairBundleBinding(compilerInput, trace.frozen_bundle))
  ) {
    throw new TypeError("TEXT2SQL_REPAIR_TRACE_BINDING_MISMATCH");
  }
  if (!(await isCurrentRepairTrace(input.authority, compilerInput, trace))) {
    return concurrentTransition();
  }
  if (trace.terminal_reason_code !== null) {
    return deepFreeze({
      state: "TERMINAL" as const,
      reason_code: "REPAIR_SESSION_TERMINATED" as const,
      receipt: null,
      trace,
    });
  }
  const parentReference = artifactReferenceFor("SqlArtifact").parse(
    input.current_parent_sql_artifact_ref,
  );
  const failureReference = artifactReferenceFor("GateReceipt").parse(
    input.failure_gate_receipt_ref,
  );
  const parent = await input.authority.authorizeParent(
    parentReference,
    trace.frozen_bundle,
    trace.expected_parent_candidate_hash,
    trace.attempt_count,
  );
  const failureReceipt = await input.authority.resolveFailureGate(
    failureReference,
    trace.frozen_bundle,
    parentReference,
  );
  if (!failureReceipt || !parent) {
    throw new TypeError("TEXT2SQL_REPAIR_FAILURE_AUTHORITY_REQUIRED");
  }
  const failureGate: AuthoritativeFailureGate = {
    reference: failureReference,
    receipt: failureReceipt,
  };
  const parentCandidateHash = await sha256ContentHash(parent);

  if (!isMechanicallyRepairableGate(failureReceipt.gate)) {
    const route = repairRouteForGate(failureReceipt.gate);
    const receipt = await createReceipt({
      repair_version: BOUNDED_REPAIR_VERSION,
      repair_id: trace.frozen_bundle.repair_id,
      episode_hash: trace.frozen_bundle.episode_hash,
      frozen_bundle_hash: trace.frozen_bundle.frozen_bundle_hash,
      attempt: trace.attempt_count + 1,
      failure_gate_receipt_ref: failureReference,
      failed_gate: failureReceipt.gate,
      failure_code: failureReceipt.reason_code,
      parent_sql_artifact_ref: parentReference,
      parent_candidate_hash: parentCandidateHash,
      deterministic_query_hash: null,
      child_candidate_hash: null,
      patch_operations: [],
      outcome: "ROUTED",
      route,
      terminal_reason_code: null,
      revalidation_state: "NOT_APPLICABLE",
      required_revalidation_gates: [...FULL_REVALIDATION_GATES],
      previous_trace_hash: trace.trace_hash,
    });
    const nextTrace = await commitRepairTransition(input.authority, trace, receipt, null);
    return nextTrace
      ? deepFreeze({
          state: "ROUTED" as const,
          route,
          reason_code: "REPAIR_GATE_NOT_MECHANICALLY_REPAIRABLE" as const,
          receipt,
          trace: nextTrace,
        })
      : concurrentTransition();
  }

  const compilation = await input.authority.compile(compilerInput);
  if (compilation.state !== "COMPILED") {
    return createTerminalAttempt({
      authority: input.authority,
      trace,
      failureGate,
      parentReference,
      parentCandidateHash,
      deterministicQueryHash: null,
      childCandidateHash: null,
      reasonCode: "REPAIR_COMPILER_UNAVAILABLE",
    });
  }
  const canonical = sqlArtifactSchema.parse(compilation.sql_artifact);
  const patches = deriveRepairPatchOperations(parent, canonical);
  if (patches.length === 0) {
    return createTerminalAttempt({
      authority: input.authority,
      trace,
      failureGate,
      parentReference,
      parentCandidateHash,
      deterministicQueryHash: canonical.query_hash,
      childCandidateHash: null,
      reasonCode: "REPAIR_NO_PROGRESS",
    });
  }
  const childCandidateHash = await sha256ContentHash(canonical);
  const receipt = await createReceipt({
    repair_version: BOUNDED_REPAIR_VERSION,
    repair_id: trace.frozen_bundle.repair_id,
    episode_hash: trace.frozen_bundle.episode_hash,
    frozen_bundle_hash: trace.frozen_bundle.frozen_bundle_hash,
    attempt: trace.attempt_count + 1,
    failure_gate_receipt_ref: failureReference,
    failed_gate: failureReceipt.gate,
    failure_code: failureReceipt.reason_code,
    parent_sql_artifact_ref: parentReference,
    parent_candidate_hash: parentCandidateHash,
    deterministic_query_hash: canonical.query_hash,
    child_candidate_hash: childCandidateHash,
    patch_operations: [...patches],
    outcome: "CANDIDATE",
    route: null,
    terminal_reason_code: null,
    revalidation_state: "REQUIRED",
    required_revalidation_gates: [...FULL_REVALIDATION_GATES],
    previous_trace_hash: trace.trace_hash,
  });
  const nextTrace = await commitRepairTransition(input.authority, trace, receipt, canonical);
  return nextTrace
    ? deepFreeze({
        state: "CANDIDATE" as const,
        next_state: "NEEDS_FULL_REVALIDATION" as const,
        candidate: canonical,
        patch_operations: [...patches],
        receipt,
        trace: nextTrace,
      })
    : concurrentTransition();
}
