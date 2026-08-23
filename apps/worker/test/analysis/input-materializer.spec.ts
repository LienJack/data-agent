import {
  type ArtifactReference,
  artifactReferenceFor,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ResearchEnvelopeContentHash,
  parseL2ResearchDocumentCandidate,
  queryEvidenceV2PayloadSchema,
} from "@data-agent/contracts/artifacts";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { describe, expect, it, vi } from "vitest";
import {
  analysisInputMaterializerInternals,
  createAnalysisInputMaterializer,
  resolveAnalysisInputEncryption,
} from "../../src/analysis/input-materializer.js";

const id = (suffix: number) => `81000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

function reference(
  artifact_type: ArtifactReference["artifact_type"],
  suffix: number,
  content_hash: `sha256:${string}` = hash(String(suffix % 10)),
): ArtifactReference {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash,
  };
}

const lease: RunWorkLease = {
  scope,
  principal_id: id(4),
  outbox_id: id(5),
  run_id: runId,
  command_id: id(6),
  command_kind: "START_DATA_AGENT_TEAM",
  attempt_id: id(7),
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 300_000,
  worker_id: "analysis-input-test",
  lease_token: 1,
  worker_fence: 1,
  expires_at: "2026-08-24T00:05:00.000Z",
  payload: {},
};

async function queryEvidenceDocument(rowCount = 2) {
  const semanticReleaseRef = reference("SemanticRelease", 20);
  const schemaSnapshotRef = reference("SchemaSnapshot", 21);
  const policyReceiptRef = reference("PolicyReceipt", 22);
  const sandboxResultRef = reference("SandboxResult", 23, hash("a"));
  const payload = queryEvidenceV2PayloadSchema.parse({
    artifact_type: "QueryEvidence",
    protocol_version: "query-evidence@2.0.0",
    obligation_ref: { container_ref: reference("EvidencePlan", 24), node_id: "analysis-input" },
    obligation_execution_decision_ref: reference("ObligationExecutionDecision", 25),
    query_contract_ref: reference("QueryContract", 26),
    sql_artifact_ref: reference("SqlArtifact", 27),
    validation_receipt_ref: reference("ValidationReceipt", 28),
    execution_receipt_ref: reference("ExecutionReceipt", 29),
    sandbox_execution_receipt_ref: reference("SandboxExecutionReceipt", 30),
    sandbox_result_ref: sandboxResultRef,
    dependency_evidence_refs: [],
    provenance_group: "sandbox:test",
    observed_version: {
      semantic_release_ref: semanticReleaseRef,
      schema_snapshot_ref: schemaSnapshotRef,
      data_snapshot: {
        protocol_version: "data-snapshot-binding@1.0.0",
        datasource_id: id(31),
        strategy: "CONTROLLED_REVISION",
        snapshot_token: "falcon24-fixed-snapshot",
        schema_manifest_hash: hash("b"),
        data_manifest_hash: hash("c"),
        fixture_manifest_hash: hash("d"),
        replay_state: "REPLAYABLE",
        binding_hash: hash("e"),
      },
      policy_receipt_ref: policyReceiptRef,
      identity_binding: {
        principal_id: lease.principal_id,
        delegation_chain_hash: hash("f"),
        authority_epoch: 1,
      },
    },
    observation: {
      result_hash: sandboxResultRef.content_hash,
      row_count: rowCount,
      schema_hash: hash("9"),
    },
  });
  const inputRefs = collectL2ResearchPayloadArtifactReferences(payload);
  const draft = parseL2ResearchDocumentCandidate({
    envelope: {
      artifact_id: id(32),
      artifact_type: "QueryEvidence",
      ...scope,
      run_id: runId,
      revision: 1,
      parent_ref: null,
      attempt_id: lease.attempt_id,
      producer: { kind: "deterministic", id: "analysis-input-test" },
      input_refs: inputRefs,
      schema_version: "2.0.0",
      semantic_version: "1.0.0",
      policy_version: "analysis-input-test@1.0.0",
      model_profile_version: "none@1.0.0",
      content_hash: hash("0"),
      status: "CANDIDATE",
      created_at: "2026-08-24T00:00:00.000Z",
    },
    payload,
  });
  const document = parseL2ResearchDocumentCandidate({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ResearchEnvelopeContentHash(draft),
    },
  });
  return {
    document,
    payload,
    reference: artifactReferenceFor("QueryEvidence").parse({
      artifact_id: document.envelope.artifact_id,
      artifact_type: document.envelope.artifact_type,
      app_id: document.envelope.app_id,
      tenant_id: document.envelope.tenant_id,
      environment: document.envelope.environment,
      run_id: document.envelope.run_id,
      revision: document.envelope.revision,
      content_hash: document.envelope.content_hash,
    }),
  };
}

describe("analysis input materializer", () => {
  it("encrypts Arrow bytes and commits the exact QueryEvidence-to-input receipt", async () => {
    const evidence = await queryEvidenceDocument();
    const sensitiveCommit = vi.fn(async (_capability, request) => ({
      ok: true as const,
      value: {
        schema_version: "sensitive-execution-artifact-commit-result@1.0.0" as const,
        disposition: "CREATED" as const,
        receipt: request.command.receipt,
      },
    }));
    const systemCommit = vi.fn(async ({ reference: committed }) => committed);
    const materializer = createAnalysisInputMaterializer({
      sensitive_artifacts: { commit: sensitiveCommit },
      analysis_artifacts: {
        commitL2: vi.fn(),
        commitSystem: systemCommit,
        resolveCommitted: vi.fn(),
      },
      capability_input: { authority: "test" },
      encryption_key: Buffer.alloc(32, 7),
      encryption_key_id: "analysis-input-test@1",
    });
    const content = Buffer.from("ARROW-IPC-BYTES", "utf8");
    const result = await materializer.materialize({
      lease,
      analysis_program_ref: reference("AnalysisProgram", 33),
      node_id: "falcon24-business-review-18m",
      idempotency_key: "analysis-input-test",
      input_name: "falcon24_business_review",
      format: "ARROW",
      content,
      row_count: 2,
      ordered_columns: ["order_id", "order_total"],
      spec_hash: hash("1"),
      snapshot_receipt_hash: hash("2"),
      query_evidence_ref: evidence.reference,
      query_evidence_document: evidence.document,
    });

    expect(result.input_ref.artifact_type).toBe("SensitiveExecutionArtifact");
    expect(result.materialization_receipt_ref.artifact_type).toBe(
      "AnalysisInputMaterializationReceipt",
    );
    const committedCiphertext = sensitiveCommit.mock.calls[0]?.[1].ciphertext;
    expect(Buffer.from(committedCiphertext ?? []).equals(content)).toBe(false);
    expect(
      Buffer.from(committedCiphertext ?? [])
        .subarray(0, 5)
        .toString("ascii"),
    ).toBe("DAAI1");
    expect(systemCommit).toHaveBeenCalledOnce();
    expect(result.materialization_receipt_document).toMatchObject({
      query_evidence_ref: evidence.reference,
      query_result_ref: evidence.payload.sandbox_result_ref,
      input_ref: result.input_ref,
      row_count: 2,
      ordered_columns: ["order_id", "order_total"],
    });
  });

  it("rejects row-count drift before either authority observes a write", async () => {
    const evidence = await queryEvidenceDocument(3);
    const sensitiveCommit = vi.fn();
    const systemCommit = vi.fn();
    const materializer = createAnalysisInputMaterializer({
      sensitive_artifacts: { commit: sensitiveCommit },
      analysis_artifacts: {
        commitL2: vi.fn(),
        commitSystem: systemCommit,
        resolveCommitted: vi.fn(),
      },
      capability_input: null,
      encryption_key: Buffer.alloc(32, 8),
      encryption_key_id: "analysis-input-test@1",
    });
    await expect(
      materializer.materialize({
        lease,
        analysis_program_ref: reference("AnalysisProgram", 33),
        node_id: "falcon24-business-review-18m",
        idempotency_key: "analysis-input-test",
        input_name: "falcon24_business_review",
        format: "ARROW",
        content: Buffer.from("ARROW", "utf8"),
        row_count: 2,
        ordered_columns: ["order_id"],
        spec_hash: hash("1"),
        snapshot_receipt_hash: hash("2"),
        query_evidence_ref: evidence.reference,
        query_evidence_document: evidence.document,
      }),
    ).rejects.toThrow("ANALYSIS_INPUT_QUERY_EVIDENCE_INVALID");
    expect(sensitiveCommit).not.toHaveBeenCalled();
    expect(systemCommit).not.toHaveBeenCalled();
  });

  it("loads only an exact 32-byte base64 key and derives stable lease time", () => {
    const encoded = Buffer.alloc(32, 9).toString("base64");
    expect(
      resolveAnalysisInputEncryption({
        DATA_AGENT_ANALYSIS_INPUT_KEY_BASE64: encoded,
      }),
    ).toEqual({ key: Buffer.alloc(32, 9), key_id: "analysis-input-v1" });
    expect(analysisInputMaterializerInternals.leaseStartedAt(lease).toISOString()).toBe(
      "2026-08-24T00:00:00.000Z",
    );
    expect(() =>
      resolveAnalysisInputEncryption({ DATA_AGENT_ANALYSIS_INPUT_KEY_BASE64: "invalid" }),
    ).toThrow("ANALYSIS_INPUT_ENCRYPTION_CONFIG_INVALID");
  });
});
