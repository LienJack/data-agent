import "server-only";

import { createHash } from "node:crypto";
import {
  type SemanticSuccessorStage,
  verifySemanticSuccessorStage,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import {
  buildFalcon24AuthorityBaselineV2,
  type Falcon24SemanticReleaseAuthorityProofV2,
  verifyFalcon24AuthorityBaselineDocument,
  verifyFalcon24SemanticReleaseAuthorityProofV2,
} from "@data-agent/contracts/evals";
import type { PortResult } from "@data-agent/contracts/ports";
import {
  buildFalcon24StagingReceiptV2,
  type Falcon24StagingReceiptV2,
  falcon24ActivationAttemptV2Schema,
  falcon24StagingHoldResultV2Schema,
  verifyFalcon24StagingReceiptV2,
} from "@data-agent/contracts/runs";
import { z } from "zod";

const configurationSchema = z
  .strictObject({
    staging_id: z.uuid(),
    retained_assets_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    source_commit: z.string().regex(/^[0-9a-f]{40}$/u),
    web_build_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    acceptance_contracts: z.strictObject({
      oracle: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
      qualification: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
      campaign: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
      qa_e2e: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
      trace_ui: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
      reclamation: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    }),
    production_isolation_proven: z.boolean(),
    production_gate: z.enum(["GO", "HOLD"]),
  })
  .superRefine((configuration, context) => {
    if (configuration.production_isolation_proven !== (configuration.production_gate === "GO")) {
      context.addIssue({
        code: "custom",
        message: "FALCON24_E4_PRODUCTION_GATE_MISMATCH",
        path: ["production_gate"],
      });
    }
  });

const stagingSessionSchema = z.strictObject({
  schema_version: z.literal("falcon24-staging-session@2.0.0"),
  authority_epoch: z.literal("E4"),
  staging_id: z.uuid(),
  retained_assets_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  status: z.literal("STAGED"),
});

const SUPPORTING_COMPONENTS = Object.freeze([
  "AGENT_PROFILES",
  "DATASET",
  "LLM_CONFIGURATION",
  "OPERATOR_REGISTRY",
  "SANDBOX_RUNTIME",
] as const);

export interface Falcon24E4StagingAuthorityPort {
  beginStaging(capability: unknown, request: unknown): Promise<PortResult<unknown>>;
  holdStagingSession(capability: unknown, request: unknown): Promise<PortResult<unknown>>;
  recordReceipt(capability: unknown, receipt: unknown): Promise<PortResult<unknown>>;
  stageBaseline(capability: unknown, request: unknown): Promise<PortResult<unknown>>;
  beginActivationAttempt(capability: unknown, request: unknown): Promise<PortResult<unknown>>;
}

export interface Falcon24E4SuccessorAuthorityReferences {
  readonly baseline_ref: {
    readonly baseline_id: string;
    readonly baseline_hash: `sha256:${string}`;
  };
  readonly activation_attempt_ref: {
    readonly activation_attempt_id: string;
  };
}

function required<T>(result: PortResult<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function stableFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(message)
    ? message
    : "FALCON24_E4_SUPPORTING_STAGING_FAILED";
}

async function holdPreBaselineStaging(input: {
  readonly capability: unknown;
  readonly epoch: Falcon24E4StagingAuthorityPort;
  readonly staging_id: string;
  readonly retained_assets_hash: `sha256:${string}`;
  readonly cause: unknown;
}): Promise<void> {
  const failureCode = stableFailureCode(input.cause);
  try {
    const held = falcon24StagingHoldResultV2Schema.parse(
      required(
        await input.epoch.holdStagingSession(input.capability, {
          schema_version: "falcon24-staging-hold-request@2.0.0",
          authority_epoch: "E4",
          staging_id: input.staging_id,
          expected_retained_assets_hash: input.retained_assets_hash,
          failure_code: failureCode,
        }),
      ),
    );
    if (
      held.authority_epoch !== "E4" ||
      held.staging_id !== input.staging_id ||
      held.retained_assets_hash !== input.retained_assets_hash ||
      held.failure_code !== failureCode
    ) {
      throw new TypeError("FALCON24_E4_STAGING_HOLD_MISMATCH");
    }
  } catch (holdError) {
    throw new TypeError("FALCON24_E4_STAGING_HOLD_FAILED", {
      cause: new AggregateError([input.cause, holdError]),
    });
  }
}

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function assertStageProofBinding(
  stage: SemanticSuccessorStage,
  proof: Falcon24SemanticReleaseAuthorityProofV2,
): void {
  if (
    stage.status !== "SMOKE_PASSED" ||
    !exact(proof.candidate_release, stage.candidate_release) ||
    !exact(proof.projections, stage.projection_refs) ||
    !exact(proof.change_set_ref, stage.change_set_ref) ||
    !exact(proof.review_ref, stage.review_ref) ||
    !exact(proof.source_snapshot_ref, stage.source_snapshot_ref) ||
    !exact(proof.compiler_bundle_ref, stage.compiler_bundle_ref) ||
    proof.predecessor_release.release_id !== stage.predecessor_release.release_id ||
    proof.predecessor_release.generation !== stage.predecessor_release.generation ||
    proof.predecessor_release.release_digest !== stage.predecessor_release.release_digest ||
    proof.predecessor_release.datasource_id !== stage.candidate_release.datasource_id ||
    proof.expected_versions.semantic_pointer !== stage.expected_pointer_version
  ) {
    throw new TypeError("FALCON24_E4_SUCCESSOR_STAGE_PROOF_MISMATCH");
  }
}

async function verifySupportingReceipts(input: {
  readonly receipts: readonly unknown[];
  readonly staging_id: string;
  readonly production_isolation_proven: boolean;
}): Promise<Map<Falcon24StagingReceiptV2["component"], Falcon24StagingReceiptV2>> {
  if (input.receipts.length !== SUPPORTING_COMPONENTS.length) {
    throw new TypeError("FALCON24_E4_SUPPORTING_RECEIPTS_INVALID");
  }
  const receipts = new Map<Falcon24StagingReceiptV2["component"], Falcon24StagingReceiptV2>();
  for (const candidate of input.receipts) {
    let receipt: Falcon24StagingReceiptV2;
    try {
      receipt = await verifyFalcon24StagingReceiptV2(candidate);
    } catch {
      throw new TypeError("FALCON24_E4_SUPPORTING_RECEIPTS_INVALID");
    }
    if (
      receipt.authority_epoch !== "E4" ||
      receipt.staging_id !== input.staging_id ||
      !SUPPORTING_COMPONENTS.includes(
        receipt.component as (typeof SUPPORTING_COMPONENTS)[number],
      ) ||
      receipts.has(receipt.component) ||
      (receipt.component === "SANDBOX_RUNTIME" &&
        receipt.production_isolation_proven !== input.production_isolation_proven)
    ) {
      throw new TypeError("FALCON24_E4_SUPPORTING_RECEIPTS_INVALID");
    }
    receipts.set(receipt.component, receipt);
  }
  if (SUPPORTING_COMPONENTS.some((component) => !receipts.has(component))) {
    throw new TypeError("FALCON24_E4_SUPPORTING_RECEIPTS_INVALID");
  }
  return receipts;
}

/**
 * Stages only the Falcon side of an already smoke-passed semantic successor.
 * It never changes semantic pointers, workspace defaults, or current Falcon
 * authority; the combined PostgreSQL activation remains the sole switch.
 */
export async function stageFalcon24E4SuccessorAuthority(input: {
  readonly capability: unknown;
  readonly epoch: Falcon24E4StagingAuthorityPort;
  readonly stage: unknown;
  readonly semantic_proof: unknown;
  readonly staging_id: string;
  readonly retained_assets_hash: `sha256:${string}`;
  readonly source_commit: string;
  readonly web_build_hash: `sha256:${string}`;
  readonly acceptance_contracts: {
    readonly oracle: `sha256:${string}`;
    readonly qualification: `sha256:${string}`;
    readonly campaign: `sha256:${string}`;
    readonly qa_e2e: `sha256:${string}`;
    readonly trace_ui: `sha256:${string}`;
    readonly reclamation: `sha256:${string}`;
  };
  readonly production_isolation_proven: boolean;
  readonly production_gate: "GO" | "HOLD";
  readonly stage_supporting_receipts: () => Promise<readonly unknown[]>;
}): Promise<Falcon24E4SuccessorAuthorityReferences> {
  const configuration = configurationSchema.parse({
    staging_id: input.staging_id,
    retained_assets_hash: input.retained_assets_hash,
    source_commit: input.source_commit,
    web_build_hash: input.web_build_hash,
    acceptance_contracts: input.acceptance_contracts,
    production_isolation_proven: input.production_isolation_proven,
    production_gate: input.production_gate,
  });
  const [stage, proof] = await Promise.all([
    verifySemanticSuccessorStage(input.stage),
    verifyFalcon24SemanticReleaseAuthorityProofV2(input.semantic_proof),
  ]);
  assertStageProofBinding(stage, proof);

  const sessionRequest = {
    schema_version: "falcon24-staging-session@2.0.0" as const,
    authority_epoch: "E4" as const,
    staging_id: configuration.staging_id,
    retained_assets_hash: configuration.retained_assets_hash,
  };
  const sessionResult = required(await input.epoch.beginStaging(input.capability, sessionRequest));
  const session = stagingSessionSchema.safeParse(sessionResult);
  if (!session.success) throw new TypeError("FALCON24_E4_STAGING_SESSION_MISMATCH");
  if (
    session.data.staging_id !== sessionRequest.staging_id ||
    session.data.retained_assets_hash !== sessionRequest.retained_assets_hash
  ) {
    throw new TypeError("FALCON24_E4_STAGING_SESSION_MISMATCH");
  }

  let receipts: Awaited<ReturnType<typeof verifySupportingReceipts>>;
  try {
    receipts = await verifySupportingReceipts({
      receipts: await input.stage_supporting_receipts(),
      staging_id: configuration.staging_id,
      production_isolation_proven: configuration.production_isolation_proven,
    });
  } catch (error) {
    await holdPreBaselineStaging({
      capability: input.capability,
      epoch: input.epoch,
      staging_id: configuration.staging_id,
      retained_assets_hash: input.retained_assets_hash,
      cause: error,
    });
    throw error;
  }
  const semanticReceipt = await buildFalcon24StagingReceiptV2({
    schema_version: "falcon24-staging-receipt@2.0.0",
    authority_epoch: "E4",
    staging_id: configuration.staging_id,
    component: "SEMANTIC_RELEASE",
    subject_hash: stage.candidate_release.release_digest,
    evidence_hash: proof.proof_hash,
    production_isolation_proven: false,
  });
  const recordedSemanticReceiptResult = required(
    await input.epoch.recordReceipt(input.capability, semanticReceipt),
  );
  let recordedSemanticReceipt: Falcon24StagingReceiptV2;
  try {
    recordedSemanticReceipt = await verifyFalcon24StagingReceiptV2(recordedSemanticReceiptResult);
  } catch {
    throw new TypeError("FALCON24_E4_SEMANTIC_RECEIPT_MISMATCH");
  }
  if (!exact(recordedSemanticReceipt, semanticReceipt)) {
    throw new TypeError("FALCON24_E4_SEMANTIC_RECEIPT_MISMATCH");
  }
  receipts.set("SEMANTIC_RELEASE", recordedSemanticReceipt);

  const receiptHash = (component: Falcon24StagingReceiptV2["component"]) => {
    const receipt = receipts.get(component);
    if (!receipt) throw new TypeError("FALCON24_E4_SUPPORTING_RECEIPTS_INVALID");
    return receipt.receipt_hash;
  };
  const baselineId = stableUuid(
    `falcon24:E4:baseline:${configuration.source_commit}:${configuration.web_build_hash}:${configuration.staging_id}`,
  );
  const baseline = await buildFalcon24AuthorityBaselineV2({
    schema_version: "falcon24-authority-baseline@2.0.0",
    baseline_id: baselineId,
    authority_epoch: "E4",
    source_commit: configuration.source_commit,
    retained_assets_hash: configuration.retained_assets_hash,
    web_build_hash: configuration.web_build_hash,
    staging_receipts: {
      dataset: receiptHash("DATASET"),
      semantic_release: receiptHash("SEMANTIC_RELEASE"),
      llm_configuration: receiptHash("LLM_CONFIGURATION"),
      agent_profiles: receiptHash("AGENT_PROFILES"),
      operator_registry: receiptHash("OPERATOR_REGISTRY"),
      sandbox_runtime: receiptHash("SANDBOX_RUNTIME"),
    },
    acceptance_contracts: configuration.acceptance_contracts,
    production_isolation_proven: configuration.production_isolation_proven,
    production_gate: configuration.production_gate,
  });
  const stagedBaselineResult = required(
    await input.epoch.stageBaseline(input.capability, {
      schema_version: "falcon24-stage-baseline-request@2.0.0",
      authority_epoch: "E4",
      staging_id: configuration.staging_id,
      baseline,
    }),
  );
  let stagedBaseline: Awaited<ReturnType<typeof verifyFalcon24AuthorityBaselineDocument>>;
  try {
    stagedBaseline = await verifyFalcon24AuthorityBaselineDocument(stagedBaselineResult);
  } catch {
    throw new TypeError("FALCON24_E4_BASELINE_MISMATCH");
  }
  if (!exact(stagedBaseline, baseline)) {
    throw new TypeError("FALCON24_E4_BASELINE_MISMATCH");
  }

  const activationRequest = {
    schema_version: "falcon24-activation-request@2.0.0" as const,
    authority_epoch: "E4" as const,
    attempt_id: stableUuid(`falcon24:E4:activation:${baseline.baseline_hash}`),
    baseline_id: baseline.baseline_id,
    expected_baseline_hash: baseline.baseline_hash,
  };
  const attemptResult = required(
    await input.epoch.beginActivationAttempt(input.capability, activationRequest),
  );
  const attempt = falcon24ActivationAttemptV2Schema.safeParse(attemptResult);
  if (!attempt.success) throw new TypeError("FALCON24_E4_ACTIVATION_ATTEMPT_MISMATCH");
  if (
    attempt.data.status !== "OPEN" ||
    attempt.data.failure_code !== null ||
    attempt.data.authority_epoch !== "E4" ||
    attempt.data.attempt_id !== activationRequest.attempt_id ||
    attempt.data.baseline_id !== activationRequest.baseline_id ||
    attempt.data.expected_baseline_hash !== activationRequest.expected_baseline_hash
  ) {
    throw new TypeError("FALCON24_E4_ACTIVATION_ATTEMPT_MISMATCH");
  }

  return Object.freeze({
    baseline_ref: Object.freeze({
      baseline_id: baseline.baseline_id,
      baseline_hash: baseline.baseline_hash as `sha256:${string}`,
    }),
    activation_attempt_ref: Object.freeze({
      activation_attempt_id: attempt.data.attempt_id,
    }),
  });
}
