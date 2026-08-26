import { z } from "zod";
import { contentHashSchema, immutableIdSchema, sha256ContentHash } from "../common/index.js";
import {
  FALCON24_ACCEPTANCE_FAILURE_LAYER_ORDER,
  falcon24AcceptanceFailureLayerSchema,
} from "./falcon24-acceptance-campaign.js";
import { falcon24AnalysisCaseIdSchema } from "./falcon24-agent-analysis.js";

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

export const falcon24QualificationIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^falcon24-[a-z0-9._-]*qualification[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$/u);

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

const falcon24QualificationManifestMaterialSchema = z
  .strictObject({
    schema_version: z.literal(FALCON24_QUALIFICATION_MANIFEST_VERSION),
    qualification_id: falcon24QualificationIdSchema,
    qualification_version: z.number().int().positive().max(1_000_000),
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
  .superRefine((manifest, context) => {
    const versionLabels = [
      ...manifest.qualification_id.matchAll(/(?:^|[._-])v([1-9][0-9]*)(?=[._-]|$)/gu),
    ];
    if (
      versionLabels.length !== 1 ||
      Number.parseInt(versionLabels[0]?.[1] ?? "0", 10) !== manifest.qualification_version
    ) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 qualification_id 必须含唯一且与 qualification_version 相同的 vN 标签。",
        path: ["qualification_id"],
      });
    }

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
  });

export const falcon24QualificationManifestSchema =
  falcon24QualificationManifestMaterialSchema.extend({
    manifest_hash: contentHashSchema,
  });

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

export type Falcon24QualificationStage = z.infer<typeof falcon24QualificationStageSchema>;
export type Falcon24QualificationSlot = z.infer<typeof falcon24QualificationSlotSchema>;
export type Falcon24QualificationManifest = z.infer<typeof falcon24QualificationManifestSchema>;
