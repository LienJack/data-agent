import { z } from "zod";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import { contentHashSchema, immutableIdSchema, sha256ContentHash, timestampSchema } from "../common/index.js";

export const pythonExecutionFailureCodeSchema = z.enum([
  "PYTHON_POLICY_REJECTED",
  "PYTHON_TIMEOUT",
  "PYTHON_RESOURCE_LIMIT",
  "PYTHON_CANCELLED",
  "PYTHON_ERROR",
  "PYTHON_OUTPUT_INVALID",
  "PYTHON_SANDBOX_UNAVAILABLE",
]);

export const pythonOutputTypeSchema = z.enum([
  "ARROW",
  "CSV",
  "JSON",
  "MARKDOWN",
  "VEGA_LITE",
  "PNG",
]);

export const pythonOutputSpecSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u),
  type: pythonOutputTypeSchema,
  required: z.boolean(),
  max_bytes: z.number().int().positive().max(67_108_864),
});

export const pythonOutputContractSchema = z.strictObject({
  schema_version: z.literal("python-output-contract@1.0.0"),
  outputs: z.array(pythonOutputSpecSchema).min(1).max(32),
}).superRefine((contract, context) => {
  const names = new Set<string>();
  for (const [index, output] of contract.outputs.entries()) {
    if (names.has(output.name)) {
      context.addIssue({ code: "custom", path: ["outputs", index, "name"], message: "output names must be unique" });
    }
    names.add(output.name);
  }
});

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

export const pythonExecutionRequestSchema = z.strictObject({
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
  runtime_digest: contentHashSchema,
  dependency_lock_digest: contentHashSchema,
  policy_version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/u),
  budgets: pythonExecutionBudgetsSchema,
}).superRefine((request, context) => {
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
    context.addIssue({ code: "custom", path: ["source_sha256"], message: "source hash must bind source_ref" });
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

export const pythonSandboxReceiptSchema = z.strictObject({
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
}).superRefine((receipt, context) => {
  if ((receipt.status === "SUCCEEDED") !== (receipt.failure_code === null)) {
    context.addIssue({ code: "custom", path: ["failure_code"], message: "only success has no failure code" });
  }
  if (receipt.status === "CANCELLED" && receipt.failure_code !== "PYTHON_CANCELLED") {
    context.addIssue({ code: "custom", path: ["failure_code"], message: "cancelled receipt requires PYTHON_CANCELLED" });
  }
  if (receipt.status !== "SUCCEEDED" && receipt.output_refs.length > 0) {
    context.addIssue({ code: "custom", path: ["output_refs"], message: "failed executions cannot commit outputs" });
  }
  for (const reference of [...receipt.output_refs, receipt.stdout_ref, receipt.stderr_ref].filter(Boolean)) {
    if (reference?.tenant_id !== receipt.workspace_id || reference.run_id !== receipt.run_id) {
      context.addIssue({ code: "custom", path: ["output_refs"], message: "receipt references must bind workspace and run" });
    }
  }
});

export type PythonExecutionFailureCode = z.infer<typeof pythonExecutionFailureCodeSchema>;
export type PythonOutputContractV1 = z.infer<typeof pythonOutputContractSchema>;
export type PythonExecutionBudgetsV1 = z.infer<typeof pythonExecutionBudgetsSchema>;
export type PythonExecutionRequestV1 = z.infer<typeof pythonExecutionRequestSchema>;
export type PythonSandboxReceiptV1 = z.infer<typeof pythonSandboxReceiptSchema>;

export const materializedPythonInputSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u),
  format: z.enum(["ARROW", "CSV", "JSON"]),
  reference: artifactReferenceSchema,
  content_base64: z.string().min(1),
});

export const pythonOutputReferenceBindingSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u),
  reference: artifactReferenceSchema,
});

export const pythonExecutionEnvelopeSchema = z.strictObject({
  protocol_version: z.literal("data-agent-python-sandbox-ipc@1.0.0"),
  authorization: z.string().min(32).max(512),
  request: pythonExecutionRequestSchema,
  source_code_base64: z.string().min(1),
  inputs: z.array(materializedPythonInputSchema).max(64),
  output_references: z.array(pythonOutputReferenceBindingSchema).max(32),
}).superRefine((envelope, context) => {
  const materialized = envelope.inputs.map(({ reference }) => reference);
  if (JSON.stringify(materialized) !== JSON.stringify(envelope.request.input_refs)) {
    context.addIssue({ code: "custom", path: ["inputs"], message: "inputs must exactly bind input_refs" });
  }
  const expected = new Set(envelope.request.output_contract.outputs.map(({ name }) => name));
  const actual = new Set(envelope.output_references.map(({ name }) => name));
  if (expected.size !== actual.size || [...expected].some((name) => !actual.has(name))) {
    context.addIssue({
      code: "custom",
      path: ["output_references"],
      message: "output references must exactly close the output contract",
    });
  }
});

export const materializedPythonOutputSchema = z.strictObject({
  name: z.string().min(1).max(63),
  type: pythonOutputTypeSchema,
  content_sha256: contentHashSchema,
  content_base64: z.string(),
  bytes: z.number().int().nonnegative(),
});

export const pythonSandboxTransportOutcomeSchema = z.strictObject({
  protocol_version: z.literal("data-agent-python-sandbox-ipc@1.0.0"),
  receipt: pythonSandboxReceiptSchema,
  outputs: z.array(materializedPythonOutputSchema).max(32),
  stdout: z.string(),
  stderr: z.string(),
}).superRefine((outcome, context) => {
  if (outcome.receipt.status !== "SUCCEEDED" && outcome.outputs.length > 0) {
    context.addIssue({ code: "custom", path: ["outputs"], message: "failed execution has no outputs" });
  }
});

export type PythonExecutionEnvelopeV1 = z.infer<typeof pythonExecutionEnvelopeSchema>;
export type PythonSandboxTransportOutcomeV1 = z.infer<typeof pythonSandboxTransportOutcomeSchema>;

export async function computePythonExecutionRequestHash(request: PythonExecutionRequestV1) {
  return sha256ContentHash(pythonExecutionRequestSchema.parse(request));
}
