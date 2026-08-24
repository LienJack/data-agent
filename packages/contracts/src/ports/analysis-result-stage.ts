import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import { governedOperatorResultRefSchema } from "./governed-operator-result.js";
import { analysisOperatorFinalizationResultSchema } from "./analysis-tools.js";

const analysisStageProviderInvocationRefSchema = z.strictObject({
  resource_id: immutableIdSchema,
  resource_revision: z.literal(1),
  resource_hash: contentHashSchema,
});

export const analysisResultStageExecutionSnapshotSchema = z.strictObject({
  schema_version: z.literal("analysis-result-stage-execution-snapshot@1.0.0"),
  request_hash: contentHashSchema,
  runtime_profile: z.enum(["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]),
  runtime: z.strictObject({
    agent_image: z.string().min(1).max(1_024),
    operator_image: z.string().min(1).max(1_024),
    agent_sandbox_id: z.string().min(1).max(256),
    operator_sandbox_id: z.string().min(1).max(256),
    secure_access: z.boolean(),
  }),
  cells: z.array(z.strictObject({
    cell_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    source_sha256: contentHashSchema,
    source_ref: artifactReferenceSchema.nullable(),
    execution_id: z.string().max(256).nullable(),
    execution_count: z.number().int().nonnegative().nullable(),
    elapsed_ms: z.number().int().nonnegative(),
    status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]),
  })).max(32),
  provider_invocation_refs: z.array(analysisStageProviderInvocationRefSchema).max(32),
  started_at: timestampSchema,
  finished_at: timestampSchema,
  elapsed_ms: z.number().int().nonnegative(),
});

export const analysisResultStageArtifactSchema = z.strictObject({
  artifact_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  artifact_kind: z.enum(["RESULT", "TABLE", "CHART"]),
  media_type: z.literal("application/json"),
  content_sha256: contentHashSchema,
  bytes: z.number().int().nonnegative().max(64 * 1024 * 1024),
});

const analysisResultStageMaterialSchema = z
  .strictObject({
    schema_version: z.literal("analysis-result-stage-command@1.0.0"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    principal_id: immutableIdSchema,
    node_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    attempt_id: immutableIdSchema,
    context_generation: z.number().int().positive(),
    worker_fence: z.number().int().positive(),
    idempotency_key: z.string().min(8).max(256),
    stage_id: immutableIdSchema,
    publish_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    contract_hash: contentHashSchema,
    manifest_hash: contentHashSchema,
    closure_hash: contentHashSchema,
    analytical_value_hashes: z.array(z.strictObject({
      symbol_name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u),
      value_hash: contentHashSchema,
    })).max(65),
    governed_operator_results: z.array(governedOperatorResultRefSchema).max(64),
    operator_finalization: analysisOperatorFinalizationResultSchema,
    execution_snapshot: analysisResultStageExecutionSnapshotSchema,
    artifacts: z.array(analysisResultStageArtifactSchema).min(3).max(66),
    expires_at: z.string().datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    const resultCount = value.artifacts.filter(({ artifact_kind }) => artifact_kind === "RESULT").length;
    const tableCount = value.artifacts.filter(({ artifact_kind }) => artifact_kind === "TABLE").length;
    const chartCount = value.artifacts.filter(({ artifact_kind }) => artifact_kind === "CHART").length;
    if (resultCount !== 1 || tableCount < 1 || chartCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "A staged analysis requires one RESULT and at least one TABLE and CHART.",
      });
    }
    if (new Set(value.artifacts.map(({ artifact_name }) => artifact_name)).size !== value.artifacts.length) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "Staged artifact names must be unique.",
      });
    }
    for (const [index, result] of value.governed_operator_results.entries()) {
      if (
        result.scope.app_id !== value.scope.app_id ||
        result.scope.tenant_id !== value.scope.tenant_id ||
        result.scope.environment !== value.scope.environment ||
        result.run_id !== value.run_id ||
        result.node_id !== value.node_id ||
        result.attempt_id !== value.attempt_id ||
        result.worker_fence !== value.worker_fence
      ) {
        context.addIssue({
          code: "custom",
          path: ["governed_operator_results", index],
          message: "Governed results must close over the staged execution identity.",
        });
      }
    }
  });

export const analysisResultStageCommandSchema = analysisResultStageMaterialSchema.extend({
  stage_hash: contentHashSchema,
});

export const analysisResultStageSchema = z.strictObject({
  schema_version: z.literal("analysis-result-stage@1.0.0"),
  stage_id: immutableIdSchema,
  stage_hash: contentHashSchema,
  closure_hash: contentHashSchema,
  status: z.enum(["STAGED", "ORACLE_VERIFIED", "COMMITTED", "EXPIRED"]),
  created: z.boolean(),
  expires_at: z.string().datetime({ offset: true }),
});

export type AnalysisResultStageArtifact = z.infer<typeof analysisResultStageArtifactSchema>;
export type AnalysisResultStageCommand = z.infer<typeof analysisResultStageCommandSchema>;
export type AnalysisResultStage = z.infer<typeof analysisResultStageSchema>;
export type AnalysisResultStageExecutionSnapshot = z.infer<
  typeof analysisResultStageExecutionSnapshotSchema
>;

export async function buildAnalysisResultStageCommand(
  input: z.input<typeof analysisResultStageMaterialSchema>,
): Promise<AnalysisResultStageCommand> {
  const material = analysisResultStageMaterialSchema.parse(input);
  return deepFreeze(
    analysisResultStageCommandSchema.parse({
      ...material,
      stage_hash: await sha256ContentHash({
        hash_domain: "analysis-result-stage@1.0.0",
        value: material,
      }),
    }),
  );
}

export async function verifyAnalysisResultStageCommand(
  input: unknown,
): Promise<AnalysisResultStageCommand> {
  const command = analysisResultStageCommandSchema.parse(input);
  const { stage_hash: observedHash, ...material } = command;
  const expectedHash = await sha256ContentHash({
    hash_domain: "analysis-result-stage@1.0.0",
    value: analysisResultStageMaterialSchema.parse(material),
  });
  if (observedHash !== expectedHash) {
    throw new TypeError("ANALYSIS_RESULT_STAGE_HASH_MISMATCH");
  }
  return deepFreeze(command);
}
