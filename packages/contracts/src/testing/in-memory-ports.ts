import {
  type ContentHash,
  canonicalizeJson,
  type PortResult,
  sha256ContentHash,
} from "../common/index.js";
import type {
  AppScope,
  CachePort,
  QueuePort,
  SandboxExecutionReceipt,
  SandboxExecutionRequest,
  SandboxPort,
  StoragePort,
  StoragePut,
} from "../ports/index.js";
import { sandboxExecutionReceiptSchema, sandboxExecutionRequestSchema } from "../ports/index.js";
import { type Clock, ManualClock } from "./manual-clock.js";
import type { PortConformanceHarness } from "./port-conformance.js";

function success<T>(value: T): PortResult<T> {
  return { ok: true, value };
}

function failure(code: string, message: string): PortResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: false,
    },
  };
}

function scopeIdentifier(scope: AppScope): string {
  return canonicalizeJson([scope.environment, scope.app_id, scope.tenant_id]);
}

function scopedKey(scope: AppScope, key: string): string {
  return canonicalizeJson([scopeIdentifier(scope), key]);
}

function cloneCanonicalJson(canonicalValue: string): unknown {
  const value: unknown = JSON.parse(canonicalValue);
  return value;
}

export class InMemoryStoragePort implements StoragePort {
  private readonly records = new Map<
    string,
    { readonly canonical_value: string; readonly content_hash: string }
  >();

  async put(input: StoragePut): ReturnType<StoragePort["put"]> {
    const key = scopedKey(input.scope, input.key);
    const existing = this.records.get(key);
    const canonicalValue = canonicalizeJson(input.value);
    if (
      existing &&
      (existing.content_hash !== input.content_hash || existing.canonical_value !== canonicalValue)
    ) {
      return failure(
        "STORAGE_CONTENT_CONFLICT",
        "同一个权威 Key 不能覆盖不同 Hash 或不同规范内容。",
      );
    }

    if (!existing) {
      this.records.set(key, {
        canonical_value: canonicalValue,
        content_hash: input.content_hash,
      });
    }
    return success({ created: !existing });
  }

  async get(input: Parameters<StoragePort["get"]>[0]): ReturnType<StoragePort["get"]> {
    const record = this.records.get(scopedKey(input.scope, input.key));
    if (!record) {
      return success(null);
    }
    return success({
      content_hash: record.content_hash,
      value: cloneCanonicalJson(record.canonical_value),
    });
  }
}

interface QueueCommandRecord {
  readonly command_id: string;
  readonly idempotency_key: string;
  readonly canonical_payload: string;
}

interface QueueLeaseRecord {
  readonly lease_id: string;
  readonly fencing_token: number;
  readonly idempotency_key: string;
  readonly expires_at_ms: number;
}

export class InMemoryQueuePort implements QueuePort {
  private readonly commands = new Map<string, Map<string, QueueCommandRecord>>();
  private readonly activeLeases = new Map<string, Map<string, QueueLeaseRecord>>();
  private nextFence = 0;

  constructor(
    private readonly clock: Clock,
    readonly leaseDurationMs: number,
  ) {
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 1) {
      throw new TypeError("Queue Lease 时长必须是大于 1 的安全整数毫秒。");
    }
  }

  async enqueue(input: Parameters<QueuePort["enqueue"]>[0]): ReturnType<QueuePort["enqueue"]> {
    const scopeKey = scopeIdentifier(input.scope);
    const scopedCommands = this.commands.get(scopeKey) ?? new Map<string, QueueCommandRecord>();
    const existing = scopedCommands.get(input.idempotency_key);
    const canonicalPayload = canonicalizeJson(input.payload);
    if (existing) {
      if (
        existing.command_id !== input.command_id ||
        existing.canonical_payload !== canonicalPayload
      ) {
        return failure(
          "QUEUE_IDEMPOTENCY_CONFLICT",
          "同一个 Queue Idempotency Key 不能绑定不同 Command ID 或规范 Payload。",
        );
      }
      return success({
        command_id: existing.command_id,
        created: false,
      });
    }

    scopedCommands.set(input.idempotency_key, {
      command_id: input.command_id,
      idempotency_key: input.idempotency_key,
      canonical_payload: canonicalPayload,
    });
    this.commands.set(scopeKey, scopedCommands);
    return success({
      command_id: input.command_id,
      created: true,
    });
  }

  async lease(input: Parameters<QueuePort["lease"]>[0]): ReturnType<QueuePort["lease"]> {
    const scopeKey = scopeIdentifier(input.scope);
    const scopedCommands = this.commands.get(scopeKey);
    if (!scopedCommands) {
      return success(null);
    }

    const now = this.clock.now().getTime();
    const scopedLeases = this.activeLeases.get(scopeKey) ?? new Map<string, QueueLeaseRecord>();
    for (const command of scopedCommands.values()) {
      const activeLease = scopedLeases.get(command.idempotency_key);
      if (activeLease && activeLease.expires_at_ms > now) {
        continue;
      }

      this.nextFence += 1;
      const lease: QueueLeaseRecord = {
        lease_id: `lease-${this.nextFence}`,
        fencing_token: this.nextFence,
        idempotency_key: command.idempotency_key,
        expires_at_ms: now + this.leaseDurationMs,
      };
      scopedLeases.set(command.idempotency_key, lease);
      this.activeLeases.set(scopeKey, scopedLeases);
      return success({
        lease_id: lease.lease_id,
        command_id: command.command_id,
        fencing_token: lease.fencing_token,
        expires_at: new Date(lease.expires_at_ms).toISOString(),
        payload: cloneCanonicalJson(command.canonical_payload),
      });
    }

    return success(null);
  }

  async ack(input: Parameters<QueuePort["ack"]>[0]): ReturnType<QueuePort["ack"]> {
    const scopeKey = scopeIdentifier(input.scope);
    const scopedLeases = this.activeLeases.get(scopeKey);
    let lease: QueueLeaseRecord | undefined;
    for (const candidate of scopedLeases?.values() ?? []) {
      if (candidate.fencing_token === input.fencing_token) {
        lease = candidate;
        break;
      }
    }
    if (!lease || lease.expires_at_ms <= this.clock.now().getTime()) {
      return failure("QUEUE_STALE_FENCE", "过期 Worker 不能确认 Lease。");
    }
    if (lease.lease_id !== input.lease_id) {
      return failure("QUEUE_LEASE_MISMATCH", "Lease ID 与当前活动 Lease 不匹配。");
    }

    this.commands.get(scopeKey)?.delete(lease.idempotency_key);
    scopedLeases?.delete(lease.idempotency_key);
    if (this.commands.get(scopeKey)?.size === 0) {
      this.commands.delete(scopeKey);
    }
    if (scopedLeases?.size === 0) {
      this.activeLeases.delete(scopeKey);
    }
    return success({ acknowledged: true as const });
  }
}

interface CacheRecord {
  readonly canonical_value: string;
  readonly expires_at_ms: number;
}

export class InMemoryCachePort implements CachePort {
  readonly authority = "NON_AUTHORITATIVE" as const;
  private readonly records = new Map<string, CacheRecord>();

  constructor(private readonly clock: Clock) {}

  async set(input: Parameters<CachePort["set"]>[0]): ReturnType<CachePort["set"]> {
    if (!Number.isFinite(input.ttl_seconds) || input.ttl_seconds <= 0) {
      return failure("CACHE_INVALID_TTL", "Cache TTL 必须大于零。");
    }
    this.records.set(scopedKey(input.scope, input.key), {
      canonical_value: canonicalizeJson(input.value),
      expires_at_ms: this.clock.now().getTime() + input.ttl_seconds * 1_000,
    });
    return success({ stored: true as const });
  }

  async get(input: Parameters<CachePort["get"]>[0]): ReturnType<CachePort["get"]> {
    const key = scopedKey(input.scope, input.key);
    const record = this.records.get(key);
    if (!record) {
      return success(null);
    }
    if (record.expires_at_ms <= this.clock.now().getTime()) {
      this.records.delete(key);
      return success(null);
    }
    return success(cloneCanonicalJson(record.canonical_value));
  }
}

interface SandboxReplayRecord {
  readonly input_hash: ContentHash;
  readonly receipt: SandboxExecutionReceipt;
}

function contentHashToUuid(contentHash: ContentHash): string {
  const hex = contentHash.slice("sha256:".length, "sha256:".length + 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export class InMemorySandboxPort implements SandboxPort {
  private readonly executions = new Map<string, SandboxReplayRecord>();

  async execute(input: SandboxExecutionRequest): ReturnType<SandboxPort["execute"]> {
    const request = sandboxExecutionRequestSchema.parse(input);
    const inputHash = await sha256ContentHash(request);
    const key = scopedKey(request.scope, request.idempotency_key);
    const existing = this.executions.get(key);
    if (existing) {
      if (existing.input_hash !== inputHash) {
        return failure(
          "SANDBOX_IDEMPOTENCY_CONFLICT",
          "同一个 Sandbox Idempotency Key 不能绑定不同规范输入。",
        );
      }
      return success(sandboxExecutionReceiptSchema.parse(existing.receipt));
    }

    const terminal = "COMPLETED" as const;
    const reasonCode = "EXECUTION_COMPLETED";
    const resourceUsage = {
      elapsed_ms: 0,
      rows: 0,
      bytes: 0,
      peak_memory_mb: 0,
    };
    const executionHash = await sha256ContentHash({
      input_hash: inputHash,
      terminal,
      reason_code: reasonCode,
      resource_usage: resourceUsage,
    });
    const receipt = sandboxExecutionReceiptSchema.parse({
      schema_version: request.schema_version,
      receipt_id: contentHashToUuid(executionHash),
      scope: request.scope,
      run_id: request.run_id,
      execution_id: request.execution_id,
      idempotency_key: request.idempotency_key,
      input_hash: inputHash,
      execution_hash: executionHash,
      terminal,
      reason_code: reasonCode,
      resource_usage: resourceUsage,
    });
    this.executions.set(key, {
      input_hash: inputHash,
      receipt,
    });
    return success(sandboxExecutionReceiptSchema.parse(receipt));
  }
}

export interface InMemoryPortConformanceOptions {
  readonly initial_time?: Date | string | number;
  readonly lease_duration_ms?: number;
}

export function createInMemoryPortConformanceHarness(
  options: InMemoryPortConformanceOptions = {},
): PortConformanceHarness {
  const clock = new ManualClock(options.initial_time);
  const leaseDurationMs = options.lease_duration_ms ?? 30_000;
  return {
    storage: new InMemoryStoragePort(),
    queue: new InMemoryQueuePort(clock, leaseDurationMs),
    cache: new InMemoryCachePort(clock),
    sandbox: new InMemorySandboxPort(),
    lease_duration_ms: leaseDurationMs,
    now: () => clock.now(),
    advanceTimeBy: (milliseconds) => clock.advanceBy(milliseconds),
  };
}
