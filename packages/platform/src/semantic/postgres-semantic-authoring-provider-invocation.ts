import {
  type AuthoritativeModelProviderInvocation,
  type ModelProviderEvent,
  type PortResult,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);

interface BooleanRow {
  readonly value: boolean;
}

type TerminalEvent = Extract<
  ModelProviderEvent,
  { event_type: "COMPLETED" | "FAILED" | "THROTTLED" }
>;

function oneBoolean(rows: readonly BooleanRow[]): boolean {
  if (rows.length !== 1 || rows[0]?.value !== true) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_PROVIDER_DATABASE_CONTRACT_INVALID",
      "Semantic authoring Provider RPC 返回无效结果。",
    );
  }
  return true;
}

function mapDatabaseError(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message.includes("LEASE_STALE") || message.includes("CONFLICT")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_PROVIDER_LEASE_STALE",
        message: "语义创作 Provider 调用不再持有有效 Writer Lease。",
        retryable: false,
      },
    };
  }
  if (message.includes("INVALID") || message.includes("MISMATCH")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_PROVIDER_AUTHORITY_MISMATCH",
        message: "语义创作 Provider 调用与已提交 intent 不一致。",
        retryable: false,
      },
    };
  }
  return null;
}

export interface PostgresSemanticAuthoringProviderInvocationOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: unknown;
  readonly semantic_domain: string;
}

export interface PostgresSemanticAuthoringProviderInvocation {
  commitIntent(request: AuthoritativeModelProviderInvocation): Promise<boolean>;
  markDispatched(request: AuthoritativeModelProviderInvocation): Promise<void>;
  markResponseObserved(input: {
    readonly request: AuthoritativeModelProviderInvocation;
    readonly event: TerminalEvent;
  }): Promise<void>;
  commitTerminal(input: {
    readonly request: AuthoritativeModelProviderInvocation;
    readonly event: TerminalEvent;
  }): Promise<void>;
}

export function createPostgresSemanticAuthoringProviderInvocation(
  options: PostgresSemanticAuthoringProviderInvocationOptions,
): PostgresSemanticAuthoringProviderInvocation {
  const semanticDomain = semanticDomainSchema.parse(options.semantic_domain);
  const transaction = async (
    operationName: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<void> => {
    const result = await withAppTransaction(
      options.pool,
      options.authorizer,
      options.capability,
      {
        access: "WRITE",
        operation_name: operationName,
        correlation_id: semanticDomain,
        map_database_error: mapDatabaseError,
      },
      async ({ capability, client }) => {
        await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
          semanticDomain,
        ]);
        const query = await client.query<BooleanRow>(sql, [
          capability.scope.app_id,
          capability.scope.tenant_id,
          capability.scope.environment,
          capability.principal,
          semanticDomain,
          ...values,
        ]);
        return oneBoolean(query.rows);
      },
    );
    if (!result.ok) {
      throw new PersistenceBoundaryError(result.error.code, result.error.message);
    }
  };

  const authority: PostgresSemanticAuthoringProviderInvocation = {
    async commitIntent(request) {
      const payloadHash = await sha256ContentHash(request);
      await transaction(
        "semantic.commit_authoring_provider_intent",
        `select semantic.commit_authoring_provider_intent(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::integer,
           $8::uuid,$9::uuid,$10::text,$11::jsonb
         ) as value`,
        [
          request.run_id,
          request.task_ref.revision,
          request.request_id,
          request.attempt_id,
          payloadHash,
          JSON.stringify({
            provider: request.provider,
            profile_id: request.profile_id,
            profile_version: request.profile_version,
            model_id: request.model_id,
          }),
        ],
      );
      return true;
    },

    async markDispatched(request) {
      await transaction(
        "semantic.mark_authoring_provider_dispatched",
        `select semantic.mark_authoring_provider_dispatched(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::integer,
           $8::uuid,$9::uuid
         ) as value`,
        [request.run_id, request.task_ref.revision, request.request_id, request.attempt_id],
      );
    },

    async markResponseObserved({ request, event }) {
      await transaction(
        "semantic.mark_authoring_provider_response_observed",
        `select semantic.mark_authoring_provider_response_observed(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::integer,
           $8::uuid,$9::uuid,$10::text,$11::text
         ) as value`,
        [
          request.run_id,
          request.task_ref.revision,
          request.request_id,
          request.attempt_id,
          event.event_type,
          event.event_type === "COMPLETED" ? event.response_hash : event.reason_code,
        ],
      );
    },

    async commitTerminal({ request, event }) {
      await transaction(
        "semantic.commit_authoring_provider_terminal",
        `select semantic.commit_authoring_provider_terminal(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::integer,
           $8::uuid,$9::uuid,$10::text,$11::jsonb
         ) as value`,
        [
          request.run_id,
          request.task_ref.revision,
          request.request_id,
          request.attempt_id,
          event.event_type,
          JSON.stringify(event),
        ],
      );
    },
  };
  return Object.freeze(authority);
}
