import type { AppScope, PortResult } from "../common/index.js";

export type { AppScope, ContractError, PortResult } from "../common/index.js";
export * from "./analysis-authority-commit.js";
export * from "./analysis-context-journal.js";
export * from "./analysis-oracle.js";
export * from "./analysis-result-publish.js";
export * from "./analysis-result-stage.js";
export * from "./analysis-sandbox.js";
export * from "./analysis-tools.js";
export * from "./benchmark-suite.js";
export * from "./embedding-provider.js";
export * from "./event-correlation.js";
export * from "./external-agent.js";
export * from "./governed-operator-result.js";
export * from "./model-provider.js";
export * from "./research-authority.js";
export {
  type AuthoritativeSandboxExecutionIdentity,
  type AuthoritativeSandboxExecutionReceipt,
  type AuthoritativeSandboxResult,
  computeOrderedSandboxSqlParametersHash,
  computeSandboxCanonicalMultisetHash,
  computeSandboxExecutionReceiptHash,
  computeSandboxExecutionRequestHash,
  computeSandboxOrderedResultHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  deriveOrderedSandboxSqlParameters,
  isAuthoritativeSandboxExecutionReceipt,
  isAuthoritativeSandboxResult,
  SANDBOX_RESULT_COLUMN_TYPES,
  SANDBOX_RESULT_LIMITS,
  type SandboxExecutionReceipt,
  SandboxExecutionReceiptAuthorityError,
  type SandboxExecutionRequest,
  SandboxExecutionRequestAuthorityError,
  type SandboxPort,
  type SandboxResult,
  SandboxResultAuthorityError,
  type SqlSandboxExecutionRequest,
  type SuccessfulSandboxExecutionReceipt,
  sandboxAuthorityRevalidationSchema,
  sandboxExecutionReceiptReferenceSchema,
  sandboxExecutionReceiptSchema,
  sandboxExecutionRequestSchema,
  sandboxOrderedSqlParametersSchema,
  sandboxResultColumnSchema,
  sandboxResultColumnTypeSchema,
  sandboxResultReferenceSchema,
  sandboxResultSchema,
  sandboxSnapshotBindingSchema,
  sandboxSnapshotRequirementSchema,
  sandboxSqlParametersSchema,
  successfulSandboxExecutionReceiptSchema,
} from "./sandbox.js";
export * from "./semantic/index.js";

export interface StoragePut {
  readonly scope: AppScope;
  readonly key: string;
  readonly content_hash: string;
  readonly value: unknown;
}

export interface StoragePort {
  put(input: StoragePut): Promise<PortResult<{ readonly created: boolean }>>;
  get(input: { readonly scope: AppScope; readonly key: string }): Promise<
    PortResult<{
      readonly content_hash: string;
      readonly value: unknown;
    } | null>
  >;
}

export interface QueuePort {
  enqueue(input: {
    readonly scope: AppScope;
    readonly command_id: string;
    readonly idempotency_key: string;
    readonly payload: unknown;
  }): Promise<
    PortResult<{
      readonly command_id: string;
      readonly created: boolean;
    }>
  >;
  lease(input: { readonly scope: AppScope; readonly worker_id: string }): Promise<
    PortResult<{
      readonly lease_id: string;
      readonly command_id: string;
      readonly fencing_token: number;
      readonly expires_at: string;
      readonly payload: unknown;
    } | null>
  >;
  ack(input: {
    readonly scope: AppScope;
    readonly lease_id: string;
    readonly fencing_token: number;
  }): Promise<PortResult<{ readonly acknowledged: true }>>;
}

export interface CachePort {
  readonly authority: "NON_AUTHORITATIVE";
  set(input: {
    readonly scope: AppScope;
    readonly key: string;
    readonly value: unknown;
    readonly ttl_seconds: number;
  }): Promise<PortResult<{ readonly stored: true }>>;
  get(input: {
    readonly scope: AppScope;
    readonly key: string;
  }): Promise<PortResult<unknown | null>>;
}
