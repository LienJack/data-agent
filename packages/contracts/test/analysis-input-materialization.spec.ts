import { describe, expect, it } from "vitest";
import {
  type AnalysisInputMaterializationReceipt,
  analysisInputMaterializationReceiptSchema,
  buildAnalysisInputMaterializationReceipt,
  computeAnalysisInputMaterializationReceiptHash,
  verifyAnalysisInputMaterializationReceipt,
} from "../src/index.js";

const id = (suffix: number) => `70000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test", run_id: id(3) } as const;
const reference = <
  const T extends
    | AnalysisInputMaterializationReceipt["artifact_type"]
    | "QueryEvidence"
    | "SensitiveExecutionArtifact",
>(
  artifact_type: T,
  suffix: number,
  content_hash: `sha256:${string}`,
) => ({ artifact_id: id(suffix), artifact_type, ...scope, revision: 1, content_hash });

async function receipt() {
  const material: Omit<AnalysisInputMaterializationReceipt, "receipt_hash"> = {
    artifact_type: "AnalysisInputMaterializationReceipt",
    protocol_version: "analysis-input-materialization@2.0.0",
    query_evidence_ref: reference("QueryEvidence", 4, hash("a")),
    input_ref: reference("SensitiveExecutionArtifact", 6, hash("c")),
    source_result_hash: hash("b"),
    input_hash: hash("c"),
    input_format: "ARROW",
    row_count: 4_612,
    ordered_columns: ["order_id", "order_total"],
    spec_hash: hash("d"),
    snapshot_receipt_hash: hash("e"),
    materializer_version: "falcon24-arrow-materializer@1.0.0",
  };
  return analysisInputMaterializationReceiptSchema.parse({
    ...material,
    receipt_hash: await computeAnalysisInputMaterializationReceiptHash(material),
  });
}

describe("analysis input materialization receipt", () => {
  it("builds one immutable content-addressed receipt", async () => {
    const value = await receipt();
    const { receipt_hash: _receiptHash, ...material } = value;
    const built = await buildAnalysisInputMaterializationReceipt(material);
    expect(built).toEqual(value);
    expect(Object.isFrozen(built)).toBe(true);
  });

  it("binds a governed SQL result to distinct deterministic Arrow bytes", async () => {
    const value = await receipt();
    expect(value.source_result_hash).toBe(hash("b"));
    expect(value.input_ref.content_hash).toBe(hash("c"));
    expect(value.source_result_hash).not.toBe(value.input_hash);
    await expect(verifyAnalysisInputMaterializationReceipt(value)).resolves.toEqual(value);
  });

  it("rejects source/output ref substitution and receipt tampering", async () => {
    const value = await receipt();
    expect(
      analysisInputMaterializationReceiptSchema.safeParse({
        ...value,
        input_ref: { ...value.input_ref, content_hash: hash("f") },
      }).success,
    ).toBe(false);
    await expect(
      verifyAnalysisInputMaterializationReceipt({ ...value, row_count: value.row_count - 1 }),
    ).rejects.toThrow("ANALYSIS_INPUT_MATERIALIZATION_RECEIPT_HASH_INVALID");
  });

  it("rejects the retired v1 receipt and SandboxResult compatibility field", async () => {
    const value = await receipt();
    expect(
      analysisInputMaterializationReceiptSchema.safeParse({
        ...value,
        protocol_version: "analysis-input-materialization@1.0.0",
        query_result_ref: reference("SensitiveExecutionArtifact", 9, hash("b")),
      }).success,
    ).toBe(false);
  });
});
