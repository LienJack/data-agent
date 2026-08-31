import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  type SemanticContextAuthoritySnapshot,
  type SemanticContextCommitCommand,
  type SemanticContextCommitResult,
  type SemanticContextRequest,
  semanticContextAuthoritySnapshotSchema,
  verifySemanticContextAuthoritySnapshot,
  verifySemanticContextCommitCommand,
  verifySemanticContextCommitResult,
  verifySemanticContextRequest,
} from "@data-agent/contracts/context";
import type { PortResult } from "@data-agent/contracts/ports";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const failure = (code: string, message: string, retryable = false) => ({
  ok: false as const,
  error: { code, message, retryable },
});

function mapDatabaseFailure(error: unknown) {
  const marker =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : "";
  if (/^SEMANTIC_CONTEXT_[A-Z0-9_]+$/.test(marker)) {
    return failure(
      marker,
      "Semantic context authority rejected the request.",
      /STALE$/.test(marker),
    );
  }
  return null;
}

function sameScope(
  left: { readonly app_id: string; readonly tenant_id: string; readonly environment: string },
  right: { readonly app_id: string; readonly tenant_id: string; readonly environment: string },
) {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

function resultValue(rows: readonly Readonly<{ value?: unknown }>[]) {
  if (rows.length !== 1 || rows[0]?.value === undefined) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_CONTEXT_DATABASE_CONTRACT_INVALID",
      "Semantic context RPC returned no value.",
    );
  }
  return rows[0].value;
}

export function createPostgresSemanticContextRegistry(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
) {
  return Object.freeze({
    async loadAuthoritySnapshot(
      capabilityInput: unknown,
      requestInput: SemanticContextRequest,
    ): Promise<PortResult<SemanticContextAuthoritySnapshot>> {
      let request: SemanticContextRequest;
      try {
        request = await verifySemanticContextRequest(requestInput);
      } catch {
        return failure("SEMANTIC_CONTEXT_REQUEST_INVALID", "Semantic context request is invalid.");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "semantic_context.load_authority",
          correlation_id: request.request_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (!sameScope(request.scope, capability.scope)) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CONTEXT_SCOPE_MISMATCH",
              "Semantic context scope is denied.",
            );
          }
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.load_semantic_context_authority_snapshot($1::jsonb) as value",
            [request],
          );
          const parsed = semanticContextAuthoritySnapshotSchema.safeParse(resultValue(query.rows));
          if (!parsed.success || !sameScope(parsed.data.scope, request.scope)) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CONTEXT_DATABASE_CONTRACT_INVALID",
              "Semantic context snapshot was substituted.",
            );
          }
          try {
            const snapshot = await verifySemanticContextAuthoritySnapshot(parsed.data);
            if ("question" in request && snapshot.question !== request.question) {
              throw new TypeError("question");
            }
            const requestedTask =
              request.basis.consumer === "RUN" ? request.basis.provider_task_ref : undefined;
            if (
              (await sha256ContentHash(requestedTask ?? null)) !==
              (await sha256ContentHash(snapshot.conversation_intent?.task_ref ?? null))
            ) {
              throw new TypeError("conversation intent");
            }
            return snapshot;
          } catch {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CONTEXT_DATABASE_CONTRACT_INVALID",
              "Semantic context snapshot hash is invalid.",
            );
          }
        },
      );
    },

    async commit(
      capabilityInput: unknown,
      commandInput: SemanticContextCommitCommand,
    ): Promise<PortResult<SemanticContextCommitResult>> {
      let command: SemanticContextCommitCommand;
      try {
        command = await verifySemanticContextCommitCommand(commandInput);
      } catch {
        return failure("SEMANTIC_CONTEXT_COMMIT_INVALID", "Semantic context commit is invalid.");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "semantic_context.commit",
          correlation_id: command.request.request_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (!sameScope(command.request.scope, capability.scope)) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CONTEXT_SCOPE_MISMATCH",
              "Semantic context scope is denied.",
            );
          }
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_semantic_context_package($1::jsonb) as value",
            [command],
          );
          try {
            const result = await verifySemanticContextCommitResult(resultValue(query.rows));
            if (
              result.receipt.request_id !== command.request.request_id ||
              result.receipt.receipt_hash !== command.receipt.receipt_hash ||
              result.package.package_hash !== command.package.package_hash
            ) {
              throw new TypeError("substitution");
            }
            return result;
          } catch {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CONTEXT_DATABASE_CONTRACT_INVALID",
              "Semantic context commit result is invalid.",
            );
          }
        },
      );
    },
  });
}

export type PostgresSemanticContextRegistry = ReturnType<
  typeof createPostgresSemanticContextRegistry
>;
