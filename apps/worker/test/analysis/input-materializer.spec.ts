import {
  type ArtifactReference,
  artifactReferenceFor,
  buildAnalysisInputMaterializationReceipt,
  buildProductTeamArtifactDocument,
  type ProductTeamArtifactDocument,
  verifyAnalysisInputMaterializationReceipt,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import { DEFAULT_RUN_EXECUTION_POLICY, type RunWorkLease } from "@data-agent/contracts/runs";
import { Float64, Table, tableToIPC, Utf8, vectorFromArray } from "apache-arrow";
import { describe, expect, it, vi } from "vitest";
import { verifyGovernedAnalysisInputs } from "../../src/analysis/governed-analysis-input.js";
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
  execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
  payload: {},
};

async function queryEvidenceDocument(rowCount = 2) {
  const sqlRef = reference("SqlArtifact", 20, hash("f"));
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    order_id: `order-${index + 1}`,
    order_total: 100 + index,
  }));
  const document = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: reference("QueryEvidence", 21, hash("0")),
    profile_id: "governed-text2sql-agent",
    task_id: id(22),
    source_refs: [sqlRef],
    provenance: {
      kind: "GOVERNED_QUERY_RESULT",
      query_id: id(23),
      request_hash: hash("1"),
      result_hash: hash("a"),
      row_count: rowCount,
      byte_count: 256,
      elapsed_ms: 4,
      truncated: false,
    },
    projection: {
      kind: "TABLE",
      columns: [
        { key: "order_id", label: "order_id", data_type: "STRING" },
        { key: "order_total", label: "order_total", data_type: "NUMBER" },
      ],
      rows,
      total_rows: rowCount,
    },
    committed_at: "2026-08-24T00:00:00.000Z",
  });
  return {
    document,
    reference: artifactReferenceFor("QueryEvidence").parse(document.artifact_ref),
  };
}

function arrowContent(rowCount = 2, orderTotalOffset = 0) {
  return tableToIPC(
    new Table({
      order_id: vectorFromArray(
        Array.from({ length: rowCount }, (_, index) => `order-${index + 1}`),
        new Utf8(),
      ),
      order_total: vectorFromArray(
        Array.from({ length: rowCount }, (_, index) => 100 + index + orderTotalOffset),
        new Float64(),
      ),
    }),
    "file",
  );
}

function productArtifactAuthority(document: ProductTeamArtifactDocument | null) {
  return {
    resolveCommitted: vi.fn(async () => ({ ok: true as const, value: document })),
  };
}

describe("analysis input materializer", () => {
  it("encrypts Arrow bytes and commits the exact QueryEvidence-to-input receipt", async () => {
    const evidence = await queryEvidenceDocument();
    const sensitiveCommit = vi.fn(async (_capability, request) => ({
      ok: true as const,
      value: {
        schema_version: "sensitive-execution-artifact-commit-result@2.0.0" as const,
        disposition: "CREATED" as const,
        receipt: request.command.receipt,
      },
    }));
    const systemCommit = vi.fn(async ({ reference: committed }) => committed);
    const materializer = createAnalysisInputMaterializer({
      sensitive_artifacts: { commit: sensitiveCommit },
      product_artifacts: productArtifactAuthority(evidence.document),
      analysis_artifacts: {
        commitL2: vi.fn(),
        commitSystem: systemCommit,
        resolveCommitted: vi.fn(),
      },
      capability_input: { authority: "test" },
      encryption_key: Buffer.alloc(32, 7),
      encryption_key_id: "analysis-input-test@1",
    });
    const content = arrowContent();
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
      protocol_version: "analysis-input-materialization@2.0.0",
      query_evidence_ref: evidence.reference,
      source_result_hash: hash("a"),
      input_ref: result.input_ref,
      row_count: 2,
      ordered_columns: ["order_id", "order_total"],
    });
    expect(result.materialization_receipt_document).not.toHaveProperty("query_result_ref");
    await expect(
      verifyGovernedAnalysisInputs({
        analysis_program_ref: reference("AnalysisProgram", 33),
        governed_inputs: [result],
      }),
    ).resolves.toBeUndefined();

    const committedReceipt = await verifyAnalysisInputMaterializationReceipt(
      result.materialization_receipt_document,
    );
    const { receipt_hash: _receiptHash, ...receiptMaterial } = committedReceipt;
    const substitutedReceipt = await buildAnalysisInputMaterializationReceipt({
      ...receiptMaterial,
      source_result_hash: hash("b"),
    });
    await expect(
      verifyGovernedAnalysisInputs({
        analysis_program_ref: reference("AnalysisProgram", 33),
        governed_inputs: [
          {
            ...result,
            materialization_receipt_document: substitutedReceipt,
            materialization_receipt_ref: {
              ...result.materialization_receipt_ref,
              content_hash: await sha256ContentHash(substitutedReceipt),
            },
          },
        ],
      }),
    ).rejects.toThrow("ANALYSIS_QUERY_EVIDENCE_MATERIALIZATION_INVALID");
  });

  it("rejects a QueryEvidence ref that Product Team authority cannot resolve", async () => {
    const evidence = await queryEvidenceDocument();
    const sensitiveCommit = vi.fn();
    const systemCommit = vi.fn();
    const materializer = createAnalysisInputMaterializer({
      sensitive_artifacts: { commit: sensitiveCommit },
      product_artifacts: {
        resolveCommitted: vi.fn(async () => ({ ok: true as const, value: null })),
      },
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
        content: arrowContent(),
        row_count: 2,
        ordered_columns: ["order_id", "order_total"],
        spec_hash: hash("1"),
        snapshot_receipt_hash: hash("2"),
        query_evidence_ref: evidence.reference,
      }),
    ).rejects.toThrow("ANALYSIS_INPUT_QUERY_EVIDENCE_NOT_COMMITTED");
    expect(sensitiveCommit).not.toHaveBeenCalled();
    expect(systemCommit).not.toHaveBeenCalled();
  });

  it("rejects an Arrow column binding that differs from the Product Team projection", async () => {
    const evidence = await queryEvidenceDocument();
    const sensitiveCommit = vi.fn();
    const systemCommit = vi.fn();
    const materializer = createAnalysisInputMaterializer({
      sensitive_artifacts: { commit: sensitiveCommit },
      product_artifacts: productArtifactAuthority(evidence.document),
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
        content: arrowContent(),
        row_count: 2,
        ordered_columns: ["order_total", "order_id"],
        spec_hash: hash("1"),
        snapshot_receipt_hash: hash("2"),
        query_evidence_ref: evidence.reference,
      }),
    ).rejects.toThrow("ANALYSIS_INPUT_QUERY_EVIDENCE_INVALID");
    expect(sensitiveCommit).not.toHaveBeenCalled();
    expect(systemCommit).not.toHaveBeenCalled();
  });

  it("rejects row-count drift before either authority observes a write", async () => {
    const evidence = await queryEvidenceDocument(3);
    const sensitiveCommit = vi.fn();
    const systemCommit = vi.fn();
    const materializer = createAnalysisInputMaterializer({
      sensitive_artifacts: { commit: sensitiveCommit },
      product_artifacts: productArtifactAuthority(evidence.document),
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
        content: arrowContent(2),
        row_count: 2,
        ordered_columns: ["order_id"],
        spec_hash: hash("1"),
        snapshot_receipt_hash: hash("2"),
        query_evidence_ref: evidence.reference,
      }),
    ).rejects.toThrow("ANALYSIS_INPUT_ARROW_CONTENT_INVALID");
    expect(sensitiveCommit).not.toHaveBeenCalled();
    expect(systemCommit).not.toHaveBeenCalled();
  });

  it("rejects same-shape Arrow bytes whose cell values differ from QueryEvidence", async () => {
    const evidence = await queryEvidenceDocument();
    const sensitiveCommit = vi.fn();
    const systemCommit = vi.fn();
    const materializer = createAnalysisInputMaterializer({
      sensitive_artifacts: { commit: sensitiveCommit },
      product_artifacts: productArtifactAuthority(evidence.document),
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
        content: arrowContent(2, 1_000),
        row_count: 2,
        ordered_columns: ["order_id", "order_total"],
        spec_hash: hash("1"),
        snapshot_receipt_hash: hash("2"),
        query_evidence_ref: evidence.reference,
      }),
    ).rejects.toThrow("ANALYSIS_INPUT_ARROW_CONTENT_MISMATCH");
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
