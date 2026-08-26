import { z } from "zod";
import {
  analysisProgramRefSchema,
  queryEvidenceRefSchema,
} from "../artifacts/research/references.js";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
} from "../common/index.js";

const oracleReasonCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,127}$/u)
  .max(128);

export const analysisOracleInputBindingSchema = z.strictObject({
  query_evidence_refs: z.array(queryEvidenceRefSchema).min(1).max(64),
  input_materialization_closure_hash: contentHashSchema,
  stage_id: immutableIdSchema,
  stage_hash: contentHashSchema,
  published_closure_hash: contentHashSchema,
  operator_receipt_closure_hash: contentHashSchema,
  sandbox_receipt_hash: contentHashSchema,
  chart_dataset_hashes: z.array(contentHashSchema).min(1).max(32),
});

const analysisOracleReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("analysis-oracle-receipt@1.0.0"),
    oracle_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    node_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    analysis_program_ref: analysisProgramRefSchema,
    implementation_id: z.string().trim().min(1).max(128),
    implementation_hash: contentHashSchema,
    input_binding: analysisOracleInputBindingSchema,
    verdict: z.enum(["PASS", "REJECT"]),
    expected_terminal: z.enum(["READY", "HOLD"]),
    sample_size: z.number().int().nonnegative().safe(),
    coverage_ratio: z.number().finite().min(0).max(1),
    limitation_codes: z.array(oracleReasonCodeSchema).max(32),
    disclosure_codes: z.array(oracleReasonCodeSchema).max(32),
    verified_at: z.string().datetime({ offset: true }),
  })
  .superRefine((receipt, context) => {
    const references = receipt.input_binding.query_evidence_refs;
    if (
      receipt.analysis_program_ref.app_id !== receipt.scope.app_id ||
      receipt.analysis_program_ref.tenant_id !== receipt.scope.tenant_id ||
      receipt.analysis_program_ref.environment !== receipt.scope.environment ||
      receipt.analysis_program_ref.run_id !== receipt.run_id ||
      references.some(
        (reference) =>
          reference.app_id !== receipt.scope.app_id ||
          reference.tenant_id !== receipt.scope.tenant_id ||
          reference.environment !== receipt.scope.environment ||
          reference.run_id !== receipt.run_id,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["input_binding"],
        message: "Oracle inputs must bind the exact scope and run.",
      });
    }
    if ((receipt.verdict === "PASS") !== (receipt.expected_terminal === "READY")) {
      context.addIssue({
        code: "custom",
        path: ["expected_terminal"],
        message: "Only an independent Oracle PASS can authorize READY.",
      });
    }
    if (
      new Set(references.map((reference) => JSON.stringify(reference))).size !== references.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["input_binding", "query_evidence_refs"],
        message: "Oracle QueryEvidence references must be unique.",
      });
    }
  });

export const analysisOracleReceiptSchema = analysisOracleReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

export type AnalysisOracleInputBinding = z.infer<typeof analysisOracleInputBindingSchema>;
export type AnalysisOracleReceipt = z.infer<typeof analysisOracleReceiptSchema>;

export async function buildAnalysisOracleReceipt(
  input: z.input<typeof analysisOracleReceiptMaterialSchema>,
): Promise<AnalysisOracleReceipt> {
  const material = analysisOracleReceiptMaterialSchema.parse(input);
  return deepFreeze(
    analysisOracleReceiptSchema.parse({
      ...material,
      receipt_hash: await sha256ContentHash({
        hash_domain: "analysis-oracle-receipt@1.0.0",
        value: material,
      }),
    }),
  );
}

export async function verifyAnalysisOracleReceipt(input: unknown): Promise<AnalysisOracleReceipt> {
  const receipt = analysisOracleReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  const expectedHash = await sha256ContentHash({
    hash_domain: "analysis-oracle-receipt@1.0.0",
    value: analysisOracleReceiptMaterialSchema.parse(material),
  });
  if (observedHash !== expectedHash) {
    throw new TypeError("ANALYSIS_ORACLE_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}
