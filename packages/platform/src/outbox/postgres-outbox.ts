import type { PortResult } from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const claimInputSchema = z.strictObject({
  worker_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
  lease_duration_ms: z.number().int().min(5_000).max(900_000).safe(),
});
const retryDelaySchema = z.number().int().nonnegative().safe();

export type OutboxLease = Readonly<{
  outbox_id: string;
  run_id: string;
  command_id: string;
  topic: string;
  payload: unknown;
  attempt_count: number;
  lease_owner: string;
  lease_token: string;
  lease_expires_at: string;
}>;

export interface OutboxSink {
  publish(input: {
    readonly idempotency_key: string;
    readonly topic: string;
    readonly payload: unknown;
    readonly attributes: Readonly<{
      outbox_id: string;
      run_id: string;
      command_id: string;
      lease_token: string;
    }>;
  }): Promise<void>;
}

interface OutboxLeaseRow {
  readonly outbox_id: string;
  readonly run_id: string;
  readonly command_id: string;
  readonly topic: string;
  readonly payload_json: unknown;
  readonly attempt_count: number;
  readonly lease_owner: string;
  readonly lease_token: string | number;
  readonly lease_expires_at: Date | string;
}

function outboxInputInvalid<T>(message: string): PortResult<T> {
  return {
    ok: false,
    error: {
      code: "OUTBOX_INPUT_INVALID",
      message,
      retryable: false,
    },
  };
}

function leaseFromRow(row: OutboxLeaseRow): OutboxLease {
  return Object.freeze({
    outbox_id: row.outbox_id,
    run_id: row.run_id,
    command_id: row.command_id,
    topic: row.topic,
    payload: row.payload_json,
    attempt_count: row.attempt_count,
    lease_owner: row.lease_owner,
    lease_token: String(row.lease_token),
    lease_expires_at:
      row.lease_expires_at instanceof Date
        ? row.lease_expires_at.toISOString()
        : new Date(row.lease_expires_at).toISOString(),
  });
}

export function createPostgresOutbox(pool: SqlPool, authorizer: TransactionalCapabilityAuthorizer) {
  const claim = async (
    capabilityInput: unknown,
    input: unknown,
  ): Promise<PortResult<OutboxLease | null>> => {
    const parsed = claimInputSchema.safeParse(input);
    if (!parsed.success) return outboxInputInvalid("Outbox Lease 参数不符合契约。");

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "WRITE" },
      async ({ client }) => {
        const result = await client.query<OutboxLeaseRow>(
          `select
             claimed.outbox_id,
             claimed.run_id,
             claimed.command_id,
             claimed.topic,
             claimed.payload_json,
             claimed.attempt_count,
             claimed.lease_owner,
             claimed.lease_token,
             claimed.lease_expires_at
           from app_data_agent.claim_outbox($1::text, 1, $2::integer) as claimed`,
          [parsed.data.worker_id, Math.ceil(parsed.data.lease_duration_ms / 1_000)],
        );
        return result.rows[0] ? leaseFromRow(result.rows[0]) : null;
      },
    );
  };

  const acknowledge = async (
    capabilityInput: unknown,
    lease: OutboxLease,
  ): Promise<PortResult<{ readonly published: true }>> =>
    withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "WRITE" },
      async ({ client }) => {
        const result = await client.query<{ readonly published: boolean }>(
          `select app_data_agent.publish_outbox(
             $1::uuid,
             $2::text,
             $3::bigint
           ) as published`,
          [lease.outbox_id, lease.lease_owner, lease.lease_token],
        );
        if (result.rows[0]?.published !== true) {
          throw new PersistenceBoundaryError(
            "OUTBOX_LEASE_STALE",
            "Outbox Lease 已过期或 Fence 不匹配，不能确认发布。",
          );
        }
        return { published: true as const };
      },
    );

  const releaseForRetry = async (
    capabilityInput: unknown,
    lease: OutboxLease,
    retryDelayMs: number,
  ): Promise<PortResult<{ readonly released: true }>> => {
    const parsedDelay = retryDelaySchema.safeParse(retryDelayMs);
    if (!parsedDelay.success) return outboxInputInvalid("Outbox Retry Delay 非法。");

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "WRITE" },
      async ({ client }) => {
        const result = await client.query<{ readonly released: boolean }>(
          `select app_data_agent.retry_outbox(
             $1::uuid,
             $2::text,
             $3::bigint,
             $4::bigint
           ) as released`,
          [lease.outbox_id, lease.lease_owner, lease.lease_token, parsedDelay.data],
        );
        if (result.rows[0]?.released !== true) {
          throw new PersistenceBoundaryError(
            "OUTBOX_LEASE_STALE",
            "Outbox Lease 已过期或 Fence 不匹配，不能安排重试。",
          );
        }
        return { released: true as const };
      },
    );
  };

  return {
    claim,
    acknowledge,
    releaseForRetry,
    async publishOne(
      capabilityInput: unknown,
      input: unknown,
      sink: OutboxSink,
      retryDelayMs = 1_000,
    ): Promise<
      PortResult<
        | { readonly state: "IDLE" }
        | { readonly state: "PUBLISHED"; readonly outbox_id: string }
        | { readonly state: "RETRY_SCHEDULED"; readonly outbox_id: string }
      >
    > {
      const leased = await claim(capabilityInput, input);
      if (!leased.ok) return leased;
      if (!leased.value) return { ok: true, value: { state: "IDLE" } };

      try {
        await sink.publish({
          idempotency_key: leased.value.outbox_id,
          topic: leased.value.topic,
          payload: leased.value.payload,
          attributes: {
            outbox_id: leased.value.outbox_id,
            run_id: leased.value.run_id,
            command_id: leased.value.command_id,
            lease_token: leased.value.lease_token,
          },
        });
      } catch {
        const released = await releaseForRetry(capabilityInput, leased.value, retryDelayMs);
        if (!released.ok) return released;
        return {
          ok: true,
          value: {
            state: "RETRY_SCHEDULED",
            outbox_id: leased.value.outbox_id,
          },
        };
      }

      const acknowledged = await acknowledge(capabilityInput, leased.value);
      if (!acknowledged.ok) return acknowledged;
      return {
        ok: true,
        value: {
          state: "PUBLISHED",
          outbox_id: leased.value.outbox_id,
        },
      };
    },
  };
}
