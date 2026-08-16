import {
  canonicalImmutableIdSchema,
  contentHashSchema,
  type PortResult,
  recoverStaleProviderInvocationMarkerCommandSchema,
  recoverStaleProviderInvocationMarkerResultSchema,
  verifyRecoverStaleProviderInvocationMarkerResult,
} from "@data-agent/contracts";
import { z } from "zod";
import { type SqlPool, withAppTransaction } from "../persistence/transaction.js";
import type { AppCapability } from "../tenancy/capability.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

interface JsonValueRow {
  readonly value: unknown;
}

export const providerInvocationUnknownClassificationSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-unknown-classification@1.0.0"),
  invocation_id: canonicalImmutableIdSchema,
  intent_id: canonicalImmutableIdSchema,
  intent_hash: contentHashSchema,
  permit_id: canonicalImmutableIdSchema,
  permit_hash: contentHashSchema,
  outcome_id: canonicalImmutableIdSchema,
  outcome_hash: contentHashSchema,
  recovery_capability_used: z.literal("AT_LEAST_ONCE_ONLY"),
  recovery_action: z.literal("MANUAL_REVIEW_REQUIRED"),
  required_action: z.literal("MANUAL_REVIEW_REQUIRED"),
});

const markers = new Map<string, { readonly retryable: boolean; readonly message: string }>([
  [
    "PROVIDER_STALE_MARKER_RECOVERY_JOB_ROLE_REQUIRED",
    { retryable: false, message: "Stale marker recovery 只允许数据库 Job Authority。" },
  ],
  [
    "PROVIDER_STALE_MARKER_LEASE_STILL_ACTIVE",
    { retryable: true, message: "原 Worker Lease 仍有效，稍后再由 recovery job 检查。" },
  ],
  [
    "PROVIDER_INVOCATION_ALREADY_TERMINAL",
    { retryable: false, message: "Provider invocation 已有持久终态。" },
  ],
]);

for (const marker of [
  "PROVIDER_STALE_MARKER_RECOVERY_COMMAND_INVALID",
  "PROVIDER_STALE_MARKER_RECOVERY_CAPABILITY_INVALID",
  "PROVIDER_STALE_MARKER_RECOVERY_INTENT_INVALID",
  "PROVIDER_STALE_MARKER_RECOVERY_PERMIT_INVALID",
  "PROVIDER_STALE_MARKER_RECOVERY_MARKER_INVALID",
  "PROVIDER_STALE_MARKER_RECOVERY_CONFLICT",
  "PROVIDER_UNKNOWN_CLASSIFICATION_CLOSURE_INVALID",
  "PROVIDER_UNKNOWN_CLASSIFICATION_JOB_ROLE_REQUIRED",
] as const) {
  markers.set(marker, {
    retryable: false,
    message: "Stale marker recovery Authority 拒绝了无效或不一致的证据。",
  });
}

function failure(code: string, message: string, retryable = false): PortResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function mapFailure(error: unknown): PortResult<never> {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  for (const [marker, details] of markers) {
    if (message.includes(marker)) return failure(marker, details.message, details.retryable);
  }
  return failure(
    "PROVIDER_STALE_MARKER_RECOVERY_DATABASE_ERROR",
    "Stale marker recovery 数据库调用失败。",
    true,
  );
}

/**
 * @internal Job-only adapter. Its pool must connect as data_agent_job_authority;
 * ordinary AppCapability/Worker routes intentionally cannot call this port.
 */
export function createPostgresProviderStaleMarkerRecoveryJob(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
}) {
  return Object.freeze({
    async recover(commandInput: unknown): Promise<PortResult<unknown>> {
      const command = recoverStaleProviderInvocationMarkerCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return failure(
          "PROVIDER_STALE_MARKER_RECOVERY_COMMAND_INVALID",
          "Stale marker recovery command 不符合严格合同。",
        );
      }
      return withAppTransaction(
        input.pool,
        input.authorizer,
        input.capability,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.recover_stale_marker",
          map_database_error: mapFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.recover_stale_provider_invocation_marker($1::jsonb) as value",
            [command.data],
          );
          if (result.rows.length !== 1) throw new Error("PROVIDER_RECOVERY_RESULT_CARDINALITY");
          return verifyRecoverStaleProviderInvocationMarkerResult(
            command.data,
            result.rows[0]?.value,
          );
        },
      );
    },
    async recoverNext(): Promise<PortResult<unknown | null>> {
      return withAppTransaction(
        input.pool,
        input.authorizer,
        input.capability,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "provider_invocation.recover_next_stale_marker",
          map_database_error: mapFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.recover_next_stale_provider_invocation_marker() as value",
          );
          if (result.rows.length !== 1) throw new Error("PROVIDER_RECOVERY_RESULT_CARDINALITY");
          const raw = result.rows[0]?.value;
          if (raw === null || raw === undefined) return null;
          const parsed = recoverStaleProviderInvocationMarkerResultSchema.parse(raw);
          const usage = parsed.usage;
          const command = {
            schema_version: "provider-invocation-recover-stale-marker@1.0.0",
            actor: "STALE_MARKER_RECOVERY_JOB",
            recovery_id: parsed.recovery_receipt.recovery_id,
            intent: parsed.intent,
            permit: parsed.permit,
            marker: parsed.marker,
            recovery_capability_used: parsed.recovery_receipt.recovery_capability_used,
            recovery_resolution: "MARK_OUTCOME_UNKNOWN",
            outcome: parsed.outcome.candidate,
            usage: {
              schema_version: "provider-invocation-usage-candidate@1.0.0",
              availability: usage.availability,
              source: usage.source,
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              total_tokens: usage.total_tokens,
              tool_calls: usage.tool_calls,
              provider_call_count: usage.provider_call_count,
              capacity_status: usage.capacity_status,
              unavailable_reason: usage.unavailable_reason,
            },
          } as const;
          return verifyRecoverStaleProviderInvocationMarkerResult(command, parsed);
        },
      );
    },
    async discoverNextUnknown(): Promise<
      PortResult<z.infer<typeof providerInvocationUnknownClassificationSchema> | null>
    > {
      return withAppTransaction(
        input.pool,
        input.authorizer,
        input.capability,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "provider_invocation.discover_unknown",
          map_database_error: mapFailure,
        },
        async ({ client }) => {
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.discover_next_provider_invocation_unknown() as value",
          );
          if (result.rows.length !== 1) throw new Error("PROVIDER_RECOVERY_RESULT_CARDINALITY");
          const raw = result.rows[0]?.value;
          if (raw === null || raw === undefined) return null;
          const discovery = providerInvocationUnknownClassificationSchema.safeParse(raw);
          if (!discovery.success) {
            throw new Error("PROVIDER_INVOCATION_UNKNOWN_DISCOVERY_INVALID");
          }
          return discovery.data;
        },
      );
    },
  });
}
