import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../src/common/index.js";
import {
  buildFalcon24AcceptanceRunManifest,
  buildFalcon24SandboxReclamationReceipt,
  verifyFalcon24AcceptanceRunManifest,
  verifyFalcon24SandboxReclamationReceipt,
} from "../src/evals/falcon24-acceptance-campaign.js";
import { falcon24AnalysisCaseIdSchema } from "../src/evals/falcon24-agent-analysis.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Falcon24 acceptance campaign contracts", () => {
  it("builds and verifies the exact 30-slot frozen manifest", async () => {
    const runs = falcon24AnalysisCaseIdSchema.options.flatMap((caseId, caseIndex) =>
      (["COLD", "WARM"] as const).flatMap((runVariant, variantIndex) =>
        [1, 2, 3].map((repetition) => ({
          run_id: id(100 + caseIndex * 10 + variantIndex * 3 + repetition),
          case_id: caseId,
          run_variant: runVariant,
          repetition,
        })),
      ),
    );
    const manifest = await buildFalcon24AcceptanceRunManifest({
      schema_version: "falcon24-analysis-run-manifest@2.0.0",
      campaign_id: "falcon24-root-v13-final",
      campaign_version: 13,
      source_fingerprint: hash("a"),
      frozen_contract_hash: hash("b"),
      runtime_attestation_hash: hash("d"),
      runs,
    });
    await expect(verifyFalcon24AcceptanceRunManifest(manifest)).resolves.toEqual(manifest);
    await expect(
      verifyFalcon24AcceptanceRunManifest({ ...manifest, campaign_version: 14 }),
    ).rejects.toThrow("campaign_id");
    await expect(
      verifyFalcon24AcceptanceRunManifest({ ...manifest, source_fingerprint: hash("c") }),
    ).rejects.toThrow("FALCON24_ANALYSIS_RUN_MANIFEST_HASH_INVALID");
  });

  it("hashes the exact zero-residual reclamation receipt", async () => {
    const managementObservationMaterial = {
      management_observation_schema_version:
        "opensandbox-management-reclamation-observation@1.0.0" as const,
      management_operation_id: id(2),
      observation_source: "OPENSANDBOX_MANAGEMENT_API" as const,
      target_metadata_hash: hash("d"),
      before_observation: { active_count: 2, observation_hash: hash("e") },
      killed: 2,
      after_observation: { active_count: 0 as const, observation_hash: hash("f") },
      residual: 0 as const,
      completed_at: "2026-08-26T00:00:00.000Z",
    };
    const managementObservation = {
      ...managementObservationMaterial,
      management_observation_hash: await sha256ContentHash(managementObservationMaterial),
    };
    const receipt = await buildFalcon24SandboxReclamationReceipt({
      schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0",
      campaign_id: "falcon24-root-v13-final",
      run_id: id(1),
      runtime_attestation_hash: hash("c"),
      ...managementObservation,
    });
    await expect(verifyFalcon24SandboxReclamationReceipt(receipt)).resolves.toEqual(receipt);
    await expect(
      verifyFalcon24SandboxReclamationReceipt({ ...receipt, killed: 3 }),
    ).rejects.toThrow();
    const { receipt_hash: _receiptHash, ...receiptMaterial } = receipt;
    await expect(
      buildFalcon24SandboxReclamationReceipt({
        ...receiptMaterial,
        management_observation_hash: hash("0"),
      }),
    ).rejects.toThrow("FALCON24_SANDBOX_MANAGEMENT_OBSERVATION_HASH_INVALID");
  });
});
