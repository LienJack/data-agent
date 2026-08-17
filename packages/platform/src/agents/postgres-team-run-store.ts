import {
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  effectiveConfigRunLeasePayloadSchema,
  immutableIdSchema,
  runWorkLeaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const operationSchema = z.enum([
  "CREATE_TASK",
  "PREPARE_HANDOFF",
  "COMMIT_CONTEXT_EPOCH",
  "COMMIT_COMPLETION",
  "COMMIT_ACCEPTANCE",
  "RECORD_LATE_RESULT",
  "ISSUE_TASK_CAPABILITY",
  "LOAD_TASK_CAPABILITY",
  "LOAD_RUN",
]);

const commandDraftSchema = z
  .strictObject({
    schema_version: z.literal("agent-team-store-command@1.0.0"),
    operation: operationSchema,
    command_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    task_id: immutableIdSchema,
    expected_revision: z.number().int().positive().nullable(),
    lease: runWorkLeaseSchema.extend({ payload: effectiveConfigRunLeasePayloadSchema }),
    selector: z.json().nullable(),
    document: z.json().nullable(),
  })
  .superRefine((command, ctx) => {
    if (
      command.scope.app_id !== command.lease.scope.app_id ||
      command.scope.tenant_id !== command.lease.scope.tenant_id ||
      command.scope.environment !== command.lease.scope.environment ||
      command.run_id !== command.lease.run_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Team command lease scope/run mismatch.",
        path: ["lease"],
      });
    }
  });

export const agentTeamStoreCommandSchema = commandDraftSchema
  .extend({
    document_hash: contentHashSchema.nullable(),
    request_hash: contentHashSchema,
  })
  .superRefine((command, ctx) => {
    if ((command.document === null) !== (command.document_hash === null)) {
      ctx.addIssue({
        code: "custom",
        message: "Document and document hash must be jointly nullable.",
      });
    }
    if (
      ["LOAD_RUN", "LOAD_TASK_CAPABILITY"].includes(command.operation) &&
      command.document !== null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "LOAD_RUN cannot carry a document.",
        path: ["document"],
      });
    }
    if (
      !["LOAD_RUN", "LOAD_TASK_CAPABILITY"].includes(command.operation) &&
      command.document === null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Write operation requires a document.",
        path: ["document"],
      });
    }
    if (command.operation === "LOAD_TASK_CAPABILITY") {
      if (
        typeof command.selector !== "object" ||
        command.selector === null ||
        Array.isArray(command.selector) ||
        Object.keys(command.selector).sort().join(",") !== "capability_hash,capability_id"
      ) {
        ctx.addIssue({
          code: "custom",
          message: "LOAD_TASK_CAPABILITY requires an exact selector.",
          path: ["selector"],
        });
      }
    } else if (command.selector !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Only capability load accepts a selector.",
        path: ["selector"],
      });
    }
  });
export type AgentTeamStoreCommand = z.infer<typeof agentTeamStoreCommandSchema>;

export async function buildAgentTeamStoreCommand(input: unknown): Promise<AgentTeamStoreCommand> {
  const draft = commandDraftSchema.parse(input);
  const documentHash = draft.document === null ? null : await sha256ContentHash(draft.document);
  return agentTeamStoreCommandSchema.parse({
    ...draft,
    document_hash: documentHash,
    request_hash: await sha256ContentHash({ ...draft, document_hash: documentHash }),
  });
}

const resultSchema = z.strictObject({
  schema_version: z.literal("agent-team-store-result@1.0.0"),
  operation: operationSchema,
  disposition: z.enum(["CREATED", "REPLAYED", "LOADED"]),
  request_hash: contentHashSchema,
  document_hash: contentHashSchema.nullable(),
  document: z.json().nullable(),
});

export interface PostgresTeamRunStoreOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

function invalid(code: string, message: string, retryable = false) {
  return { ok: false as const, error: { code, message, retryable } };
}

function mapDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  for (const marker of [
    "AGENT_TEAM_COMMAND_INVALID",
    "AGENT_TEAM_SCOPE_MISMATCH",
    "AGENT_TEAM_REVISION_CONFLICT",
    "AGENT_TEAM_LEASE_STALE",
    "AGENT_TEAM_IDEMPOTENCY_CONFLICT",
    "AGENT_TEAM_CAPABILITY_REQUIRED",
    "AGENT_TEAM_OBLIGATION_SET_MISMATCH",
    "AGENT_TEAM_PENDING_EFFECT_RECONCILIATION_REQUIRED",
  ]) {
    if (message.includes(marker)) {
      return invalid(
        marker,
        "Agent Team Authority 拒绝该请求。",
        marker === "AGENT_TEAM_LEASE_STALE",
      );
    }
  }
  if (message.includes("PROVIDER_WORKER_LEASE_STALE")) {
    return invalid("AGENT_TEAM_LEASE_STALE", "Agent Team Worker lease 已失效。", true);
  }
  return null;
}

const rpcByOperation = {
  CREATE_TASK: "create_agent_team_task",
  PREPARE_HANDOFF: "prepare_agent_team_handoff",
  COMMIT_CONTEXT_EPOCH: "commit_agent_team_context_epoch",
  COMMIT_COMPLETION: "commit_agent_team_completion",
  COMMIT_ACCEPTANCE: "commit_agent_team_acceptance",
  RECORD_LATE_RESULT: "record_agent_team_late_result",
  ISSUE_TASK_CAPABILITY: "issue_agent_team_task_capability",
  LOAD_TASK_CAPABILITY: "load_agent_team_task_capability",
  LOAD_RUN: "load_agent_team_run",
} as const;

async function verifyCommand(input: unknown): Promise<AgentTeamStoreCommand> {
  const command = agentTeamStoreCommandSchema.parse(input);
  const rebuilt = await buildAgentTeamStoreCommand({
    schema_version: command.schema_version,
    operation: command.operation,
    command_id: command.command_id,
    scope: command.scope,
    run_id: command.run_id,
    task_id: command.task_id,
    expected_revision: command.expected_revision,
    lease: command.lease,
    selector: command.selector,
    document: command.document,
  });
  if (canonicalizeJson(command) !== canonicalizeJson(rebuilt))
    throw new Error("AGENT_TEAM_COMMAND_HASH_INVALID");
  return command;
}

async function verifyResult(command: AgentTeamStoreCommand, input: unknown) {
  const result = resultSchema.parse(input);
  if (
    result.operation !== command.operation ||
    result.request_hash !== command.request_hash ||
    (!["LOAD_RUN", "LOAD_TASK_CAPABILITY"].includes(command.operation) &&
      (result.document_hash !== command.document_hash ||
        canonicalizeJson(result.document) !== canonicalizeJson(command.document)))
  ) {
    throw new PersistenceBoundaryError(
      "AGENT_TEAM_DATABASE_CONTRACT_INVALID",
      "Agent Team DB response correlation invalid.",
      false,
    );
  }
  if (
    result.document !== null &&
    (await sha256ContentHash(result.document)) !== result.document_hash
  ) {
    throw new PersistenceBoundaryError(
      "AGENT_TEAM_DATABASE_CONTRACT_INVALID",
      "Agent Team DB document hash invalid.",
      false,
    );
  }
  return result;
}

export function createPostgresTeamRunStore(options: PostgresTeamRunStoreOptions) {
  async function execute(
    capabilityInput: unknown,
    commandInput: unknown,
    expectedOperation: z.infer<typeof operationSchema>,
  ) {
    let command: AgentTeamStoreCommand;
    try {
      command = await verifyCommand(commandInput);
    } catch {
      return invalid("AGENT_TEAM_COMMAND_INVALID", "Agent Team command invalid.");
    }
    if (command.operation !== expectedOperation)
      return invalid("AGENT_TEAM_COMMAND_INVALID", "Agent Team operation mismatch.");
    return withAppTransaction(
      options.pool,
      options.authorizer,
      capabilityInput,
      {
        access: ["LOAD_RUN", "LOAD_TASK_CAPABILITY"].includes(expectedOperation) ? "READ" : "WRITE",
        ...(expectedOperation === "ISSUE_TASK_CAPABILITY"
          ? { allowed_roles: ["OWNER"] as const }
          : {}),
        operation_name: `agent-team.${expectedOperation.toLowerCase()}`,
        correlation_id: command.command_id,
        map_database_error: mapDatabaseError,
      },
      async ({ client }) => {
        const rpc = rpcByOperation[expectedOperation];
        const query = await client.query<{ readonly value: unknown }>(
          `select app_data_agent.${rpc}($1::jsonb) as value`,
          [command],
        );
        return verifyResult(command, query.rows[0]?.value);
      },
    );
  }
  return {
    createTask: (capability: unknown, command: unknown) =>
      execute(capability, command, "CREATE_TASK"),
    prepareHandoff: (capability: unknown, command: unknown) =>
      execute(capability, command, "PREPARE_HANDOFF"),
    commitContextEpoch: (capability: unknown, command: unknown) =>
      execute(capability, command, "COMMIT_CONTEXT_EPOCH"),
    commitCompletion: (capability: unknown, command: unknown) =>
      execute(capability, command, "COMMIT_COMPLETION"),
    commitAcceptance: (capability: unknown, command: unknown) =>
      execute(capability, command, "COMMIT_ACCEPTANCE"),
    recordLateResult: (capability: unknown, command: unknown) =>
      execute(capability, command, "RECORD_LATE_RESULT"),
    issueTaskCapability: (capability: unknown, command: unknown) =>
      execute(capability, command, "ISSUE_TASK_CAPABILITY"),
    loadTaskCapability: (capability: unknown, command: unknown) =>
      execute(capability, command, "LOAD_TASK_CAPABILITY"),
    loadRun: (capability: unknown, command: unknown) => execute(capability, command, "LOAD_RUN"),
  };
}

export type PostgresTeamRunStore = ReturnType<typeof createPostgresTeamRunStore>;
