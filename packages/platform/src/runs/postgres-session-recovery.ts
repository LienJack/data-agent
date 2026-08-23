import {
  type InterruptionReplyCommand,
  type InterruptionReplyReceipt,
  type PortResult,
  type RunInterruption,
  type RunInterruptionOpenCommand,
  runInterruptionSchema,
  type SessionBranch,
  type SessionBranchCommand,
  sessionBranchSchema,
  verifyInterruptionReplyCommand,
  verifyInterruptionReplyReceipt,
  verifyRunInterruption,
  verifyRunInterruptionOpenCommand,
  verifyRunInterruptionOpenReceipt,
  verifySessionBranch,
  verifySessionBranchCommand,
  verifySessionBranchReceipt,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const branchListSchema = z.array(sessionBranchSchema);

function databaseError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return /^(RUN_INTERRUPTION|INTERRUPTION_REPLY|SESSION_BRANCH|SESSION_RECOVERY|DA_RUN_CONTROL)/.test(
    code,
  )
    ? {
        ok: false as const,
        error: {
          code,
          message: "Session recovery authority rejected the operation.",
          retryable: /CONFLICT|STALE/.test(code),
        },
      }
    : null;
}

export function createPostgresSessionRecovery(options: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}) {
  const transact = <T>(
    capability: unknown,
    access: "READ" | "WRITE",
    operationName: string,
    correlationId: string,
    operation: Parameters<typeof withAppTransaction<T>>[4],
  ) => {
    const transactionOptions =
      access === "WRITE"
        ? {
            access: "WRITE" as const,
            allowed_roles: ["OWNER", "ANALYST"] as const,
            operation_name: operationName,
            correlation_id: correlationId,
            map_database_error: databaseError,
          }
        : {
            access: "READ" as const,
            allowed_roles: ["OWNER", "ANALYST", "VIEWER"] as const,
            operation_name: operationName,
            correlation_id: correlationId,
            map_database_error: databaseError,
          };
    return withAppTransaction<T>(
      options.pool,
      options.authorizer,
      capability,
      transactionOptions,
      operation,
    );
  };

  return Object.freeze({
    async open(
      capability: unknown,
      input: RunInterruptionOpenCommand,
    ): Promise<PortResult<Awaited<ReturnType<typeof verifyRunInterruptionOpenReceipt>>>> {
      let command: RunInterruptionOpenCommand;
      try {
        command = await verifyRunInterruptionOpenCommand(input);
      } catch {
        return {
          ok: false,
          error: {
            code: "RUN_INTERRUPTION_OPEN_INVALID",
            message: "Run interruption open command is invalid.",
            retryable: false,
          },
        };
      }
      return transact(
        capability,
        "WRITE",
        "session_recovery.interruption.open",
        command.operation_id,
        async ({ client }) => {
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.open_run_interruption($1::jsonb) as value",
            [command],
          );
          const receipt = await verifyRunInterruptionOpenReceipt(query.rows[0]?.value);
          if (
            receipt.command_hash !== command.command_hash ||
            receipt.interruption.interruption_id !== command.interruption.interruption_id
          ) {
            throw new PersistenceBoundaryError(
              "SESSION_RECOVERY_DATABASE_CONTRACT_INVALID",
              "Interruption open result was substituted.",
            );
          }
          return receipt;
        },
      );
    },
    async reply(
      capability: unknown,
      input: InterruptionReplyCommand,
    ): Promise<PortResult<InterruptionReplyReceipt>> {
      let command: InterruptionReplyCommand;
      try {
        command = await verifyInterruptionReplyCommand(input);
      } catch {
        return {
          ok: false,
          error: {
            code: "INTERRUPTION_REPLY_INVALID",
            message: "Interruption reply command is invalid.",
            retryable: false,
          },
        };
      }
      return transact(
        capability,
        "WRITE",
        "session_recovery.interruption.reply",
        command.operation_id,
        async ({ client }) => {
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.reply_run_interruption($1::jsonb) as value",
            [command],
          );
          const receipt = await verifyInterruptionReplyReceipt(query.rows[0]?.value);
          if (
            receipt.command_hash !== command.command_hash ||
            receipt.interruption.interruption_id !== command.interruption_id ||
            receipt.interruption.run_id !== command.run_id
          ) {
            throw new PersistenceBoundaryError(
              "SESSION_RECOVERY_DATABASE_CONTRACT_INVALID",
              "Interruption reply result was substituted.",
            );
          }
          return receipt;
        },
      );
    },
    async createBranch(
      capability: unknown,
      input: SessionBranchCommand,
    ): Promise<PortResult<Awaited<ReturnType<typeof verifySessionBranchReceipt>>>> {
      let command: SessionBranchCommand;
      try {
        command = await verifySessionBranchCommand(input);
      } catch {
        return {
          ok: false,
          error: {
            code: "SESSION_BRANCH_COMMAND_INVALID",
            message: "Session branch command is invalid.",
            retryable: false,
          },
        };
      }
      return transact(
        capability,
        "WRITE",
        "session_recovery.branch.create",
        command.operation_id,
        async ({ client }) => {
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.create_session_branch($1::jsonb) as value",
            [command],
          );
          const receipt = await verifySessionBranchReceipt(query.rows[0]?.value);
          if (
            receipt.command_hash !== command.command_hash ||
            receipt.branch.branch_id !== command.branch.branch_id
          ) {
            throw new PersistenceBoundaryError(
              "SESSION_RECOVERY_DATABASE_CONTRACT_INVALID",
              "Session branch result was substituted.",
            );
          }
          return receipt;
        },
      );
    },
    loadInterruption(
      capability: unknown,
      runId: string,
    ): Promise<PortResult<RunInterruption | null>> {
      return transact(
        capability,
        "READ",
        "session_recovery.interruption.load",
        runId,
        async ({ client }) => {
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.load_run_interruption($1::uuid) as value",
            [runId],
          );
          if (query.rows[0]?.value == null) return null;
          const interruption = runInterruptionSchema.parse(query.rows[0].value);
          await verifyRunInterruption(interruption);
          return interruption;
        },
      );
    },
    listBranches(
      capability: unknown,
      parentRunId: string,
    ): Promise<PortResult<readonly SessionBranch[]>> {
      return transact(
        capability,
        "READ",
        "session_recovery.branch.list",
        parentRunId,
        async ({ client }) => {
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.list_session_branches($1::uuid) as value",
            [parentRunId],
          );
          const branches = branchListSchema.parse(query.rows[0]?.value);
          await Promise.all(branches.map((branch) => verifySessionBranch(branch)));
          return branches;
        },
      );
    },
  });
}

export type PostgresSessionRecovery = ReturnType<typeof createPostgresSessionRecovery>;
