import {
  type PortResult,
  type ResolvedContextAuthoritySnapshot,
  type ResolvedContextCommitCommand,
  type ResolvedContextCommitResult,
  type ResolvedContextRequest,
  resolvedContextAuthoritySnapshotSchema,
  verifyResolvedContextAuthoritySnapshot,
  verifyResolvedContextCommitCommand,
  verifyResolvedContextCommitResult,
  verifyResolvedContextRequest,
} from "@data-agent/contracts";
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
  if (/^RESOLVED_CONTEXT_[A-Z0-9_]+$/.test(marker)) {
    return failure(
      marker,
      "Resolved context authority rejected the request.",
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
      "RESOLVED_CONTEXT_DATABASE_CONTRACT_INVALID",
      "Resolved context RPC returned no value.",
    );
  }
  return rows[0].value;
}

export function createPostgresResolvedContextRegistry(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
) {
  return Object.freeze({
    async loadAuthoritySnapshot(
      capabilityInput: unknown,
      requestInput: ResolvedContextRequest,
    ): Promise<PortResult<ResolvedContextAuthoritySnapshot>> {
      let request: ResolvedContextRequest;
      try {
        request = await verifyResolvedContextRequest(requestInput);
      } catch {
        return failure("RESOLVED_CONTEXT_REQUEST_INVALID", "Resolved context request is invalid.");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "resolved_context.load_authority",
          correlation_id: request.request_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (!sameScope(request.scope, capability.scope)) {
            throw new PersistenceBoundaryError(
              "RESOLVED_CONTEXT_SCOPE_MISMATCH",
              "Resolved context scope is denied.",
            );
          }
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.load_resolved_context_authority_snapshot($1::jsonb) as value",
            [request],
          );
          const parsed = resolvedContextAuthoritySnapshotSchema.safeParse(resultValue(query.rows));
          if (!parsed.success || !sameScope(parsed.data.scope, request.scope)) {
            throw new PersistenceBoundaryError(
              "RESOLVED_CONTEXT_DATABASE_CONTRACT_INVALID",
              "Resolved context snapshot was substituted.",
            );
          }
          try {
            const snapshot = await verifyResolvedContextAuthoritySnapshot(parsed.data);
            if ("question" in request && snapshot.question !== request.question) {
              throw new TypeError("question");
            }
            return snapshot;
          } catch {
            throw new PersistenceBoundaryError(
              "RESOLVED_CONTEXT_DATABASE_CONTRACT_INVALID",
              "Resolved context snapshot hash is invalid.",
            );
          }
        },
      );
    },

    async commit(
      capabilityInput: unknown,
      commandInput: ResolvedContextCommitCommand,
    ): Promise<PortResult<ResolvedContextCommitResult>> {
      let command: ResolvedContextCommitCommand;
      try {
        command = await verifyResolvedContextCommitCommand(commandInput);
      } catch {
        return failure("RESOLVED_CONTEXT_COMMIT_INVALID", "Resolved context commit is invalid.");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "resolved_context.commit",
          correlation_id: command.request.request_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (!sameScope(command.request.scope, capability.scope)) {
            throw new PersistenceBoundaryError(
              "RESOLVED_CONTEXT_SCOPE_MISMATCH",
              "Resolved context scope is denied.",
            );
          }
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_resolved_context_package($1::jsonb) as value",
            [command],
          );
          try {
            const result = await verifyResolvedContextCommitResult(resultValue(query.rows));
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
              "RESOLVED_CONTEXT_DATABASE_CONTRACT_INVALID",
              "Resolved context commit result is invalid.",
            );
          }
        },
      );
    },
  });
}

export type PostgresResolvedContextRegistry = ReturnType<
  typeof createPostgresResolvedContextRegistry
>;
