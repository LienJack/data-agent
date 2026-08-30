import "server-only";

import type { SemanticSuccessorStageEnvelope } from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import {
  verifyFalcon24FourLayerGateManifest,
  verifyFalcon24FourLayerTerminalReceipt,
} from "@data-agent/contracts/evals";
import type { PortResult } from "@data-agent/contracts/ports";
import type { ModelExecutionCertificationClaims } from "@data-agent/contracts/providers";
import {
  buildFalcon24ActivationRequestV3,
  buildFalcon24ActivationRequestV4,
  buildFalcon24ActivationRequestV5,
  buildFalcon24ActivationRequestV6,
  buildFalcon24ActivationRequestV7,
  buildFalcon24ActivationRequestV8,
  buildFalcon24RetainedSemanticReleaseAuthorityProof,
  type Falcon24AuthorityBindingV2,
  type Falcon24EpochClosureFailureReceipt,
  type Falcon24FinalizationFailureReceipt,
  type Falcon24LlmExecutionAuthorityProof,
  type Falcon24PredecessorFourLayerFailureRef,
  type Falcon24RetainedActivationResultV4,
  type Falcon24RetainedActivationResultV5,
  type Falcon24RetainedActivationResultV6,
  type Falcon24RetainedActivationResultV7,
  type Falcon24RetainedActivationResultV8,
  type Falcon24RetainedSemanticReleaseAuthorityProof,
  type Falcon24SemanticAuthorityClosure,
  type Falcon24TerminalDiagnosticFailureReceiptRef,
  falcon24AuthorityBindingV2Schema,
  falcon24AuthorityEpochOrdinal,
  falcon24EpochClosureFailureReceiptSchema,
  falcon24FinalizationFailureReceiptSchema,
  falcon24PredecessorDiagnosticFailureSchema,
  falcon24TerminalDiagnosticFailureReceiptRefSchema,
  verifyFalcon24FourLayerRecoveryEvidence,
  verifyFalcon24LlmExecutionAuthorityProof,
} from "@data-agent/contracts/runs";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
import type { ProviderExecutionProfile } from "@data-agent/contracts/workspaces";
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
  activateRetainedWithClosureRecovery(
    capability: unknown,
    input: unknown,
  ): Promise<PortResult<Falcon24RetainedActivationResultV5>>;
  activateRetainedWithTerminalDiagnosticRecovery(
    capability: unknown,
    input: unknown,
  ): Promise<PortResult<Falcon24RetainedActivationResultV6>>;
  activateRetainedWithFinalizationFailureRecovery(
    capability: unknown,
    input: unknown,
  ): Promise<PortResult<Falcon24RetainedActivationResultV7>>;
  activateRetainedWithFourLayerFailureRecovery(
    capability: unknown,
    input: unknown,
  ): Promise<PortResult<Falcon24RetainedActivationResultV8>>;
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
  readonly recovery:
    | Readonly<{
        kind: "DIAGNOSTIC";
        llm_execution_proof: Falcon24LlmExecutionAuthorityProof;
        activation_result: Falcon24RetainedActivationResultV4;
      }>
    | Readonly<{
        kind: "CLOSURE_FAILURE";
        llm_execution_proof: Falcon24LlmExecutionAuthorityProof;
        predecessor_closure_failure: Falcon24EpochClosureFailureReceipt;
        activation_result: Falcon24RetainedActivationResultV5;
        provider_execution_profile: ProviderExecutionProfile;
      }>
    | Readonly<{
        kind: "TERMINAL_DIAGNOSTIC";
        llm_execution_proof: Falcon24LlmExecutionAuthorityProof;
        predecessor_diagnostic_receipt: Falcon24TerminalDiagnosticFailureReceiptRef;
        activation_result: Falcon24RetainedActivationResultV6;
        provider_execution_profile: ProviderExecutionProfile;
        current_execution_certification: ModelExecutionCertificationClaims;
      }>
    | Readonly<{
        kind: "FINALIZATION_FAILURE";
        llm_execution_proof: Falcon24LlmExecutionAuthorityProof;
        predecessor_finalization_failure: Falcon24FinalizationFailureReceipt;
        activation_result: Falcon24RetainedActivationResultV7;
        provider_execution_profile: ProviderExecutionProfile;
        current_execution_certification: ModelExecutionCertificationClaims;
      }>
    | Readonly<{
        kind: "FOUR_LAYER_FAILURE";
        llm_execution_proof: Falcon24LlmExecutionAuthorityProof;
        predecessor_four_layer_failure_receipt: Falcon24PredecessorFourLayerFailureRef;
        activation_result: Falcon24RetainedActivationResultV8;
        provider_execution_profile: ProviderExecutionProfile;
        current_execution_certification: ModelExecutionCertificationClaims;
      }>
    | null;
}

type Falcon24RetainedRecoveryInput =
  | Readonly<{
      kind: "DIAGNOSTIC";
      llm_execution_proof: unknown;
      predecessor_diagnostic_failure: unknown;
    }>
  | Readonly<{
      kind: "CLOSURE_FAILURE";
      llm_execution_proof: unknown;
      predecessor_closure_failure: unknown;
    }>
  | Readonly<{
      kind: "TERMINAL_DIAGNOSTIC";
      llm_execution_proof: unknown;
      predecessor_diagnostic_receipt: unknown;
    }>
  | Readonly<{
      kind: "FINALIZATION_FAILURE";
      llm_execution_proof: unknown;
      predecessor_finalization_failure: unknown;
    }>
  | Readonly<{
      kind: "FOUR_LAYER_FAILURE";
      llm_execution_proof: unknown;
      predecessor_manifest: unknown;
      predecessor_terminal_receipt: unknown;
    }>;

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
  readonly recovery?: Falcon24RetainedRecoveryInput;
  readonly load_provider_execution_profiles?: () => Promise<readonly ProviderExecutionProfile[]>;
  readonly resolve_current_execution_certification?: (input: {
    readonly model_profile_id: string;
    readonly model_config_version: number;
    readonly certification_receipt_ref: Falcon24LlmExecutionAuthorityProof["certification_receipt_ref"];
  }) => Promise<ModelExecutionCertificationClaims>;
  readonly resolve_current_execution_certification_v2?: (input: {
    readonly model_profile_id: string;
    readonly model_config_version: number;
    readonly certification_receipt_ref: Falcon24LlmExecutionAuthorityProof["certification_receipt_ref"];
  }) => Promise<ModelExecutionCertificationClaims>;
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
  const predecessorFourLayer =
    input.recovery?.kind === "FOUR_LAYER_FAILURE"
      ? {
          manifest: await verifyFalcon24FourLayerGateManifest(input.recovery.predecessor_manifest),
          terminal_receipt: await verifyFalcon24FourLayerTerminalReceipt(
            input.recovery.predecessor_terminal_receipt,
          ),
        }
      : null;
  const staged = await input.stage_falcon_authority({
    semantic_release_digest: proof.semantic_release.release_digest as `sha256:${string}`,
    retained_semantic_proof_hash: proof.proof_hash as `sha256:${string}`,
  });
  const diagnosticRecoveryRequired = targetOrdinal === 7n;
  const closureRecoveryRequired = targetOrdinal === 8n;
  const terminalRecoveryRequired = targetOrdinal >= 9n;
  const recoveryRequired =
    diagnosticRecoveryRequired || closureRecoveryRequired || terminalRecoveryRequired;
  let llmProof: Falcon24LlmExecutionAuthorityProof | null = null;
  let predecessorFailure: ReturnType<
    typeof falcon24PredecessorDiagnosticFailureSchema.parse
  > | null = null;
  let predecessorClosureFailure: Falcon24EpochClosureFailureReceipt | null = null;
  let predecessorDiagnosticReceipt: Falcon24TerminalDiagnosticFailureReceiptRef | null = null;
  let predecessorFinalizationFailure: Falcon24FinalizationFailureReceipt | null = null;
  if (recoveryRequired) {
    if (!input.recovery) throw new TypeError("FALCON24_RECOVERY_ACTIVATION_PROOF_REQUIRED");
    if (
      (diagnosticRecoveryRequired && input.recovery.kind !== "DIAGNOSTIC") ||
      (closureRecoveryRequired && input.recovery.kind !== "CLOSURE_FAILURE") ||
      (terminalRecoveryRequired &&
        input.recovery.kind !== "TERMINAL_DIAGNOSTIC" &&
        input.recovery.kind !== "FINALIZATION_FAILURE" &&
        input.recovery.kind !== "FOUR_LAYER_FAILURE") ||
      (input.recovery.kind === "TERMINAL_DIAGNOSTIC" && targetOrdinal < 9n) ||
      (input.recovery.kind === "FINALIZATION_FAILURE" && targetOrdinal < 10n) ||
      (targetOrdinal >= 12n && input.recovery.kind !== "FOUR_LAYER_FAILURE") ||
      (input.recovery.kind === "FOUR_LAYER_FAILURE" && targetOrdinal < 12n)
    ) {
      throw new TypeError("FALCON24_RECOVERY_ACTIVATION_KIND_MISMATCH");
    }
    llmProof = await verifyFalcon24LlmExecutionAuthorityProof(input.recovery.llm_execution_proof);
    if (input.recovery.kind === "DIAGNOSTIC") {
      predecessorFailure = falcon24PredecessorDiagnosticFailureSchema.parse(
        input.recovery.predecessor_diagnostic_failure,
      );
    } else if (input.recovery.kind === "CLOSURE_FAILURE") {
      predecessorClosureFailure = falcon24EpochClosureFailureReceiptSchema.parse(
        input.recovery.predecessor_closure_failure,
      );
    } else if (input.recovery.kind === "TERMINAL_DIAGNOSTIC") {
      predecessorDiagnosticReceipt = falcon24TerminalDiagnosticFailureReceiptRefSchema.parse(
        input.recovery.predecessor_diagnostic_receipt,
      );
    } else if (input.recovery.kind === "FINALIZATION_FAILURE") {
      predecessorFinalizationFailure = falcon24FinalizationFailureReceiptSchema.parse(
        input.recovery.predecessor_finalization_failure,
      );
    }
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
  let closureRecoveryResult: Falcon24RetainedActivationResultV5 | null = null;
  let terminalDiagnosticRecoveryResult: Falcon24RetainedActivationResultV6 | null = null;
  let finalizationFailureRecoveryResult: Falcon24RetainedActivationResultV7 | null = null;
  let fourLayerRecoveryResult: Falcon24RetainedActivationResultV8 | null = null;
  try {
    if (llmProof && predecessorFourLayer) {
      const terminal = predecessorFourLayer.terminal_receipt;
      const request = await buildFalcon24ActivationRequestV8({
        schema_version: "falcon24-activation-request@8.0.0",
        scope: proof.scope,
        authority_epoch: input.authority_epoch,
        attempt_id: staged.activation_attempt_ref.activation_attempt_id,
        baseline_id: staged.baseline_ref.baseline_id,
        expected_baseline_hash: staged.baseline_ref.baseline_hash,
        expected_current_authority: proof.expected_current_authority,
        expected_semantic_release: proof.semantic_release,
        expected_versions: proof.expected_versions,
        retained_semantic_proof_hash: proof.proof_hash,
        predecessor_four_layer_failure_receipt: {
          attempt_id: terminal.attempt_id,
          manifest_hash: terminal.manifest_hash,
          turn_ordinal: terminal.turn_ordinal,
          run_id: terminal.run_id,
          receipt_hash: terminal.receipt_hash,
          failure_code: terminal.failure_code,
        },
        llm_execution_stage_ref: { stage_id: llmProof.stage_id, proof_hash: llmProof.proof_hash },
      });
      await verifyFalcon24FourLayerRecoveryEvidence(
        request,
        predecessorFourLayer.manifest,
        terminal,
      );
      fourLayerRecoveryResult = required(
        await input.epoch.activateRetainedWithFourLayerFailureRecovery(input.capability, {
          request,
          retained_semantic_proof: proof,
          llm_execution_proof: llmProof,
          predecessor_manifest: predecessorFourLayer.manifest,
          predecessor_terminal_receipt: terminal,
        }),
      );
      authority = falcon24AuthorityBindingV2Schema.parse(fourLayerRecoveryResult.authority);
    } else if (llmProof && predecessorFinalizationFailure) {
      const request = await buildFalcon24ActivationRequestV7({
        schema_version: "falcon24-activation-request@7.0.0",
        scope: proof.scope,
        authority_epoch: input.authority_epoch,
        attempt_id: staged.activation_attempt_ref.activation_attempt_id,
        baseline_id: staged.baseline_ref.baseline_id,
        expected_baseline_hash: staged.baseline_ref.baseline_hash,
        expected_current_authority: proof.expected_current_authority,
        expected_semantic_release: proof.semantic_release,
        expected_versions: proof.expected_versions,
        retained_semantic_proof_hash: proof.proof_hash,
        predecessor_finalization_failure_receipt: {
          receipt_id: predecessorFinalizationFailure.receipt_id,
          receipt_hash: predecessorFinalizationFailure.receipt_hash,
          failure_code: predecessorFinalizationFailure.failure_code,
        },
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      });
      finalizationFailureRecoveryResult = required(
        await input.epoch.activateRetainedWithFinalizationFailureRecovery(input.capability, {
          request,
          retained_semantic_proof: proof,
          llm_execution_proof: llmProof,
          predecessor_finalization_failure_receipt:
            request.predecessor_finalization_failure_receipt,
        }),
      );
      authority = falcon24AuthorityBindingV2Schema.parse(
        finalizationFailureRecoveryResult.authority,
      );
    } else if (llmProof && predecessorDiagnosticReceipt) {
      const request = await buildFalcon24ActivationRequestV6({
        schema_version: "falcon24-activation-request@6.0.0",
        scope: proof.scope,
        authority_epoch: input.authority_epoch,
        attempt_id: staged.activation_attempt_ref.activation_attempt_id,
        baseline_id: staged.baseline_ref.baseline_id,
        expected_baseline_hash: staged.baseline_ref.baseline_hash,
        expected_current_authority: proof.expected_current_authority,
        expected_semantic_release: proof.semantic_release,
        expected_versions: proof.expected_versions,
        retained_semantic_proof_hash: proof.proof_hash,
        predecessor_diagnostic_receipt: predecessorDiagnosticReceipt,
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      });
      terminalDiagnosticRecoveryResult = required(
        await input.epoch.activateRetainedWithTerminalDiagnosticRecovery(input.capability, {
          request,
          retained_semantic_proof: proof,
          llm_execution_proof: llmProof,
          predecessor_diagnostic_receipt: predecessorDiagnosticReceipt,
        }),
      );
      authority = falcon24AuthorityBindingV2Schema.parse(
        terminalDiagnosticRecoveryResult.authority,
      );
    } else if (llmProof && predecessorClosureFailure) {
      const request = await buildFalcon24ActivationRequestV5({
        schema_version: "falcon24-activation-request@5.0.0",
        scope: proof.scope,
        authority_epoch: input.authority_epoch,
        attempt_id: staged.activation_attempt_ref.activation_attempt_id,
        baseline_id: staged.baseline_ref.baseline_id,
        expected_baseline_hash: staged.baseline_ref.baseline_hash,
        expected_current_authority: proof.expected_current_authority,
        expected_semantic_release: proof.semantic_release,
        expected_versions: proof.expected_versions,
        retained_semantic_proof_hash: proof.proof_hash,
        predecessor_closure_failure_ref: {
          receipt_id: predecessorClosureFailure.receipt_id,
          receipt_hash: predecessorClosureFailure.receipt_hash,
          failure_code: predecessorClosureFailure.failure_code,
        },
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      });
      closureRecoveryResult = required(
        await input.epoch.activateRetainedWithClosureRecovery(input.capability, {
          request,
          retained_semantic_proof: proof,
          llm_execution_proof: llmProof,
          predecessor_closure_failure: predecessorClosureFailure,
        }),
      );
      authority = falcon24AuthorityBindingV2Schema.parse(closureRecoveryResult.authority);
    } else if (llmProof && predecessorFailure) {
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
  let providerExecutionProfile: ProviderExecutionProfile | null = null;
  let currentExecutionCertification: ModelExecutionCertificationClaims | null = null;
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
    if (
      llmProof &&
      ((closureRecoveryResult && predecessorClosureFailure) ||
        (terminalDiagnosticRecoveryResult && predecessorDiagnosticReceipt) ||
        (finalizationFailureRecoveryResult && predecessorFinalizationFailure) ||
        (fourLayerRecoveryResult && predecessorFourLayer))
    ) {
      if (!input.load_provider_execution_profiles) {
        throw new TypeError("FALCON24_RETAINED_PROVIDER_PROFILE_READBACK_REQUIRED");
      }
      const matches = (await input.load_provider_execution_profiles()).filter(
        (profile) => profile.model_profile_id === llmProof.model_profile_id,
      );
      const profile = matches[0];
      if (
        matches.length !== 1 ||
        !profile ||
        profile.readiness !== "AVAILABLE" ||
        !profile.selectable ||
        profile.model_config_version !== llmProof.model_config_version ||
        profile.execution_profile_hash !== llmProof.execution_profile_hash ||
        profile.certification_receipt_ref.run_id !== llmProof.certification_receipt_ref.run_id ||
        profile.certification_receipt_ref.artifact_id !==
          llmProof.certification_receipt_ref.artifact_id ||
        profile.certification_receipt_ref.revision !==
          llmProof.certification_receipt_ref.revision ||
        profile.certification_receipt_ref.content_hash !==
          llmProof.certification_receipt_ref.content_hash
      ) {
        throw new TypeError("FALCON24_RETAINED_POST_ACTIVATION_PROVIDER_PROFILE_MISMATCH");
      }
      providerExecutionProfile = profile;
      if (
        (terminalDiagnosticRecoveryResult && predecessorDiagnosticReceipt) ||
        (finalizationFailureRecoveryResult && predecessorFinalizationFailure) ||
        (fourLayerRecoveryResult && predecessorFourLayer)
      ) {
        const resolveCurrentCertification =
          targetOrdinal >= 10n
            ? input.resolve_current_execution_certification_v2
            : input.resolve_current_execution_certification;
        if (!resolveCurrentCertification) {
          throw new TypeError("FALCON24_RETAINED_CURRENT_CERTIFICATION_READBACK_REQUIRED");
        }
        const certification = await resolveCurrentCertification({
          model_profile_id: llmProof.model_profile_id,
          model_config_version: llmProof.model_config_version,
          certification_receipt_ref: llmProof.certification_receipt_ref,
        });
        if (
          certification.profile_id !== llmProof.model_profile_id ||
          certification.model_config_version !== llmProof.model_config_version ||
          certification.provider !== llmProof.provider ||
          certification.model_id !== llmProof.model_id ||
          certification.execution_profile_hash !== llmProof.execution_profile_hash ||
          !exact(certification.receipt_ref, llmProof.certification_receipt_ref)
        ) {
          throw new TypeError("FALCON24_RETAINED_CURRENT_CERTIFICATION_READBACK_MISMATCH");
        }
        currentExecutionCertification = certification;
      }
    }
  } catch (error) {
    if (
      error instanceof TypeError &&
      [
        "FALCON24_RETAINED_POST_ACTIVATION_READBACK_MISMATCH",
        "FALCON24_RETAINED_PROVIDER_PROFILE_READBACK_REQUIRED",
        "FALCON24_RETAINED_POST_ACTIVATION_PROVIDER_PROFILE_MISMATCH",
        "FALCON24_RETAINED_CURRENT_CERTIFICATION_READBACK_REQUIRED",
        "FALCON24_RETAINED_CURRENT_CERTIFICATION_READBACK_MISMATCH",
      ].includes(error.message)
    ) {
      throw error;
    }
    throw new TypeError("FALCON24_RETAINED_POST_ACTIVATION_READBACK_FAILED", { cause: error });
  }
  if (
    llmProof &&
    fourLayerRecoveryResult &&
    providerExecutionProfile &&
    currentExecutionCertification
  ) {
    return Object.freeze({
      semantic_proof: proof,
      authority,
      readback: after,
      published_release: reloaded,
      recovery: Object.freeze({
        kind: "FOUR_LAYER_FAILURE" as const,
        llm_execution_proof: llmProof,
        predecessor_four_layer_failure_receipt:
          fourLayerRecoveryResult.predecessor_four_layer_failure_receipt,
        activation_result: fourLayerRecoveryResult,
        provider_execution_profile: providerExecutionProfile,
        current_execution_certification: currentExecutionCertification,
      }),
    });
  }
  return Object.freeze({
    semantic_proof: proof,
    authority,
    readback: after,
    published_release: reloaded,
    recovery:
      llmProof &&
      predecessorFinalizationFailure &&
      finalizationFailureRecoveryResult &&
      providerExecutionProfile &&
      currentExecutionCertification
        ? Object.freeze({
            kind: "FINALIZATION_FAILURE" as const,
            llm_execution_proof: llmProof,
            predecessor_finalization_failure: predecessorFinalizationFailure,
            activation_result: finalizationFailureRecoveryResult,
            provider_execution_profile: providerExecutionProfile,
            current_execution_certification: currentExecutionCertification,
          })
        : llmProof &&
            predecessorDiagnosticReceipt &&
            terminalDiagnosticRecoveryResult &&
            providerExecutionProfile &&
            currentExecutionCertification
          ? Object.freeze({
              kind: "TERMINAL_DIAGNOSTIC" as const,
              llm_execution_proof: llmProof,
              predecessor_diagnostic_receipt: predecessorDiagnosticReceipt,
              activation_result: terminalDiagnosticRecoveryResult,
              provider_execution_profile: providerExecutionProfile,
              current_execution_certification: currentExecutionCertification,
            })
          : llmProof &&
              predecessorClosureFailure &&
              closureRecoveryResult &&
              providerExecutionProfile
            ? Object.freeze({
                kind: "CLOSURE_FAILURE" as const,
                llm_execution_proof: llmProof,
                predecessor_closure_failure: predecessorClosureFailure,
                activation_result: closureRecoveryResult,
                provider_execution_profile: providerExecutionProfile,
              })
            : llmProof && recoveryResult
              ? Object.freeze({
                  kind: "DIAGNOSTIC" as const,
                  llm_execution_proof: llmProof,
                  activation_result: recoveryResult,
                })
              : null,
  });
}
