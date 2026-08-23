import { type ArtifactReference, artifactReferenceIdentity } from "../artifacts/envelope.js";
import {
  type ContentHash,
  canonicalizeJson,
  deepFreeze,
  type PortResult,
  sha256ContentHash,
} from "../common/index.js";
import type {
  AppScope,
  CachePort,
  QueuePort,
  SandboxExecutionRequest,
  SandboxPort,
  SqlSandboxExecutionRequest,
  StoragePort,
  StoragePut,
} from "../ports/index.js";
import {
  computeSandboxExecutionReceiptHash,
  computeSandboxExecutionRequestHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  sandboxExecutionReceiptSchema,
  sandboxResultSchema,
} from "../ports/index.js";
import {
  type AuthoritativeSandboxExecutionReceipt,
  type AuthoritativeSandboxResult,
  authorizeSandboxExecutionReceipt,
  authorizeSandboxResult,
  computeExecutionGrantHash,
  computeSnapshotDescriptorHash,
  executeAuthorizedSandboxRequest,
  registerSandboxServerAuthority,
  type SandboxExecutionAuthorityStore,
  type SandboxExecutionCancelRequest,
  type SandboxExecutionClaim,
  type SandboxExecutionIdempotencyClaim,
  SandboxExecutionIdempotencyConflictError,
  type SandboxExecutionIdempotencyResolution,
  type SandboxExecutionImmutableIdentity,
  type SandboxExecutionOutcome,
  type SandboxExecutionRecoveryRequest,
  type SandboxServerAuthority,
  type SnapshotDescriptor,
} from "../ports/sandbox.js";
import { type Clock, ManualClock } from "./manual-clock.js";
import {
  PORT_CONFORMANCE_SANDBOX_PERMITS,
  type PortConformanceHarness,
} from "./port-conformance.js";

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
  readonly canonical_output: string;
}

interface SandboxInFlightExecution {
  readonly input_hash: ContentHash;
  readonly completion: Promise<string>;
}

function contentHashToUuid(contentHash: string): string {
  const hex = contentHash.slice("sha256:".length, "sha256:".length + 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * U5 三段式 Authority 的框架无关内存参考实现。
 *
 * 它证明 Claim/Lease/Fence/Cancel Epoch 语义，不模拟 Datasource 查询；公共
 * `InMemorySandboxPort.execute` 仍保留原有 `SandboxPort` 兼容行为。
 */
export class InMemorySandboxExecutionAuthorityStore implements SandboxExecutionAuthorityStore {
  private readonly claims = new Map<string, SandboxExecutionClaim>();
  private nextFence = 1;

  private key(identity: SandboxExecutionImmutableIdentity): string {
    return canonicalizeJson([
      scopeIdentifier(identity.scope),
      identity.run_id,
      identity.principal_id,
      identity.idempotency_key,
    ]);
  }

  private async issueClaim(
    identity: SandboxExecutionImmutableIdentity,
    requestedAt: string,
    attempt: number,
    cancelEpoch: number,
    snapshotDescriptor: SnapshotDescriptor,
  ) {
    const attemptHash = await sha256ContentHash([identity, attempt, this.nextFence]);
    const attemptId = contentHashToUuid(attemptHash);
    const leaseId = contentHashToUuid(
      await sha256ContentHash([identity.input_hash, attemptId, "lease"]),
    );
    const observedAt = new Date(requestedAt);
    const leaseExpiresAt = new Date(observedAt.getTime() + 30_000).toISOString();
    const fencingToken = this.nextFence;
    this.nextFence += 1;
    const grantDraft = {
      protocol_version: "sandbox-execution-grant@1.0.0" as const,
      identity,
      attempt_id: attemptId,
      attempt,
      fencing_token: fencingToken,
      lease_id: leaseId,
      lease_expires_at: leaseExpiresAt,
      cancel_epoch: cancelEpoch,
      snapshot_descriptor: snapshotDescriptor,
      fixture_manifest_hash: snapshotDescriptor.fixture_manifest_hash,
      budget: identity.budget,
      issued_at: requestedAt,
      grant_hash: identity.input_hash,
    };
    const grant = {
      ...grantDraft,
      grant_hash: await computeExecutionGrantHash(grantDraft),
    };
    const claim: SandboxExecutionClaim = deepFreeze({
      identity,
      state: "EXECUTING",
      attempt_id: attemptId,
      attempt,
      fencing_token: fencingToken,
      lease_id: leaseId,
      lease_expires_at: leaseExpiresAt,
      cancel_epoch: cancelEpoch,
      grant_cancel_epoch: cancelEpoch,
      cancel_requested_at: null,
      recovery_deadline: leaseExpiresAt,
      snapshot_descriptor: snapshotDescriptor,
      grant_hash: grant.grant_hash,
      result_ref: null,
      receipt_ref: null,
      terminal_reason_code: null,
      updated_at: requestedAt,
    });
    this.claims.set(this.key(identity), claim);
    return { claim, grant };
  }

  async createSnapshotDescriptor(
    identity: SandboxExecutionImmutableIdentity,
    requestedAt: string,
    intent: "CREATE" | "RESOLVE" = "CREATE",
  ): Promise<SnapshotDescriptor> {
    const descriptorDraft = {
      protocol_version: "postgresql-snapshot@1.0.0" as const,
      scope_hash: identity.scope_hash,
      run_id: identity.run_id,
      execution_id: identity.execution_id,
      principal_id: identity.principal_id,
      datasource_id: identity.datasource_id,
      datasource_fingerprint: `in-memory:${identity.datasource_id}`,
      schema_version: identity.schema_version,
      strategy: "CONTROLLED_REVISION" as const,
      intent,
      snapshot_token: "in-memory-controlled-revision@1.0.0",
      schema_manifest_hash: identity.input_hash,
      data_manifest_hash: identity.query_hash,
      fixture_manifest_hash: identity.parameters_hash,
      observed_at: requestedAt,
      replay_state: "REPLAYABLE" as const,
      descriptor_hash: identity.input_hash,
    };
    const snapshotDescriptor = {
      ...descriptorDraft,
      descriptor_hash: await computeSnapshotDescriptorHash(descriptorDraft),
    };
    return snapshotDescriptor;
  }

  async prepareExecution(input: {
    readonly identity: SandboxExecutionImmutableIdentity;
    readonly snapshot_descriptor: SnapshotDescriptor;
    readonly requested_at: string;
  }): Promise<unknown> {
    const existing = this.claims.get(this.key(input.identity));
    if (existing) {
      if (existing.identity.input_hash !== input.identity.input_hash) {
        return {
          schema_version: "sandbox-execution-authority-result@1.0.0",
          disposition: "IDEMPOTENCY_CONFLICT",
          reason_code: "SANDBOX_IDEMPOTENCY_CONFLICT",
          claim: existing,
          grant: null,
        };
      }
      return {
        schema_version: "sandbox-execution-authority-result@1.0.0",
        disposition: existing.state === "COMPLETED" ? "REPLAYED" : "IN_PROGRESS",
        reason_code:
          existing.state === "COMPLETED"
            ? "SANDBOX_EXECUTION_COMPLETED"
            : "SANDBOX_EXECUTION_IN_PROGRESS",
        claim: existing,
        grant: null,
      };
    }
    const issued = await this.issueClaim(
      input.identity,
      input.requested_at,
      1,
      0,
      input.snapshot_descriptor,
    );
    return {
      schema_version: "sandbox-execution-authority-result@1.0.0",
      disposition: "ACCEPTED",
      reason_code: "SANDBOX_EXECUTION_IN_PROGRESS",
      ...issued,
    };
  }

  private settle(
    identity: SandboxExecutionImmutableIdentity,
    outcome: SandboxExecutionOutcome,
  ): unknown {
    const claim = this.claims.get(this.key(identity));
    if (!claim) {
      return {
        schema_version: "sandbox-execution-authority-result@1.0.0",
        disposition: "REJECTED",
        reason_code: "SANDBOX_AUTHORITY_REJECTED",
        claim: null,
        grant: null,
      };
    }
    const lateCancel = claim.cancel_epoch > outcome.cancel_epoch_observed;
    const state = lateCancel ? "CANCELLED" : outcome.terminal;
    const reasonCode = lateCancel ? "SANDBOX_CANCELLED" : outcome.reason_code;
    const completedReferenceMaterial =
      state === "COMPLETED"
        ? {
            artifact_id: contentHashToUuid(outcome.outcome_checksum),
            app_id: identity.scope.app_id,
            tenant_id: identity.scope.tenant_id,
            environment: identity.scope.environment,
            run_id: identity.run_id,
            revision: 1,
            content_hash: outcome.outcome_checksum,
          }
        : null;
    const settled: SandboxExecutionClaim = deepFreeze({
      ...claim,
      state,
      lease_id: null,
      lease_expires_at: null,
      result_ref: completedReferenceMaterial
        ? {
            ...completedReferenceMaterial,
            artifact_type: "SandboxResult",
          }
        : null,
      receipt_ref: completedReferenceMaterial
        ? {
            ...completedReferenceMaterial,
            artifact_type: "SandboxExecutionReceipt",
          }
        : null,
      terminal_reason_code: reasonCode,
      updated_at: outcome.completed_at,
    });
    this.claims.set(this.key(identity), settled);
    return {
      schema_version: "sandbox-execution-authority-result@1.0.0",
      disposition: lateCancel
        ? "CANCEL_ACCEPTED"
        : outcome.terminal === "REPLAY_UNAVAILABLE"
          ? "REPLAY_UNAVAILABLE"
          : "ACCEPTED",
      reason_code: reasonCode,
      claim: settled,
      grant: null,
    };
  }

  finalizeExecution(input: {
    readonly identity: SandboxExecutionImmutableIdentity;
    readonly outcome: SandboxExecutionOutcome;
  }): Promise<unknown> {
    return Promise.resolve(this.settle(input.identity, input.outcome));
  }

  failExecution(input: {
    readonly identity: SandboxExecutionImmutableIdentity;
    readonly outcome: SandboxExecutionOutcome;
  }): Promise<unknown> {
    return Promise.resolve(this.settle(input.identity, input.outcome));
  }

  async cancelExecution(input: SandboxExecutionCancelRequest): Promise<unknown> {
    const claim = this.claims.get(this.key(input.identity));
    if (!claim) {
      return {
        schema_version: "sandbox-execution-authority-result@1.0.0",
        disposition: "REJECTED",
        reason_code: "SANDBOX_AUTHORITY_REJECTED",
        claim: null,
        grant: null,
      };
    }
    if (["COMPLETED", "FAILED", "CANCELLED", "REPLAY_UNAVAILABLE"].includes(claim.state)) {
      return {
        schema_version: "sandbox-execution-authority-result@1.0.0",
        disposition: "CANCEL_ALREADY_TERMINAL",
        reason_code: claim.terminal_reason_code ?? "SANDBOX_CANCELLED",
        claim,
        grant: null,
      };
    }
    const cancelled: SandboxExecutionClaim = deepFreeze({
      ...claim,
      state: "CANCEL_REQUESTED",
      cancel_epoch: claim.cancel_epoch + 1,
      cancel_requested_at: input.requested_at,
      updated_at: input.requested_at,
    });
    this.claims.set(this.key(input.identity), cancelled);
    return {
      schema_version: "sandbox-execution-authority-result@1.0.0",
      disposition: "CANCEL_ACCEPTED",
      reason_code: "SANDBOX_CANCELLED",
      claim: cancelled,
      grant: null,
    };
  }

  async recoverExecution(input: SandboxExecutionRecoveryRequest): Promise<unknown> {
    const claim = this.claims.get(this.key(input.identity));
    if (claim?.state !== "RECOVERY_PENDING") {
      return {
        schema_version: "sandbox-execution-authority-result@1.0.0",
        disposition: "REJECTED",
        reason_code: "SANDBOX_AUTHORITY_REJECTED",
        claim: claim ?? null,
        grant: null,
      };
    }
    const issued = await this.issueClaim(
      input.identity,
      input.requested_at,
      claim.attempt + 1,
      claim.cancel_epoch,
      await this.createSnapshotDescriptor(input.identity, input.requested_at, "RESOLVE"),
    );
    return {
      schema_version: "sandbox-execution-authority-result@1.0.0",
      disposition: "ACCEPTED",
      reason_code: "SANDBOX_EXECUTION_IN_PROGRESS",
      ...issued,
    };
  }

  resolveExecutionClaim(identity: SandboxExecutionImmutableIdentity): Promise<unknown | null> {
    return Promise.resolve(this.claims.get(this.key(identity)) ?? null);
  }

  /** Conformance fixture only: model an expired owner before recover. */
  markRecoveryPending(identity: SandboxExecutionImmutableIdentity, observedAt: string): void {
    const claim = this.claims.get(this.key(identity));
    if (!claim) {
      throw new TypeError("Recovery fixture 必须先 prepare Execution Claim。");
    }
    this.claims.set(
      this.key(identity),
      deepFreeze({
        ...claim,
        state: "RECOVERY_PENDING",
        updated_at: observedAt,
      }),
    );
  }
}

export class InMemorySandboxPort implements SandboxPort {
  private readonly executions = new Map<string, SandboxReplayRecord>();
  private readonly inFlightExecutions = new Map<string, SandboxInFlightExecution>();
  private readonly committedArtifacts = new Map<string, string>();
  private readonly authoritativeExecutionPermits = new Set<string>();
  private readonly authoritativeSqlArtifacts = new Set<string>();
  private readonly revokedExecutionPermits = new Set<string>();
  private readonly executionRecords = new Map<ContentHash, string>();
  private readonly authority: SandboxServerAuthority;
  private readonly pendingExecutionAuthorityRevocations = new Set<string>();
  private activeSqlTransactions = 0;
  private authorityEpoch = 0;
  readonly executionAuthority = new InMemorySandboxExecutionAuthorityStore();

  constructor(
    private readonly clock: Clock = new ManualClock(),
    private readonly options: {
      readonly snapshot_capability?: "REPLAYABLE" | "LIMITED" | "REPLAY_UNAVAILABLE";
      /**
       * 仅供并发契约测试控制真实 Operation 的进入点；回调位于幂等 Claim 之后。
       */
      readonly before_execution?: (request: SqlSandboxExecutionRequest) => Promise<void> | void;
    } = {},
  ) {
    this.authority = registerSandboxServerAuthority({
      identity: {
        authority_id: "00000000-0000-4000-8000-000000000901",
        principal_id: "in-memory-sandbox-authority",
        key_id: "in-memory-sandbox-key@1",
      },
      executionAuthority: this.executionAuthority,
      resolveSnapshotDescriptor: ({ identity, requested_at }) =>
        this.executionAuthority.createSnapshotDescriptor(identity, requested_at),
      resolveCommitted: (reference) => this.resolveCommitted(reference),
      verifyCommitted: (reference) => this.verifyCommitted(reference),
      resolveAuthoritativeExecutionPermit: (reference) =>
        this.resolveAuthoritativeExecutionPermit(reference),
      resolveAuthoritativeSqlArtifact: (reference) =>
        this.resolveAuthoritativeSqlArtifact(reference),
      revalidateExecutionAuthority: (input) => {
        const permitIdentity = artifactReferenceIdentity(input.execution_permit_ref);
        if (
          this.revokedExecutionPermits.has(permitIdentity) ||
          this.pendingExecutionAuthorityRevocations.has(permitIdentity)
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          effective_principal_id: input.effective_principal_id,
          policy_receipt_ref: input.policy_receipt_ref,
          revalidated_at: input.transaction_started_at,
          authority_epoch: this.authorityEpoch,
        });
      },
      assertAuthorityFence: async (input) => {
        const permitIdentity = artifactReferenceIdentity(input.execution_permit_ref);
        return (
          input.authority_epoch === this.authorityEpoch &&
          !this.revokedExecutionPermits.has(permitIdentity) &&
          !this.pendingExecutionAuthorityRevocations.has(permitIdentity)
        );
      },
      withSqlTransaction: async (operation) => {
        this.activeSqlTransactions += 1;
        try {
          return await operation();
        } finally {
          this.activeSqlTransactions -= 1;
          if (this.activeSqlTransactions === 0) {
            for (const identity of this.pendingExecutionAuthorityRevocations) {
              this.revokedExecutionPermits.add(identity);
              this.authorityEpoch += 1;
            }
            this.pendingExecutionAuthorityRevocations.clear();
          }
        }
      },
      claimOrLoadExecution: (claim, operation) => this.claimOrLoadExecution(claim, operation),
      resolveExecutionRecord: (inputHash) => this.resolveExecutionRecord(inputHash),
      verifyExactArtifactRevision: (reference, artifact) =>
        this.verifyExactArtifactRevision(reference, artifact),
      now: () => this.clock.now(),
    });
  }

  private async resolveCommitted(reference: ArtifactReference): Promise<unknown | null> {
    const canonicalArtifact = this.committedArtifacts.get(artifactReferenceIdentity(reference));
    return canonicalArtifact ? cloneCanonicalJson(canonicalArtifact) : null;
  }

  private async verifyCommitted(reference: ArtifactReference): Promise<boolean> {
    return this.committedArtifacts.has(artifactReferenceIdentity(reference));
  }

  private async verifyExactArtifactRevision(
    reference: ArtifactReference,
    artifact: unknown,
  ): Promise<boolean> {
    const committed = this.committedArtifacts.get(artifactReferenceIdentity(reference));
    return committed !== undefined && committed === canonicalizeJson(artifact);
  }

  private async resolveAuthoritativeExecutionPermit(
    reference: ArtifactReference,
  ): Promise<unknown | null> {
    if (!this.authoritativeExecutionPermits.has(artifactReferenceIdentity(reference))) {
      return null;
    }
    return this.resolveCommitted(reference);
  }

  private async resolveAuthoritativeSqlArtifact(
    reference: ArtifactReference,
  ): Promise<unknown | null> {
    if (!this.authoritativeSqlArtifacts.has(artifactReferenceIdentity(reference))) {
      return null;
    }
    return this.resolveCommitted(reference);
  }

  private async resolveExecutionRecord(inputHash: ContentHash): Promise<unknown | null> {
    const canonicalRecord = this.executionRecords.get(inputHash);
    return canonicalRecord ? cloneCanonicalJson(canonicalRecord) : null;
  }

  private async claimOrLoadExecution<T>(
    claim: SandboxExecutionIdempotencyClaim,
    operation: () => Promise<T>,
  ): Promise<SandboxExecutionIdempotencyResolution<T>> {
    const key = canonicalizeJson([
      scopeIdentifier(claim.scope),
      claim.principal_id,
      claim.idempotency_key,
    ]);
    const existing = this.executions.get(key);
    if (existing) {
      if (existing.input_hash !== claim.input_hash) {
        return {
          status: "CONFLICT",
          existing_input_hash: existing.input_hash,
        };
      }
      return {
        status: "REPLAYED",
        value: deepFreeze(cloneCanonicalJson(existing.canonical_output)) as T,
      };
    }

    const inFlight = this.inFlightExecutions.get(key);
    if (inFlight) {
      if (inFlight.input_hash !== claim.input_hash) {
        return {
          status: "CONFLICT",
          existing_input_hash: inFlight.input_hash,
        };
      }
      return {
        status: "REPLAYED",
        value: deepFreeze(cloneCanonicalJson(await inFlight.completion)) as T,
      };
    }

    // 先发布 Claim，再在下一 Microtask 进入真实 Operation，避免两个并发调用都越过检查。
    const completion = Promise.resolve()
      .then(operation)
      .then((value) => {
        const canonicalOutput = canonicalizeJson(value);
        this.executions.set(key, {
          input_hash: claim.input_hash,
          canonical_output: canonicalOutput,
        });
        return canonicalOutput;
      });
    const claimed: SandboxInFlightExecution = {
      input_hash: claim.input_hash,
      completion,
    };
    this.inFlightExecutions.set(key, claimed);
    try {
      return {
        status: "EXECUTED",
        value: deepFreeze(cloneCanonicalJson(await completion)) as T,
      };
    } finally {
      if (this.inFlightExecutions.get(key) === claimed) {
        this.inFlightExecutions.delete(key);
      }
    }
  }

  /**
   * 测试适配器的受控 Seed 入口。它只存在于 `@data-agent/contracts/testing`，
   * 不会把生产 Authority 注册器暴露到 contracts root。
   */
  commitAuthoritativeExecutionPermit(reference: ArtifactReference, permit: unknown): void {
    if (reference.artifact_type !== "ExecutionPermit") {
      throw new TypeError("In-Memory Sandbox 只能以 ExecutionPermit Reference 注册 Permit。");
    }
    const identity = artifactReferenceIdentity(reference);
    this.committedArtifacts.set(identity, canonicalizeJson(permit));
    this.authoritativeExecutionPermits.add(identity);
  }

  commitAuthoritativeSqlArtifact(reference: ArtifactReference, artifact: unknown): void {
    if (reference.artifact_type !== "SqlArtifact") {
      throw new TypeError("In-Memory Sandbox 只能以 SqlArtifact Reference 注册 SQL Artifact。");
    }
    const identity = artifactReferenceIdentity(reference);
    this.committedArtifacts.set(identity, canonicalizeJson(artifact));
    this.authoritativeSqlArtifacts.add(identity);
  }

  revokeExecutionAuthority(reference: ArtifactReference): void {
    if (reference.artifact_type !== "ExecutionPermit") {
      throw new TypeError("In-Memory Sandbox 只能撤销 ExecutionPermit Authority。");
    }
    const identity = artifactReferenceIdentity(reference);
    if (this.activeSqlTransactions > 0) {
      this.pendingExecutionAuthorityRevocations.add(identity);
      return;
    }
    this.authorityEpoch += 1;
    this.revokedExecutionPermits.add(identity);
  }

  authorizeResult(reference: ArtifactReference): Promise<AuthoritativeSandboxResult> {
    return authorizeSandboxResult(reference, this.authority);
  }

  authorizeExecutionReceipt(
    reference: ArtifactReference,
  ): Promise<AuthoritativeSandboxExecutionReceipt> {
    return authorizeSandboxExecutionReceipt(reference, this.authority);
  }

  private issueSnapshot(): {
    readonly snapshot_token: string | null;
    readonly watermark: string | null;
    readonly replay_state: "REPLAYABLE" | "LIMITED" | "REPLAY_UNAVAILABLE";
  } {
    switch (this.options.snapshot_capability ?? "REPLAYABLE") {
      case "REPLAYABLE":
        return {
          snapshot_token: "in-memory-snapshot@1.0.0",
          watermark: null,
          replay_state: "REPLAYABLE",
        };
      case "LIMITED":
        return {
          snapshot_token: null,
          watermark: "in-memory-watermark@1.0.0",
          replay_state: "LIMITED",
        };
      case "REPLAY_UNAVAILABLE":
        return {
          snapshot_token: null,
          watermark: null,
          replay_state: "REPLAY_UNAVAILABLE",
        };
    }
  }

  async execute(input: SandboxExecutionRequest): ReturnType<SandboxPort["execute"]> {
    try {
      return await executeAuthorizedSandboxRequest(
        input,
        this.authority,
        async (executionStart) => {
          const request = executionStart.request;
          const permit = executionStart.permit;
          const authorityRevalidation = executionStart.authority_revalidation;
          await this.options.before_execution?.(request);
          const inputHash = await computeSandboxExecutionRequestHash(request);

          const columns = [{ name: "result", type: "JSON" }] as const;
          const rows: [] = [];
          const resultDraft = {
            schema_version: request.schema_version,
            result_ref: {
              artifact_id: contentHashToUuid(inputHash),
              artifact_type: "SandboxResult",
              app_id: request.scope.app_id,
              tenant_id: request.scope.tenant_id,
              environment: request.scope.environment,
              run_id: request.run_id,
              revision: 1,
              content_hash: inputHash,
            },
            scope: request.scope,
            run_id: request.run_id,
            execution_id: request.execution_id,
            columns,
            rows,
            row_count: rows.length,
            bytes: computeSandboxResultBytes({ columns, rows }),
            result_hash: inputHash,
          } as const;
          const resultHash = await computeSandboxResultHash(resultDraft);
          const result = sandboxResultSchema.parse({
            ...resultDraft,
            result_ref: {
              ...resultDraft.result_ref,
              content_hash: resultHash,
            },
            result_hash: resultHash,
          });
          const resourceUsage = {
            elapsed_ms: 0,
            rows: result.row_count,
            bytes: result.bytes,
            peak_memory_mb: 0,
          };
          const receiptId = contentHashToUuid(inputHash);
          const observedAt = executionStart.transaction_started_at;
          const snapshot = this.issueSnapshot();
          if (
            (request.payload.snapshot_requirement.mode === "REQUIRE_REPLAYABLE" &&
              snapshot.replay_state !== "REPLAYABLE") ||
            (request.payload.snapshot_requirement.mode === "ALLOW_LIMITED" &&
              snapshot.replay_state === "REPLAY_UNAVAILABLE")
          ) {
            return failure(
              "SANDBOX_SNAPSHOT_REQUIREMENT_UNSATISFIED",
              "数据库 Snapshot 能力不能满足当前 Request 的最小重放要求。",
            );
          }
          const transaction = {
            transaction_id: receiptId,
            read_only: true,
            isolation_level:
              snapshot.replay_state === "REPLAYABLE" ? "REPEATABLE_READ" : "READ_COMMITTED",
          } as const;
          const receiptDraft = {
            schema_version: request.schema_version,
            language: "sql",
            executor: {
              authority_id: "00000000-0000-4000-8000-000000000901",
              principal_id: "in-memory-sandbox-authority",
              key_id: "in-memory-sandbox-key@1",
            },
            executor_role: "SANDBOX_EXECUTION",
            authority_role_policy_version: "authority_role_policy@1.0.0",
            receipt_id: receiptId,
            receipt_ref: {
              artifact_id: receiptId,
              artifact_type: "SandboxExecutionReceipt",
              app_id: request.scope.app_id,
              tenant_id: request.scope.tenant_id,
              environment: request.scope.environment,
              run_id: request.run_id,
              revision: 1,
              content_hash: inputHash,
            },
            scope: request.scope,
            run_id: request.run_id,
            execution_id: request.execution_id,
            idempotency_key: request.idempotency_key,
            input_hash: inputHash,
            execution_hash: inputHash,
            terminal: "COMPLETED",
            reason_code: "EXECUTION_COMPLETED",
            started_at: observedAt,
            completed_at: observedAt,
            result_artifact_ref: result.result_ref,
            sql_artifact_ref: permit.sql_artifact_ref,
            execution_permit_ref: request.payload.execution_permit_ref,
            resource_admission_ref: permit.resource_admission_ref,
            datasource_id: permit.datasource_id,
            settings_hash: permit.settings_hash,
            execution_settings: permit.execution_settings,
            transaction,
            authority_revalidation: authorityRevalidation,
            snapshot_token: snapshot.snapshot_token,
            watermark: snapshot.watermark,
            replay_state: snapshot.replay_state,
            resource_usage: resourceUsage,
          } as const;
          const executionHash = await computeSandboxExecutionReceiptHash(receiptDraft);
          const receipt = sandboxExecutionReceiptSchema.parse({
            ...receiptDraft,
            receipt_ref: {
              ...receiptDraft.receipt_ref,
              content_hash: executionHash,
            },
            execution_hash: executionHash,
          });
          this.committedArtifacts.set(
            artifactReferenceIdentity(result.result_ref),
            canonicalizeJson(result),
          );
          if (receipt.terminal !== "COMPLETED") {
            throw new TypeError("In-Memory Sandbox 成功路径必须生成 COMPLETED Receipt。");
          }
          this.committedArtifacts.set(
            artifactReferenceIdentity(receipt.receipt_ref),
            canonicalizeJson(receipt),
          );
          this.executionRecords.set(
            inputHash,
            canonicalizeJson({
              request,
              started_at: receipt.started_at,
              completed_at: receipt.completed_at,
              result_artifact_ref: result.result_ref,
              datasource_id: permit.datasource_id,
              schema_version: permit.schema_version,
              settings_hash: permit.settings_hash,
              applied_execution_settings: permit.execution_settings,
              transaction,
              authority_revalidation: authorityRevalidation,
              snapshot,
              resource_usage: resourceUsage,
            }),
          );
          return success(sandboxExecutionReceiptSchema.parse(receipt));
        },
      );
    } catch (error) {
      if (error instanceof SandboxExecutionIdempotencyConflictError) {
        return failure(error.code, error.message);
      }
      return failure(
        "SANDBOX_EXECUTION_NOT_AUTHORIZED",
        error instanceof Error ? error.message : "Sandbox Request 未通过服务端 Authority。",
      );
    }
  }
}

export interface InMemoryPortConformanceOptions {
  readonly initial_time?: Date | string | number;
  readonly lease_duration_ms?: number;
}

export async function createInMemoryPortConformanceHarness(
  options: InMemoryPortConformanceOptions = {},
): Promise<PortConformanceHarness> {
  const clock = new ManualClock(options.initial_time);
  const leaseDurationMs = options.lease_duration_ms ?? 30_000;
  const sandbox = new InMemorySandboxPort(clock);
  for (const { reference, permit } of PORT_CONFORMANCE_SANDBOX_PERMITS) {
    sandbox.commitAuthoritativeExecutionPermit(reference, permit);
    const sqlArtifact = {
      artifact_type: "SqlArtifact",
      logical_plan_ref: {
        ...permit.sql_artifact_ref,
        artifact_type: "LogicalPlan",
        content_hash: permit.sql_artifact_ref.content_hash,
      },
      compiler_version: "postgresql-compiler@1.1.0",
      ast_hash: permit.sql_artifact_ref.content_hash,
      dialect: "postgresql",
      sql: "select * from governed_result where region = $1 limit $2",
      parameters: {
        $1: "south",
        $2: 10,
      },
    } as const;
    sandbox.commitAuthoritativeSqlArtifact(permit.sql_artifact_ref, {
      ...sqlArtifact,
      query_hash: await sha256ContentHash({
        dialect: sqlArtifact.dialect,
        sql: sqlArtifact.sql,
        parameters: sqlArtifact.parameters,
      }),
    });
  }
  return {
    storage: new InMemoryStoragePort(),
    queue: new InMemoryQueuePort(clock, leaseDurationMs),
    cache: new InMemoryCachePort(clock),
    sandbox,
    lease_duration_ms: leaseDurationMs,
    now: () => clock.now(),
    advanceTimeBy: (milliseconds) => clock.advanceBy(milliseconds),
  };
}
