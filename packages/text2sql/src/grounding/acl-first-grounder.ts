import {
  deepFreeze,
  type PortResult,
  type QueryContractPayload,
  queryContractSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { groundQueryContract } from "./ground-query-contract.js";
import {
  type CatalogSnapshot,
  catalogSnapshotSchema,
  type GroundingResult,
  type PolicySnapshot,
  policySnapshotSchema,
  retrievalCandidateSchema,
} from "./types.js";

export type AclFirstGroundingInput = Readonly<{
  query_contract: QueryContractPayload;
  principal_id: string;
  max_context_objects: number;
}>;

const groundInputSchema: z.ZodType<AclFirstGroundingInput> = z.strictObject({
  query_contract: queryContractSchema,
  principal_id: z.string().min(1).max(256),
  max_context_objects: z.number().int().positive().max(10_000),
});

export interface GroundingPolicyPort {
  authorize(input: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
    readonly run_id: string;
    readonly principal_id: string;
    readonly datasource_id: string;
  }): Promise<PortResult<unknown | null>>;
}

export interface GroundingCatalogPort {
  project(input: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
    readonly run_id: string;
    readonly principal_id: string;
    readonly datasource_id: string;
    readonly policy: PolicySnapshot;
  }): Promise<PortResult<unknown>>;
}

export interface GroundingRetrievalPort {
  retrieve(input: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
    readonly run_id: string;
    readonly principal_id: string;
    readonly datasource_id: string;
    readonly catalog_version: string;
    readonly policy_version: string;
    readonly allowed_object_ids: readonly string[];
  }): Promise<PortResult<readonly unknown[]>>;
}

export interface AclFirstGrounderDependencies {
  readonly policy: GroundingPolicyPort;
  readonly catalog: GroundingCatalogPort;
  readonly retrieval: GroundingRetrievalPort;
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function allowedObjectIds(catalog: CatalogSnapshot, policy: PolicySnapshot): string[] {
  const allowedColumns = new Map(
    policy.allowed_tables.map(({ table_id, column_ids }) => [table_id, new Set(column_ids)]),
  );
  const metricIds = catalog.metrics
    .filter((metric) => {
      const columns = allowedColumns.get(metric.table_id);
      return (
        columns?.has(metric.column_id) === true &&
        metric.dependency_column_ids.every((columnId) => columns.has(columnId)) &&
        (metric.time_column_id === null || columns.has(metric.time_column_id))
      );
    })
    .map(({ metric_id }) => metric_id);
  const dimensionIds = catalog.dimensions
    .filter(
      (dimension) => allowedColumns.get(dimension.table_id)?.has(dimension.column_id) === true,
    )
    .map(({ dimension_id }) => dimension_id);
  return [...new Set([...metricIds, ...dimensionIds])].sort(compareStable);
}

function snapshotMatchesAuthority(
  snapshot: Pick<CatalogSnapshot | PolicySnapshot, "scope" | "run_id">,
  authority: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
    readonly run_id: string;
  },
): boolean {
  return (
    snapshot.scope.app_id === authority.app_id &&
    snapshot.scope.tenant_id === authority.tenant_id &&
    snapshot.scope.environment === authority.environment &&
    snapshot.run_id === authority.run_id
  );
}

export function createAclFirstGrounder(dependencies: AclFirstGrounderDependencies) {
  return Object.freeze({
    async ground(input: AclFirstGroundingInput): Promise<GroundingResult> {
      const parsed = groundInputSchema.parse(input);
      const authorityIdentity = {
        app_id: parsed.query_contract.evidence_plan_ref.app_id,
        tenant_id: parsed.query_contract.evidence_plan_ref.tenant_id,
        environment: parsed.query_contract.evidence_plan_ref.environment,
        run_id: parsed.query_contract.evidence_plan_ref.run_id,
        principal_id: parsed.principal_id,
        datasource_id: parsed.query_contract.datasource_id,
      };
      const policyResult = await dependencies.policy.authorize({
        ...authorityIdentity,
      });
      if (!policyResult.ok) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_POLICY_UNAVAILABLE",
        });
      }
      if (!policyResult.value) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_POLICY_MISSING",
        });
      }
      const parsedPolicy = policySnapshotSchema.safeParse(policyResult.value);
      if (!parsedPolicy.success) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_POLICY_UNAVAILABLE",
        });
      }
      const policy = parsedPolicy.data;
      if (
        !snapshotMatchesAuthority(policy, authorityIdentity) ||
        policy.principal_id !== parsed.principal_id ||
        policy.datasource_id !== parsed.query_contract.datasource_id
      ) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_POLICY_SCOPE_MISMATCH",
        });
      }
      if (policy.allowed_tables.length === 0) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_ALLOWED_SCHEMA_EMPTY",
        });
      }
      const catalogResult = await dependencies.catalog.project({
        ...authorityIdentity,
        policy,
      });
      if (!catalogResult.ok) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_CATALOG_UNAVAILABLE",
        });
      }
      const parsedCatalog = catalogSnapshotSchema.safeParse(catalogResult.value);
      if (!parsedCatalog.success) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_CATALOG_UNAVAILABLE",
        });
      }
      const catalog = parsedCatalog.data;
      if (!snapshotMatchesAuthority(catalog, authorityIdentity)) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_CATALOG_SCOPE_MISMATCH",
        });
      }
      if (catalog.datasource_id !== parsed.query_contract.datasource_id) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_DATASOURCE_MISMATCH",
        });
      }
      const objectIds = allowedObjectIds(catalog, policy);
      if (objectIds.length === 0) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_ALLOWED_SCHEMA_EMPTY",
        });
      }
      const retrievalResult = await dependencies.retrieval.retrieve({
        ...authorityIdentity,
        catalog_version: catalog.catalog_version,
        policy_version: policy.policy_version,
        allowed_object_ids: objectIds.map((objectId) => versionIdentifierSchema.parse(objectId)),
      });
      if (!retrievalResult.ok) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_RETRIEVAL_UNAVAILABLE",
        });
      }
      const allowedObjectIdSet = new Set(objectIds);
      const parsedCandidates = z.array(retrievalCandidateSchema).safeParse(retrievalResult.value);
      if (!parsedCandidates.success) {
        return deepFreeze({
          state: "DENIED",
          reason_code: "GROUNDING_RETRIEVAL_UNAVAILABLE",
        });
      }
      const candidates = parsedCandidates.data.filter(({ object_id }) =>
        allowedObjectIdSet.has(object_id),
      );
      return groundQueryContract({
        query_contract: parsed.query_contract,
        catalog,
        policy,
        retrieval_candidates: candidates,
        max_context_objects: parsed.max_context_objects,
      });
    },
  });
}
