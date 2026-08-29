import "server-only";

import type { SemanticSuccessorStageEnvelope } from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import type { PortResult } from "@data-agent/contracts/ports";
import {
  buildFalcon24ActivationRequestV3,
  buildFalcon24ActivationRequestV4,
  buildFalcon24RetainedSemanticReleaseAuthorityProof,
  type Falcon24AuthorityBindingV2,
  type Falcon24LlmExecutionAuthorityProof,
  type Falcon24RetainedActivationResultV4,
  type Falcon24RetainedSemanticReleaseAuthorityProof,
  type Falcon24SemanticAuthorityClosure,
  falcon24AuthorityBindingV2Schema,
  falcon24AuthorityEpochOrdinal,
  falcon24PredecessorDiagnosticFailureSchema,
  verifyFalcon24LlmExecutionAuthorityProof,
} from "@data-agent/contracts/runs";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
import {
  validateSemanticRuntimeClosure,
  verifySemanticReleaseEnvelope,
} from "@data-agent/semantic/production";

interface RetainedEpochPort {
  activateRetained(
    capability: unknown,
    input: unknown,
  ): Promise<PortResult<Falcon24AuthorityBindingV2>>;
  activateRetainedWithRecovery(
    capability: unknown,
    input: unknown,
  ): Promise<PortResult<Falcon24RetainedActivationResultV4>>;
}

interface RetainedReadback {
  loadCurrentClosure(): Promise<Falcon24SemanticAuthorityClosure>;
  loadPublishedRelease(input: {
    readonly semantic_domain: string;
    readonly release_id: string;
  }): Promise<SemanticSuccessorStageEnvelope>;
}

interface RetainedStagedAuthorityReferences {
  readonly baseline_ref: {
    readonly baseline_id: string;
    readonly baseline_hash: `sha256:${string}`;
  };
  readonly activation_attempt_ref: {
    readonly activation_attempt_id: string;
  };
}

export interface Falcon24RetainedFinalizationResult {
  readonly semantic_proof: Falcon24RetainedSemanticReleaseAuthorityProof;
  readonly authority: Falcon24AuthorityBindingV2;
  readonly readback: Falcon24SemanticAuthorityClosure;
  readonly published_release: SemanticSuccessorStageEnvelope;
  readonly recovery: Readonly<{
    llm_execution_proof: Falcon24LlmExecutionAuthorityProof;
    activation_result: Falcon24RetainedActivationResultV4;
  }> | null;
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function required<T>(result: PortResult<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function stableFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(message) ? message : "FALCON24_RETAINED_ACTIVATION_FAILED";
}

function versions(closure: Falcon24SemanticAuthorityClosure) {
  return {
    semantic_pointer: closure.semantic_pointer.version,
    semantic_runtime: closure.semantic_runtime.version,
    workspace_defaults: closure.workspace_defaults.version,
  } as const;
}

function assertRetainedClosure(
  closure: Falcon24SemanticAuthorityClosure,
  expectedEpoch: string,
): void {
  if (
    closure.authority.authority_epoch !== expectedEpoch ||
    closure.semantic_pointer.release.generation !== 2 ||
    !exact(closure.semantic_runtime.release, closure.semantic_pointer.release) ||
    !exact(closure.workspace_defaults.release, closure.semantic_pointer.release)
  ) {
    throw new TypeError("FALCON24_RETAINED_SEMANTIC_CLOSURE_MISMATCH");
  }
}

function assertUnchangedReadback(input: {
  readonly before: Falcon24SemanticAuthorityClosure;
  readonly after: Falcon24SemanticAuthorityClosure;
  readonly authority_epoch: string;
  readonly authority: Falcon24AuthorityBindingV2;
}): void {
  const { before, after, authority, authority_epoch: authorityEpoch } = input;
  if (
    !exact(after.scope, before.scope) ||
    after.authority.authority_epoch !== authorityEpoch ||
    !exact(after.authority, authority) ||
    after.semantic_pointer.version !== before.semantic_pointer.version ||
    after.semantic_runtime.version !== before.semantic_runtime.version ||
    after.workspace_defaults.version !== before.workspace_defaults.version ||
    !exact(after.semantic_pointer.release, before.semantic_pointer.release) ||
    !exact(after.semantic_runtime.release, before.semantic_runtime.release) ||
    !exact(after.workspace_defaults.release, before.workspace_defaults.release)
  ) {
    throw new TypeError("FALCON24_RETAINED_POST_ACTIVATION_READBACK_MISMATCH");
  }
}

/** Advances Falcon build authority while retaining the exact active gen2 release. */
export async function finalizeFalcon24RetainedAuthority(input: {
  readonly capability: unknown;
  readonly authority_epoch: string;
  readonly web_build_identity: RuntimeBuildIdentity;
  readonly worker_build_identity: RuntimeBuildIdentity;
  readonly epoch: RetainedEpochPort;
  readonly readback: RetainedReadback;
  readonly recovery?: Readonly<{
    llm_execution_proof: unknown;
    predecessor_diagnostic_failure: unknown;
  }>;
  readonly stage_falcon_authority: (input: {
    readonly semantic_release_digest: `sha256:${string}`;
    readonly retained_semantic_proof_hash: `sha256:${string}`;
  }) => Promise<RetainedStagedAuthorityReferences>;
  readonly hold_activation_attempt: (request: {
    readonly schema_version: "falcon24-activation-request@2.0.0";
    readonly authority_epoch: string;
    readonly attempt_id: string;
    readonly baseline_id: string;
    readonly expected_baseline_hash: `sha256:${string}`;
    readonly failure_code: string;
  }) => Promise<void>;
}): Promise<Falcon24RetainedFinalizationResult> {
  const closure = await input.readback.loadCurrentClosure();
  const targetOrdinal = falcon24AuthorityEpochOrdinal(input.authority_epoch);
  if (targetOrdinal < 5n) {
    throw new TypeError("FALCON24_RETAINED_AUTHORITY_EPOCH_INVALID");
  }
  assertRetainedClosure(closure, `E${targetOrdinal - 1n}`);
  const published = await verifySemanticReleaseEnvelope(
    await input.readback.loadPublishedRelease({
      semantic_domain: closure.scope.semantic_domain,
      release_id: closure.semantic_pointer.release.release_id,
    }),
  );
  const verifiedStage = published;
  const validation = await validateSemanticRuntimeClosure(verifiedStage);
  if (
    validation.outcome !== "PASS" ||
    verifiedStage.stage.status !== "PROMOTED" ||
    !exact(verifiedStage.stage.candidate_release, closure.semantic_pointer.release)
  ) {
    throw new TypeError("FALCON24_RETAINED_PUBLISHED_RELEASE_INVALID");
  }

  const proof = await buildFalcon24RetainedSemanticReleaseAuthorityProof({
    schema_version: "falcon24-retained-semantic-release-authority-proof@1.0.0",
    scope: closure.scope,
    authority_epoch: input.authority_epoch,
    expected_current_authority: closure.authority,
    semantic_release: closure.semantic_pointer.release,
    projections: verifiedStage.stage.projection_refs,
    expected_versions: versions(closure),
    web_build: {
      build_id: input.web_build_identity.build_id,
      generation_id: input.web_build_identity.generation_id,
    },
    worker_build: {
      build_id: input.worker_build_identity.build_id,
      generation_id: input.worker_build_identity.generation_id,
    },
  });
  const staged = await input.stage_falcon_authority({
    semantic_release_digest: proof.semantic_release.release_digest as `sha256:${string}`,
    retained_semantic_proof_hash: proof.proof_hash as `sha256:${string}`,
  });
  const recoveryRequired = targetOrdinal >= 7n;
  let llmProof: Falcon24LlmExecutionAuthorityProof | null = null;
  let predecessorFailure: ReturnType<
    typeof falcon24PredecessorDiagnosticFailureSchema.parse
  > | null = null;
  if (recoveryRequired) {
    if (!input.recovery) throw new TypeError("FALCON24_RECOVERY_ACTIVATION_PROOF_REQUIRED");
    [llmProof, predecessorFailure] = await Promise.all([
      verifyFalcon24LlmExecutionAuthorityProof(input.recovery.llm_execution_proof),
      Promise.resolve(
        falcon24PredecessorDiagnosticFailureSchema.parse(
          input.recovery.predecessor_diagnostic_failure,
        ),
      ),
    ]);
    if (
      llmProof.target_authority_epoch !== input.authority_epoch ||
      !exact(llmProof.scope, proof.scope) ||
      llmProof.worker_build.build_id !== proof.worker_build.build_id ||
      llmProof.worker_build.generation_id !== proof.worker_build.generation_id
    ) {
      throw new TypeError("FALCON24_RECOVERY_ACTIVATION_PROOF_MISMATCH");
    }
  } else if (input.recovery) {
    throw new TypeError("FALCON24_RECOVERY_ACTIVATION_EPOCH_INVALID");
  }
  let authority: Falcon24AuthorityBindingV2;
  let recoveryResult: Falcon24RetainedActivationResultV4 | null = null;
  try {
    if (llmProof && predecessorFailure) {
      const request = await buildFalcon24ActivationRequestV4({
        schema_version: "falcon24-activation-request@4.0.0",
        scope: proof.scope,
        authority_epoch: input.authority_epoch,
        attempt_id: staged.activation_attempt_ref.activation_attempt_id,
        baseline_id: staged.baseline_ref.baseline_id,
        expected_baseline_hash: staged.baseline_ref.baseline_hash,
        expected_current_authority: proof.expected_current_authority,
        expected_semantic_release: proof.semantic_release,
        expected_versions: proof.expected_versions,
        retained_semantic_proof_hash: proof.proof_hash,
        predecessor_diagnostic_failure: predecessorFailure,
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      });
      recoveryResult = required(
        await input.epoch.activateRetainedWithRecovery(input.capability, {
          request,
          retained_semantic_proof: proof,
          llm_execution_proof: llmProof,
        }),
      );
      authority = falcon24AuthorityBindingV2Schema.parse(recoveryResult.authority);
    } else {
      const request = await buildFalcon24ActivationRequestV3({
        schema_version: "falcon24-activation-request@3.0.0",
        scope: proof.scope,
        authority_epoch: input.authority_epoch,
        attempt_id: staged.activation_attempt_ref.activation_attempt_id,
        baseline_id: staged.baseline_ref.baseline_id,
        expected_baseline_hash: staged.baseline_ref.baseline_hash,
        expected_current_authority: proof.expected_current_authority,
        expected_semantic_release: proof.semantic_release,
        expected_versions: proof.expected_versions,
        retained_semantic_proof_hash: proof.proof_hash,
      });
      authority = falcon24AuthorityBindingV2Schema.parse(
        required(
          await input.epoch.activateRetained(input.capability, {
            request,
            retained_semantic_proof: proof,
          }),
        ),
      );
    }
  } catch (activationError) {
    try {
      await input.hold_activation_attempt({
        schema_version: "falcon24-activation-request@2.0.0",
        authority_epoch: input.authority_epoch,
        attempt_id: staged.activation_attempt_ref.activation_attempt_id,
        baseline_id: staged.baseline_ref.baseline_id,
        expected_baseline_hash: staged.baseline_ref.baseline_hash,
        failure_code: stableFailureCode(activationError),
      });
    } catch (holdError) {
      throw new TypeError("FALCON24_RETAINED_ACTIVATION_HOLD_FAILED", {
        cause: new AggregateError([activationError, holdError]),
      });
    }
    throw activationError;
  }
  if (
    authority.authority_epoch !== input.authority_epoch ||
    authority.baseline_id !== staged.baseline_ref.baseline_id ||
    authority.baseline_hash !== staged.baseline_ref.baseline_hash ||
    authority.activation_attempt_id !== staged.activation_attempt_ref.activation_attempt_id
  ) {
    throw new TypeError("FALCON24_RETAINED_ACTIVATION_BINDING_MISMATCH");
  }

  let after: Falcon24SemanticAuthorityClosure;
  let reloaded: SemanticSuccessorStageEnvelope;
  try {
    after = await input.readback.loadCurrentClosure();
    assertUnchangedReadback({
      before: closure,
      after,
      authority_epoch: input.authority_epoch,
      authority,
    });
    reloaded = await verifySemanticReleaseEnvelope(
      await input.readback.loadPublishedRelease({
        semantic_domain: closure.scope.semantic_domain,
        release_id: closure.semantic_pointer.release.release_id,
      }),
    );
    if (!exact(reloaded, verifiedStage)) {
      throw new TypeError("FALCON24_RETAINED_POST_ACTIVATION_READBACK_MISMATCH");
    }
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === "FALCON24_RETAINED_POST_ACTIVATION_READBACK_MISMATCH"
    ) {
      throw error;
    }
    throw new TypeError("FALCON24_RETAINED_POST_ACTIVATION_READBACK_FAILED", { cause: error });
  }
  return Object.freeze({
    semantic_proof: proof,
    authority,
    readback: after,
    published_release: reloaded,
    recovery:
      llmProof && recoveryResult
        ? Object.freeze({ llm_execution_proof: llmProof, activation_result: recoveryResult })
        : null,
  });
}
