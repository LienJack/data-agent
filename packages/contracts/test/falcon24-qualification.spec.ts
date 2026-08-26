import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../src/common/index.js";
import { falcon24AnalysisCaseIdSchema } from "../src/evals/falcon24-agent-analysis.js";
import {
  buildFalcon24QualificationManifest,
  FALCON24_QUALIFICATION_EXPECTED_PATH,
  verifyFalcon24QualificationManifest,
} from "../src/evals/falcon24-qualification.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function qualificationSlots() {
  const stages = [
    "G1",
    ...Array(5).fill("G2"),
    ...Array(5).fill("G3"),
    ...Array(5).fill("G4"),
  ] as const;
  return Promise.all(
    stages.map(async (stage, ordinal) => {
      const stageStart = stage === "G1" ? 0 : stage === "G2" ? 1 : stage === "G3" ? 6 : 11;
      const stagePosition = ordinal - stageStart;
      const prompt = `Falcon24 qualification ${stage} prompt ${stagePosition + 1}`;
      return {
        ordinal,
        run_id: id(100 + ordinal),
        slot_id: `${stage}-${String(stagePosition + 1).padStart(2, "0")}`,
        stage,
        case_id: falcon24AnalysisCaseIdSchema.options[stage === "G1" ? 0 : stagePosition],
        prompt,
        prompt_hash: await sha256ContentHash(prompt),
        run_variant: stage === "G4" ? ("COLD" as const) : ("WARM" as const),
        expected_path: [...FALCON24_QUALIFICATION_EXPECTED_PATH],
      };
    }),
  );
}

async function manifestMaterial() {
  return {
    schema_version: "falcon24-qualification-manifest@1.0.0" as const,
    qualification_id: "falcon24-root-qualification-v1-final",
    qualification_version: 1,
    source_commit: "a".repeat(40),
    source_fingerprint: hash("1"),
    frozen_contract_hash: hash("2"),
    semantic_release_hash: hash("3"),
    schema_snapshot_hash: hash("4"),
    operator_registry_digest: hash("5"),
    model_config_hash: hash("6"),
    web_build_hash: hash("7"),
    runtime_attestation_hash: hash("8"),
    model_provider: "deepseek" as const,
    model_id: "deepseek-v4-flash",
    slots: await qualificationSlots(),
  };
}

describe("Falcon24 qualification contracts", () => {
  it("builds and verifies the unique ordered 16-slot v1 manifest", async () => {
    const manifest = await buildFalcon24QualificationManifest(await manifestMaterial());

    expect(manifest.slots.map(({ stage }) => stage)).toEqual([
      "G1",
      ...Array(5).fill("G2"),
      ...Array(5).fill("G3"),
      ...Array(5).fill("G4"),
    ]);
    expect(manifest.slots.slice(0, 11).every(({ run_variant }) => run_variant === "WARM")).toBe(
      true,
    );
    expect(manifest.slots.slice(11).every(({ run_variant }) => run_variant === "COLD")).toBe(true);
    await expect(verifyFalcon24QualificationManifest(manifest)).resolves.toEqual(manifest);
  });

  it("rejects qualification identity, stage order, case coverage, and six-layer path drift", async () => {
    const material = await manifestMaterial();
    await expect(
      buildFalcon24QualificationManifest({ ...material, qualification_version: 2 }),
    ).rejects.toThrow("qualification_id");
    await expect(
      buildFalcon24QualificationManifest({
        ...material,
        slots: material.slots.map((slot, index) => (index === 1 ? { ...slot, stage: "G3" } : slot)),
      }),
    ).rejects.toThrow("冻结顺序");
    await expect(
      buildFalcon24QualificationManifest({
        ...material,
        slots: material.slots.map((slot, index) =>
          index === 6 ? { ...slot, case_id: falcon24AnalysisCaseIdSchema.options[4] } : slot,
        ),
      }),
    ).rejects.toThrow("冻结顺序");
    await expect(
      buildFalcon24QualificationManifest({
        ...material,
        slots: material.slots.map((slot, index) =>
          index === 0 ? { ...slot, expected_path: [...slot.expected_path].reverse() } : slot,
        ),
      }),
    ).rejects.toThrow("固定六层验收路径");
  });

  it("rejects duplicate slot and run identities", async () => {
    const material = await manifestMaterial();
    for (const field of ["slot_id", "run_id"] as const) {
      await expect(
        buildFalcon24QualificationManifest({
          ...material,
          slots: material.slots.map((slot, index) =>
            index === 1 ? { ...slot, [field]: material.slots[0]?.[field] } : slot,
          ),
        }),
      ).rejects.toThrow(field);
    }
  });

  it("allows G3 and G4 to reuse the same five prompts while hashing every slot locally", async () => {
    const material = await manifestMaterial();
    const slots = material.slots.map((slot, index) => {
      const matchingG3 = index >= 11 ? material.slots[index - 5] : undefined;
      return matchingG3
        ? { ...slot, prompt: matchingG3.prompt, prompt_hash: matchingG3.prompt_hash }
        : slot;
    });

    await expect(buildFalcon24QualificationManifest({ ...material, slots })).resolves.toMatchObject(
      {
        slots,
      },
    );
  });

  it("rejects prompt and manifest hash tampering", async () => {
    const material = await manifestMaterial();
    await expect(
      buildFalcon24QualificationManifest({
        ...material,
        slots: material.slots.map((slot, index) =>
          index === 0 ? { ...slot, prompt: `${slot.prompt} tampered` } : slot,
        ),
      }),
    ).rejects.toThrow("FALCON24_QUALIFICATION_PROMPT_HASH_INVALID");

    const manifest = await buildFalcon24QualificationManifest(material);
    await expect(
      verifyFalcon24QualificationManifest({ ...manifest, web_build_hash: hash("9") }),
    ).rejects.toThrow("FALCON24_QUALIFICATION_MANIFEST_HASH_INVALID");
  });
});
