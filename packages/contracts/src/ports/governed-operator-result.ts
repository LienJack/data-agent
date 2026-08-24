import { z } from "zod";
import {
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

export const governedResultShapeSummarySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("MAPPING"),
    keys: z.number().int().nonnegative().max(2_048),
    bounded_summary: z.string().max(1_024),
  }),
  z.strictObject({
    kind: z.literal("TABLE"),
    rows: z.number().int().nonnegative().max(100_000),
    columns: z.number().int().positive().max(256),
    bounded_summary: z.string().max(1_024),
  }),
]);

export const governedOperatorResultRefSchema = z
  .strictObject({
    schema_version: z.literal("governed-operator-result-ref@1.0.0"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    node_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    attempt_id: immutableIdSchema,
    context_generation: z.number().int().positive(),
    call_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    operator_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._@:-]{0,127}$/u),
    program_hash: contentHashSchema,
    request_sha256: contentHashSchema,
    result_artifact_ref: sandboxResultRefSchema,
    result_sha256: contentHashSchema,
    result_bytes: z.number().int().nonnegative().max(16 * 1024 * 1024),
    shape: governedResultShapeSummarySchema,
    receipt_ref: sandboxExecutionReceiptRefSchema,
    worker_fence: z.number().int().positive(),
  })
  .superRefine((value, context) => {
    for (const [path, reference] of [
      ["result_artifact_ref", value.result_artifact_ref],
      ["receipt_ref", value.receipt_ref],
    ] as const) {
      if (
        reference.app_id !== value.scope.app_id ||
        reference.tenant_id !== value.scope.tenant_id ||
        reference.environment !== value.scope.environment ||
        reference.run_id !== value.run_id
      ) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "Governed operator references must close over scope and run.",
        });
      }
    }
    if (value.result_artifact_ref.content_hash !== value.result_sha256) {
      context.addIssue({
        code: "custom",
        path: ["result_sha256"],
        message: "Governed operator result hash must equal the result artifact hash.",
      });
    }
  });

const governedOperatorResultCommitMaterialSchema = z.strictObject({
  schema_version: z.literal("governed-operator-result-commit@1.0.0"),
  principal_id: immutableIdSchema,
  result: governedOperatorResultRefSchema,
  idempotency_key: z.string().min(8).max(256),
  operator_registry_digest: contentHashSchema,
  result_receipt_payload: z.record(z.string(), z.unknown()),
  result_receipt_hash: contentHashSchema,
});

export const governedOperatorResultCommitSchema = governedOperatorResultCommitMaterialSchema.extend(
  { commit_hash: contentHashSchema },
);

export type GovernedResultShapeSummary = z.infer<typeof governedResultShapeSummarySchema>;
export type GovernedOperatorResultRef = z.infer<typeof governedOperatorResultRefSchema>;
export type GovernedOperatorResultCommit = z.infer<typeof governedOperatorResultCommitSchema>;

async function verifyMaterial(input: unknown) {
  const material = governedOperatorResultCommitMaterialSchema.parse(input);
  if ((await sha256ContentHash(material.result_receipt_payload)) !== material.result_receipt_hash) {
    throw new TypeError("GOVERNED_OPERATOR_RESULT_RECEIPT_HASH_MISMATCH");
  }
  if (material.result.receipt_ref.content_hash !== material.result_receipt_hash) {
    throw new TypeError("GOVERNED_OPERATOR_RESULT_RECEIPT_REFERENCE_MISMATCH");
  }
  return material;
}

export async function buildGovernedOperatorResultCommit(
  input: z.input<typeof governedOperatorResultCommitMaterialSchema>,
): Promise<GovernedOperatorResultCommit> {
  const material = await verifyMaterial(input);
  return deepFreeze(
    governedOperatorResultCommitSchema.parse({
      ...material,
      commit_hash: await sha256ContentHash({
        hash_domain: "governed-operator-result-commit@1.0.0",
        value: material,
      }),
    }),
  );
}

export async function verifyGovernedOperatorResultCommit(
  input: unknown,
): Promise<GovernedOperatorResultCommit> {
  const command = governedOperatorResultCommitSchema.parse(input);
  const { commit_hash: observedHash, ...materialInput } = command;
  const material = await verifyMaterial(materialInput);
  const expectedHash = await sha256ContentHash({
    hash_domain: "governed-operator-result-commit@1.0.0",
    value: material,
  });
  if (observedHash !== expectedHash) {
    throw new TypeError("GOVERNED_OPERATOR_RESULT_COMMIT_HASH_MISMATCH");
  }
  return deepFreeze(command);
}
