import { z } from "zod";
import { immutableIdSchema, versionIdentifierSchema } from "../common/index.js";

const contractOnlyFields = {
  contract_version: versionIdentifierSchema,
  delivery_state: z.literal("CONTRACT_ONLY"),
  executable: z.literal(false),
  public_message: z.literal("未交付"),
} as const;

export const l3ContractArtifactSchema = z.strictObject({
  level: z.literal("L3"),
  artifact_type: z.enum(["ExperimentPlan", "ExperimentResult", "ResultCertificate"]),
  ...contractOnlyFields,
  hypothesis_ref: immutableIdSchema,
  dag_node_contracts: z.array(versionIdentifierSchema).min(1),
});

export const l4ContractArtifactSchema = z.strictObject({
  level: z.literal("L4"),
  artifact_type: z.enum(["ObservationSpec", "DiscoveryCandidate", "DiscoveryReceipt"]),
  ...contractOnlyFields,
  observation_target_ref: immutableIdSchema,
  novelty_policy_version: versionIdentifierSchema,
  multiple_testing_policy_version: versionIdentifierSchema,
});

export const l5ContractArtifactSchema = z.strictObject({
  level: z.literal("L5"),
  artifact_type: z.enum([
    "CausalQuestion",
    "IdentificationPlan",
    "CausalEstimate",
    "IdentificationCertificate",
  ]),
  ...contractOnlyFields,
  causal_question_ref: immutableIdSchema,
  estimand: versionIdentifierSchema,
  assumptions: z.array(z.string().min(1).max(500)).min(1),
});

export const deferredCapabilityArtifactSchema = z.discriminatedUnion("level", [
  l3ContractArtifactSchema,
  l4ContractArtifactSchema,
  l5ContractArtifactSchema,
]);

export type L3ContractArtifact = z.infer<typeof l3ContractArtifactSchema>;
export type L4ContractArtifact = z.infer<typeof l4ContractArtifactSchema>;
export type L5ContractArtifact = z.infer<typeof l5ContractArtifactSchema>;
