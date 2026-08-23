import {
  canonicalizeJson,
  type JobWorkLease,
  type PortResult,
  type SemanticInductionCommitCommand,
  type SemanticInductionCommitResult,
  type SemanticInductionRegistryPort,
  type SemanticInductionRejectCommand,
  type SemanticInductionRejectResult,
  type SemanticInductionSourceRegistrationCommand,
  type SemanticInductionTarget,
  semanticInductionCommitResultSchema,
  semanticInductionRejectCommandSchema,
  semanticInductionRejectResultSchema,
  semanticInductionRequestSchema,
  semanticInductionSourceReferenceSchema,
  semanticInductionTargetSchema,
  verifyJobWorkLease,
  verifySemanticInductionCommitCommand,
  verifySemanticInductionReceipt,
  verifySemanticInductionSourceRegistrationCommand,
  verifySemanticMetricDryRunReceipt,
} from "@data-agent/contracts";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

function failure(code: string, message: string, retryable = false) {
  return { ok: false as const, error: { code, message, retryable } };
}

function mapSemanticInductionDatabaseFailure(error: unknown) {
  const marker =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : "";
  if (/^(?:SEMANTIC_INDUCTION|SEMANTIC_METRIC|JOB_WORK_LEASE)_[A-Z0-9_]+$/.test(marker)) {
    return failure(
      marker,
      "Semantic induction authority rejected the request.",
      /(?:STALE|UNAVAILABLE)$/.test(marker),
    );
  }
  return null;
}

function contractInvalid(message: string): never {
  throw new PersistenceBoundaryError("SEMANTIC_INDUCTION_DATABASE_CONTRACT_INVALID", message);
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

function resultValue(rows: readonly Readonly<{ value?: unknown }>[]): unknown {
  if (rows.length !== 1 || rows[0]?.value === undefined)
    contractInvalid("Semantic induction RPC returned no value.");
  return rows[0]?.value;
}

async function verifiedLease(input: JobWorkLease, expectedKinds: readonly string[]) {
  try {
    const lease = await verifyJobWorkLease(input);
    if (!expectedKinds.includes(lease.kind)) throw new TypeError("kind");
    return lease;
  } catch {
    throw new PersistenceBoundaryError(
      "SEMANTIC_INDUCTION_LEASE_INVALID",
      "Semantic induction lease is invalid.",
    );
  }
}

export function createPostgresSemanticInductionRegistry(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
): SemanticInductionRegistryPort {
  return Object.freeze({
    async registerSource(
      capabilityInput: unknown,
      commandInput: SemanticInductionSourceRegistrationCommand,
    ) {
      let command: SemanticInductionSourceRegistrationCommand;
      try {
        command = await verifySemanticInductionSourceRegistrationCommand(commandInput);
      } catch {
        return failure(
          "SEMANTIC_INDUCTION_SOURCE_INVALID",
          "Semantic induction source is invalid.",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "semantic_induction.register_source",
          correlation_id: command.resource_id,
          map_database_error: mapSemanticInductionDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (!sameScope(command.scope, capability.scope)) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_INDUCTION_SCOPE_DENIED",
              "Semantic induction source scope is denied.",
            );
          }
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.register_semantic_induction_source($1::text,$2::jsonb,$3::jsonb) as value",
            [command.semantic_domain, command.source, command.content],
          );
          const reference = semanticInductionSourceReferenceSchema.safeParse(
            resultValue(query.rows),
          );
          if (
            !reference.success ||
            canonicalizeJson(reference.data) !== canonicalizeJson(command.source.source_ref)
          ) {
            return contractInvalid("Semantic induction source reference was substituted.");
          }
          return reference.data;
        },
      );
    },

    async loadTarget(
      capabilityInput: unknown,
      leaseInput: JobWorkLease,
    ): Promise<PortResult<SemanticInductionTarget>> {
      let lease: JobWorkLease;
      try {
        lease = await verifiedLease(leaseInput, ["SEMANTIC_INDUCTION", "METRIC_IMPORT"]);
      } catch {
        return failure("SEMANTIC_INDUCTION_LEASE_INVALID", "Semantic induction lease is invalid.");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "semantic_induction.load_target",
          correlation_id: lease.job_id,
          map_database_error: mapSemanticInductionDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (
            !sameScope(lease.scope, capability.scope) ||
            lease.principal_id !== capability.principal
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_INDUCTION_SCOPE_DENIED",
              "Semantic induction lease scope is denied.",
            );
          }
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.load_semantic_induction_target($1::jsonb) as value",
            [lease],
          );
          const target = semanticInductionTargetSchema.safeParse(resultValue(query.rows));
          const request = semanticInductionRequestSchema.safeParse(lease.input.parameters.request);
          if (
            !target.success ||
            !request.success ||
            canonicalizeJson(target.data.request) !== canonicalizeJson(request.data) ||
            !sameScope(target.data.request.scope, capability.scope)
          ) {
            return contractInvalid("Semantic induction target authority was substituted.");
          }
          return target.data;
        },
      );
    },

    async commit(
      capabilityInput: unknown,
      leaseInput: JobWorkLease,
      commandInput: SemanticInductionCommitCommand,
    ): Promise<PortResult<SemanticInductionCommitResult>> {
      let lease: JobWorkLease;
      let command: SemanticInductionCommitCommand;
      try {
        lease = await verifiedLease(leaseInput, ["SEMANTIC_INDUCTION", "METRIC_IMPORT"]);
        command = await verifySemanticInductionCommitCommand(commandInput);
      } catch {
        return failure(
          "SEMANTIC_INDUCTION_COMMIT_INVALID",
          "Semantic induction commit is invalid.",
        );
      }
      const request = semanticInductionRequestSchema.safeParse(lease.input.parameters.request);
      if (
        !request.success ||
        canonicalizeJson(request.data) !== canonicalizeJson(command.request)
      ) {
        return failure(
          "SEMANTIC_INDUCTION_REQUEST_MISMATCH",
          "Semantic induction request was substituted.",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "semantic_induction.commit_candidate",
          correlation_id: lease.job_id,
          map_database_error: mapSemanticInductionDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (
            !sameScope(lease.scope, capability.scope) ||
            lease.principal_id !== capability.principal
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_INDUCTION_SCOPE_DENIED",
              "Semantic induction lease scope is denied.",
            );
          }
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_semantic_induction_candidate($1::jsonb,$2::jsonb) as value",
            [lease, command],
          );
          const result = semanticInductionCommitResultSchema.safeParse(resultValue(query.rows));
          if (!result.success)
            return contractInvalid("Semantic induction commit result is invalid.");
          try {
            const receipt = await verifySemanticInductionReceipt(result.data.receipt);
            if (
              !sameScope(receipt.scope, capability.scope) ||
              receipt.induction_id !== command.request.induction_id ||
              receipt.request_hash !== lease.request_hash ||
              receipt.proposal_hash !== command.proposal.proposal_hash ||
              receipt.impact_plan_ref?.resource_hash !== command.impact_plan.plan_hash ||
              receipt.metric_dry_run_ref?.resource_hash !== command.metric_dry_run?.receipt_hash ||
              receipt.candidate_ref?.resource_id !== result.data.candidate.candidate_id ||
              receipt.candidate_ref?.resource_hash !== result.data.candidate.revision_digest
            ) {
              return contractInvalid("Semantic induction commit authority was substituted.");
            }
            return { ...result.data, receipt };
          } catch (error) {
            if (error instanceof PersistenceBoundaryError) throw error;
            return contractInvalid("Semantic induction receipt hash is invalid.");
          }
        },
      );
    },

    async reject(
      capabilityInput: unknown,
      leaseInput: JobWorkLease,
      commandInput: SemanticInductionRejectCommand,
    ): Promise<PortResult<SemanticInductionRejectResult>> {
      let lease: JobWorkLease;
      let command: SemanticInductionRejectCommand;
      try {
        lease = await verifiedLease(leaseInput, ["SEMANTIC_INDUCTION", "METRIC_IMPORT"]);
        command = semanticInductionRejectCommandSchema.parse(commandInput);
        if (command.metric_dry_run) await verifySemanticMetricDryRunReceipt(command.metric_dry_run);
      } catch {
        return failure("SEMANTIC_INDUCTION_REJECTION_INVALID", "Semantic rejection is invalid.");
      }
      const request = semanticInductionRequestSchema.safeParse(lease.input.parameters.request);
      if (
        !request.success ||
        canonicalizeJson(request.data) !== canonicalizeJson(command.request)
      ) {
        return failure("SEMANTIC_INDUCTION_REQUEST_MISMATCH", "Semantic request was substituted.");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "semantic_induction.record_rejection",
          correlation_id: lease.job_id,
          map_database_error: mapSemanticInductionDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (
            !sameScope(lease.scope, capability.scope) ||
            lease.principal_id !== capability.principal
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_INDUCTION_SCOPE_DENIED",
              "Semantic induction lease scope is denied.",
            );
          }
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.record_semantic_induction_rejection($1::jsonb,$2::jsonb) as value",
            [lease, command],
          );
          const result = semanticInductionRejectResultSchema.safeParse(resultValue(query.rows));
          if (!result.success) return contractInvalid("Semantic rejection result is invalid.");
          const receipt = await verifySemanticInductionReceipt(result.data.receipt);
          if (
            !sameScope(receipt.scope, capability.scope) ||
            receipt.induction_id !== command.request.induction_id ||
            receipt.request_hash !== lease.request_hash ||
            receipt.terminal !== command.terminal ||
            receipt.proposal_hash !== null ||
            receipt.impact_plan_ref !== null ||
            receipt.candidate_ref !== null ||
            receipt.metric_dry_run_ref?.resource_hash !== command.metric_dry_run?.receipt_hash
          ) {
            return contractInvalid("Semantic rejection authority was substituted.");
          }
          return { ...result.data, receipt };
        },
      );
    },
  });
}

export type PostgresSemanticInductionRegistry = ReturnType<
  typeof createPostgresSemanticInductionRegistry
>;
