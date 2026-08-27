import { z } from "zod";
import { contentHashSchema, immutableIdSchema, sha256ContentHash } from "../common/index.js";
import { falcon24SuccessorAuthorityEpochSchema } from "../runs/falcon24-authority-identity.js";
import {
  FALCON24_ACCEPTANCE_FAILURE_LAYER_ORDER,
  FALCON24_E1_QUALIFICATION_ID,
  falcon24AcceptanceFailureLayerSchema,
  falcon24QualificationGateIdSchema,
  qualificationIdForEpoch,
} from "./falcon24-acceptance-campaign.js";
import { falcon24AnalysisCaseIdSchema } from "./falcon24-agent-analysis.js";
import { falcon24DiagnosticReceiptReferenceSchema } from "./falcon24-diagnostic.js";

export const FALCON24_QUALIFICATION_MANIFEST_VERSION =
  "falcon24-qualification-manifest@1.0.0" as const;

export const FALCON24_QUALIFICATION_STAGE_ORDER = Object.freeze(["G1", "G2", "G3", "G4"] as const);

export const FALCON24_QUALIFICATION_STAGE_SLOT_COUNTS = Object.freeze({
  G1: 1,
  G2: 5,
  G3: 5,
  G4: 5,
} as const);

export const FALCON24_QUALIFICATION_EXPECTED_PATH = FALCON24_ACCEPTANCE_FAILURE_LAYER_ORDER;

export const falcon24QualificationStageSchema = z.enum(FALCON24_QUALIFICATION_STAGE_ORDER);

export const falcon24QualificationIdSchema = z.literal(FALCON24_E1_QUALIFICATION_ID);

const falcon24QualificationExpectedPathSchema = z
  .array(falcon24AcceptanceFailureLayerSchema)
  .length(FALCON24_QUALIFICATION_EXPECTED_PATH.length)
  .superRefine((path, context) => {
    if (path.some((layer, index) => layer !== FALCON24_QUALIFICATION_EXPECTED_PATH[index])) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 Qualification slot 必须声明固定六层验收路径。",
      });
    }
  });

export const falcon24QualificationSlotSchema = z.strictObject({
  ordinal: z.number().int().min(0).max(15),
  run_id: immutableIdSchema,
  slot_id: z.string().regex(/^G[1-4]-0[1-5]$/u),
  stage: falcon24QualificationStageSchema,
  case_id: falcon24AnalysisCaseIdSchema,
  prompt: z
    .string()
    .min(1)
    .max(8_000)
    .refine((value) => value.trim().length > 0, "Qualification prompt 不能仅包含空白。"),
  prompt_hash: contentHashSchema,
  run_variant: z.enum(["COLD", "WARM"]),
  expected_path: falcon24QualificationExpectedPathSchema,
});

function expectedSlotAt(ordinal: number) {
  const caseOrder = falcon24AnalysisCaseIdSchema.options;
  if (ordinal === 0) {
    return {
      stage: "G1" as const,
      slot_id: "G1-01",
      case_id: caseOrder[0],
      run_variant: "WARM" as const,
    };
  }
  const stage = ordinal <= 5 ? "G2" : ordinal <= 10 ? "G3" : "G4";
  const stageStart = stage === "G2" ? 1 : stage === "G3" ? 6 : 11;
  const stagePosition = ordinal - stageStart;
  return {
    stage,
    slot_id: `${stage}-${String(stagePosition + 1).padStart(2, "0")}`,
    case_id: caseOrder[stagePosition],
    run_variant: stage === "G4" ? ("COLD" as const) : ("WARM" as const),
  };
}

function addQualificationManifestIssues(
  manifest: { slots: readonly z.infer<typeof falcon24QualificationSlotSchema>[] },
  context: z.RefinementCtx,
): void {
  const slotIds = manifest.slots.map(({ slot_id: slotId }) => slotId);
  const runIds = manifest.slots.map(({ run_id: runId }) => runId);
  if (new Set(slotIds).size !== manifest.slots.length) {
    context.addIssue({
      code: "custom",
      message: "Qualification slot_id 必须唯一。",
      path: ["slots"],
    });
  }
  if (new Set(runIds).size !== manifest.slots.length) {
    context.addIssue({
      code: "custom",
      message: "Qualification run_id 必须唯一。",
      path: ["slots"],
    });
  }
  const observedCounts = Object.fromEntries(
    FALCON24_QUALIFICATION_STAGE_ORDER.map((stage) => [
      stage,
      manifest.slots.filter((slot) => slot.stage === stage).length,
    ]),
  );
  for (const stage of FALCON24_QUALIFICATION_STAGE_ORDER) {
    if (observedCounts[stage] !== FALCON24_QUALIFICATION_STAGE_SLOT_COUNTS[stage]) {
      context.addIssue({
        code: "custom",
        message: `Qualification ${stage} slot 数量不符合冻结拓扑。`,
        path: ["slots"],
      });
    }
  }

  manifest.slots.forEach((slot, index) => {
    const expected = expectedSlotAt(index);
    if (
      slot.ordinal !== index ||
      slot.stage !== expected.stage ||
      slot.slot_id !== expected.slot_id ||
      slot.case_id !== expected.case_id ||
      slot.run_variant !== expected.run_variant
    ) {
      context.addIssue({
        code: "custom",
        message: "Qualification slots 必须按 G1=1、G2=5、G3=5、G4=5 的冻结顺序覆盖五题。",
        path: ["slots", index],
      });
    }
  });
}

const falcon24QualificationManifestMaterialSchema = z
  .strictObject({
    schema_version: z.literal(FALCON24_QUALIFICATION_MANIFEST_VERSION),
    qualification_id: falcon24QualificationIdSchema,
    attempt_id: immutableIdSchema,
    authority_baseline_hash: contentHashSchema,
    source_commit: z.string().regex(/^[0-9a-f]{40}$/u),
    source_fingerprint: contentHashSchema,
    frozen_contract_hash: contentHashSchema,
    semantic_release_hash: contentHashSchema,
    schema_snapshot_hash: contentHashSchema,
    operator_registry_digest: contentHashSchema,
    model_config_hash: contentHashSchema,
    web_build_hash: contentHashSchema,
    runtime_attestation_hash: contentHashSchema,
    model_provider: z.literal("deepseek"),
    model_id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u),
    slots: z.array(falcon24QualificationSlotSchema).length(16),
  })
  .superRefine(addQualificationManifestIssues);

export const falcon24QualificationManifestSchema =
  falcon24QualificationManifestMaterialSchema.extend({
    manifest_hash: contentHashSchema,
  });

const falcon24QualificationManifestV2MaterialSchema = z
  .strictObject({
    ...falcon24QualificationManifestMaterialSchema.shape,
    schema_version: z.literal("falcon24-qualification-manifest@2.0.0"),
    authority_epoch: falcon24SuccessorAuthorityEpochSchema,
    qualification_id: falcon24QualificationGateIdSchema,
  })
  .superRefine(addQualificationManifestIssues)
  .superRefine((manifest, context) => {
    if (manifest.qualification_id !== qualificationIdForEpoch(manifest.authority_epoch)) {
      context.addIssue({
        code: "custom",
        message: "qualification_id 必须与 authority_epoch 派生值一致。",
        path: ["qualification_id"],
      });
    }
  });

export const falcon24QualificationManifestV2Schema =
  falcon24QualificationManifestV2MaterialSchema.extend({
    manifest_hash: contentHashSchema,
  });

const falcon24QualificationManifestV3MaterialSchema = z
  .strictObject({
    ...falcon24QualificationManifestV2MaterialSchema.shape,
    schema_version: z.literal("falcon24-qualification-manifest@3.0.0"),
    authority_epoch: z.literal("E4"),
    qualification_id: z.literal("E4-Q1"),
    diagnostic_receipt_ref: falcon24DiagnosticReceiptReferenceSchema,
  })
  .superRefine(addQualificationManifestIssues);

export const falcon24QualificationManifestV3Schema =
  falcon24QualificationManifestV3MaterialSchema.extend({
    manifest_hash: contentHashSchema,
  });

export const falcon24QualificationManifestDocumentSchema = z.union([
  falcon24QualificationManifestSchema,
  falcon24QualificationManifestV2Schema,
  falcon24QualificationManifestV3Schema,
]);

async function assertPromptHashes(
  slots: readonly z.infer<typeof falcon24QualificationSlotSchema>[],
): Promise<void> {
  const observedHashes = await Promise.all(slots.map(({ prompt }) => sha256ContentHash(prompt)));
  if (slots.some((slot, index) => slot.prompt_hash !== observedHashes[index])) {
    throw new TypeError("FALCON24_QUALIFICATION_PROMPT_HASH_INVALID");
  }
}

export async function buildFalcon24QualificationManifest(input: unknown) {
  const material = falcon24QualificationManifestMaterialSchema.parse(input);
  await assertPromptHashes(material.slots);
  return falcon24QualificationManifestSchema.parse({
    ...material,
    manifest_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24QualificationManifest(input: unknown) {
  const manifest = falcon24QualificationManifestSchema.parse(input);
  await assertPromptHashes(manifest.slots);
  const { manifest_hash: observedHash, ...material } = manifest;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_QUALIFICATION_MANIFEST_HASH_INVALID");
  }
  return manifest;
}

export async function buildFalcon24QualificationManifestV2(input: unknown) {
  const material = falcon24QualificationManifestV2MaterialSchema.parse(input);
  await assertPromptHashes(material.slots);
  return falcon24QualificationManifestV2Schema.parse({
    ...material,
    manifest_hash: await sha256ContentHash(material),
  });
}

export async function buildFalcon24QualificationManifestV3(input: unknown) {
  const material = falcon24QualificationManifestV3MaterialSchema.parse(input);
  await assertPromptHashes(material.slots);
  return falcon24QualificationManifestV3Schema.parse({
    ...material,
    manifest_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24QualificationManifestDocument(input: unknown) {
  const manifest = falcon24QualificationManifestDocumentSchema.parse(input);
  await assertPromptHashes(manifest.slots);
  const { manifest_hash: observedHash, ...material } = manifest;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_QUALIFICATION_MANIFEST_HASH_INVALID");
  }
  return manifest;
}

export type Falcon24QualificationStage = z.infer<typeof falcon24QualificationStageSchema>;
export type Falcon24QualificationSlot = z.infer<typeof falcon24QualificationSlotSchema>;
export type Falcon24QualificationManifest = z.infer<typeof falcon24QualificationManifestSchema>;
export type Falcon24QualificationManifestV2 = z.infer<typeof falcon24QualificationManifestV2Schema>;
export type Falcon24QualificationManifestV3 = z.infer<typeof falcon24QualificationManifestV3Schema>;
