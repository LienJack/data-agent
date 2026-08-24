import { z } from "zod";
import {
  analysisProgramRefSchema,
  sandboxExecutionReceiptRefSchema,
  sandboxResultRefSchema,
} from "../artifacts/research/references.js";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
} from "../common/index.js";
import { analysisAgentFinalResponseSchema } from "./analysis-tools.js";
import { analysisResultStageArtifactSchema } from "./analysis-result-stage.js";

export const analysisAuthorityOutputBindingSchema = z.strictObject({
  stage_artifact: analysisResultStageArtifactSchema,
  reference: sandboxResultRefSchema,
});

const analysisAuthorityCommitMaterialSchema = z
  .strictObject({
    schema_version: z.literal("analysis-authority-commit@1.0.0"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    principal_id: immutableIdSchema,
    node_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    attempt_id: immutableIdSchema,
    worker_fence: z.number().int().positive(),
    idempotency_key: z.string().min(8).max(256),
    analysis_program_ref: analysisProgramRefSchema,
    stage_id: immutableIdSchema,
    stage_hash: contentHashSchema,
    closure_hash: contentHashSchema,
    operator_receipt_closure_hash: contentHashSchema,
    oracle_receipt_payload: z.unknown(),
    oracle_receipt_hash: contentHashSchema,
    explanation: analysisAgentFinalResponseSchema,
    explanation_hash: contentHashSchema,
    output_bindings: z.array(analysisAuthorityOutputBindingSchema).min(3).max(66),
    sandbox_receipt_ref: sandboxExecutionReceiptRefSchema,
    sandbox_receipt_payload: z.record(z.string(), z.unknown()),
    sandbox_receipt_hash: contentHashSchema,
    public_event_id: immutableIdSchema,
  })
  .superRefine((value, context) => {
    const resultCount = value.output_bindings.filter(
      ({ stage_artifact }) => stage_artifact.artifact_kind === "RESULT",
    ).length;
    const tableCount = value.output_bindings.filter(
      ({ stage_artifact }) => stage_artifact.artifact_kind === "TABLE",
    ).length;
    const chartCount = value.output_bindings.filter(
      ({ stage_artifact }) => stage_artifact.artifact_kind === "CHART",
    ).length;
    if (resultCount !== 1 || tableCount < 1 || chartCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["output_bindings"],
        message: "Authority commit requires one RESULT and at least one TABLE and CHART.",
      });
    }
    for (const [index, binding] of value.output_bindings.entries()) {
      const reference = binding.reference;
      if (
        reference.app_id !== value.scope.app_id ||
        reference.tenant_id !== value.scope.tenant_id ||
        reference.environment !== value.scope.environment ||
        reference.run_id !== value.run_id ||
        reference.content_hash !== binding.stage_artifact.content_sha256
      ) {
        context.addIssue({
          code: "custom",
          path: ["output_bindings", index],
          message: "Authority output reference must exactly bind its staged content.",
        });
      }
    }
    if (
      value.sandbox_receipt_ref.app_id !== value.scope.app_id ||
      value.sandbox_receipt_ref.tenant_id !== value.scope.tenant_id ||
      value.sandbox_receipt_ref.environment !== value.scope.environment ||
      value.sandbox_receipt_ref.run_id !== value.run_id ||
      value.sandbox_receipt_ref.content_hash !== value.sandbox_receipt_hash
    ) {
      context.addIssue({
        code: "custom",
        path: ["sandbox_receipt_ref"],
        message: "Sandbox receipt must close over scope, run and payload hash.",
      });
    }
  });

export const analysisAuthorityCommitSchema = analysisAuthorityCommitMaterialSchema.extend({
  authority_commit_hash: contentHashSchema,
});

export const analysisAuthorityCommitReceiptSchema = z.strictObject({
  schema_version: z.literal("analysis-authority-commit-receipt@1.0.0"),
  created: z.boolean(),
  authority_commit_hash: contentHashSchema,
  stage_id: immutableIdSchema,
  stage_hash: contentHashSchema,
  references: z.array(z.union([sandboxResultRefSchema, sandboxExecutionReceiptRefSchema])).min(4).max(67),
  public_event_id: immutableIdSchema,
});

export type AnalysisAuthorityCommit = z.infer<typeof analysisAuthorityCommitSchema>;
export type AnalysisAuthorityCommitReceipt = z.infer<
  typeof analysisAuthorityCommitReceiptSchema
>;

async function verifyMaterial(input: unknown) {
  const material = analysisAuthorityCommitMaterialSchema.parse(input);
  if ((await sha256ContentHash(material.oracle_receipt_payload)) !== material.oracle_receipt_hash) {
    throw new TypeError("ANALYSIS_AUTHORITY_ORACLE_RECEIPT_HASH_MISMATCH");
  }
  if ((await sha256ContentHash(material.explanation)) !== material.explanation_hash) {
    throw new TypeError("ANALYSIS_AUTHORITY_EXPLANATION_HASH_MISMATCH");
  }
  if (
    (await sha256ContentHash(material.sandbox_receipt_payload)) !== material.sandbox_receipt_hash
  ) {
    throw new TypeError("ANALYSIS_AUTHORITY_SANDBOX_RECEIPT_HASH_MISMATCH");
  }
  return material;
}

export async function buildAnalysisAuthorityCommit(
  input: z.input<typeof analysisAuthorityCommitMaterialSchema>,
): Promise<AnalysisAuthorityCommit> {
  const material = await verifyMaterial(input);
  return deepFreeze(
    analysisAuthorityCommitSchema.parse({
      ...material,
      authority_commit_hash: await sha256ContentHash({
        hash_domain: "analysis-authority-commit@1.0.0",
        value: material,
      }),
    }),
  );
}

export async function verifyAnalysisAuthorityCommit(
  input: unknown,
): Promise<AnalysisAuthorityCommit> {
  const command = analysisAuthorityCommitSchema.parse(input);
  const { authority_commit_hash: observedHash, ...materialInput } = command;
  const material = await verifyMaterial(materialInput);
  const expectedHash = await sha256ContentHash({
    hash_domain: "analysis-authority-commit@1.0.0",
    value: material,
  });
  if (observedHash !== expectedHash) {
    throw new TypeError("ANALYSIS_AUTHORITY_COMMIT_HASH_MISMATCH");
  }
  return deepFreeze(command);
}
