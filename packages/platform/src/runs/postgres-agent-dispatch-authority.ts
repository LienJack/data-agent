import {
  type AgentDispatchAdmissionResult,
  agentDispatchAdmissionResultSchema,
  canonicalImmutableIdSchema,
  sha256ContentHash,
  subagentCapabilityCatalogSnapshotSchema,
  verifyAgentDispatchAdmissionResult,
  verifySubagentCapabilityCatalogSnapshot,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const rolloutPolicySchema = z.strictObject({
  schema_version: z.literal("agent-dispatch-rollout-policy@1.0.0"),
  mode: z.enum(["SHADOW", "ENFORCED", "ROOT_ONLY_DEFER_DATA"]),
  version: z.number().int().positive().safe(),
  policy_version: z.string().min(1).max(128),
});
const rolloutModeSchema = z.enum(["SHADOW", "ENFORCED", "ROOT_ONLY_DEFER_DATA"]);

type DeferredReceipt = Extract<AgentDispatchAdmissionResult, { kind: "DEFERRED" }>;
type JsonRow = { readonly value: unknown };

function exact(rows: readonly JsonRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "AGENT_DISPATCH_DATABASE_CONTRACT_INVALID",
      "Agent Dispatch RPC 必须返回恰好一行。",
    );
  }
  return rows[0]?.value;
}

export function createPostgresAgentDispatchAuthority(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}) {
  return Object.freeze({
    async resolveRolloutPolicy(capabilityInput: unknown, bootstrapMode: unknown) {
      const mode = rolloutModeSchema.catch("SHADOW").parse(bootstrapMode);
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "agent-dispatch.resolve-rollout-policy",
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.resolve_agent_dispatch_rollout_policy($1::text) as value",
            [mode],
          );
          return rolloutPolicySchema.parse(exact(result.rows));
        },
      );
    },

    async setRolloutPolicy(
      capabilityInput: unknown,
      request: { readonly mode: unknown; readonly expected_version: unknown },
    ) {
      const mode = rolloutModeSchema.parse(request.mode);
      const expectedVersion = z.number().int().positive().safe().parse(request.expected_version);
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "agent-dispatch.set-rollout-policy",
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.set_agent_dispatch_rollout_policy($1::text,$2::bigint) as value",
            [mode, expectedVersion],
          );
          return rolloutPolicySchema.parse(exact(result.rows));
        },
      );
    },

    async commitDeferred(
      capabilityInput: unknown,
      request: {
        readonly idempotency_key: unknown;
        readonly question: string;
        readonly receipt: DeferredReceipt;
      },
    ) {
      const idempotencyKey = workspaceIdempotencyKeySchema.parse(request.idempotency_key);
      const runId = canonicalImmutableIdSchema.parse(request.receipt.run_id);
      const verified = await verifyAgentDispatchAdmissionResult(request.receipt);
      if (verified.kind !== "DEFERRED" || verified.run_id !== runId) {
        throw new TypeError("AGENT_DISPATCH_DEFERRED_RECEIPT_MISMATCH");
      }
      const questionHash = await sha256ContentHash({ question: request.question });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "agent-dispatch.commit-deferred",
          correlation_id: runId,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            `select app_data_agent.commit_agent_dispatch_deferred(
               $1::text,$2::text,$3::jsonb
             ) as value`,
            [idempotencyKey, questionHash, verified],
          );
          const replayed = await verifyAgentDispatchAdmissionResult(exact(result.rows));
          if (
            replayed.kind !== "DEFERRED" ||
            replayed.run_id !== verified.run_id ||
            replayed.receipt_hash !== verified.receipt_hash
          ) {
            throw new PersistenceBoundaryError(
              "AGENT_DISPATCH_DATABASE_CONTRACT_INVALID",
              "Deferred replay 与请求 receipt 不一致。",
            );
          }
          return agentDispatchAdmissionResultSchema.parse(replayed) as DeferredReceipt;
        },
      );
    },

    async loadCatalogSnapshot(
      capabilityInput: unknown,
      request: { readonly run_id: unknown; readonly catalog_id: unknown },
    ) {
      const runId = canonicalImmutableIdSchema.parse(request.run_id);
      const catalogId = canonicalImmutableIdSchema.parse(request.catalog_id);
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "agent-dispatch.load-catalog-snapshot",
          correlation_id: runId,
        },
        async ({ capability, client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_subagent_catalog_snapshot($1::uuid,$2::uuid) as value",
            [runId, catalogId],
          );
          const raw = exact(result.rows);
          if (raw === null) return null;
          const snapshot = await verifySubagentCapabilityCatalogSnapshot(
            subagentCapabilityCatalogSnapshotSchema.parse(raw),
          );
          if (
            snapshot.run_id !== runId ||
            snapshot.catalog_id !== catalogId ||
            snapshot.scope.app_id !== capability.scope.app_id ||
            snapshot.scope.tenant_id !== capability.scope.tenant_id ||
            snapshot.scope.environment !== capability.scope.environment ||
            snapshot.principal_id !== capability.principal
          ) {
            throw new PersistenceBoundaryError(
              "AGENT_DISPATCH_DATABASE_CONTRACT_INVALID",
              "Subagent catalog snapshot escaped its frozen authority.",
            );
          }
          return snapshot;
        },
      );
    },
  });
}

export type PostgresAgentDispatchAuthority = ReturnType<
  typeof createPostgresAgentDispatchAuthority
>;
