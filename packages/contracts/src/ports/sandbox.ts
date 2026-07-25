import { z } from "zod";
import {
  type ArtifactReferenceVerifier,
  artifactReferenceFor,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import type { PortResult } from "../common/primitives.js";

const sandboxBudgetSchema = z.strictObject({
  timeout_ms: z.number().int().positive().max(3_600_000),
  max_rows: z.number().int().nonnegative(),
  max_bytes: z.number().int().positive(),
  max_memory_mb: z.number().int().positive(),
});

const sandboxRequestBase = {
  schema_version: versionIdentifierSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  execution_id: immutableIdSchema,
  idempotency_key: z.string().min(1).max(256),
  budget: sandboxBudgetSchema,
} as const;

export const sandboxExecutionRequestSchema = z
  .discriminatedUnion("language", [
    z.strictObject({
      ...sandboxRequestBase,
      language: z.literal("sql"),
      payload: z.strictObject({
        dialect: z.literal("postgresql"),
        sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
        parameters: z.record(z.string(), z.json()),
      }),
    }),
    z.strictObject({
      ...sandboxRequestBase,
      language: z.literal("python"),
      payload: z.strictObject({
        runtime_profile_version: versionIdentifierSchema,
        program_ref: artifactReferenceFor("SandboxProgram"),
        input_refs: z.array(artifactReferenceSchema).max(64),
      }),
    }),
  ])
  .superRefine((request, ctx) => {
    const references =
      request.language === "sql"
        ? [request.payload.sql_artifact_ref]
        : [request.payload.program_ref, ...request.payload.input_refs];
    if (
      references.some(
        (reference) =>
          reference.app_id !== request.scope.app_id ||
          reference.tenant_id !== request.scope.tenant_id ||
          reference.environment !== request.scope.environment ||
          reference.run_id !== request.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Request 的 Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["payload"],
      });
    }
  });

const sandboxExecutionReceiptShape = {
  schema_version: versionIdentifierSchema,
  receipt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  execution_id: immutableIdSchema,
  idempotency_key: z.string().min(1).max(256),
  input_hash: contentHashSchema,
  execution_hash: contentHashSchema,
  terminal: z.enum(["COMPLETED", "POLICY_BLOCKED", "FAILED"]),
  reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  result_artifact_ref: artifactReferenceSchema.optional(),
  resource_usage: z.strictObject({
    elapsed_ms: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    peak_memory_mb: z.number().int().nonnegative(),
  }),
} as const;

const sandboxExecutionReceiptObjectSchema = z.strictObject(sandboxExecutionReceiptShape);

function validateSandboxExecutionReceiptScope(
  receipt: z.infer<typeof sandboxExecutionReceiptObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const reference = receipt.result_artifact_ref;
  if (
    reference &&
    (reference.app_id !== receipt.scope.app_id ||
      reference.tenant_id !== receipt.scope.tenant_id ||
      reference.environment !== receipt.scope.environment ||
      reference.run_id !== receipt.run_id)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Sandbox Result 必须与 Receipt 属于同一 App/Tenant/Environment/Run。",
      path: ["result_artifact_ref"],
    });
  }
}

export const sandboxExecutionReceiptSchema = sandboxExecutionReceiptObjectSchema.superRefine(
  validateSandboxExecutionReceiptScope,
);

export const successfulSandboxExecutionReceiptSchema = z
  .strictObject({
    ...sandboxExecutionReceiptShape,
    receipt_ref: artifactReferenceFor("SandboxExecutionReceipt"),
    terminal: z.literal("COMPLETED"),
    reason_code: z.literal("EXECUTION_COMPLETED"),
  })
  .superRefine((receipt, ctx) => {
    validateSandboxExecutionReceiptScope(receipt, ctx);
    if (
      receipt.receipt_ref.artifact_id !== receipt.receipt_id ||
      receipt.receipt_ref.app_id !== receipt.scope.app_id ||
      receipt.receipt_ref.tenant_id !== receipt.scope.tenant_id ||
      receipt.receipt_ref.environment !== receipt.scope.environment ||
      receipt.receipt_ref.run_id !== receipt.run_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Receipt Reference 必须完整指向当前成功 Receipt。",
        path: ["receipt_ref"],
      });
    }
  });

export type SandboxExecutionRequest = z.infer<typeof sandboxExecutionRequestSchema>;
export type SandboxExecutionReceipt = z.infer<typeof sandboxExecutionReceiptSchema>;
export type SuccessfulSandboxExecutionReceipt = z.infer<
  typeof successfulSandboxExecutionReceiptSchema
>;

export class SandboxExecutionReceiptAuthorityError extends Error {
  override readonly name = "SandboxExecutionReceiptAuthorityError";
  readonly code = "SANDBOX_EXECUTION_RECEIPT_NOT_AUTHORITATIVE";
}

declare const authoritativeSandboxExecutionReceipt: unique symbol;
const authorizedSandboxExecutionReceipts = new WeakSet<object>();

export type AuthoritativeSandboxExecutionReceipt = SuccessfulSandboxExecutionReceipt & {
  readonly [authoritativeSandboxExecutionReceipt]: true;
};

export async function authorizeSandboxExecutionReceipt(
  input: unknown,
  verifyCommitted: ArtifactReferenceVerifier,
): Promise<AuthoritativeSandboxExecutionReceipt> {
  const receipt = successfulSandboxExecutionReceiptSchema.parse(input);
  const references = [
    receipt.receipt_ref,
    ...(receipt.result_artifact_ref ? [receipt.result_artifact_ref] : []),
  ];
  const committed = await Promise.all(references.map(verifyCommitted));
  if (committed.some((verdict) => !verdict)) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 引用了未提交的权威 Artifact。",
    );
  }

  authorizedSandboxExecutionReceipts.add(receipt);
  return deepFreeze(receipt) as AuthoritativeSandboxExecutionReceipt;
}

export function isAuthoritativeSandboxExecutionReceipt(
  value: unknown,
): value is AuthoritativeSandboxExecutionReceipt {
  return (
    typeof value === "object" && value !== null && authorizedSandboxExecutionReceipts.has(value)
  );
}

export interface SandboxPort {
  execute(input: SandboxExecutionRequest): Promise<PortResult<SandboxExecutionReceipt>>;
}
