import { z } from "zod";
import { artifactReferenceIdentity, artifactReferenceSchema } from "../artifacts/envelope.js";
import {
  contentHashSchema,
  immutableIdSchema,
  type PythonOutputContractV1,
  pythonOutputContractSchema,
  pythonOutputTypeSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import {
  generatedAnalysisSourcePolicySchema,
  statisticalOperatorCallReceiptSchema,
  statisticalOperatorObligationsSchema,
} from "../generated/statistical-operators.js";

export const pythonExecutionFailureCodeSchema = z.enum([
  "PYTHON_POLICY_AUTHORIZATION_INVALID",
  "PYTHON_POLICY_RUNTIME_ATTESTATION_MISMATCH",
  "PYTHON_POLICY_IDEMPOTENCY_CONFLICT",
  "PYTHON_POLICY_SOURCE_DIGEST_MISMATCH",
  "PYTHON_POLICY_INPUT_DIGEST_MISMATCH",
  "PYTHON_POLICY_SOURCE_ENCODING_INVALID",
  "PYTHON_POLICY_IMPORT_PROFILE_DENIED",
  "PYTHON_POLICY_SOURCE_TOO_LARGE",
  "PYTHON_POLICY_SOURCE_NUL",
  "PYTHON_POLICY_SOURCE_SYNTAX",
  "PYTHON_POLICY_AST_TOO_LARGE",
  "PYTHON_POLICY_ENTRYPOINT_INVALID",
  "PYTHON_POLICY_ENTRYPOINT_SIGNATURE_INVALID",
  "PYTHON_POLICY_TOP_LEVEL_EFFECT_DENIED",
  "PYTHON_POLICY_IMPORT_DENIED",
  "PYTHON_POLICY_NAME_DENIED",
  "PYTHON_POLICY_PRIVATE_ATTRIBUTE_DENIED",
  "PYTHON_POLICY_ATTRIBUTE_DENIED",
  "PYTHON_POLICY_ATTRIBUTE_ROOT_DENIED",
  "PYTHON_POLICY_GLOBAL_STATE_DENIED",
  "PYTHON_POLICY_ASYNC_GENERATOR_DENIED",
  "PYTHON_POLICY_CALL_DENIED",
  "PYTHON_OPERATOR_REGISTRY_DIGEST_MISMATCH",
  "PYTHON_OPERATOR_NOT_REGISTERED",
  "PYTHON_OPERATOR_NOT_AUTHORIZED",
  "PYTHON_OPERATOR_REQUIRED_CALL_MISSING",
  "PYTHON_OPERATOR_UNDECLARED_CALL",
  "PYTHON_OPERATOR_DUPLICATE_CALL_ID",
  "PYTHON_OPERATOR_INPUT_INVALID",
  "PYTHON_OPERATOR_PARAMETER_INVALID",
  "PYTHON_OPERATOR_APPLICABILITY_HOLD",
  "PYTHON_OPERATOR_NUMERIC_FAILURE",
  "PYTHON_OPERATOR_RESULT_BINDING_MISMATCH",
  "PYTHON_OPERATOR_RECEIPT_CLOSURE_MISMATCH",
  "PYTHON_TIMEOUT",
  "PYTHON_RESOURCE_LIMIT",
  "PYTHON_CANCELLED",
  "PYTHON_IMPORT_DENIED",
  "PYTHON_INPUT_FORMAT_INVALID",
  "PYTHON_INPUT_NOT_DECLARED",
  "PYTHON_OUTPUT_NOT_DECLARED",
  "PYTHON_OUTPUT_TYPE_MISMATCH",
  "PYTHON_OUTPUT_VALUE_INVALID",
  "PYTHON_VEGA_LITE_INVALID",
  "PYTHON_PNG_VALUE_INVALID",
  "PYTHON_ENTRYPOINT_MISSING",
  "PYTHON_ENTRYPOINT_RETURN_MUST_BE_NONE",
  "PYTHON_TYPE_ERROR",
  "PYTHON_NAME_ERROR",
  "PYTHON_ATTRIBUTE_ERROR",
  "PYTHON_KEY_ERROR",
  "PYTHON_INDEX_ERROR",
  "PYTHON_VALUE_ERROR",
  "PYTHON_ZERO_DIVISION_ERROR",
  "PYTHON_IMPORT_ERROR",
  "PYTHON_MODULE_NOT_FOUND_ERROR",
  "PYTHON_RUNTIME_ERROR",
  "PYTHON_ASSERTION_ERROR",
  "PYTHON_OVERFLOW_ERROR",
  "PYTHON_ERROR",
  "PYTHON_OUTPUT_INVALID",
  "PYTHON_SANDBOX_UNAVAILABLE",
]);

export { pythonOutputContractSchema, pythonOutputTypeSchema };

export const pythonExecutionBudgetsSchema = z.strictObject({
  wall_time_ms: z.number().int().positive().max(600_000),
  cpu_seconds: z.number().int().positive().max(600),
  memory_bytes: z.number().int().positive().max(2_147_483_648),
  input_bytes: z.number().int().positive().max(536_870_912),
  output_bytes: z.number().int().positive().max(268_435_456),
  max_pids: z.number().int().positive().max(64),
  max_open_files: z.number().int().positive().max(256),
  stdout_bytes: z.number().int().nonnegative().max(1_048_576),
  stderr_bytes: z.number().int().nonnegative().max(1_048_576),
});

export const pythonExecutionRequestSchema = z
  .strictObject({
    schema_version: z.literal("1.0.0"),
    workspace_id: immutableIdSchema,
    run_id: immutableIdSchema,
    attempt: z.union([z.literal(0), z.literal(1)]),
    fence_token: z.string().min(1).max(256),
    idempotency_key: z.string().min(8).max(256),
    source_ref: artifactReferenceSchema,
    source_sha256: contentHashSchema,
    entrypoint: z.literal("main"),
    input_refs: z.array(artifactReferenceSchema).max(64),
    output_contract: pythonOutputContractSchema,
    generated_source_policy: generatedAnalysisSourcePolicySchema,
    operator_registry_digest: contentHashSchema,
    operator_obligations: statisticalOperatorObligationsSchema,
    runtime_digest: contentHashSchema,
    dependency_lock_digest: contentHashSchema,
    policy_version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/u),
    budgets: pythonExecutionBudgetsSchema,
  })
  .superRefine((request, context) => {
    const references = [request.source_ref, ...request.input_refs];
    for (const [index, reference] of references.entries()) {
      if (reference.tenant_id !== request.workspace_id || reference.run_id !== request.run_id) {
        context.addIssue({
          code: "custom",
          path: index === 0 ? ["source_ref"] : ["input_refs", index - 1],
          message: "Python source and inputs must bind the request workspace and run",
        });
      }
    }
    if (request.source_ref.content_hash !== request.source_sha256) {
      context.addIssue({
        code: "custom",
        path: ["source_sha256"],
        message: "source hash must bind source_ref",
      });
    }
    if (
      (request.generated_source_policy === "GOVERNED_OPERATOR_ORCHESTRATION") !==
      request.operator_obligations.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["operator_obligations"],
        message: "execution request 的源码策略与算子义务不闭合",
      });
    }
    const outputByName = new Map(
      request.output_contract.outputs.map((output) => [output.name, output]),
    );
    for (const [index, obligation] of request.operator_obligations.entries()) {
      if (outputByName.get(obligation.result_binding.result_output_name)?.type !== "JSON") {
        context.addIssue({
          code: "custom",
          path: ["operator_obligations", index, "result_binding"],
          message: "operator result binding 必须命中已声明的 JSON 输出",
        });
      }
    }
  });

export const pythonObservedResourcesSchema = z.strictObject({
  peak_memory_bytes: z.number().int().nonnegative(),
  cpu_seconds: z.number().nonnegative(),
  output_bytes: z.number().int().nonnegative(),
  stdout_bytes: z.number().int().nonnegative(),
  stderr_bytes: z.number().int().nonnegative(),
  exit_code: z.number().int().nullable(),
  signal: z.number().int().nullable(),
});

export const pythonHardControlsSchema = z.strictObject({
  network_isolated: z.boolean(),
  filesystem_isolated: z.boolean(),
  memory_limit_enforced: z.boolean(),
  cpu_limit_enforced: z.boolean(),
  pid_limit_enforced: z.boolean(),
});

export const pythonSandboxReceiptSchema = z
  .strictObject({
    schema_version: z.literal("1.0.0"),
    workspace_id: immutableIdSchema,
    run_id: immutableIdSchema,
    attempt: z.union([z.literal(0), z.literal(1)]),
    fence_token: z.string().min(1).max(256),
    idempotency_key: z.string().min(8).max(256),
    request_hash: contentHashSchema,
    sandbox_image_digest: contentHashSchema,
    python_version: z.string().regex(/^3\.12(?:\.[0-9]+)?$/u),
    sdk_version: z.string().min(1).max(128),
    dependency_lock_digest: contentHashSchema,
    policy_version: z.string().min(1).max(128),
    generated_source_policy: generatedAnalysisSourcePolicySchema,
    operator_registry_digest: contentHashSchema,
    operator_obligations: statisticalOperatorObligationsSchema,
    operator_receipts: z.array(statisticalOperatorCallReceiptSchema).max(32),
    operator_receipt_closure_hash: contentHashSchema.nullable(),
    started_at: timestampSchema,
    finished_at: timestampSchema,
    elapsed_ms: z.number().int().nonnegative(),
    observed_resources: pythonObservedResourcesSchema,
    hard_controls: pythonHardControlsSchema,
    status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
    failure_code: pythonExecutionFailureCodeSchema.nullable(),
    output_refs: z.array(artifactReferenceSchema).max(32),
    stdout_ref: artifactReferenceSchema.nullable(),
    stderr_ref: artifactReferenceSchema.nullable(),
  })
  .superRefine((receipt, context) => {
    if ((receipt.status === "SUCCEEDED") !== (receipt.failure_code === null)) {
      context.addIssue({
        code: "custom",
        path: ["failure_code"],
        message: "only success has no failure code",
      });
    }
    if (receipt.status === "CANCELLED" && receipt.failure_code !== "PYTHON_CANCELLED") {
      context.addIssue({
        code: "custom",
        path: ["failure_code"],
        message: "cancelled receipt requires PYTHON_CANCELLED",
      });
    }
    if (receipt.status !== "SUCCEEDED" && receipt.output_refs.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["output_refs"],
        message: "failed executions cannot commit outputs",
      });
    }
    if (
      (receipt.generated_source_policy === "GOVERNED_OPERATOR_ORCHESTRATION") !==
      receipt.operator_obligations.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["operator_obligations"],
        message: "sandbox receipt 的源码策略与算子义务不闭合",
      });
    }
    if (receipt.status === "SUCCEEDED") {
      const expected = receipt.operator_obligations.map(({ call_id, operator_id }) => ({
        call_id,
        operator_id,
      }));
      const actual = receipt.operator_receipts.map(({ call_id, operator_id }) => ({
        call_id,
        operator_id,
      }));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        context.addIssue({
          code: "custom",
          path: ["operator_receipts"],
          message: "successful receipt 必须按声明顺序逐一闭合 operator obligations",
        });
      }
      if (receipt.operator_receipt_closure_hash === null) {
        context.addIssue({
          code: "custom",
          path: ["operator_receipt_closure_hash"],
          message: "successful receipt 必须绑定 operator receipt closure hash",
        });
      }
    } else if (
      receipt.operator_receipts.length > 0 ||
      receipt.operator_receipt_closure_hash !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["operator_receipts"],
        message: "failed or cancelled execution cannot publish operator receipts",
      });
    }
    for (const [index, operatorReceipt] of receipt.operator_receipts.entries()) {
      if (operatorReceipt.operator_registry_digest !== receipt.operator_registry_digest) {
        context.addIssue({
          code: "custom",
          path: ["operator_receipts", index, "operator_registry_digest"],
          message: "operator receipt 必须绑定 sandbox receipt registry digest",
        });
      }
    }
    for (const reference of [...receipt.output_refs, receipt.stdout_ref, receipt.stderr_ref].filter(
      Boolean,
    )) {
      if (reference?.tenant_id !== receipt.workspace_id || reference.run_id !== receipt.run_id) {
        context.addIssue({
          code: "custom",
          path: ["output_refs"],
          message: "receipt references must bind workspace and run",
        });
      }
    }
  });

export type PythonExecutionFailureCode = z.infer<typeof pythonExecutionFailureCodeSchema>;
export type { PythonOutputContractV1 };
export type PythonExecutionBudgetsV2 = z.infer<typeof pythonExecutionBudgetsSchema>;
export type PythonExecutionRequestV2 = z.infer<typeof pythonExecutionRequestSchema>;
export type PythonSandboxReceiptV2 = z.infer<typeof pythonSandboxReceiptSchema>;

export const materializedPythonInputSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u),
  format: z.enum(["ARROW", "CSV", "JSON"]),
  reference: artifactReferenceSchema,
  content_base64: z.string().min(1),
});

export const pythonOutputSlotSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u),
  artifact_id: immutableIdSchema,
  artifact_type: z.literal("SandboxResult"),
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  run_id: immutableIdSchema,
  revision: z.number().int().positive(),
});
export type PythonOutputSlotV2 = z.infer<typeof pythonOutputSlotSchema>;

export const pythonExecutionEnvelopeSchema = z
  .strictObject({
    protocol_version: z.literal("data-agent-python-sandbox-ipc@2.0.0"),
    authorization: z.string().min(32).max(512),
    request: pythonExecutionRequestSchema,
    source_code_base64: z.string().min(1),
    inputs: z.array(materializedPythonInputSchema).max(64),
    output_slots: z.array(pythonOutputSlotSchema).max(32),
  })
  .superRefine((envelope, context) => {
    const materialized = envelope.inputs.map(({ reference }) => reference);
    if (JSON.stringify(materialized) !== JSON.stringify(envelope.request.input_refs)) {
      context.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "inputs must exactly bind input_refs",
      });
    }
    const expected = new Set(envelope.request.output_contract.outputs.map(({ name }) => name));
    const actual = new Set(envelope.output_slots.map(({ name }) => name));
    if (
      expected.size !== actual.size ||
      actual.size !== envelope.output_slots.length ||
      [...expected].some((name) => !actual.has(name))
    ) {
      context.addIssue({
        code: "custom",
        path: ["output_slots"],
        message: "output slots must exactly close the output contract",
      });
    }
    for (const [index, slot] of envelope.output_slots.entries()) {
      if (
        slot.tenant_id !== envelope.request.workspace_id ||
        slot.run_id !== envelope.request.run_id ||
        slot.app_id !== envelope.request.source_ref.app_id ||
        slot.environment !== envelope.request.source_ref.environment
      ) {
        context.addIssue({
          code: "custom",
          path: ["output_slots", index],
          message: "output slots must bind request scope and run",
        });
      }
    }
  });

export const materializedPythonOutputSchema = z.strictObject({
  name: z.string().min(1).max(63),
  type: pythonOutputTypeSchema,
  reference: artifactReferenceSchema,
  content_sha256: contentHashSchema,
  content_base64: z.string(),
  bytes: z.number().int().nonnegative(),
});

export const pythonSandboxTransportOutcomeSchema = z
  .strictObject({
    protocol_version: z.literal("data-agent-python-sandbox-ipc@2.0.0"),
    receipt: pythonSandboxReceiptSchema,
    outputs: z.array(materializedPythonOutputSchema).max(32),
    stdout: z.string(),
    stderr: z.string(),
  })
  .superRefine((outcome, context) => {
    if (outcome.receipt.status !== "SUCCEEDED" && outcome.outputs.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["outputs"],
        message: "failed execution has no outputs",
      });
    }
    if (
      outcome.receipt.status === "SUCCEEDED" &&
      (outcome.outputs.length !== outcome.receipt.output_refs.length ||
        outcome.outputs.some((output, index) => {
          const receiptReference = outcome.receipt.output_refs[index];
          return (
            !receiptReference ||
            artifactReferenceIdentity(output.reference) !==
              artifactReferenceIdentity(receiptReference) ||
            output.reference.content_hash !== output.content_sha256
          );
        }))
    ) {
      context.addIssue({
        code: "custom",
        path: ["outputs"],
        message: "successful outputs must exactly bind receipt references and content hashes",
      });
    }
  });

export type PythonExecutionEnvelopeV2 = z.infer<typeof pythonExecutionEnvelopeSchema>;
export type PythonSandboxTransportOutcomeV2 = z.infer<typeof pythonSandboxTransportOutcomeSchema>;

export async function computePythonExecutionAuthorizationHash(
  envelopeInput: PythonExecutionEnvelopeV2,
) {
  const envelope = pythonExecutionEnvelopeSchema.parse(envelopeInput);
  return sha256ContentHash({
    protocol_version: envelope.protocol_version,
    request: envelope.request,
    output_slots: envelope.output_slots,
  });
}
