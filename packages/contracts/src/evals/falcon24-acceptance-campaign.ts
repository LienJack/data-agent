import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import { falcon24AnalysisCaseIdSchema } from "./falcon24-agent-analysis.js";

export const FALCON24_STRICT_ACCEPTANCE_POLICY_ID = "falcon24-strict-zero-retry@1.0.0" as const;

export const falcon24AcceptanceCampaignIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$/u);

export const falcon24AcceptanceFailureLayerSchema = z.enum([
  "ROOT_ROUTING",
  "SQL_DATA_PREPARATION",
  "GOVERNED_OPERATOR",
  "ORACLE",
  "PUBLISHER",
  "SANDBOX_RECLAMATION",
]);

export const falcon24AcceptanceManifestRunSchema = z.strictObject({
  run_id: immutableIdSchema,
  case_id: falcon24AnalysisCaseIdSchema,
  run_variant: z.enum(["COLD", "WARM"]),
  repetition: z.number().int().min(1).max(3),
});

const falcon24AcceptanceRunManifestMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-analysis-run-manifest@2.0.0"),
    campaign_id: falcon24AcceptanceCampaignIdSchema,
    campaign_version: z.number().int().positive().max(1_000_000),
    source_fingerprint: contentHashSchema,
    frozen_contract_hash: contentHashSchema,
    runtime_attestation_hash: contentHashSchema,
    runs: z.array(falcon24AcceptanceManifestRunSchema).length(30),
  })
  .superRefine((manifest, context) => {
    const versionLabels = [
      ...manifest.campaign_id.matchAll(/(?:^|[._-])v([1-9][0-9]*)(?=[._-]|$)/gu),
    ];
    if (
      versionLabels.length !== 1 ||
      Number.parseInt(versionLabels[0]?.[1] ?? "0", 10) !== manifest.campaign_version
    ) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 campaign_id 必须含唯一且与 campaign_version 相同的 vN 标签。",
        path: ["campaign_id"],
      });
    }
    const runIds = new Set(manifest.runs.map(({ run_id: runId }) => runId));
    const observedSlots = new Set(
      manifest.runs.map(
        ({ case_id: caseId, run_variant: variant, repetition }) =>
          `${caseId}\0${variant}\0${repetition}`,
      ),
    );
    const expectedSlots = new Set(
      falcon24AnalysisCaseIdSchema.options.flatMap((caseId) =>
        (["COLD", "WARM"] as const).flatMap((variant) =>
          [1, 2, 3].map((repetition) => `${caseId}\0${variant}\0${repetition}`),
        ),
      ),
    );
    if (
      runIds.size !== 30 ||
      observedSlots.size !== 30 ||
      [...expectedSlots].some((slot) => !observedSlots.has(slot))
    ) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 Manifest 必须精确覆盖 5 题各 3 冷、3 暖且 Run ID 唯一。",
        path: ["runs"],
      });
    }
  });

export const falcon24AcceptanceRunManifestSchema =
  falcon24AcceptanceRunManifestMaterialSchema.extend({
    manifest_hash: contentHashSchema,
  });

export async function buildFalcon24AcceptanceRunManifest(input: unknown) {
  const material = falcon24AcceptanceRunManifestMaterialSchema.parse(input);
  return falcon24AcceptanceRunManifestSchema.parse({
    ...material,
    manifest_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24AcceptanceRunManifest(input: unknown) {
  const manifest = falcon24AcceptanceRunManifestSchema.parse(input);
  const { manifest_hash: observedHash, ...material } = manifest;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_ANALYSIS_RUN_MANIFEST_HASH_INVALID");
  }
  return manifest;
}

const falcon24SandboxManagementObservationSummarySchema = z.strictObject({
  active_count: z.number().int().nonnegative().safe(),
  observation_hash: contentHashSchema,
});

const falcon24SandboxManagementObservationMaterialSchema = z.strictObject({
  management_observation_schema_version: z.literal(
    "opensandbox-management-reclamation-observation@1.0.0",
  ),
  management_operation_id: immutableIdSchema,
  observation_source: z.literal("OPENSANDBOX_MANAGEMENT_API"),
  target_metadata_hash: contentHashSchema,
  before_observation: falcon24SandboxManagementObservationSummarySchema,
  killed: z.number().int().nonnegative().safe(),
  after_observation: falcon24SandboxManagementObservationSummarySchema.extend({
    active_count: z.literal(0),
  }),
  residual: z.literal(0),
  completed_at: timestampSchema,
});

export const falcon24SandboxManagementObservationSchema =
  falcon24SandboxManagementObservationMaterialSchema
    .extend({ management_observation_hash: contentHashSchema })
    .superRefine((observation, context) => {
      if (observation.killed !== observation.before_observation.active_count) {
        context.addIssue({
          code: "custom",
          message: "Falcon24 Sandbox 回收数必须与管理面首次观测到的活动 Sandbox 数一致。",
          path: ["killed"],
        });
      }
    });

export async function verifyFalcon24SandboxManagementObservation(input: unknown) {
  const observation = falcon24SandboxManagementObservationSchema.parse(input);
  const { management_observation_hash: observedHash, ...material } = observation;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_SANDBOX_MANAGEMENT_OBSERVATION_HASH_INVALID");
  }
  return observation;
}

const falcon24SandboxReclamationReceiptMaterialSchema = z.strictObject({
  schema_version: z.literal("falcon24-sandbox-reclamation-receipt@2.0.0"),
  campaign_id: falcon24AcceptanceCampaignIdSchema,
  run_id: immutableIdSchema,
  runtime_attestation_hash: contentHashSchema,
  ...falcon24SandboxManagementObservationSchema.shape,
});

function sandboxManagementObservationFromReceipt(
  receipt: z.infer<typeof falcon24SandboxReclamationReceiptMaterialSchema>,
) {
  return {
    management_observation_schema_version: receipt.management_observation_schema_version,
    management_operation_id: receipt.management_operation_id,
    observation_source: receipt.observation_source,
    target_metadata_hash: receipt.target_metadata_hash,
    before_observation: receipt.before_observation,
    killed: receipt.killed,
    after_observation: receipt.after_observation,
    residual: receipt.residual,
    completed_at: receipt.completed_at,
    management_observation_hash: receipt.management_observation_hash,
  };
}

export const falcon24SandboxReclamationReceiptSchema =
  falcon24SandboxReclamationReceiptMaterialSchema.extend({
    receipt_hash: contentHashSchema,
  });

export async function buildFalcon24SandboxReclamationReceipt(input: unknown) {
  const material = falcon24SandboxReclamationReceiptMaterialSchema.parse(input);
  await verifyFalcon24SandboxManagementObservation(
    sandboxManagementObservationFromReceipt(material),
  );
  return falcon24SandboxReclamationReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24SandboxReclamationReceipt(input: unknown) {
  const receipt = falcon24SandboxReclamationReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  await verifyFalcon24SandboxManagementObservation(
    sandboxManagementObservationFromReceipt(material),
  );
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_SANDBOX_RECLAMATION_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export type Falcon24AcceptanceFailureLayer = z.infer<typeof falcon24AcceptanceFailureLayerSchema>;
export type Falcon24AcceptanceRunManifest = z.infer<typeof falcon24AcceptanceRunManifestSchema>;
export type Falcon24SandboxReclamationReceipt = z.infer<
  typeof falcon24SandboxReclamationReceiptSchema
>;
