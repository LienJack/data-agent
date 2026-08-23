import {
  type SemanticBindingImpactAuthorityBundle,
  type SemanticBindingImpactCommitReceipt,
  type SemanticBindingImpactPlan,
  type SemanticBindingImpactPort,
  type SemanticBindingImpactSafeProjection,
  semanticBindingImpactAnalyzeRequestSchema,
  semanticBindingImpactSafeProjectionSchema,
  semanticCandidateDraftSchema,
  verifySemanticBindingImpactAuthorityBundle,
  verifySemanticBindingImpactCommitReceipt,
  verifySemanticBindingImpactPlan,
} from "@data-agent/contracts";
import {
  PersistenceBoundaryError,
  type SqlClient,
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
  if (/^SEMANTIC_BINDING_IMPACT_[A-Z0-9_]+$/.test(marker)) {
    return failure(
      marker,
      "Semantic binding impact authority rejected the request.",
      /(?:STALE|UNAVAILABLE)$/.test(marker),
    );
  }
  return null;
}

function contractInvalid(message: string): never {
  throw new PersistenceBoundaryError("SEMANTIC_BINDING_IMPACT_DATABASE_CONTRACT_INVALID", message);
}

function resultValue(rows: readonly Readonly<{ value?: unknown }>[]) {
  if (rows.length !== 1 || rows[0]?.value === undefined) {
    contractInvalid("Semantic binding impact RPC returned no value.");
  }
  return rows[0]?.value;
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

async function setSemanticDomain(client: SqlClient, semanticDomain: string) {
  await client.query("select pg_catalog.set_config('app.semantic_domain',$1,true)", [
    semanticDomain,
  ]);
}

export function createPostgresSemanticBindingImpactStore(
  options: Readonly<{ pool: SqlPool; authorizer: TransactionalCapabilityAuthorizer }>,
): SemanticBindingImpactPort {
  const store: SemanticBindingImpactPort = {
    async loadAuthority(capabilityInput, input) {
      const parsed = semanticBindingImpactAnalyzeRequestSchema.safeParse({
        schema_version: "semantic-binding-impact-analyze@1.0.0",
        ...input,
      });
      if (!parsed.success) {
        return failure(
          "SEMANTIC_BINDING_IMPACT_REQUEST_INVALID",
          "Binding impact request is invalid.",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "semantic_binding_impact.load_authority",
          correlation_id: parsed.data.drift_event_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }): Promise<SemanticBindingImpactAuthorityBundle> => {
          await setSemanticDomain(client, parsed.data.semantic_domain);
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.load_semantic_binding_impact_authority($1::jsonb) as value",
            [parsed.data],
          );
          try {
            const bundle = await verifySemanticBindingImpactAuthorityBundle(
              resultValue(query.rows),
            );
            if (
              !sameScope(bundle.scope, capability.scope) ||
              bundle.scope.semantic_domain !== parsed.data.semantic_domain ||
              bundle.datasource_id !== parsed.data.datasource_id ||
              bundle.drift.event.drift_event_id !== parsed.data.drift_event_id
            ) {
              throw new TypeError("substitution");
            }
            return bundle;
          } catch {
            return contractInvalid("Semantic binding impact authority bundle is invalid.");
          }
        },
      );
    },

    async commit(capabilityInput, input) {
      let plan: SemanticBindingImpactPlan;
      try {
        plan = await verifySemanticBindingImpactPlan(input.plan);
        if (input.candidate_draft !== null)
          semanticCandidateDraftSchema.parse(input.candidate_draft);
        if ((plan.status === "REVIEW_REQUIRED") !== (input.candidate_draft !== null)) {
          throw new TypeError("candidate closure");
        }
      } catch {
        return failure(
          "SEMANTIC_BINDING_IMPACT_COMMIT_INVALID",
          "Binding impact commit is invalid.",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "semantic_binding_impact.commit",
          correlation_id: plan.impact_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ capability, client }): Promise<SemanticBindingImpactCommitReceipt> => {
          if (!sameScope(plan.scope, capability.scope)) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_BINDING_IMPACT_SCOPE_MISMATCH",
              "Binding impact scope is denied.",
            );
          }
          await setSemanticDomain(client, plan.scope.semantic_domain);
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_semantic_binding_impact($1::jsonb) as value",
            [{ plan, candidate_draft: input.candidate_draft }],
          );
          try {
            const receipt = await verifySemanticBindingImpactCommitReceipt(resultValue(query.rows));
            if (
              receipt.impact_id !== plan.impact_id ||
              receipt.plan_hash !== plan.plan_hash ||
              receipt.authority_input_hash !== plan.authority_input_hash ||
              receipt.status !== plan.status ||
              !sameScope(receipt.scope, plan.scope)
            ) {
              throw new TypeError("substitution");
            }
            return receipt;
          } catch {
            return contractInvalid("Semantic binding impact receipt is invalid.");
          }
        },
      );
    },

    async getSafeProjection(capabilityInput, input) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(input.semantic_domain) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          input.impact_id,
        )
      ) {
        return failure(
          "SEMANTIC_BINDING_IMPACT_REQUEST_INVALID",
          "Binding impact lookup is invalid.",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "semantic_binding_impact.get",
          correlation_id: input.impact_id,
          map_database_error: mapDatabaseFailure,
        },
        async ({ client }): Promise<SemanticBindingImpactSafeProjection> => {
          await setSemanticDomain(client, input.semantic_domain);
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.get_semantic_binding_impact($1::jsonb) as value",
            [input],
          );
          const value = resultValue(query.rows);
          if (value === null) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_BINDING_IMPACT_NOT_FOUND",
              "Binding impact receipt was not found.",
            );
          }
          const parsed = semanticBindingImpactSafeProjectionSchema.safeParse(value);
          if (!parsed.success || parsed.data.impact_id !== input.impact_id) {
            return contractInvalid("Semantic binding impact safe projection is invalid.");
          }
          return parsed.data;
        },
      );
    },
  };
  return Object.freeze(store);
}

export type PostgresSemanticBindingImpactStore = ReturnType<
  typeof createPostgresSemanticBindingImpactStore
>;
