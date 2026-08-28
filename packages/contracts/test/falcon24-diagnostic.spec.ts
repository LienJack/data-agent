import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../src/common/index.js";
import {
  buildFalcon24DiagnosticAttempt,
  buildFalcon24DiagnosticAttemptV2,
  buildFalcon24DiagnosticReceipt,
  buildFalcon24DiagnosticReceiptV2,
  FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH,
  FALCON24_E4_DIAGNOSTIC_QUESTION,
  verifyFalcon24DiagnosticAttempt,
  verifyFalcon24DiagnosticAttemptDocument,
  verifyFalcon24DiagnosticReceipt,
  verifyFalcon24DiagnosticReceiptDocument,
} from "../src/evals/falcon24-diagnostic.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

const authority = {
  schema_version: "falcon24-authority-binding@2.0.0" as const,
  authority_epoch: "E4" as const,
  baseline_id: id(1),
  baseline_hash: hash("1"),
  activation_attempt_id: id(2),
};
const semanticRelease = {
  release_id: id(3),
  generation: 2,
  release_digest: hash("2"),
  datasource_id: id(4),
};

async function attempt() {
  return buildFalcon24DiagnosticAttempt({
    schema_version: "falcon24-diagnostic-attempt@1.0.0",
    attempt_id: id(5),
    run_id: id(6),
    authority,
    semantic_release: semanticRelease,
    source_commit: "a".repeat(40),
    source_fingerprint: hash("3"),
    web_build: { build_id: hash("4"), generation_id: hash("5") },
    worker_build: { build_id: hash("6"), generation_id: hash("7") },
    runtime_attestation_hash: hash("c"),
    question: FALCON24_E4_DIAGNOSTIC_QUESTION,
    question_hash: await sha256ContentHash(FALCON24_E4_DIAGNOSTIC_QUESTION),
  });
}

const artifactTypes = [
  "AnalysisReport",
  "ArtifactWorkspaceDocument",
  "DerivedAnalysisEvidence",
  "QueryEvidence",
  "SqlArtifact",
] as const;

describe("Falcon24 E4 diagnostic contracts", () => {
  it("binds the fixed question to the exact E4 and generation 2 closure", async () => {
    const manifest = await attempt();
    await expect(verifyFalcon24DiagnosticAttempt(manifest)).resolves.toEqual(manifest);
    const { manifest_hash: _manifestHash, ...material } = manifest;
    await expect(
      buildFalcon24DiagnosticAttempt({
        ...material,
        semantic_release: { ...semanticRelease, generation: 1 },
      }),
    ).rejects.toThrow("FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_INVALID");
    await expect(
      buildFalcon24DiagnosticAttempt({ ...material, question_hash: hash("f") }),
    ).rejects.toThrow("FALCON24_DIAGNOSTIC_QUESTION_HASH_INVALID");
  });

  it("records observed dynamic-loop closure, browser receipts, and residual zero", async () => {
    const manifest = await attempt();
    const receipt = await buildFalcon24DiagnosticReceipt({
      schema_version: "falcon24-diagnostic-receipt@1.0.0",
      attempt_id: manifest.attempt_id,
      run_id: manifest.run_id,
      attempt_manifest_hash: manifest.manifest_hash,
      authority,
      semantic_release: semanticRelease,
      outcome: "PASS",
      pass_evidence: {
        qa_e2e_receipt_hash: hash("8"),
        trace_ui_receipt_hash: hash("9"),
        trace_hash: hash("a"),
        opened_artifact_refs: artifactTypes.map((artifact_type, index) => ({
          artifact_id: id(20 + index),
          artifact_type,
          app_id: id(30),
          tenant_id: id(31),
          environment: "test",
          run_id: manifest.run_id,
          revision: 1,
          content_hash: hash(String(index)),
        })),
        observed_execution_path: [...FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH],
        sandbox_reclamation_receipt_hash: hash("b"),
        residual: 0,
      },
      failure_class: null,
      failure_code: null,
      completed_at: "2026-08-28T12:00:00.000Z",
    });

    await expect(verifyFalcon24DiagnosticReceipt(receipt)).resolves.toEqual(receipt);
    await expect(
      buildFalcon24DiagnosticReceipt({
        ...receipt,
        pass_evidence: { ...receipt.pass_evidence, observed_execution_path: [] },
      }),
    ).rejects.toThrow();
  });

  it("terminally classifies failures without pass evidence", async () => {
    const manifest = await attempt();
    await expect(
      buildFalcon24DiagnosticReceipt({
        schema_version: "falcon24-diagnostic-receipt@1.0.0",
        attempt_id: manifest.attempt_id,
        run_id: manifest.run_id,
        attempt_manifest_hash: manifest.manifest_hash,
        authority,
        semantic_release: semanticRelease,
        outcome: "FAIL",
        pass_evidence: null,
        failure_class: "EXTERNAL_DEPENDENCY",
        failure_code: "PROVIDER_UNAVAILABLE",
        completed_at: "2026-08-28T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "FAIL", failure_class: "EXTERNAL_DEPENDENCY" });
  });

  it("builds E5 diagnostic v2 with epoch-derived authority and retained gen2", async () => {
    const historical = await attempt();
    const { manifest_hash: _manifestHash, ...material } = historical;
    const manifest = await buildFalcon24DiagnosticAttemptV2({
      ...material,
      schema_version: "falcon24-diagnostic-attempt@2.0.0",
      authority: { ...authority, authority_epoch: "E5" },
    });
    await expect(verifyFalcon24DiagnosticAttemptDocument(manifest)).resolves.toEqual(manifest);

    const receipt = await buildFalcon24DiagnosticReceiptV2({
      schema_version: "falcon24-diagnostic-receipt@2.0.0",
      attempt_id: manifest.attempt_id,
      run_id: manifest.run_id,
      attempt_manifest_hash: manifest.manifest_hash,
      authority: manifest.authority,
      semantic_release: semanticRelease,
      outcome: "FAIL",
      pass_evidence: null,
      failure_class: "EXTERNAL_DEPENDENCY",
      failure_code: "PROVIDER_UNAVAILABLE",
      completed_at: "2026-08-29T12:00:00.000Z",
    });
    await expect(verifyFalcon24DiagnosticReceiptDocument(receipt)).resolves.toEqual(receipt);
  });

  it("rejects v2 diagnostic before E5 and gen3 injection", async () => {
    const historical = await attempt();
    const { manifest_hash: _manifestHash, ...material } = historical;
    await expect(
      buildFalcon24DiagnosticAttemptV2({
        ...material,
        schema_version: "falcon24-diagnostic-attempt@2.0.0",
        authority,
      }),
    ).rejects.toThrow();
    await expect(
      buildFalcon24DiagnosticAttemptV2({
        ...material,
        schema_version: "falcon24-diagnostic-attempt@2.0.0",
        authority: { ...authority, authority_epoch: "E5" },
        semantic_release: { ...semanticRelease, generation: 3 },
      }),
    ).rejects.toThrow();
  });
});
