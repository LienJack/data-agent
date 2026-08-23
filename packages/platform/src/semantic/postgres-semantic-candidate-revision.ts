import {
  type PortResult,
  type SemanticCandidateRevisionPort,
  type SemanticCandidateRevisionSaveCommand,
  type SemanticManualSessionStartCommand,
  semanticCandidateRevisionSaveResultSchema,
  semanticManualSessionStartResultSchema,
  verifySemanticCandidateRevisionSaveCommand,
  verifySemanticManualSessionStartCommand,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (/SEMANTIC_CANDIDATE_SAVE_(?:CONFLICT|STALE)/.test(message)) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_CANDIDATE_SAVE_CONFLICT",
        message: "语义 Working ChangeSet 已变化，请刷新后重新保存。",
        retryable: true,
      },
    };
  }
  if (/SEMANTIC_CANDIDATE_SAVE_(?:FORBIDDEN|NOT_FOUND)/.test(message)) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_CANDIDATE_SAVE_NOT_FOUND_OR_DENIED",
        message: "语义创作任务不存在或无权保存。",
        retryable: false,
      },
    };
  }
  if (message.includes("SEMANTIC_CANDIDATE_SAVE_INVALID")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_CANDIDATE_SAVE_INVALID",
        message: "保存草稿请求未通过权威校验。",
        retryable: false,
      },
    };
  }
  return null;
}

export function createPostgresSemanticCandidateRevisionStore(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
): SemanticCandidateRevisionPort {
  return Object.freeze({
    async getSaved(
      capability: unknown,
      input: {
        readonly scope: {
          readonly app_id: string;
          readonly tenant_id: string;
          readonly environment: string;
        };
        readonly semantic_domain: string;
        readonly principal_id: string;
        readonly authoring_run_id: string;
      },
    ) {
      const parsed = z
        .strictObject({
          scope: z.strictObject({
            app_id: z.uuid(),
            tenant_id: z.uuid(),
            environment: z.string().min(1).max(64),
          }),
          semantic_domain: z
            .string()
            .min(1)
            .max(64)
            .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
          principal_id: z.uuid(),
          authoring_run_id: z.uuid(),
        })
        .safeParse(input);
      if (!parsed.success) {
        return {
          ok: false as const,
          error: {
            code: "SEMANTIC_CANDIDATE_RESTORE_INVALID",
            message: "恢复 Candidate Revision 的请求不符合严格合同。",
            retryable: false,
          },
        };
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capability,
        {
          access: "READ",
          operation_name: "semantic.get_saved_candidate_revision",
          correlation_id: parsed.data.authoring_run_id,
          map_database_error: databaseFailure,
        },
        async ({ capability: current, client }) => {
          if (
            parsed.data.scope.app_id !== current.scope.app_id ||
            parsed.data.scope.tenant_id !== current.scope.tenant_id ||
            parsed.data.scope.environment !== current.scope.environment ||
            parsed.data.principal_id !== current.principal
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CANDIDATE_RESTORE_AUTHORITY_MISMATCH",
              "Candidate restore authority was substituted.",
            );
          }
          await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
            parsed.data.semantic_domain,
          ]);
          const result = await client.query<{ value: unknown }>(
            `select semantic.get_saved_semantic_candidate_revision(
              $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid
            ) as value`,
            [
              parsed.data.scope.app_id,
              parsed.data.scope.tenant_id,
              parsed.data.scope.environment,
              parsed.data.principal_id,
              parsed.data.semantic_domain,
              parsed.data.authoring_run_id,
            ],
          );
          const value = result.rows[0]?.value;
          if (value === null || value === undefined) return null;
          const restored = semanticCandidateRevisionSaveResultSchema.safeParse(value);
          if (!restored.success) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CANDIDATE_RESTORE_DATABASE_CONTRACT_INVALID",
              "Saved Candidate Revision is invalid.",
            );
          }
          return restored.data;
        },
      );
    },

    async startManual(capability: unknown, commandInput: SemanticManualSessionStartCommand) {
      let command: SemanticManualSessionStartCommand;
      try {
        command = await verifySemanticManualSessionStartCommand(commandInput);
      } catch {
        return {
          ok: false as const,
          error: {
            code: "SEMANTIC_MANUAL_SESSION_START_INVALID",
            message: "直接编辑会话命令不符合严格合同。",
            retryable: false,
          },
        };
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capability,
        {
          access: "WRITE",
          operation_name: "semantic.start_manual_session",
          correlation_id: command.authoring_run_id,
          map_database_error: databaseFailure,
        },
        async ({ capability: current, client }) => {
          if (
            command.scope.app_id !== current.scope.app_id ||
            command.scope.tenant_id !== current.scope.tenant_id ||
            command.scope.environment !== current.scope.environment ||
            command.principal_id !== current.principal
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_MANUAL_SESSION_AUTHORITY_MISMATCH",
              "Manual session authority was substituted.",
            );
          }
          await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
            command.semantic_domain,
          ]);
          const result = await client.query<{ value: unknown }>(
            "select semantic.start_manual_semantic_authoring($1::jsonb) as value",
            [command],
          );
          const parsed = semanticManualSessionStartResultSchema.safeParse(result.rows[0]?.value);
          if (
            !parsed.success ||
            parsed.data.run.authoring_run_id !== command.authoring_run_id ||
            parsed.data.run.candidate_id !== command.candidate_id ||
            parsed.data.run.graph_digest !== command.base_graph_digest
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_MANUAL_SESSION_DATABASE_CONTRACT_INVALID",
              "Manual session result is invalid.",
            );
          }
          return parsed.data;
        },
      );
    },

    async save(capability: unknown, commandInput: SemanticCandidateRevisionSaveCommand) {
      let command: SemanticCandidateRevisionSaveCommand;
      try {
        command = await verifySemanticCandidateRevisionSaveCommand(commandInput);
      } catch {
        return {
          ok: false as const,
          error: {
            code: "SEMANTIC_CANDIDATE_SAVE_INVALID",
            message: "保存草稿命令不符合严格合同。",
            retryable: false,
          },
        };
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capability,
        {
          access: "WRITE",
          operation_name: "semantic.save_candidate_revision",
          correlation_id: command.authoring_run_id,
          map_database_error: databaseFailure,
        },
        async ({ capability: current, client }) => {
          if (
            command.scope.app_id !== current.scope.app_id ||
            command.scope.tenant_id !== current.scope.tenant_id ||
            command.scope.environment !== current.scope.environment ||
            command.principal_id !== current.principal
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CANDIDATE_SAVE_AUTHORITY_MISMATCH",
              "Candidate save authority was substituted.",
            );
          }
          await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
            command.semantic_domain,
          ]);
          const result = await client.query<{ value: unknown }>(
            "select semantic.save_semantic_candidate_revision($1::jsonb) as value",
            [command],
          );
          const parsed = semanticCandidateRevisionSaveResultSchema.safeParse(result.rows[0]?.value);
          if (
            !parsed.success ||
            parsed.data.candidate_id !== command.candidate_id ||
            parsed.data.final_graph_digest !== command.final_graph_digest
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CANDIDATE_SAVE_DATABASE_CONTRACT_INVALID",
              "Candidate save result is invalid.",
            );
          }
          return parsed.data;
        },
      );
    },
  });
}
