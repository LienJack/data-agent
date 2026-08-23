import { z } from "zod";
import { sha256ContentHash } from "../common/index.js";
import { artifactReferenceFor } from "./envelope.js";
import {
  contentHashSchema,
  identifierSchema,
  nonNegativeIntSchema,
  versionIdentifierSchema,
} from "./research/primitives.js";

export const analysisInputMaterializationReceiptSchema = z
  .strictObject({
    artifact_type: z.literal("AnalysisInputMaterializationReceipt"),
    protocol_version: z.literal("analysis-input-materialization@1.0.0"),
    query_evidence_ref: artifactReferenceFor("QueryEvidence"),
    query_result_ref: artifactReferenceFor("SandboxResult"),
    input_ref: artifactReferenceFor("SensitiveExecutionArtifact"),
    source_result_hash: contentHashSchema,
    input_hash: contentHashSchema,
    input_format: z.literal("ARROW"),
    row_count: nonNegativeIntSchema.max(10_000),
    ordered_columns: z.array(identifierSchema).min(1).max(256),
    spec_hash: contentHashSchema,
    snapshot_receipt_hash: contentHashSchema,
    materializer_version: versionIdentifierSchema,
    receipt_hash: contentHashSchema,
  })
  .superRefine((receipt, context) => {
    if (
      receipt.query_result_ref.content_hash !== receipt.source_result_hash ||
      receipt.input_ref.content_hash !== receipt.input_hash
    ) {
      context.addIssue({
        code: "custom",
        message: "Analysis input materialization hashes must bind exact source and output refs.",
      });
    }
    const anchor = receipt.query_evidence_ref;
    if (
      [receipt.query_result_ref, receipt.input_ref].some(
        (reference) =>
          reference.app_id !== anchor.app_id ||
          reference.tenant_id !== anchor.tenant_id ||
          reference.environment !== anchor.environment ||
          reference.run_id !== anchor.run_id,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Analysis input materialization refs must share exact scope and run.",
      });
    }
    if (new Set(receipt.ordered_columns).size !== receipt.ordered_columns.length) {
      context.addIssue({ code: "custom", message: "Materialized input columns must be unique." });
    }
  });

export type AnalysisInputMaterializationReceipt = z.infer<
  typeof analysisInputMaterializationReceiptSchema
>;

export async function computeAnalysisInputMaterializationReceiptHash(
  input: Omit<AnalysisInputMaterializationReceipt, "receipt_hash">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    hash_domain: "analysis-input-materialization@1.0.0",
    value: input,
  });
}

export async function verifyAnalysisInputMaterializationReceipt(input: unknown) {
  const receipt = analysisInputMaterializationReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await computeAnalysisInputMaterializationReceiptHash(material)) !== observedHash) {
    throw new TypeError("ANALYSIS_INPUT_MATERIALIZATION_RECEIPT_HASH_INVALID");
  }
  return receipt;
}
