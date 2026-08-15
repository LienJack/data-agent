import {
  type PortResult,
  type SemanticAuthoringBeginTurnInput,
  type SemanticAuthoringCommitToolInput,
  type SemanticAuthoringCommitTurnInput,
  type SemanticAuthoringCompleteInput,
  type SemanticAuthoringPublicEvent,
  type SemanticAuthoringResumeInput,
  type SemanticAuthoringStartInput,
  type SemanticAuthoringState,
  type SemanticAuthoringStorePort,
  type SemanticAuthoringToolReceipt,
  semanticAuthoringPublicEventSchema,
  semanticAuthoringStartInputSchema,
  semanticAuthoringStateSchema,
  semanticAuthoringToolReceiptSchema,
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

interface JsonValueRow {
  readonly value: unknown;
}

function oneValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_AUTHORING_DATABASE_CONTRACT_INVALID",
      "Semantic authoring RPC 返回了无效行数。",
    );
  }
  return rows[0]?.value;
}

function parseValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_AUTHORING_DATABASE_CONTRACT_INVALID",
      "Semantic authoring RPC 返回了无效契约。",
      false,
    );
  }
  return parsed.data;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message.includes("SCOPE_FORBIDDEN") || message.includes("PERMISSION")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_AUTHORING_PERMISSION_DENIED",
        message: "当前 Authority 不允许访问该语义创作任务。",
        retryable: false,
      },
    };
  }
  if (message.includes("CONFLICT") || message.includes("STALE")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_AUTHORING_CONFLICT",
        message: "语义创作状态已变化，请从最新 checkpoint 恢复。",
        retryable: true,
      },
    };
  }
  if (message.includes("NOT_FOUND") || message.includes("NOT_DRAFT")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_AUTHORING_NOT_FOUND",
        message: "语义创作任务、候选或基线不存在。",
        retryable: false,
      },
    };
  }
  if (message.includes("INVALID") || message.includes("MISMATCH")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_AUTHORING_INVALID",
        message: "语义创作请求不符合权威持久化契约。",
        retryable: false,
      },
    };
  }
  return null;
}

export interface PostgresSemanticAuthoringStoreOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: unknown;
  readonly semantic_domain: string;
}

export function createPostgresSemanticAuthoringStore(
  options: PostgresSemanticAuthoringStoreOptions,
): SemanticAuthoringStorePort {
  const semanticDomain = semanticDomainSchema.parse(options.semantic_domain);
  const transaction = async <T>(
    access: "READ" | "WRITE",
    operationName: string,
    work: Parameters<typeof withAppTransaction<T>>[4],
  ): Promise<PortResult<T>> =>
    withAppTransaction(
      options.pool,
      options.authorizer,
      options.capability,
      {
        access,
        operation_name: operationName,
        correlation_id: semanticDomain,
        map_database_error: databaseFailure,
      },
      async (context) => {
        await context.client.query(
          "select pg_catalog.set_config('app.semantic_domain', $1, true)",
          [semanticDomain],
        );
        return work(context);
      },
    );

  const stateResult = async (
    operationName: string,
    values: readonly unknown[],
    sql: string,
  ): Promise<PortResult<SemanticAuthoringState>> =>
    transaction("WRITE", operationName, async ({ capability, client }) => {
      const result = await client.query<JsonValueRow>(sql, [
        capability.scope.app_id,
        capability.scope.tenant_id,
        capability.scope.environment,
        capability.principal,
        semanticDomain,
        ...values,
      ]);
      return parseValue(semanticAuthoringStateSchema, oneValue(result.rows));
    });

  return {
    async start(input: SemanticAuthoringStartInput) {
      const parsed = semanticAuthoringStartInputSchema.parse(input);
      if (parsed.semantic_domain !== semanticDomain) {
        return {
          ok: false,
          error: {
            code: "SEMANTIC_AUTHORING_DOMAIN_MISMATCH",
            message: "Start input 与绑定的 semantic domain 不一致。",
            retryable: false,
          },
        };
      }
      return stateResult(
        "semantic.start_semantic_studio_authoring",
        [parsed],
        `select semantic.start_semantic_studio_authoring(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::jsonb
         ) as value`,
      );
    },

    async load(input) {
      if (input.semantic_domain !== semanticDomain) {
        return {
          ok: false,
          error: {
            code: "SEMANTIC_AUTHORING_DOMAIN_MISMATCH",
            message: "Load input 与绑定的 semantic domain 不一致。",
            retryable: false,
          },
        };
      }
      return transaction(
        "READ",
        "semantic.get_semantic_authoring",
        async ({ capability, client }) => {
          if (
            input.scope.app_id !== capability.scope.app_id ||
            input.scope.tenant_id !== capability.scope.tenant_id ||
            input.scope.environment !== capability.scope.environment
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_AUTHORING_SCOPE_MISMATCH",
              "Load input Scope 与 Authority 不一致。",
            );
          }
          const result = await client.query<JsonValueRow>(
            `select semantic.get_semantic_authoring(
             $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid
           ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              input.authoring_run_id,
            ],
          );
          const value = oneValue(result.rows);
          return value === null ? null : parseValue(semanticAuthoringStateSchema, value);
        },
      );
    },

    async beginTurn(input: SemanticAuthoringBeginTurnInput) {
      return stateResult(
        "semantic.begin_semantic_authoring_turn",
        [
          input.authoring_run_id,
          input.expected_writer_fence,
          input.expected_turn,
          input.request_digest,
          input.checkpoint,
          JSON.stringify(input.events),
        ],
        `select semantic.begin_semantic_authoring_turn(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,
           $7::bigint,$8::integer,$9::text,$10::jsonb,$11::jsonb
         ) as value`,
      );
    },

    async commitTurn(input: SemanticAuthoringCommitTurnInput) {
      return stateResult(
        "semantic.commit_semantic_authoring_turn",
        [
          input.authoring_run_id,
          input.expected_writer_fence,
          input.expected_turn,
          input.request_digest,
          input.response_digest,
          input.checkpoint,
          JSON.stringify(input.events),
        ],
        `select semantic.commit_semantic_authoring_turn(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,
           $7::bigint,$8::integer,$9::text,$10::text,$11::jsonb,$12::jsonb
         ) as value`,
      );
    },

    async findToolReceipt(input) {
      return transaction(
        "READ",
        "semantic.get_semantic_authoring_tool_receipt",
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.get_semantic_authoring_tool_receipt(
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::text
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              input.authoring_run_id,
              input.tool_call_id,
            ],
          );
          const value = oneValue(result.rows);
          return value === null ? null : parseValue(semanticAuthoringToolReceiptSchema, value);
        },
      );
    },

    async commitTool(input: SemanticAuthoringCommitToolInput) {
      return stateResult(
        "semantic.commit_semantic_authoring_tool",
        [
          input.authoring_run_id,
          input.expected_writer_fence,
          input.expected_working_revision,
          input.expected_graph_digest,
          input.receipt,
          input.next_graph,
          input.checkpoint,
          JSON.stringify(input.events),
        ],
        `select semantic.commit_semantic_authoring_tool(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,
           $7::bigint,$8::integer,$9::text,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb
         ) as value`,
      );
    },

    async resume(input: SemanticAuthoringResumeInput) {
      return stateResult(
        "semantic.resume_semantic_authoring",
        [input.authoring_run_id, input.clarification_id, input.answer, input.idempotency_key],
        `select semantic.resume_semantic_authoring(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,
           $7::uuid,$8::text,$9::text
         ) as value`,
      );
    },

    async complete(input: SemanticAuthoringCompleteInput) {
      return stateResult(
        "semantic.complete_semantic_authoring",
        [
          input.authoring_run_id,
          input.expected_writer_fence,
          input.expected_working_revision,
          input.expected_graph_digest,
          input.validation_receipt,
          input.final_graph,
          input.summary,
          input.event,
        ],
        `select semantic.complete_semantic_authoring(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,
           $7::bigint,$8::integer,$9::text,$10::jsonb,$11::jsonb,$12::text,$13::jsonb
         ) as value`,
      );
    },

    async fail(input) {
      return stateResult(
        "semantic.fail_semantic_authoring",
        [input.authoring_run_id, input.expected_writer_fence, input.error_code, input.event],
        `select semantic.fail_semantic_authoring(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,
           $7::bigint,$8::text,$9::jsonb
         ) as value`,
      );
    },

    async listEvents(input) {
      if (input.semantic_domain !== semanticDomain) {
        return {
          ok: false,
          error: {
            code: "SEMANTIC_AUTHORING_DOMAIN_MISMATCH",
            message: "Event input 与绑定的 semantic domain 不一致。",
            retryable: false,
          },
        };
      }
      return transaction(
        "READ",
        "semantic.list_semantic_authoring_events",
        async ({ capability, client }) => {
          if (
            input.scope.app_id !== capability.scope.app_id ||
            input.scope.tenant_id !== capability.scope.tenant_id ||
            input.scope.environment !== capability.scope.environment
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_AUTHORING_SCOPE_MISMATCH",
              "Event input Scope 与 Authority 不一致。",
            );
          }
          const result = await client.query<JsonValueRow>(
            `select semantic.list_semantic_authoring_events(
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::bigint,$8::integer
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              input.authoring_run_id,
              input.after_sequence ?? 0,
              input.limit ?? 1_000,
            ],
          );
          return parseValue(z.array(semanticAuthoringPublicEventSchema), oneValue(result.rows));
        },
      );
    },
  };
}

export type { SemanticAuthoringPublicEvent, SemanticAuthoringToolReceipt };
