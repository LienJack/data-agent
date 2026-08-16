import {
  canonicalImmutableIdSchema,
  type PortResult,
  providerResponseArtifactReferenceSchema,
  runtimeIdentifierSchema,
  runWorkLeaseSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { type SqlPool, withAppTransaction } from "../persistence/transaction.js";
import type { AppCapability } from "../tenancy/capability.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

interface JsonValueRow {
  readonly value: unknown;
}

const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const smokeClaimInputSchema = z.strictObject({
  worker_id: runtimeIdentifierSchema,
  lease_duration_ms: z.number().int().min(5_000).max(900_000).safe(),
  expected_run_id: canonicalImmutableIdSchema,
  expected_command_id: canonicalImmutableIdSchema,
});

const zeroInvocationPreconditionSchema = z.strictObject({
  run_id: canonicalImmutableIdSchema,
  command_id: canonicalImmutableIdSchema,
  logical_invocation_id: canonicalImmutableIdSchema,
  intent_count: z.literal(0),
  permit_count: z.literal(0),
  marker_count: z.literal(0),
  outcome_count: z.literal(0),
  usage_count: z.literal(0),
  response_artifact_count: z.literal(0),
});

export const providerInvocationSmokeClaimSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-smoke-claim@1.0.0"),
    lease: runWorkLeaseSchema,
    precondition: zeroInvocationPreconditionSchema,
  })
  .superRefine((claim, context) => {
    if (
      claim.lease.run_id !== claim.precondition.run_id ||
      claim.lease.command_id !== claim.precondition.command_id ||
      claim.precondition.logical_invocation_id !== claim.precondition.command_id
    ) {
      context.addIssue({
        code: "custom",
        message: "Provider smoke claim 必须闭合 target lease 与零调用前置证据。",
      });
    }
  });

const smokeProofRequestSchema = z.strictObject({
  run_id: canonicalImmutableIdSchema,
  command_id: canonicalImmutableIdSchema,
  attempt_id: canonicalImmutableIdSchema,
  worker_fence: z.number().int().positive().safe(),
});

export const providerInvocationSmokeProofSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-smoke-proof@1.0.0"),
    run_id: canonicalImmutableIdSchema,
    command_id: canonicalImmutableIdSchema,
    logical_invocation_id: canonicalImmutableIdSchema,
    provider: z.literal("deepseek"),
    model_id: z.literal("deepseek-v4-flash"),
    intent_id: canonicalImmutableIdSchema,
    intent_hash: contentHashSchema,
    permit_id: canonicalImmutableIdSchema,
    permit_hash: contentHashSchema,
    marker_id: canonicalImmutableIdSchema,
    marker_hash: contentHashSchema,
    outcome_id: canonicalImmutableIdSchema,
    outcome_hash: contentHashSchema,
    outcome_status: z.literal("COMPLETED"),
    usage_receipt_id: canonicalImmutableIdSchema,
    usage_receipt_hash: contentHashSchema,
    usage_availability: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    provider_call_count: z.literal(1),
    response_artifact_ref: providerResponseArtifactReferenceSchema,
  })
  .superRefine((proof, context) => {
    if (
      proof.logical_invocation_id !== proof.command_id ||
      proof.response_artifact_ref.run_id !== proof.run_id
    ) {
      context.addIssue({
        code: "custom",
        message: "Provider smoke proof 必须闭合 logical invocation 与 protected response。",
      });
    }
  });

function failure(code: string, message: string, retryable = false): PortResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function mapFailure(error: unknown): PortResult<never> {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message.includes("PROVIDER_SMOKE_PROOF_NOT_READY")) {
    return failure("PROVIDER_SMOKE_PROOF_NOT_READY", "Provider smoke 终态证据尚未闭合。", true);
  }
  for (const marker of [
    "PROVIDER_SMOKE_CLAIM_CONFLICT",
    "PROVIDER_SMOKE_CLAIM_INVALID",
    "PROVIDER_SMOKE_JOB_ROLE_REQUIRED",
    "PROVIDER_SMOKE_PRECONDITION_NOT_EMPTY",
    "PROVIDER_SMOKE_PROOF_INVALID",
    "PROVIDER_INVOCATION_SMOKE_PROOF_INVALID",
  ] as const) {
    if (!message.includes(marker)) continue;
    return failure(marker, "Provider smoke 前后 Authority 证据不闭合。");
  }
  return failure(
    "PROVIDER_INVOCATION_SMOKE_DATABASE_ERROR",
    "Provider smoke job 数据库调用失败。",
    true,
  );
}

/** @internal Explicit-confirmation smoke adapter; pool must use the dedicated job role. */
export function createPostgresProviderInvocationSmokeJob(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
}) {
  return Object.freeze({
    async claim(
      claimInput: unknown,
    ): Promise<PortResult<z.infer<typeof providerInvocationSmokeClaimSchema> | null>> {
      const requested = smokeClaimInputSchema.safeParse(claimInput);
      if (!requested.success) {
        return failure(
          "PROVIDER_INVOCATION_SMOKE_INPUT_INVALID",
          "Provider smoke target claim 输入不符合严格合同。",
        );
      }
      return withAppTransaction(
        input.pool,
        input.authorizer,
        input.capability,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.smoke_claim",
          map_database_error: mapFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            `select app_data_agent.claim_provider_invocation_smoke_work(
               $1::text, $2::integer, $3::uuid, $4::uuid
             ) as value`,
            [
              requested.data.worker_id,
              requested.data.lease_duration_ms,
              requested.data.expected_run_id,
              requested.data.expected_command_id,
            ],
          );
          if (result.rows.length !== 1) throw new Error("PROVIDER_INVOCATION_SMOKE_CARDINALITY");
          const raw = result.rows[0]?.value;
          if (raw === null || raw === undefined) return null;
          const parsed = providerInvocationSmokeClaimSchema.safeParse(raw);
          if (!parsed.success) throw new Error("PROVIDER_INVOCATION_SMOKE_PROOF_INVALID");
          const claim = parsed.data;
          if (
            claim.lease.worker_id !== requested.data.worker_id ||
            claim.lease.run_id !== requested.data.expected_run_id ||
            claim.lease.command_id !== requested.data.expected_command_id
          ) {
            throw new Error("PROVIDER_INVOCATION_SMOKE_PROOF_INVALID");
          }
          return claim;
        },
      );
    },

    async verifyCompleted(
      proofInput: unknown,
    ): Promise<PortResult<z.infer<typeof providerInvocationSmokeProofSchema>>> {
      const requested = smokeProofRequestSchema.safeParse(proofInput);
      if (!requested.success) {
        return failure(
          "PROVIDER_INVOCATION_SMOKE_INPUT_INVALID",
          "Provider smoke completion proof 输入不符合严格合同。",
        );
      }
      return withAppTransaction(
        input.pool,
        input.authorizer,
        input.capability,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "provider_invocation.smoke_verify",
          map_database_error: mapFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            `select app_data_agent.verify_provider_invocation_smoke_completion(
               $1::uuid, $2::uuid, $3::uuid, $4::bigint
             ) as value`,
            [
              requested.data.run_id,
              requested.data.command_id,
              requested.data.attempt_id,
              requested.data.worker_fence,
            ],
          );
          if (result.rows.length !== 1) throw new Error("PROVIDER_INVOCATION_SMOKE_CARDINALITY");
          const parsed = providerInvocationSmokeProofSchema.safeParse(result.rows[0]?.value);
          if (!parsed.success) throw new Error("PROVIDER_INVOCATION_SMOKE_PROOF_INVALID");
          const proof = parsed.data;
          if (
            proof.run_id !== requested.data.run_id ||
            proof.command_id !== requested.data.command_id
          ) {
            throw new Error("PROVIDER_INVOCATION_SMOKE_PROOF_INVALID");
          }
          return proof;
        },
      );
    },
  });
}
