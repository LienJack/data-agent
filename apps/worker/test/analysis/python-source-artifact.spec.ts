import { createDecipheriv } from "node:crypto";
import type {
  AnalysisProgramPayload,
  AnalysisPythonSourceCommitCommand,
  ArtifactReference,
} from "@data-agent/contracts";
import { DEFAULT_RUN_EXECUTION_POLICY } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  analysisPythonSourceArtifactInternals,
  createAnalysisPythonSourceArtifactPort,
  resolveAnalysisPythonSourceEncryption,
} from "../../src/analysis/python-source-artifact.js";

const id = (suffix: number) => `35000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const sourceText =
  "import pandas as pd\nframe = pd.DataFrame({'value': [1]})\nresult_document = {'value': int(frame['value'].sum())}\n";
const sourceHash = analysisPythonSourceArtifactInternals.sourceHash(sourceText);

function reference(
  artifactType: ArtifactReference["artifact_type"],
  suffix: number,
  contentHash = hash(String(suffix % 10)),
): ArtifactReference {
  return {
    artifact_id: id(suffix),
    artifact_type: artifactType,
    ...scope,
    run_id: id(3),
    revision: 1,
    content_hash: contentHash,
  };
}

function fixture() {
  const analysisProgramRef = reference("AnalysisProgram", 4);
  const analysisProgram = {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    nodes: [{ node_id: "falcon24-question-1", execution_mode: "MODEL_GENERATED" }],
    program_hash: hash("5"),
  } as AnalysisProgramPayload;
  const lease = {
    scope,
    principal_id: id(5),
    outbox_id: id(6),
    run_id: id(3),
    command_id: id(7),
    command_kind: "START_L2_RESEARCH",
    attempt_id: id(8),
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 120_000,
    worker_id: "analysis-worker",
    lease_token: 1,
    worker_fence: 1,
    expires_at: "2026-08-24T00:02:00.000Z",
    execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
    payload: {},
  } as const;
  return { analysisProgram, analysisProgramRef, lease };
}

describe("Analysis Python source artifact port", () => {
  it("encrypts source, binds DeepSeek provenance and never persists plaintext", async () => {
    const base = fixture();
    const key = new Uint8Array(32).fill(7);
    const captured: Array<{
      readonly command: AnalysisPythonSourceCommitCommand;
      readonly ciphertext: Uint8Array;
    }> = [];
    const reads: unknown[] = [];
    const commitCapability = { capability: "planning-commit" };
    const replayCapability = { capability: "evidence-replay" };
    const observedCapabilities: unknown[] = [];
    const artifacts = createAnalysisPythonSourceArtifactPort({
      authority: {
        async commitAnalysisPythonSource(...input) {
          observedCapabilities.push(input[0]);
          captured.push({ command: input[1], ciphertext: input[2] });
          return { ok: true, created: true, receipt: input[1].receipt };
        },
        async readAnalysisContextModelCellSource(capability, command) {
          observedCapabilities.push(capability);
          reads.push(command);
          const committed = captured[0];
          if (!committed) return { ok: false as const, error_code: "NOT_FOUND" };
          return {
            ok: true as const,
            receipt: committed.command.receipt,
            ciphertext_base64: Buffer.from(committed.ciphertext).toString("base64"),
          };
        },
      },
      commit_capability_input: commitCapability,
      replay_capability_input: replayCapability,
      encryption_key: key,
      encryption_key_id: "analysis-python-source-v1",
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });
    const sourceCommand = {
      lease: base.lease,
      analysis_program: base.analysisProgram,
      analysis_program_ref: base.analysisProgramRef,
      node_id: "falcon24-question-1",
      generation_attempt: 0,
      provider_invocation_ref: {
        resource_id: id(9),
        resource_revision: 1,
        resource_hash: hash("9"),
      },
      source_sha256: sourceHash,
      source_text: sourceText,
    } as const;
    const result = await artifacts.commit(sourceCommand);
    await artifacts.commit(sourceCommand);
    const replayed = await artifacts.load({
      lease: base.lease,
      node_id: "falcon24-question-1",
      context_generation: 1,
      journal_seq: 3,
      source_ref: result,
    });

    const committed = captured[0];
    if (!committed) throw new TypeError("source commit was not captured");
    const { command, ciphertext } = committed;
    expect(captured[1]?.command.receipt).toEqual(command.receipt);
    expect(captured[1]?.ciphertext).toEqual(ciphertext);
    expect(result).toMatchObject({
      artifact_type: "SensitiveExecutionArtifact",
      content_hash: sourceHash,
    });
    expect(command.receipt).toMatchObject({
      source_kind: "DEEPSEEK_GENERATED",
      provider_invocation_ref: { resource_id: id(9) },
      plaintext_hash: sourceHash,
      storage: "POSTGRES_ENCRYPTED_BYTEA",
    });
    expect(JSON.stringify(command)).not.toContain(sourceText);
    expect(Buffer.from(ciphertext).toString("utf8")).not.toContain("DataFrame");
    expect(replayed).toEqual({ source: sourceText, source_sha256: sourceHash });
    expect(reads).toMatchObject([
      {
        schema_version: "analysis-context-model-cell-source-read@1.0.0",
        journal_seq: 3,
        source_ref: { artifact_id: result.artifact_id },
      },
    ]);
    expect(observedCapabilities).toEqual([commitCapability, commitCapability, replayCapability]);

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(command.receipt.encryption.iv_base64, "base64"),
    );
    decipher.setAAD(
      analysisPythonSourceArtifactInternals.sourceAad({
        lease: base.lease,
        analysis_program_ref: base.analysisProgramRef,
        node_id: "falcon24-question-1",
        generation_attempt: 0,
        source_sha256: sourceHash,
      }),
    );
    decipher.setAuthTag(Buffer.from(command.receipt.encryption.auth_tag_base64, "base64"));
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    expect(decrypted.toString("utf8")).toBe(sourceText);
  });

  it("fails closed for missing or malformed encryption configuration", () => {
    expect(resolveAnalysisPythonSourceEncryption({})).toBeNull();
    expect(() =>
      resolveAnalysisPythonSourceEncryption({
        DATA_AGENT_ANALYSIS_PYTHON_SOURCE_KEY_BASE64: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow("ANALYSIS_PYTHON_SOURCE_ENCRYPTION_CONFIG_INVALID");
    expect(() =>
      createAnalysisPythonSourceArtifactPort({
        authority: {
          commitAnalysisPythonSource: async () => ({
            ok: false as const,
            error_code: "RESEARCH_DATABASE_CONTRACT_INVALID",
          }),
          readAnalysisContextModelCellSource: async () => ({
            ok: false as const,
            error_code: "NOT_USED",
          }),
        },
        commit_capability_input: {},
        replay_capability_input: {},
        encryption_key: new Uint8Array(16),
        encryption_key_id: "analysis-python-source-v1",
      }),
    ).toThrow("ANALYSIS_PYTHON_SOURCE_ENCRYPTION_CONFIG_INVALID");
  });
});
