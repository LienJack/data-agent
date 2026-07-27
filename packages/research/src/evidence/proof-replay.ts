import type {
  AtomicClaimRef,
  AtomicClaimV2Payload,
  EvidenceCheckReceiptPayload,
  EvidenceCheckReceiptRef,
  EvidenceRelationRef,
  EvidenceRelationV2Payload,
  QueryEvidenceRef,
  QueryEvidenceV2Payload,
  SupportDecisionPayload,
  SupportDecisionRef,
} from "@data-agent/contracts";
import type { ResearchKernelResult } from "../errors.js";
import {
  memoizeSuccessfulResearchReplay,
  type ResearchRequestReplayContext,
} from "../internal/request-replay-context.js";

export interface ResolvedQueryEvidenceDerivation {
  readonly ref: QueryEvidenceRef;
  readonly payload: QueryEvidenceV2Payload;
}

export interface ResolvedAtomicClaimDerivation {
  readonly ref: AtomicClaimRef;
  readonly payload: AtomicClaimV2Payload;
}

export interface ResolvedEvidenceRelationDerivation {
  readonly ref: EvidenceRelationRef;
  readonly payload: EvidenceRelationV2Payload;
}

export interface ResolvedEvidenceCheckDerivation {
  readonly ref: EvidenceCheckReceiptRef;
  readonly payload: EvidenceCheckReceiptPayload;
}

export interface ResolvedSupportDecisionDerivation {
  readonly ref: SupportDecisionRef;
  readonly payload: SupportDecisionPayload;
  readonly claim: ResolvedAtomicClaimDerivation;
}

interface ProofReplayCacheEntry<Value> {
  readonly document: unknown;
  readonly derivation_input: unknown;
  readonly promise: Promise<ResearchKernelResult<Value>>;
}

/**
 * A request-local replay context. It only coalesces duplicate in-flight work
 * for the same resolution/document/derivation-input object identities. The
 * context is created by one public boundary and discarded when that call
 * returns; it is neither an authority cache nor a cross-request cache.
 *
 * This type is intentionally not re-exported from the package root.
 */
export interface ProofDerivationReplayContext {
  readonly request_context?: ResearchRequestReplayContext;
  readonly query_evidence: WeakMap<object, ProofReplayCacheEntry<ResolvedQueryEvidenceDerivation>>;
  readonly atomic_claim: WeakMap<object, ProofReplayCacheEntry<ResolvedAtomicClaimDerivation>>;
  readonly evidence_relation: WeakMap<
    object,
    ProofReplayCacheEntry<ResolvedEvidenceRelationDerivation>
  >;
  readonly evidence_check: WeakMap<object, ProofReplayCacheEntry<ResolvedEvidenceCheckDerivation>>;
  readonly support_decision: WeakMap<
    object,
    ProofReplayCacheEntry<ResolvedSupportDecisionDerivation>
  >;
}

export function createProofDerivationReplayContext(
  requestContext?: ResearchRequestReplayContext,
): ProofDerivationReplayContext {
  return {
    ...(requestContext ? { request_context: requestContext } : {}),
    query_evidence: new WeakMap(),
    atomic_claim: new WeakMap(),
    evidence_relation: new WeakMap(),
    evidence_check: new WeakMap(),
    support_decision: new WeakMap(),
  };
}

export function replayWithinBoundary<Resolution extends object, Value>(
  context: ProofDerivationReplayContext,
  namespace: string,
  cache: WeakMap<object, ProofReplayCacheEntry<Value>>,
  resolution: Resolution & {
    readonly document: unknown;
    readonly derivation_input: unknown;
  },
  replay: () => Promise<ResearchKernelResult<Value>>,
): Promise<ResearchKernelResult<Value>> {
  if (context.request_context) {
    return memoizeSuccessfulResearchReplay(
      context.request_context,
      `proof:${namespace}`,
      resolution,
      replay,
    );
  }
  const cached = cache.get(resolution);
  if (
    cached &&
    cached.document === resolution.document &&
    cached.derivation_input === resolution.derivation_input
  ) {
    return cached.promise;
  }
  const promise = replay().then(
    (result) => {
      if (!result.ok) cache.delete(resolution);
      return result;
    },
    (error: unknown) => {
      cache.delete(resolution);
      throw error;
    },
  );
  cache.set(resolution, {
    document: resolution.document,
    derivation_input: resolution.derivation_input,
    promise,
  });
  return promise;
}
