import { z } from "zod";
import { deepFreeze, postgresqlOutputAliasSchema, sha256ContentHash } from "../common/index.js";
import { artifactReferenceFor } from "./envelope.js";
import {
  contentHashSchema,
  nonNegativeIntSchema,
  versionIdentifierSchema,
} from "./research/primitives.js";

const materializedColumnSchema = z.strictObject({
  name: postgresqlOutputAliasSchema,
  arrow_type: z.enum(["UTF8", "FLOAT64", "BOOL", "DATE32", "TIMESTAMP_MS"]),
  nullable: z.boolean(),
  semantic_role: z.enum(["METRIC", "FORMULA", "DIMENSION"]),
  semantic_object_id: versionIdentifierSchema,
});

const materializationReceiptFields = {
  artifact_type: z.literal("AnalysisInputMaterializationReceipt"),
  protocol_version: z.literal("analysis-input-materialization@3.0.0"),
  query_evidence_ref: artifactReferenceFor("QueryEvidence"),
  input_ref: artifactReferenceFor("SensitiveExecutionArtifact"),
  source_result_hash: contentHashSchema,
  source_binding_hash: contentHashSchema,
  input_hash: contentHashSchema,
  input_format: z.literal("ARROW"),
  input_byte_count: nonNegativeIntSchema.min(1).max(16 * 1024 * 1024),
  row_count: nonNegativeIntSchema.max(10_000),
  columns: z.array(materializedColumnSchema).min(1).max(256),
  spec_hash: contentHashSchema,
  snapshot_receipt_hash: contentHashSchema,
  materializer_version: versionIdentifierSchema,
} as const;

function validateMaterializationBindings(
  receipt: z.infer<z.ZodObject<typeof materializationReceiptFields>>,
  context: z.RefinementCtx,
) {
  if (receipt.input_ref.content_hash !== receipt.input_hash) {
    context.addIssue({
      code: "custom",
      message: "Analysis input materialization hash must bind the exact input ref.",
    });
  }
  const anchor = receipt.query_evidence_ref;
  if (
    receipt.input_ref.app_id !== anchor.app_id ||
    receipt.input_ref.tenant_id !== anchor.tenant_id ||
    receipt.input_ref.environment !== anchor.environment ||
    receipt.input_ref.run_id !== anchor.run_id
  ) {
    context.addIssue({
      code: "custom",
      message: "Analysis input materialization refs must share exact scope and run.",
    });
  }
  if (new Set(receipt.columns.map(({ name }) => name)).size !== receipt.columns.length) {
    context.addIssue({ code: "custom", message: "Materialized input columns must be unique." });
  }
}

const analysisInputMaterializationReceiptDraftSchema = z
  .strictObject(materializationReceiptFields)
  .superRefine(validateMaterializationBindings);

export const analysisInputMaterializationReceiptSchema = z
  .strictObject({ ...materializationReceiptFields, receipt_hash: contentHashSchema })
  .superRefine(validateMaterializationBindings);

export type AnalysisInputMaterializationReceipt = z.infer<
  typeof analysisInputMaterializationReceiptSchema
>;

export async function computeAnalysisInputMaterializationReceiptHash(
  input: Omit<AnalysisInputMaterializationReceipt, "receipt_hash">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    hash_domain: "analysis-input-materialization@3.0.0",
    value: input,
  });
}

export async function buildAnalysisInputMaterializationReceipt(
  input: Omit<AnalysisInputMaterializationReceipt, "receipt_hash">,
): Promise<AnalysisInputMaterializationReceipt> {
  const material = analysisInputMaterializationReceiptDraftSchema.parse(input);
  return deepFreeze(
    analysisInputMaterializationReceiptSchema.parse({
      ...material,
      receipt_hash: await computeAnalysisInputMaterializationReceiptHash(material),
    }),
  );
}

export async function verifyAnalysisInputMaterializationReceipt(input: unknown) {
  const receipt = analysisInputMaterializationReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await computeAnalysisInputMaterializationReceiptHash(material)) !== observedHash) {
    throw new TypeError("ANALYSIS_INPUT_MATERIALIZATION_RECEIPT_HASH_INVALID");
  }
  return deepFreeze(receipt);
}
