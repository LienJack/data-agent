import {
  analysisPythonSourceLoadCommandSchema,
  buildAnalysisPythonSourceReceipt,
  verifyAnalysisPythonSourceReceipt,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const id = (suffix: number) => `34000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

function reference(artifactType: "AnalysisProgram" | "SensitiveExecutionArtifact", suffix: number) {
  return {
    artifact_id: id(suffix),
    artifact_type: artifactType,
    ...scope,
    run_id: id(3),
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  } as const;
}

describe("Analysis Python source receipt", () => {
  it("binds encrypted source to the exact program, provider response and hash", async () => {
    const artifactRef = reference("SensitiveExecutionArtifact", 4);
    const receipt = await buildAnalysisPythonSourceReceipt({
      schema_version: "analysis-python-source-receipt@1.0.0",
      artifact_ref: artifactRef,
      analysis_program_ref: reference("AnalysisProgram", 5),
      node_id: "falcon24-question-1",
      generation_attempt: 0,
      source_kind: "DEEPSEEK_GENERATED",
      provider_invocation_ref: {
        resource_id: id(6),
        resource_revision: 1,
        resource_hash: hash("6"),
      },
      plaintext_hash: artifactRef.content_hash,
      ciphertext_hash: hash("7"),
      encryption: {
        algorithm: "AES-256-GCM",
        key_id: "analysis-python-source-v1",
        iv_base64: "AQEBAQEBAQEBAQEB",
        auth_tag_base64: "AgICAgICAgICAgICAgICAg==",
      },
      storage: "POSTGRES_ENCRYPTED_BYTEA",
      committed_at: "2026-08-24T00:00:00.000Z",
    });

    await expect(verifyAnalysisPythonSourceReceipt(receipt)).resolves.toEqual(receipt);
    await expect(
      verifyAnalysisPythonSourceReceipt({ ...receipt, node_id: "substituted-node" }),
    ).rejects.toThrow("ANALYSIS_PYTHON_SOURCE_RECEIPT_HASH_INVALID");
  });

  it("rejects missing provider provenance, cross-run refs and repaired templates", async () => {
    const artifactRef = reference("SensitiveExecutionArtifact", 4);
    const base = {
      schema_version: "analysis-python-source-receipt@1.0.0",
      artifact_ref: artifactRef,
      analysis_program_ref: reference("AnalysisProgram", 5),
      node_id: "falcon24-question-1",
      generation_attempt: 0,
      source_kind: "DEEPSEEK_GENERATED",
      provider_invocation_ref: null,
      plaintext_hash: artifactRef.content_hash,
      ciphertext_hash: hash("7"),
      encryption: {
        algorithm: "AES-256-GCM",
        key_id: "analysis-python-source-v1",
        iv_base64: "AQEBAQEBAQEBAQEB",
        auth_tag_base64: "AgICAgICAgICAgICAgICAg==",
      },
      storage: "POSTGRES_ENCRYPTED_BYTEA",
      committed_at: "2026-08-24T00:00:00.000Z",
    } as const;
    await expect(buildAnalysisPythonSourceReceipt(base)).rejects.toThrow();
    await expect(
      buildAnalysisPythonSourceReceipt({
        ...base,
        source_kind: "STANDARD_PROGRAM",
        generation_attempt: 1,
      }),
    ).rejects.toThrow();
    await expect(
      buildAnalysisPythonSourceReceipt({
        ...base,
        source_kind: "STANDARD_PROGRAM",
        generation_attempt: 0,
        analysis_program_ref: { ...base.analysis_program_ref, run_id: id(9) },
      }),
    ).rejects.toThrow();
  });

  it("requires replay loads to bind the exact program scope and run", () => {
    const command = {
      schema_version: "analysis-python-source-load@1.0.0",
      scope,
      run_id: id(3),
      principal_id: id(8),
      attempt_id: id(9),
      worker_fence: 2,
      analysis_program_ref: reference("AnalysisProgram", 5),
      node_id: "falcon24-question-1",
      generation_attempt: 0,
    } as const;
    expect(analysisPythonSourceLoadCommandSchema.parse(command)).toEqual(command);
    expect(() =>
      analysisPythonSourceLoadCommandSchema.parse({
        ...command,
        analysis_program_ref: { ...command.analysis_program_ref, run_id: id(10) },
      }),
    ).toThrow();
  });
});
