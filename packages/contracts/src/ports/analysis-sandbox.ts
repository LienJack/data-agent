import { z } from "zod";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  generatedAnalysisSourcePolicySchema,
  statisticalOperatorCallReceiptSchema,
  statisticalOperatorObligationsSchema,
} from "../generated/statistical-operators.js";

export const analysisSandboxRuntimeProfileSchema = z.enum([
  "CORE_ANALYSIS",
  "ML_DIAGNOSTIC",
  "CAUSAL_L5",
]);

const analysisSandboxOutputReferenceSchema = z.strictObject({
  artifact_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  artifact_kind: z.enum(["RESULT", "TABLE", "CHART"]),
  media_type: z.literal("application/json"),
  reference: artifactReferenceSchema,
  content_sha256: contentHashSchema,
  bytes: z.number().int().nonnegative(),
});

const analysisSandboxCellReceiptSchema = z.strictObject({
  cell_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
  source_sha256: contentHashSchema,
  execution_id: z.string().min(1).max(256).nullable(),
  execution_count: z.number().int().nonnegative().nullable(),
  elapsed_ms: z.number().int().nonnegative(),
  status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]),
});

export const analysisSandboxExecutionReceiptSchema = z
  .strictObject({
    schema_version: z.literal("analysis-sandbox-execution-receipt@1.0.0"),
    workspace_id: immutableIdSchema,
    run_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    worker_fence: z.number().int().nonnegative(),
    fence_token: z.string().min(1).max(256),
    idempotency_key: z.string().min(8).max(256),
    request_hash: contentHashSchema,
    analysis_program_ref: artifactReferenceSchema,
    node_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    runtime_profile: analysisSandboxRuntimeProfileSchema,
    runtime: z.strictObject({
      provider: z.literal("OpenSandbox"),
      opensandbox_sdk_version: versionIdentifierSchema,
      code_interpreter_sdk_version: versionIdentifierSchema,
      agent_image: z.string().trim().min(1).max(1_024),
      operator_image: z.string().trim().min(1).max(1_024),
      agent_sandbox_id: z.string().uuid(),
      operator_sandbox_id: z.string().uuid(),
    }),
    generated_source_policy: generatedAnalysisSourcePolicySchema.exclude(["NO_GENERATED_SOURCE"]),
    operator_registry_digest: contentHashSchema,
    operator_obligations: statisticalOperatorObligationsSchema,
    operator_receipts: z.array(statisticalOperatorCallReceiptSchema).max(32),
    operator_receipt_closure_hash: contentHashSchema,
    result_contract_hash: contentHashSchema,
    publish_manifest_hash: contentHashSchema,
    published_closure_hash: contentHashSchema,
    publish_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    inputs: z
      .array(
        z.strictObject({
          name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u),
          format: z.enum(["ARROW", "CSV", "JSON"]),
          query_evidence_ref: artifactReferenceSchema,
          input_ref: artifactReferenceSchema,
          materialization_receipt_ref: artifactReferenceSchema,
          content_sha256: contentHashSchema,
          bytes: z.number().int().positive(),
        }),
      )
      .min(1)
      .max(64),
    cells: z.array(analysisSandboxCellReceiptSchema).min(1).max(32),
    started_at: timestampSchema,
    finished_at: timestampSchema,
    elapsed_ms: z.number().int().nonnegative(),
    hard_controls: z.strictObject({
      network_isolated: z.literal(true),
      scoped_filesystem: z.literal(true),
      separate_operator_sandbox: z.literal(true),
      resource_limits_enforced: z.literal(true),
      secure_access: z.boolean(),
    }),
    status: z.literal("SUCCEEDED"),
    failure_code: z.null(),
    outputs: z.array(analysisSandboxOutputReferenceSchema).min(3).max(65),
    execution_hash: contentHashSchema,
  })
  .superRefine((receipt, context) => {
    if (
      receipt.analysis_program_ref.tenant_id !== receipt.workspace_id ||
      receipt.analysis_program_ref.run_id !== receipt.run_id ||
      receipt.runtime.agent_sandbox_id === receipt.runtime.operator_sandbox_id
    ) {
      context.addIssue({
        code: "custom",
        path: ["analysis_program_ref"],
        message: "Analysis sandbox receipt scope and sandbox identities must be closed.",
      });
    }
    const expectedCalls = receipt.operator_obligations.map(({ call_id, operator_id }) => ({
      call_id,
      operator_id,
    }));
    const actualCalls = receipt.operator_receipts.map(({ call_id, operator_id }) => ({
      call_id,
      operator_id,
    }));
    if (JSON.stringify(expectedCalls) !== JSON.stringify(actualCalls)) {
      context.addIssue({
        code: "custom",
        path: ["operator_receipts"],
        message: "Operator receipts must exactly close the declared obligations.",
      });
    }
    const outputNames = new Set<string>();
    for (const [index, materialized] of receipt.inputs.entries()) {
      if (
        materialized.input_ref.tenant_id !== receipt.workspace_id ||
        materialized.input_ref.run_id !== receipt.run_id ||
        materialized.input_ref.content_hash !== materialized.content_sha256 ||
        materialized.query_evidence_ref.tenant_id !== receipt.workspace_id ||
        materialized.query_evidence_ref.run_id !== receipt.run_id
      ) {
        context.addIssue({
          code: "custom",
          path: ["inputs", index],
          message: "Each materialized input must bind the receipt scope and content.",
        });
      }
    }
    for (const [index, output] of receipt.outputs.entries()) {
      if (
        outputNames.has(output.artifact_name) ||
        output.reference.tenant_id !== receipt.workspace_id ||
        output.reference.run_id !== receipt.run_id ||
        output.reference.content_hash !== output.content_sha256
      ) {
        context.addIssue({
          code: "custom",
          path: ["outputs", index],
          message: "Each published artifact must be unique and bind its committed reference.",
        });
      }
      outputNames.add(output.artifact_name);
    }
  });

export type AnalysisSandboxRuntimeProfile = z.infer<typeof analysisSandboxRuntimeProfileSchema>;
export type AnalysisSandboxExecutionReceipt = z.infer<typeof analysisSandboxExecutionReceiptSchema>;
