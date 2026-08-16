import { z } from "zod";
import { artifactReferenceIdentity, artifactReferenceSchema } from "../artifacts/envelope.js";
import {
  deepFreeze,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  type AuthoritativeReleaseDecision,
  AuthorityEvidenceError,
  isAuthoritativeReleaseDecision,
  releaseDecisionSchema,
} from "../runs/index.js";

export * from "../authz/signer-key-registry.js";
export * from "../semantic/greenfield-bootstrap.js";
export * from "../semantic/semantic-coverage-policy.js";
export * from "../workspaces/route-authorization-matrix.js";
export * from "./deferred-artifacts.js";
export * from "./platform-capabilities.js";

export const capabilityLevelSchema = z.enum(["L2", "L3", "L4", "L5"]);

export const executableCapabilityRegistrationSchema = z.strictObject({
  capability_id: versionIdentifierSchema,
  level: z.literal("L2"),
  kind: z.enum(["workflow", "route", "tool"]),
  entrypoint: versionIdentifierSchema,
});

export type ExecutableCapabilityRegistration = z.infer<
  typeof executableCapabilityRegistrationSchema
>;

export const EXECUTABLE_CAPABILITY_REGISTRY = Object.freeze(
  [] as ExecutableCapabilityRegistration[],
);

export const deferredCapabilityDescriptorSchema = z.strictObject({
  level: z.enum(["L3", "L4", "L5"]),
  contract_version: versionIdentifierSchema,
  delivery_state: z.literal("CONTRACT_ONLY"),
  public_message: z.literal("未交付"),
});

export const l2CapabilityDescriptorSchema = z.strictObject({
  level: z.literal("L2"),
  contract_version: versionIdentifierSchema,
  delivery_state: z.enum(["CONTRACT_ONLY", "IMPLEMENTING", "DELIVERED"]),
  public_message: z.string().min(1).max(200),
});

export const capabilityDeliveryReceiptSchema = z
  .strictObject({
    receipt_id: immutableIdSchema,
    level: z.literal("L2"),
    state: z.literal("DELIVERED"),
    release_decision_id: immutableIdSchema,
    release_decision: releaseDecisionSchema,
    evidence_refs: z.array(artifactReferenceSchema).min(1),
    issued_at: timestampSchema,
  })
  .superRefine((receipt, ctx) => {
    if (
      receipt.release_decision.decision !== "GO" ||
      receipt.release_decision.decision_id !== receipt.release_decision_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "DELIVERED Receipt 必须绑定同 ID 的 GO 决策。",
        path: ["release_decision"],
      });
    }

    const decisionEvidence = new Set(
      receipt.release_decision.evidence_refs.map(artifactReferenceIdentity),
    );
    if (
      receipt.evidence_refs.some(
        (reference) => !decisionEvidence.has(artifactReferenceIdentity(reference)),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "DELIVERED Receipt 不能引用 GO 决策之外的 Evidence。",
        path: ["evidence_refs"],
      });
    }
  });

declare const authoritativeCapabilityDeliveryReceipt: unique symbol;
const authorizedCapabilityDeliveryReceipts = new WeakSet<object>();

export type CapabilityDeliveryReceiptInput = z.infer<typeof capabilityDeliveryReceiptSchema>;

export type CapabilityDeliveryReceipt = CapabilityDeliveryReceiptInput & {
  readonly [authoritativeCapabilityDeliveryReceipt]: true;
};

export function issueCapabilityDeliveryReceipt(
  input: Omit<CapabilityDeliveryReceiptInput, "release_decision">,
  releaseDecision: AuthoritativeReleaseDecision,
): CapabilityDeliveryReceipt {
  if (!isAuthoritativeReleaseDecision(releaseDecision)) {
    throw new AuthorityEvidenceError(
      "DELIVERED Receipt 只能绑定经过 Evidence Verifier 授权的 GO 决策。",
    );
  }

  const receipt = capabilityDeliveryReceiptSchema.parse({
    ...input,
    release_decision: releaseDecision,
  });
  receipt.release_decision = releaseDecision;
  authorizedCapabilityDeliveryReceipts.add(receipt);
  return deepFreeze(receipt) as CapabilityDeliveryReceipt;
}

export function isCapabilityDeliveryReceipt(value: unknown): value is CapabilityDeliveryReceipt {
  return (
    typeof value === "object" && value !== null && authorizedCapabilityDeliveryReceipts.has(value)
  );
}

export type DeferredCapabilityDescriptor = z.infer<typeof deferredCapabilityDescriptorSchema>;
export type L2CapabilityDescriptor = z.infer<typeof l2CapabilityDescriptorSchema>;
