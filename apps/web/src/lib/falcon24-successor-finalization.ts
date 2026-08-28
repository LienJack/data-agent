import "server-only";

import {
  buildStageReviewedSemanticSuccessorCommand,
  type SemanticRuntimeClosureValidationReceipt,
  type SemanticRuntimeSmokeReceipt,
  type SemanticSuccessorStage,
  type SemanticSuccessorStageEnvelope,
  verifySemanticRuntimeSmokeReceipt,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import type { Falcon24SemanticReleaseAuthorityProofV2 } from "@data-agent/contracts/evals";
import type { PortResult } from "@data-agent/contracts/ports";
import {
  buildCombinedFalcon24SemanticActivationCommand,
  type CombinedFalcon24SemanticActivationReceipt,
  type Falcon24SemanticAuthorityClosure,
  verifyCombinedFalcon24SemanticActivationReceipt,
} from "@data-agent/contracts/runs";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
import { buildFalcon24SemanticSuccessorAuthorityProof } from "@data-agent/platform/semantic-postgres";
import {
  type SemanticPublicationAuthorityPort,
  validateSemanticRuntimeClosure,
  verifySemanticReleaseEnvelope,
} from "@data-agent/semantic/production";

type SemanticRelease = SemanticSuccessorStage["candidate_release"];

export interface Falcon24SuccessorFinalizationReadback {
  loadCurrentClosure(): Promise<Falcon24SemanticAuthorityClosure>;
  loadPublishedRelease(input: {
    readonly semantic_domain: string;
    readonly release_id: string;
  }): Promise<SemanticSuccessorStageEnvelope>;
}

export interface Falcon24SuccessorSmokePort {
  run(input: {
    readonly capability: unknown;
    readonly semantic_domain: string;
    readonly stage_id: string;
    readonly idempotency_key: string;
    readonly worker_build_identity: RuntimeBuildIdentity;
  }): Promise<PortResult<SemanticRuntimeSmokeReceipt>>;
}

export interface Falcon24StagedAuthorityReferences {
  readonly baseline_ref: {
    readonly baseline_id: string;
    readonly baseline_hash: `sha256:${string}`;
  };
  readonly activation_attempt_ref: {
    readonly activation_attempt_id: string;
  };
}

export interface Falcon24ActivationAttemptHoldRequest {
  readonly schema_version: "falcon24-activation-request@2.0.0";
  readonly authority_epoch: "E4";
  readonly attempt_id: string;
  readonly baseline_id: string;
  readonly expected_baseline_hash: `sha256:${string}`;
  readonly failure_code: string;
}

export interface Falcon24SuccessorFinalizationResult {
  readonly stage: SemanticSuccessorStageEnvelope;
  readonly validation_receipt: SemanticRuntimeClosureValidationReceipt;
  readonly smoke_receipt: SemanticRuntimeSmokeReceipt;
  readonly semantic_proof: Falcon24SemanticReleaseAuthorityProofV2;
  readonly activation_receipt: CombinedFalcon24SemanticActivationReceipt;
  readonly readback: Falcon24SemanticAuthorityClosure;
  readonly published_release: SemanticSuccessorStageEnvelope;
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function fail(code: string): never {
  throw new TypeError(code);
}

function requirePortValue<T>(result: PortResult<T>): T {
  if (!result.ok) return fail(result.error.code);
  return result.value;
}

function stableActivationFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(message) ? message : "FALCON24_COMBINED_ACTIVATION_FAILED";
}

function expectedVersions(closure: Falcon24SemanticAuthorityClosure) {
  return {
    semantic_pointer: closure.semantic_pointer.version,
    semantic_runtime: closure.semantic_runtime.version,
    workspace_defaults: closure.workspace_defaults.version,
  } as const;
}

function assertPreActivationClosure(
  closure: Falcon24SemanticAuthorityClosure,
  command: Awaited<ReturnType<typeof buildStageReviewedSemanticSuccessorCommand>>,
): void {
  const predecessor = closure.semantic_pointer.release;
  const commandPredecessor = command.expected_predecessor;
  if (
    closure.authority.authority_epoch !== "E3" ||
    predecessor.generation !== 1 ||
    command.target_generation !== 2 ||
    !exact(closure.scope, command.scope) ||
    closure.semantic_pointer.version !== command.expected_pointer_version ||
    !exact(closure.semantic_runtime.release, predecessor) ||
    !exact(closure.workspace_defaults.release, predecessor) ||
    commandPredecessor.release_id !== predecessor.release_id ||
    commandPredecessor.generation !== predecessor.generation ||
    commandPredecessor.release_digest !== predecessor.release_digest
  ) {
    fail("FALCON24_SEMANTIC_SUCCESSOR_PREFLIGHT_MISMATCH");
  }
}

function assertStageCommandBinding(
  stage: SemanticSuccessorStage,
  command: Awaited<ReturnType<typeof buildStageReviewedSemanticSuccessorCommand>>,
): void {
  if (
    !exact(stage.scope, command.scope) ||
    !exact(stage.predecessor_release, command.expected_predecessor) ||
    stage.expected_pointer_version !== command.expected_pointer_version ||
    stage.target_generation !== command.target_generation ||
    !exact(stage.change_set_ref, command.change_set_ref) ||
    !exact(stage.review_ref, command.review_ref) ||
    !exact(stage.source_snapshot_ref, command.source_snapshot_ref) ||
    !exact(stage.compiler_bundle_ref, command.compiler_bundle_ref)
  ) {
    fail("FALCON24_SEMANTIC_SUCCESSOR_STAGE_BINDING_MISMATCH");
  }
}

function assertSmokeClosure(
  stage: SemanticSuccessorStage,
  receipt: SemanticRuntimeSmokeReceipt,
  expectedWorkerBuild: RuntimeBuildIdentity,
): void {
  if (
    receipt.outcome !== "PASS" ||
    receipt.failure_code !== null ||
    receipt.stage_id !== stage.stage_id ||
    receipt.stage_digest !== stage.stage_digest ||
    !exact(receipt.candidate_release, stage.candidate_release) ||
    !exact(receipt.projection_refs, stage.projection_refs)
  ) {
    fail("FALCON24_SEMANTIC_SUCCESSOR_SMOKE_REQUIRED");
  }
  if (!exact(receipt.worker_build_identity, expectedWorkerBuild)) {
    fail("FALCON24_SEMANTIC_SUCCESSOR_SMOKE_BUILD_MISMATCH");
  }
}

function assertPostActivationClosure(input: {
  readonly before: Falcon24SemanticAuthorityClosure;
  readonly after: Falcon24SemanticAuthorityClosure;
  readonly receipt: CombinedFalcon24SemanticActivationReceipt;
  readonly candidate: SemanticRelease;
}): void {
  const { before, after, receipt, candidate } = input;
  if (
    !exact(after.scope, before.scope) ||
    !exact(after.authority, receipt.authority) ||
    after.authority.authority_epoch !== "E4" ||
    after.semantic_pointer.version !== before.semantic_pointer.version + 1 ||
    after.semantic_runtime.version !== before.semantic_runtime.version + 1 ||
    after.workspace_defaults.version !== before.workspace_defaults.version + 1 ||
    after.workspace_defaults.version !== receipt.workspace_defaults.version ||
    !exact(after.semantic_pointer.release, candidate) ||
    !exact(after.semantic_runtime.release, candidate) ||
    !exact(after.workspace_defaults.release, candidate) ||
    !exact(receipt.semantic_release, candidate) ||
    !exact(receipt.workspace_defaults.semantic_release, candidate)
  ) {
    fail("FALCON24_POST_ACTIVATION_READBACK_MISMATCH");
  }
}

/**
 * Coordinates the existing server-owned authorities. It cannot compile or
 * submit projection payloads and deliberately has no compensation writer: a
 * post-commit mismatch is a severe incident that freezes further execution.
 */
export async function finalizeFalcon24SemanticSuccessor(input: {
  readonly stage_command: Parameters<SemanticPublicationAuthorityPort["stageReviewedSuccessor"]>[0];
  readonly smoke_idempotency_key: string;
  readonly worker_build_identity: RuntimeBuildIdentity;
  readonly smoke_capability: unknown;
  readonly activation: {
    readonly command_id: string;
    readonly idempotency_key: string;
  };
  readonly publication_authority: SemanticPublicationAuthorityPort;
  readonly smoke: Falcon24SuccessorSmokePort;
  readonly stage_falcon_authority: (input: {
    readonly stage: SemanticSuccessorStageEnvelope;
    readonly validation_receipt: SemanticRuntimeClosureValidationReceipt;
    readonly smoke_receipt: SemanticRuntimeSmokeReceipt;
    readonly semantic_proof: Falcon24SemanticReleaseAuthorityProofV2;
  }) => Promise<Falcon24StagedAuthorityReferences>;
  readonly hold_activation_attempt: (
    request: Falcon24ActivationAttemptHoldRequest,
  ) => Promise<void>;
  readonly readback: Falcon24SuccessorFinalizationReadback;
}): Promise<Falcon24SuccessorFinalizationResult> {
  const command = await buildStageReviewedSemanticSuccessorCommand(input.stage_command);
  const before = await input.readback.loadCurrentClosure();
  assertPreActivationClosure(before, command);

  const stagedEnvelope = await verifySemanticReleaseEnvelope(
    await input.publication_authority.stageReviewedSuccessor(command),
  );
  assertStageCommandBinding(stagedEnvelope.stage, command);
  if (stagedEnvelope.stage.status !== "STAGED" && stagedEnvelope.stage.status !== "SMOKE_PASSED") {
    fail("FALCON24_SEMANTIC_SUCCESSOR_STAGE_NOT_SMOKEABLE");
  }

  const smoke = await verifySemanticRuntimeSmokeReceipt(
    requirePortValue(
      await input.smoke.run({
        capability: input.smoke_capability,
        semantic_domain: command.scope.semantic_domain,
        stage_id: stagedEnvelope.stage.stage_id,
        idempotency_key: input.smoke_idempotency_key,
        worker_build_identity: input.worker_build_identity,
      }),
    ),
  );
  assertSmokeClosure(stagedEnvelope.stage, smoke, input.worker_build_identity);

  const smokePassedEnvelope = await verifySemanticReleaseEnvelope(
    await input.publication_authority.loadStagedSuccessor({
      stage_id: stagedEnvelope.stage.stage_id,
    }),
  );
  if (
    smokePassedEnvelope.stage.status !== "SMOKE_PASSED" ||
    smokePassedEnvelope.stage.stage_id !== stagedEnvelope.stage.stage_id ||
    smokePassedEnvelope.stage.stage_digest !== stagedEnvelope.stage.stage_digest ||
    !exact(smokePassedEnvelope.stage.candidate_release, stagedEnvelope.stage.candidate_release)
  ) {
    fail("FALCON24_SEMANTIC_SUCCESSOR_SMOKE_STATE_MISMATCH");
  }
  assertStageCommandBinding(smokePassedEnvelope.stage, command);
  const validation = await validateSemanticRuntimeClosure(smokePassedEnvelope);
  if (validation.outcome !== "PASS") {
    fail("FALCON24_SEMANTIC_SUCCESSOR_VALIDATION_REQUIRED");
  }
  assertSmokeClosure(smokePassedEnvelope.stage, smoke, input.worker_build_identity);

  const proof = await buildFalcon24SemanticSuccessorAuthorityProof({
    stage: smokePassedEnvelope.stage,
    validation_receipt: validation,
    smoke_receipt: smoke,
    expected_versions: expectedVersions(before),
  });
  const stagedAuthority = await input.stage_falcon_authority({
    stage: smokePassedEnvelope,
    validation_receipt: validation,
    smoke_receipt: smoke,
    semantic_proof: proof,
  });
  const combinedCommand = await buildCombinedFalcon24SemanticActivationCommand({
    schema_version: "combined-falcon24-semantic-activation-command@1.0.0",
    command_id: input.activation.command_id,
    idempotency_key: input.activation.idempotency_key,
    scope: command.scope,
    authority_epoch: "E4",
    expected_current_authority: before.authority,
    expected_semantic_predecessor: before.semantic_pointer.release,
    stage_ref: {
      stage_id: smokePassedEnvelope.stage.stage_id,
      stage_digest: smokePassedEnvelope.stage.stage_digest,
    },
    smoke_receipt_ref: {
      schema_version: smoke.schema_version,
      receipt_id: smoke.receipt_id,
      smoke_receipt_hash: smoke.smoke_receipt_hash,
    },
    baseline_ref: stagedAuthority.baseline_ref,
    activation_attempt_ref: stagedAuthority.activation_attempt_ref,
    expected_versions: expectedVersions(before),
  });
  let activationResult: unknown;
  try {
    activationResult = await input.publication_authority.promoteStagedSuccessor(combinedCommand);
  } catch (promoteError) {
    try {
      await input.hold_activation_attempt({
        schema_version: "falcon24-activation-request@2.0.0",
        authority_epoch: "E4",
        attempt_id: stagedAuthority.activation_attempt_ref.activation_attempt_id,
        baseline_id: stagedAuthority.baseline_ref.baseline_id,
        expected_baseline_hash: stagedAuthority.baseline_ref.baseline_hash,
        failure_code: stableActivationFailureCode(promoteError),
      });
    } catch (holdError) {
      throw new TypeError("FALCON24_E4_ACTIVATION_HOLD_FAILED", {
        cause: new AggregateError(
          [promoteError, holdError],
          "Falcon24 combined activation and activation-attempt HOLD both failed.",
        ),
      });
    }
    throw promoteError;
  }
  const activationReceipt = await verifyCombinedFalcon24SemanticActivationReceipt(activationResult);
  if (
    activationReceipt.command_id !== combinedCommand.command_id ||
    activationReceipt.command_hash !== combinedCommand.command_hash ||
    !exact(activationReceipt.scope, combinedCommand.scope) ||
    activationReceipt.authority.authority_epoch !== "E4" ||
    activationReceipt.authority.baseline_id !== combinedCommand.baseline_ref.baseline_id ||
    activationReceipt.authority.baseline_hash !== combinedCommand.baseline_ref.baseline_hash ||
    activationReceipt.authority.activation_attempt_id !==
      combinedCommand.activation_attempt_ref.activation_attempt_id ||
    !exact(activationReceipt.semantic_release, smokePassedEnvelope.stage.candidate_release) ||
    activationReceipt.workspace_defaults.version !== before.workspace_defaults.version + 1 ||
    !exact(
      activationReceipt.workspace_defaults.semantic_release,
      smokePassedEnvelope.stage.candidate_release,
    ) ||
    !exact(activationReceipt.stage_ref, combinedCommand.stage_ref) ||
    !exact(activationReceipt.smoke_receipt_ref, combinedCommand.smoke_receipt_ref)
  ) {
    fail("FALCON24_COMBINED_ACTIVATION_RECEIPT_MISMATCH");
  }

  let after: Falcon24SemanticAuthorityClosure;
  let publishedRelease: Awaited<ReturnType<typeof verifySemanticReleaseEnvelope>>;
  try {
    after = await input.readback.loadCurrentClosure();
    assertPostActivationClosure({
      before,
      after,
      receipt: activationReceipt,
      candidate: smokePassedEnvelope.stage.candidate_release,
    });
    publishedRelease = await verifySemanticReleaseEnvelope(
      await input.readback.loadPublishedRelease({
        semantic_domain: command.scope.semantic_domain,
        release_id: smokePassedEnvelope.stage.candidate_release.release_id,
      }),
    );
    if (
      publishedRelease.stage.status !== "PROMOTED" ||
      publishedRelease.stage.stage_id !== smokePassedEnvelope.stage.stage_id ||
      publishedRelease.stage.stage_digest !== smokePassedEnvelope.stage.stage_digest ||
      !exact(publishedRelease.stage.candidate_release, smokePassedEnvelope.stage.candidate_release)
    ) {
      fail("FALCON24_POST_ACTIVATION_READBACK_MISMATCH");
    }
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === "FALCON24_POST_ACTIVATION_READBACK_MISMATCH"
    ) {
      throw error;
    }
    throw new TypeError("FALCON24_POST_ACTIVATION_READBACK_FAILED", { cause: error });
  }

  return Object.freeze({
    stage: smokePassedEnvelope,
    validation_receipt: validation,
    smoke_receipt: smoke,
    semantic_proof: proof,
    activation_receipt: activationReceipt,
    readback: after,
    published_release: publishedRelease,
  });
}
