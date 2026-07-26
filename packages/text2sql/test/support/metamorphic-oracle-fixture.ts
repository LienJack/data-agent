import {
  type ArtifactReference,
  AUTHORITY_ROLE_POLICY_VERSION,
  type AuthoritativeSandboxExecutionReceipt,
  type AuthoritativeSandboxResult,
  type AuthorityIdentity,
  artifactReferenceIdentity,
  type ContentHash,
  canonicalizeJson,
  computeFixtureMutationRecordHash,
  computeMetamorphicFixtureEvidenceHash,
  computeMetamorphicFixtureReceiptHash,
  computeMetamorphicOracleEvidenceHash,
  computeMetamorphicOracleReceiptHash,
  computeMetamorphicRelationSampleHash,
  computePostgresqlExecutionSettingsHash,
  computeSandboxExecutionReceiptHash,
  computeSandboxExecutionRequestHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  computeSqlArtifactQueryHash,
  type ExecutionPermitPayload,
  executionPermitSchema,
  fixtureMutationRecordSchema,
  groundingPackageSchema,
  logicalPlanSchema,
  type MetamorphicFixtureReceipt,
  type MetamorphicOracleReceipt,
  metamorphicFixtureReceiptSchema,
  metamorphicOracleReceiptSchema,
  queryContractSchema,
  type SandboxResult,
  type SqlArtifactPayloadContract,
  type SuccessfulSandboxExecutionReceipt,
  sandboxExecutionRequestSchema,
  sandboxResultSchema,
  semanticQuerySchema,
  sha256ContentHash,
  sqlArtifactSchema,
  successfulSandboxExecutionReceiptSchema,
} from "@data-agent/contracts";
import {
  type AuthoritativeSandboxExecutionIdentity,
  authorizeSandboxExecutionReceipt,
  authorizeSandboxResult,
  getAuthoritativeSandboxExecutionIdentity,
  registerSandboxServerAuthority,
  type SandboxServerAuthority,
  type SandboxServerAuthorityRegistration,
} from "@data-agent/contracts/server";
import {
  registerTrustedMetamorphicFixtureAuthority,
  registerTrustedMetamorphicOracleVerifier,
  type TrustedMetamorphicFixtureAuthority,
} from "@data-agent/text2sql/server";
import {
  createGroundingPackagePayload,
  createLogicalPlanPayload,
  createSemanticQueryPayload,
} from "../../src/artifacts/payload-projection.js";
import { groundQueryContract } from "../../src/grounding/ground-query-contract.js";
import { buildLogicalPlan } from "../../src/planning/build-logical-plan.js";
import { validateLogicalPlan } from "../../src/planning/validate-logical-plan.js";
import { buildSemanticQuery } from "../../src/semantic/build-semantic-query.js";
import { analystPolicy, commerceCatalog, netRevenueContract } from "./commerce-fixture.js";

const metaFixtureIds = {
  receipt: "30000000-0000-4000-8000-000000000001",
  fanOutExecution: "30000000-0000-4000-8000-000000000002",
  fanOutReceipt: "30000000-0000-4000-8000-000000000003",
  fanOutResult: "30000000-0000-4000-8000-000000000004",
  nullExecution: "30000000-0000-4000-8000-000000000005",
  nullReceipt: "30000000-0000-4000-8000-000000000006",
  nullResult: "30000000-0000-4000-8000-000000000007",
  leftExecution: "30000000-0000-4000-8000-000000000008",
  leftReceipt: "30000000-0000-4000-8000-000000000009",
  leftResult: "30000000-0000-4000-8000-000000000010",
  rightExecution: "30000000-0000-4000-8000-000000000011",
  rightReceipt: "30000000-0000-4000-8000-000000000012",
  rightResult: "30000000-0000-4000-8000-000000000013",
  distinctExecution: "30000000-0000-4000-8000-000000000014",
  distinctReceipt: "30000000-0000-4000-8000-000000000015",
  distinctResult: "30000000-0000-4000-8000-000000000016",
  fanOutCase: "30000000-0000-4000-8000-000000000017",
  nullCase: "30000000-0000-4000-8000-000000000018",
  partitionCase: "30000000-0000-4000-8000-000000000019",
  distinctCase: "30000000-0000-4000-8000-000000000020",
} as const;

const metaFixtureSnapshots = {
  fanOut: "metamorphic-snapshot@fan-out",
  nullAntiMembership: "metamorphic-snapshot@null-anti-membership",
  halfOpenPartition: "metamorphic-snapshot@half-open-partition",
  sameValuedFact: "metamorphic-snapshot@same-valued-fact",
} as const;

export interface MetamorphicFixtureStore {
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  verifyExactArtifactRevision(reference: ArtifactReference, artifact: unknown): Promise<boolean>;
  now(): string;
  commit(reference: ArtifactReference, payload: unknown): void;
}

type FixtureCell = SandboxResult["rows"][number][number];
type FixtureRows = readonly (readonly FixtureCell[])[];

export interface MetamorphicRelationRows {
  readonly fan_out?: FixtureRows;
  readonly null_anti_membership?: FixtureRows;
  readonly left_partition?: FixtureRows;
  readonly right_partition?: FixtureRows;
  readonly same_valued_distinct_fact?: FixtureRows;
}

export type MetamorphicSelectionProbeRows = Readonly<
  Partial<
    Record<
      Extract<AuthoritativeMetamorphicExecutionLabel, `${string}_selection_probe`>,
      FixtureRows
    >
  >
>;

const authoritativeFixtureScope = {
  app_id: "50000000-0000-4000-8000-000000000001",
  tenant_id: "50000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;
const authoritativeFixtureRunId = "50000000-0000-4000-8000-000000000003";
const authoritativeFixturePrincipalId = "metamorphic-sandbox-principal";
const authoritativeFixtureSnapshot = "metamorphic-snapshot@baseline";
const authoritativeFixtureZeroHash = `sha256:${"0".repeat(64)}` as const;

const authoritativeFixtureExecutionSettings = {
  database_role: "analyst",
  search_path: ["app_data_agent", "pg_catalog"],
  plan_cache_mode: "force_custom_plan",
  statement_timeout_ms: 5_000,
  lock_timeout_ms: 500,
} as const;

const authoritativeFixtureBudget = {
  timeout_ms: 5_000,
  lock_timeout_ms: 500,
  max_rows: 1_000,
  max_bytes: 1_000_000,
  max_memory_mb: 256,
} as const;

export type AuthoritativeMetamorphicExecutionLabel =
  | "baseline"
  | "fan_out"
  | "null_anti_membership"
  | "left_partition"
  | "right_partition"
  | "same_valued_distinct_fact"
  | "fan_out_selection_probe"
  | "null_anti_membership_selection_probe"
  | "half_open_selection_probe"
  | "same_valued_distinct_selection_probe";

function deriveHalfOpenPartitionBounds(sqlArtifact: SqlArtifactPayloadContract): Readonly<{
  start_at: string;
  midpoint_at: string;
  end_at: string;
  lower_placeholder: string;
  upper_placeholder: string;
}> {
  const comparisonPattern =
    /("(?:[^"]|"")+"\."(?:[^"]|"")+")\s*(>=|<)\s*(\$[1-9][0-9]*)::(?:timestamp|timestamptz)\b/g;
  const comparisons = [...sqlArtifact.sql.matchAll(comparisonPattern)];
  const candidates = comparisons.flatMap((lower) =>
    comparisons.flatMap((upper) => {
      const startAt = sqlArtifact.parameters[lower[3] ?? ""];
      const endAt = sqlArtifact.parameters[upper[3] ?? ""];
      const startEpoch = typeof startAt === "string" ? Date.parse(startAt) : Number.NaN;
      const endEpoch = typeof endAt === "string" ? Date.parse(endAt) : Number.NaN;
      return lower[2] === ">=" &&
        upper[2] === "<" &&
        lower[1] === upper[1] &&
        lower[3] !== upper[3] &&
        Number.isFinite(startEpoch) &&
        Number.isFinite(endEpoch) &&
        startEpoch < endEpoch
        ? [
            {
              start_at: startAt as string,
              midpoint_at: new Date(startEpoch + (endEpoch - startEpoch) / 2).toISOString(),
              end_at: endAt as string,
              lower_placeholder: lower[3] as string,
              upper_placeholder: upper[3] as string,
            },
          ]
        : [];
    }),
  );
  if (candidates.length !== 1 || !candidates[0]) {
    throw new TypeError("Metamorphic Fixture 必须从 SQL 精确推导一组半开时间参数。");
  }
  return candidates[0];
}

type AuthoritativeMetamorphicSandboxEvidence = Readonly<{
  request: Extract<
    ReturnType<typeof sandboxExecutionRequestSchema.parse>,
    { readonly language: "sql" }
  >;
  execution_record: Readonly<Record<string, unknown>>;
  execution_permit: ExecutionPermitPayload;
  sql_artifact: SqlArtifactPayloadContract;
  raw_receipt: SuccessfulSandboxExecutionReceipt;
  raw_result: SandboxResult;
  receipt: AuthoritativeSandboxExecutionReceipt;
  result: AuthoritativeSandboxResult;
}>;

export type AuthoritativeMetamorphicArtifactContext = Readonly<{
  query_contract_ref: MetamorphicFixtureReceipt["query_contract_ref"];
  grounding_package_ref: MetamorphicFixtureReceipt["grounding_package_ref"];
  logical_plan_ref: MetamorphicFixtureReceipt["logical_plan_ref"];
  applicability_profile: MetamorphicFixtureReceipt["applicability_profile"];
}>;

export type AuthoritativeMetamorphicSandboxFixture = Readonly<{
  authority_records: Map<string, unknown>;
  committed_artifacts: Map<string, unknown>;
  execution_records: Map<ContentHash, unknown>;
  sandbox_authority: SandboxServerAuthority;
  sandbox_execution_identity: AuthoritativeSandboxExecutionIdentity;
  artifact_context: AuthoritativeMetamorphicArtifactContext;
  evidence: Readonly<
    Record<AuthoritativeMetamorphicExecutionLabel, AuthoritativeMetamorphicSandboxEvidence>
  >;
}>;

export type AuthoritativeMetamorphicSandboxContext = Readonly<{
  authority_records?: Map<string, unknown>;
  committed_artifacts?: Map<string, unknown>;
  sandbox_authority: SandboxServerAuthority;
  sandbox_execution_identity: AuthoritativeSandboxExecutionIdentity;
  artifact_context?: AuthoritativeMetamorphicArtifactContext;
  evidence: Readonly<
    Record<
      AuthoritativeMetamorphicExecutionLabel,
      Pick<AuthoritativeMetamorphicSandboxEvidence, "receipt" | "result" | "sql_artifact">
    >
  >;
}>;

function authoritativeFixtureUuid(sequence: number): string {
  return `50000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function authoritativeFixtureReference<const T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  artifactId: string,
  scope: SuccessfulSandboxExecutionReceipt["scope"] = authoritativeFixtureScope,
  runId: string = authoritativeFixtureRunId,
): ArtifactReference & { readonly artifact_type: T } {
  return {
    ...scope,
    run_id: runId,
    artifact_type: artifactType,
    artifact_id: artifactId,
    revision: 1,
    content_hash: authoritativeFixtureZeroHash,
  };
}

export type AuthoritativeMetamorphicExecutionContext = Readonly<{
  scope: SuccessfulSandboxExecutionReceipt["scope"];
  run_id: string;
  sandbox_identity: AuthorityIdentity;
  sql_artifact_ref: ArtifactReference & { readonly artifact_type: "SqlArtifact" };
  sql_artifact: SqlArtifactPayloadContract;
  execution_permit_ref: ArtifactReference & {
    readonly artifact_type: "ExecutionPermit";
  };
  execution_permit: ExecutionPermitPayload;
  authority_epoch: number;
  artifact_context: AuthoritativeMetamorphicArtifactContext;
  baseline: Readonly<{
    columns: SandboxResult["columns"];
    rows: FixtureRows;
    snapshot_token: string;
    started_at: string;
    completed_at: string;
  }>;
}>;

async function createAuthoritativeMetamorphicLineage(
  input: Readonly<{
    aggregate_kind: "sum" | "count";
    global_aggregate: boolean;
    query_contract_ref: ArtifactReference & { readonly artifact_type: "QueryContract" };
    grounding_package_ref: ArtifactReference & {
      readonly artifact_type: "GroundingPackage";
    };
    semantic_query_ref: ArtifactReference & { readonly artifact_type: "SemanticQuery" };
    logical_plan_ref: ArtifactReference & { readonly artifact_type: "LogicalPlan" };
    semantic_release_ref: ArtifactReference & {
      readonly artifact_type: "SemanticRelease";
    };
    schema_snapshot_ref: ArtifactReference & { readonly artifact_type: "SchemaSnapshot" };
    policy_receipt_ref: ArtifactReference & { readonly artifact_type: "PolicyReceipt" };
  }>,
) {
  const baseMetric = commerceCatalog.metrics.find(
    ({ metric_id }) => metric_id === "metric.net_revenue",
  );
  if (!baseMetric) {
    throw new TypeError("Metamorphic Fixture 缺少 commerce metric.net_revenue。");
  }
  const metric =
    input.aggregate_kind === "count"
      ? ({
          ...baseMetric,
          metric_id: "metric.order_count",
          aliases: ["订单数"],
          column_id: "orders.id",
          aggregation: "count",
          unit: "count",
          null_policy: "preserve",
          dependency_column_ids: ["orders.id"],
        } as const)
      : baseMetric;
  const catalog = {
    ...commerceCatalog,
    tables: commerceCatalog.tables.map((table) =>
      table.table_id === "orders"
        ? {
            ...table,
            columns: table.columns.map((column) =>
              column.column_id === "orders.net_amount"
                ? { ...column, data_type: "integer" as const }
                : column,
            ),
          }
        : table,
    ),
    metrics: [metric],
  };
  const dimensionIds = input.global_aggregate ? [] : (["dimension.customer_segment"] as const);
  const queryContract = queryContractSchema.parse(
    netRevenueContract({
      metric: metric.metric_id,
      dimensions: [...dimensionIds],
      unit: metric.unit,
      result_contract: {
        columns: [...dimensionIds, metric.metric_id],
        invariant_ids: ["non_negative_result"],
      },
    }),
  );
  const groundingResult = await groundQueryContract({
    query_contract: queryContract,
    catalog,
    policy: analystPolicy,
    retrieval_candidates: [
      { object_id: metric.metric_id, score: 1 },
      ...dimensionIds.map((objectId) => ({ object_id: objectId, score: 0.9 })),
    ],
    max_context_objects: 32,
  });
  if (groundingResult.state !== "READY") {
    throw new TypeError(
      `Metamorphic Fixture lineage Grounding 必须 READY，实际为 ${groundingResult.state}。`,
    );
  }
  const semanticDraft = buildSemanticQuery({
    query_contract: queryContract,
    grounding: groundingResult.grounding,
  });
  const logicalDraft = buildLogicalPlan({
    semantic_query: semanticDraft,
    grounding: groundingResult.grounding,
  });
  const validation = validateLogicalPlan({
    logical_plan: logicalDraft,
    grounding: groundingResult.grounding,
    semantic_query: semanticDraft,
    query_contract: queryContract,
  });
  if (validation.state !== "VALID") {
    throw new TypeError(
      `Metamorphic Fixture lineage LogicalPlan 必须 VALID，实际为 ${validation.reason_code}。`,
    );
  }
  const groundingPackage = groundingPackageSchema.parse(
    createGroundingPackagePayload({
      draft: groundingResult.grounding,
      query_contract_ref: input.query_contract_ref,
      semantic_release_ref: input.semantic_release_ref,
      schema_snapshot_ref: input.schema_snapshot_ref,
      policy_receipt_ref: input.policy_receipt_ref,
    }),
  );
  const semanticQuery = semanticQuerySchema.parse(
    createSemanticQueryPayload({
      draft: semanticDraft,
      query_contract_ref: input.query_contract_ref,
      grounding_package_ref: input.grounding_package_ref,
    }),
  );
  const logicalPlan = logicalPlanSchema.parse(
    createLogicalPlanPayload({
      draft: validation.logical_plan,
      semantic_query_ref: input.semantic_query_ref,
    }),
  );
  return {
    query_contract: queryContract,
    grounding_package: groundingPackage,
    semantic_query: semanticQuery,
    logical_plan: logicalPlan,
  } as const;
}

/**
 * Test-only Sandbox execution domain used by the metamorphic fixture.
 *
 * Every authoritative brand is obtained from the real contracts/server authorizer. The mutable
 * maps deliberately retain the raw Request/ExecutionRecord/Permit/SqlArtifact/Receipt/Result so
 * tests can prove that deleting or rebinding any one authority fact fails closed.
 */
export async function createAuthoritativeMetamorphicSandboxFixture(
  input: Readonly<{
    execution_context?: AuthoritativeMetamorphicExecutionContext;
    relation_rows?: MetamorphicRelationRows;
    selection_probe_rows?: MetamorphicSelectionProbeRows;
    global_aggregate?: boolean;
    aggregate_kind?: "sum" | "count";
    half_open_query_variants?: "DISTINCT" | "REUSE_BASELINE" | "COMMENT_ONLY";
  }> = {},
): Promise<AuthoritativeMetamorphicSandboxFixture> {
  const authorityRecords = new Map<string, unknown>();
  const committedArtifacts = new Map<string, unknown>();
  const executionRecords = new Map<ContentHash, unknown>();
  const executionContext = input.execution_context;
  const scope = executionContext?.scope ?? authoritativeFixtureScope;
  const runId = executionContext?.run_id ?? authoritativeFixtureRunId;
  const reference = <const T extends ArtifactReference["artifact_type"]>(
    artifactType: T,
    artifactId: string,
  ) => authoritativeFixtureReference(artifactType, artifactId, scope, runId);
  const sandboxIdentity =
    executionContext?.sandbox_identity ??
    ({
      authority_id: authoritativeFixtureUuid(4),
      principal_id: "metamorphic-sandbox-authority",
      key_id: "metamorphic-sandbox-key@1.0.0",
    } satisfies AuthorityIdentity);
  const sqlArtifactReference =
    executionContext?.sql_artifact_ref ?? reference("SqlArtifact", authoritativeFixtureUuid(10));
  const executionPermitReference =
    executionContext?.execution_permit_ref ??
    reference("ExecutionPermit", authoritativeFixtureUuid(11));
  const defaultResourceAdmissionReference = reference(
    "ResourceAdmissionReceipt",
    authoritativeFixtureUuid(12),
  );
  const defaultPolicyReceiptReference = reference("PolicyReceipt", authoritativeFixtureUuid(13));
  const queryContractReference =
    executionContext?.artifact_context.query_contract_ref ??
    reference("QueryContract", authoritativeFixtureUuid(14));
  const groundingPackageReference =
    executionContext?.artifact_context.grounding_package_ref ??
    reference("GroundingPackage", authoritativeFixtureUuid(15));
  const semanticQueryReference = authoritativeFixtureReference(
    "SemanticQuery",
    authoritativeFixtureUuid(16),
    scope,
    runId,
  );
  const logicalPlanReference =
    executionContext?.artifact_context.logical_plan_ref ??
    reference("LogicalPlan", authoritativeFixtureUuid(17));
  let lineage: Awaited<ReturnType<typeof createAuthoritativeMetamorphicLineage>> | null = null;
  let sqlArtifact: SqlArtifactPayloadContract;
  let executionPermit: ExecutionPermitPayload;
  if (executionContext) {
    sqlArtifact = sqlArtifactSchema.parse(executionContext.sql_artifact);
    executionPermit = executionPermitSchema.parse(executionContext.execution_permit);
  } else {
    lineage = await createAuthoritativeMetamorphicLineage({
      aggregate_kind: input.aggregate_kind ?? "sum",
      global_aggregate: input.global_aggregate ?? false,
      query_contract_ref: queryContractReference,
      grounding_package_ref: groundingPackageReference,
      semantic_query_ref: semanticQueryReference,
      logical_plan_ref: logicalPlanReference,
      semantic_release_ref: reference("SemanticRelease", authoritativeFixtureUuid(18)),
      schema_snapshot_ref: reference("SchemaSnapshot", authoritativeFixtureUuid(19)),
      policy_receipt_ref: defaultPolicyReceiptReference,
    });
    const settingsHash = await computePostgresqlExecutionSettingsHash(
      authoritativeFixtureExecutionSettings,
    );
    const sqlArtifactMaterial = {
      dialect: "postgresql",
      sql: [
        'SELECT "facts"."metric_value" AS "metric_value"',
        'FROM "governed_metamorphic_result" AS "facts"',
        'WHERE "facts"."occurred_at" >= $1::timestamptz',
        '  AND "facts"."occurred_at" < $2::timestamptz',
      ].join("\n"),
      parameters: {
        $1: lineage.query_contract.time_range.start,
        $2: lineage.query_contract.time_range.end,
      },
    } as const;
    sqlArtifact = sqlArtifactSchema.parse({
      artifact_type: "SqlArtifact",
      logical_plan_ref: logicalPlanReference,
      compiler_version: "postgresql-compiler@1.0.0",
      ast_hash: await sha256ContentHash("metamorphic-fixture-ast"),
      ...sqlArtifactMaterial,
      query_hash: await sha256ContentHash(sqlArtifactMaterial),
    });
    executionPermit = executionPermitSchema.parse({
      artifact_type: "ExecutionPermit",
      sql_artifact_ref: sqlArtifactReference,
      resource_admission_ref: defaultResourceAdmissionReference,
      gate_receipt_refs: Array.from({ length: 5 }, (_, index) =>
        reference("GateReceipt", authoritativeFixtureUuid(20 + index)),
      ),
      datasource_id: lineage.query_contract.datasource_id,
      schema_version: "commerce-schema@1.0.0",
      settings_hash: settingsHash,
      execution_settings: authoritativeFixtureExecutionSettings,
      principal_id: authoritativeFixturePrincipalId,
      policy_receipt_ref: defaultPolicyReceiptReference,
      budget: authoritativeFixtureBudget,
      issued_at: "2026-07-26T00:00:00.000Z",
      expires_at: "2026-07-26T00:05:00.000Z",
    });
  }
  const policyReceiptReference = executionPermit.policy_receipt_ref;
  const authorityEpoch = executionContext?.authority_epoch ?? 1;
  const artifactContext =
    executionContext?.artifact_context ??
    ({
      query_contract_ref: queryContractReference,
      grounding_package_ref: groundingPackageReference,
      logical_plan_ref: logicalPlanReference,
      applicability_profile: {
        suite: "ADDITIVE_INTEGER_V1",
        aggregate_kind: input.aggregate_kind ?? "sum",
        distinct: false,
        source_measure_data_type:
          input.aggregate_kind === "count" ? "not_applicable_for_count" : "integer",
        result_data_type: "INTEGER",
        metric_id: input.aggregate_kind === "count" ? "metric.order_count" : "metric.net_revenue",
        dimension_ids: input.global_aggregate ? [] : ["dimension.customer_segment"],
        group_key_arity: input.global_aggregate ? 0 : 1,
      },
    } satisfies AuthoritativeMetamorphicArtifactContext);
  const halfOpenBounds = deriveHalfOpenPartitionBounds(sqlArtifact);
  async function halfOpenVariant(
    label: "left-half-open" | "right-half-open",
    sequence: number,
  ): Promise<
    Readonly<{
      sql_artifact_ref: ArtifactReference & { readonly artifact_type: "SqlArtifact" };
      sql_artifact: SqlArtifactPayloadContract;
      execution_permit_ref: ArtifactReference & {
        readonly artifact_type: "ExecutionPermit";
      };
      execution_permit: ExecutionPermitPayload;
    }>
  > {
    const variantParameters =
      input.half_open_query_variants === "COMMENT_ONLY"
        ? sqlArtifact.parameters
        : {
            ...sqlArtifact.parameters,
            [halfOpenBounds.lower_placeholder]:
              label === "left-half-open" ? halfOpenBounds.start_at : halfOpenBounds.midpoint_at,
            [halfOpenBounds.upper_placeholder]:
              label === "left-half-open" ? halfOpenBounds.midpoint_at : halfOpenBounds.end_at,
          };
    const variantMaterial = {
      dialect: sqlArtifact.dialect,
      sql:
        input.half_open_query_variants === "COMMENT_ONLY"
          ? `${sqlArtifact.sql}\n/* metamorphic:${label} */`
          : sqlArtifact.sql,
      parameters: variantParameters,
    } as const;
    const variantSqlReference = reference("SqlArtifact", authoritativeFixtureUuid(sequence));
    const variantSql = sqlArtifactSchema.parse({
      ...sqlArtifact,
      ...variantMaterial,
      ast_hash: sqlArtifact.ast_hash,
      query_hash: await computeSqlArtifactQueryHash(variantMaterial),
    });
    const variantPermitReference = reference(
      "ExecutionPermit",
      authoritativeFixtureUuid(sequence + 1),
    );
    const variantPermit = executionPermitSchema.parse({
      ...executionPermit,
      sql_artifact_ref: variantSqlReference,
      resource_admission_ref: reference(
        "ResourceAdmissionReceipt",
        authoritativeFixtureUuid(sequence + 2),
      ),
    });
    return {
      sql_artifact_ref: variantSqlReference,
      sql_artifact: variantSql,
      execution_permit_ref: variantPermitReference,
      execution_permit: variantPermit,
    };
  }
  const leftHalfOpenVariant = await halfOpenVariant("left-half-open", 60);
  const rightHalfOpenVariant = await halfOpenVariant("right-half-open", 63);

  function commit(reference: ArtifactReference, payload: unknown): void {
    const identity = artifactReferenceIdentity(reference);
    committedArtifacts.set(identity, payload);
    authorityRecords.set(`artifact:${identity}`, payload);
  }

  if (lineage) {
    commit(queryContractReference, lineage.query_contract);
    commit(groundingPackageReference, lineage.grounding_package);
    commit(semanticQueryReference, lineage.semantic_query);
    commit(logicalPlanReference, lineage.logical_plan);
  }
  commit(sqlArtifactReference, sqlArtifact);
  commit(executionPermitReference, executionPermit);
  commit(leftHalfOpenVariant.sql_artifact_ref, leftHalfOpenVariant.sql_artifact);
  commit(leftHalfOpenVariant.execution_permit_ref, leftHalfOpenVariant.execution_permit);
  commit(rightHalfOpenVariant.sql_artifact_ref, rightHalfOpenVariant.sql_artifact);
  commit(rightHalfOpenVariant.execution_permit_ref, rightHalfOpenVariant.execution_permit);

  const rawEvidence = new Map<
    AuthoritativeMetamorphicExecutionLabel,
    Omit<AuthoritativeMetamorphicSandboxEvidence, "receipt" | "result">
  >();
  const globalAggregate =
    executionContext?.artifact_context.applicability_profile.group_key_arity === 0 ||
    (!executionContext && (input.global_aggregate ?? false));
  const metricId =
    executionContext?.artifact_context.applicability_profile.metric_id ??
    (input.aggregate_kind === "count" ? "metric.order_count" : "metric.net_revenue");
  const aggregateKind = artifactContext.applicability_profile.aggregate_kind;
  const columns =
    executionContext?.baseline.columns ??
    (globalAggregate
      ? ([{ name: metricId, type: "INTEGER" }] as const)
      : ([
          { name: "dimension.customer_segment", type: "STRING" },
          { name: metricId, type: "INTEGER" },
        ] as const));
  const baselineRows: FixtureRows =
    executionContext?.baseline.rows ??
    (globalAggregate
      ? ([[200]] as const)
      : ([
          ["new", 120],
          ["returning", 80],
        ] as const));
  const probeDimensionColumns = columns.slice(0, -1);
  const firstBaselineRow = baselineRows[0];
  const probeDimensionValues = firstBaselineRow?.slice(0, -1) ?? [];
  const baselineSnapshot =
    executionContext?.baseline.snapshot_token ?? authoritativeFixtureSnapshot;
  const definitions = [
    {
      label: "baseline",
      snapshot: baselineSnapshot,
      columns,
      rows: baselineRows,
    },
    {
      label: "fan_out",
      snapshot: metaFixtureSnapshots.fanOut,
      columns,
      rows: input.relation_rows?.fan_out ?? baselineRows,
    },
    {
      label: "null_anti_membership",
      snapshot: metaFixtureSnapshots.nullAntiMembership,
      columns,
      rows: input.relation_rows?.null_anti_membership ?? baselineRows,
    },
    {
      label: "left_partition",
      snapshot: baselineSnapshot,
      columns,
      rows:
        input.relation_rows?.left_partition ??
        (globalAggregate
          ? ([[70]] as const)
          : ([
              ["new", 40],
              ["returning", 30],
            ] as const)),
    },
    {
      label: "right_partition",
      snapshot: baselineSnapshot,
      columns,
      rows:
        input.relation_rows?.right_partition ??
        (globalAggregate
          ? ([[130]] as const)
          : ([
              ["new", 80],
              ["returning", 50],
            ] as const)),
    },
    {
      label: "same_valued_distinct_fact",
      snapshot: metaFixtureSnapshots.sameValuedFact,
      columns,
      rows:
        input.relation_rows?.same_valued_distinct_fact ??
        (globalAggregate
          ? ([[aggregateKind === "count" ? 201 : 210]] as const)
          : ([
              ["new", aggregateKind === "count" ? 121 : 130],
              ["returning", 80],
            ] as const)),
    },
    {
      label: "fan_out_selection_probe",
      snapshot: metaFixtureSnapshots.fanOut,
      columns: [
        { name: "fact_key", type: "STRING" },
        ...probeDimensionColumns,
        { name: "measure_minor_units", type: "INTEGER" },
      ],
      rows: input.selection_probe_rows?.fan_out_selection_probe ?? [
        ["order-100", ...probeDimensionValues, 10],
      ],
    },
    {
      label: "null_anti_membership_selection_probe",
      snapshot: metaFixtureSnapshots.nullAntiMembership,
      columns: [
        { name: "probe_key", type: "STRING" },
        ...probeDimensionColumns,
        { name: "measure_minor_units", type: "INTEGER" },
      ],
      rows: input.selection_probe_rows?.null_anti_membership_selection_probe ?? [
        ["eligible-customer", ...probeDimensionValues, 10],
      ],
    },
    {
      label: "half_open_selection_probe",
      snapshot: baselineSnapshot,
      columns: [
        { name: "boundary_fact_key", type: "STRING" },
        ...probeDimensionColumns,
        { name: "occurred_at", type: "STRING" },
        { name: "measure_minor_units", type: "INTEGER" },
      ],
      rows: input.selection_probe_rows?.half_open_selection_probe ?? [
        ["order-at-midpoint", ...probeDimensionValues, halfOpenBounds.midpoint_at, 10],
      ],
    },
    {
      label: "same_valued_distinct_selection_probe",
      snapshot: metaFixtureSnapshots.sameValuedFact,
      columns: [
        { name: "original_fact_key", type: "STRING" },
        ...probeDimensionColumns,
        { name: "occurred_at", type: "STRING" },
        { name: "measure_minor_units", type: "INTEGER" },
      ],
      rows: input.selection_probe_rows?.same_valued_distinct_selection_probe ?? [
        ["order-original", ...probeDimensionValues, "2026-02-10T00:00:00.000Z", 10],
      ],
    },
  ] as const satisfies readonly {
    readonly label: AuthoritativeMetamorphicExecutionLabel;
    readonly snapshot: string;
    readonly columns: readonly { readonly name: string; readonly type: string }[];
    readonly rows: FixtureRows;
  }[];

  for (const [index, definition] of definitions.entries()) {
    const executionId = authoritativeFixtureUuid(100 + index * 4);
    const receiptId = authoritativeFixtureUuid(101 + index * 4);
    const resultId = authoritativeFixtureUuid(102 + index * 4);
    const transactionId = authoritativeFixtureUuid(103 + index * 4);
    const executionBinding =
      input.half_open_query_variants !== "REUSE_BASELINE" && definition.label === "left_partition"
        ? leftHalfOpenVariant
        : input.half_open_query_variants !== "REUSE_BASELINE" &&
            definition.label === "right_partition"
          ? rightHalfOpenVariant
          : {
              sql_artifact_ref: sqlArtifactReference,
              sql_artifact: sqlArtifact,
              execution_permit_ref: executionPermitReference,
              execution_permit: executionPermit,
            };
    const evidencePermit = executionBinding.execution_permit;
    const evidenceSqlArtifact = executionBinding.sql_artifact;
    const request = sandboxExecutionRequestSchema.parse({
      schema_version: evidencePermit.schema_version,
      scope,
      run_id: runId,
      execution_id: executionId,
      idempotency_key: `metamorphic-${definition.label}`,
      language: "sql",
      payload: {
        dialect: "postgresql",
        sql_artifact_ref: executionBinding.sql_artifact_ref,
        execution_permit_ref: executionBinding.execution_permit_ref,
        resource_admission_ref: evidencePermit.resource_admission_ref,
        datasource_id: evidencePermit.datasource_id,
        settings_hash: evidencePermit.settings_hash,
        execution_settings: evidencePermit.execution_settings,
        snapshot_requirement: {
          mode: "REQUIRE_REPLAYABLE",
        },
        parameters: evidenceSqlArtifact.parameters,
      },
      budget: evidencePermit.budget,
    });
    if (request.language !== "sql") {
      throw new TypeError("Metamorphic Sandbox Fixture 只能生成 SQL Request。");
    }
    const inputHash = await computeSandboxExecutionRequestHash(request);
    const resultReference = reference("SandboxResult", resultId);
    const resultDraft = sandboxResultSchema.parse({
      schema_version: request.schema_version,
      result_ref: resultReference,
      scope,
      run_id: runId,
      execution_id: executionId,
      columns: definition.columns,
      rows: definition.rows,
      row_count: definition.rows.length,
      bytes: computeSandboxResultBytes({
        columns: definition.columns,
        rows: definition.rows,
      }),
      result_hash: resultReference.content_hash,
    });
    const resultHash = await computeSandboxResultHash(resultDraft);
    const result = sandboxResultSchema.parse({
      ...resultDraft,
      result_ref: {
        ...resultReference,
        content_hash: resultHash,
      },
      result_hash: resultHash,
    });
    const startedAt =
      executionContext?.baseline.started_at ??
      `2026-07-26T00:00:${String(index + 1).padStart(2, "0")}.000Z`;
    const completedAt =
      executionContext?.baseline.completed_at ??
      `2026-07-26T00:00:${String(index + 1).padStart(2, "0")}.050Z`;
    const authorityRevalidation = {
      effective_principal_id: evidencePermit.principal_id,
      policy_receipt_ref: evidencePermit.policy_receipt_ref,
      revalidated_at: startedAt,
      authority_epoch: authorityEpoch,
    } as const;
    const transaction = {
      transaction_id: transactionId,
      read_only: true,
      isolation_level: "REPEATABLE_READ",
    } as const;
    const resourceUsage = {
      elapsed_ms: 50,
      rows: result.row_count,
      bytes: result.bytes,
      peak_memory_mb: 8,
    } as const;
    const receiptReference = reference("SandboxExecutionReceipt", receiptId);
    const receiptDraft = successfulSandboxExecutionReceiptSchema.parse({
      schema_version: request.schema_version,
      language: "sql",
      executor: sandboxIdentity,
      executor_role: "SANDBOX_EXECUTION",
      authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
      receipt_id: receiptId,
      receipt_ref: receiptReference,
      scope,
      run_id: runId,
      execution_id: executionId,
      idempotency_key: request.idempotency_key,
      input_hash: inputHash,
      execution_hash: receiptReference.content_hash,
      terminal: "COMPLETED",
      reason_code: "EXECUTION_COMPLETED",
      started_at: startedAt,
      completed_at: completedAt,
      result_artifact_ref: result.result_ref,
      sql_artifact_ref: executionBinding.sql_artifact_ref,
      execution_permit_ref: executionBinding.execution_permit_ref,
      resource_admission_ref: evidencePermit.resource_admission_ref,
      datasource_id: evidencePermit.datasource_id,
      settings_hash: evidencePermit.settings_hash,
      execution_settings: evidencePermit.execution_settings,
      transaction,
      authority_revalidation: authorityRevalidation,
      snapshot_token: definition.snapshot,
      watermark: null,
      replay_state: "REPLAYABLE",
      resource_usage: resourceUsage,
    });
    const executionHash = await computeSandboxExecutionReceiptHash(receiptDraft);
    const receipt = successfulSandboxExecutionReceiptSchema.parse({
      ...receiptDraft,
      receipt_ref: {
        ...receiptReference,
        content_hash: executionHash,
      },
      execution_hash: executionHash,
    });
    const executionRecord = {
      request,
      started_at: startedAt,
      completed_at: completedAt,
      result_artifact_ref: result.result_ref,
      datasource_id: evidencePermit.datasource_id,
      schema_version: evidencePermit.schema_version,
      settings_hash: evidencePermit.settings_hash,
      applied_execution_settings: evidencePermit.execution_settings,
      transaction,
      authority_revalidation: authorityRevalidation,
      snapshot: {
        snapshot_token: definition.snapshot,
        watermark: null,
        replay_state: "REPLAYABLE",
      },
      resource_usage: resourceUsage,
    } as const;
    commit(result.result_ref, result);
    commit(receipt.receipt_ref, receipt);
    executionRecords.set(inputHash, executionRecord);
    authorityRecords.set(`request:${inputHash}`, request);
    authorityRecords.set(`execution-record:${inputHash}`, executionRecord);
    rawEvidence.set(definition.label, {
      request,
      execution_record: executionRecord,
      execution_permit: evidencePermit,
      sql_artifact: evidenceSqlArtifact,
      raw_receipt: receipt,
      raw_result: result,
    });
  }

  const registration = {
    identity: sandboxIdentity,
    resolveCommitted: async (reference: ArtifactReference) =>
      committedArtifacts.get(artifactReferenceIdentity(reference)) ?? null,
    verifyCommitted: async (reference: ArtifactReference) =>
      committedArtifacts.has(artifactReferenceIdentity(reference)),
    resolveAuthoritativeExecutionPermit: async (reference: ArtifactReference) => {
      const identity = artifactReferenceIdentity(reference);
      return identity === artifactReferenceIdentity(executionPermitReference)
        ? executionPermit
        : identity === artifactReferenceIdentity(leftHalfOpenVariant.execution_permit_ref)
          ? leftHalfOpenVariant.execution_permit
          : identity === artifactReferenceIdentity(rightHalfOpenVariant.execution_permit_ref)
            ? rightHalfOpenVariant.execution_permit
            : null;
    },
    resolveAuthoritativeSqlArtifact: async (reference: ArtifactReference) => {
      const identity = artifactReferenceIdentity(reference);
      return identity === artifactReferenceIdentity(sqlArtifactReference)
        ? sqlArtifact
        : identity === artifactReferenceIdentity(leftHalfOpenVariant.sql_artifact_ref)
          ? leftHalfOpenVariant.sql_artifact
          : identity === artifactReferenceIdentity(rightHalfOpenVariant.sql_artifact_ref)
            ? rightHalfOpenVariant.sql_artifact
            : null;
    },
    verifyExactArtifactRevision: async (reference: ArtifactReference, artifact: unknown) => {
      const committed = committedArtifacts.get(artifactReferenceIdentity(reference));
      return committed !== undefined && canonicalizeJson(committed) === canonicalizeJson(artifact);
    },
    revalidateExecutionAuthority: async (
      request: Parameters<SandboxServerAuthorityRegistration["revalidateExecutionAuthority"]>[0],
    ) => ({
      effective_principal_id: executionPermit.principal_id,
      policy_receipt_ref: policyReceiptReference,
      revalidated_at: request.transaction_started_at,
      authority_epoch: authorityEpoch,
    }),
    assertAuthorityFence: async () => true,
    withSqlTransaction: async <T>(operation: () => Promise<T>) => operation(),
    claimOrLoadExecution: async <T>(
      _claim: Parameters<SandboxServerAuthorityRegistration["claimOrLoadExecution"]>[0],
      operation: () => Promise<T>,
    ) => ({
      status: "EXECUTED" as const,
      value: await operation(),
    }),
    resolveExecutionRecord: async (inputHash: ContentHash) =>
      executionRecords.get(inputHash) ?? null,
    now: () => new Date(executionContext?.baseline.completed_at ?? "2026-07-26T00:30:00.000Z"),
  } satisfies SandboxServerAuthorityRegistration;
  const authority = registerSandboxServerAuthority(registration);
  const evidenceEntries = await Promise.all(
    [...rawEvidence].map(async ([label, raw]) => {
      const result = await authorizeSandboxResult(raw.raw_result.result_ref, authority);
      const receipt = await authorizeSandboxExecutionReceipt(
        raw.raw_receipt.receipt_ref,
        authority,
      );
      return [
        label,
        {
          ...raw,
          receipt,
          result,
        },
      ] as const;
    }),
  );
  const firstEvidence = evidenceEntries[0]?.[1];
  const authoritativeSandboxIdentity = firstEvidence
    ? getAuthoritativeSandboxExecutionIdentity(firstEvidence.receipt)
    : null;
  if (!authoritativeSandboxIdentity) {
    throw new TypeError("Metamorphic Sandbox Fixture 缺少权威 Sandbox Execution Identity。");
  }

  return {
    authority_records: authorityRecords,
    committed_artifacts: committedArtifacts,
    execution_records: executionRecords,
    sandbox_authority: authority,
    sandbox_execution_identity: authoritativeSandboxIdentity,
    artifact_context: artifactContext,
    evidence: Object.fromEntries(evidenceEntries) as Readonly<
      Record<AuthoritativeMetamorphicExecutionLabel, AuthoritativeMetamorphicSandboxEvidence>
    >,
  };
}

export interface AuthoritativeMetamorphicOracleFixtureInput {
  readonly sandbox_fixture: AuthoritativeMetamorphicSandboxContext;
  readonly evaluated_at: string;
  /**
   * 仅用于构造“声明与固定算法一致”的权威 FAIL。省略时四项都声明 PASS；
   * 若原始行实际失败却仍声明 PASS，Verifier 必须拒绝品牌化整张 Receipt。
   */
  readonly relation_verdicts?: Readonly<
    Partial<
      Record<MetamorphicOracleReceipt["relation_samples"][number]["relation_kind"], "PASS" | "FAIL">
    >
  >;
  /**
   * Integration tests can reuse their current committed store. When omitted, the standalone
   * Sandbox fixture's mutable authority maps are used.
   */
  readonly store_adapter?: MetamorphicFixtureStore;
  /**
   * Exact current-run lineage/profile. Gate-matrix tests pass their real QueryContract,
   * GroundingPackage and LogicalPlan refs here instead of accepting standalone defaults.
   */
  readonly artifact_context?: AuthoritativeMetamorphicArtifactContext;
  readonly applicability_profile?: MetamorphicFixtureReceipt["applicability_profile"];
  readonly mutation_record_binding?: "EXACT" | "FAN_OUT_WRONG_CASE";
  readonly identity_overrides?: Readonly<
    Partial<{
      fixture_mutation: AuthorityIdentity;
      metamorphic_verifier: AuthorityIdentity;
      result_producer: AuthorityIdentity;
    }>
  >;
}

type FixtureAuthorityIdentities = Readonly<{
  fixture_mutation: AuthorityIdentity & { readonly role: "FIXTURE_MUTATION" };
  sandbox_execution: AuthorityIdentity & { readonly role: "SANDBOX_EXECUTION" };
  metamorphic_verifier: AuthorityIdentity & { readonly role: "METAMORPHIC_VERIFIER" };
  result_producer: AuthorityIdentity & { readonly role: "RESULT_PRODUCER" };
}>;

type AuthoritativeMetamorphicOracleFixture = Readonly<{
  fixture_receipt: MetamorphicFixtureReceipt;
  receipt: MetamorphicOracleReceipt;
  authority_identities: FixtureAuthorityIdentities;
  fixture_authority: TrustedMetamorphicFixtureAuthority;
  verifier: ReturnType<typeof registerTrustedMetamorphicOracleVerifier>;
  store_adapter: MetamorphicFixtureStore;
}>;

function evidenceBinding(
  evidence: Pick<AuthoritativeMetamorphicSandboxEvidence, "receipt" | "result">,
): MetamorphicOracleReceipt["baseline"] {
  return {
    sandbox_execution_receipt_ref: evidence.receipt.receipt_ref,
    result_artifact_ref: evidence.result.result_ref,
  };
}

async function prepareAuthoritativeMetamorphicOracleFixture(
  input: AuthoritativeMetamorphicOracleFixtureInput,
): Promise<
  Readonly<{
    fixture_receipt: MetamorphicFixtureReceipt;
    receipt: MetamorphicOracleReceipt;
    authority_identities: FixtureAuthorityIdentities;
    store_adapter: MetamorphicFixtureStore;
  }>
> {
  const { sandbox_fixture: sandbox } = input;
  const baseline = sandbox.evidence.baseline;
  const baselineSnapshot = baseline.receipt.snapshot_token;
  if (!baselineSnapshot) {
    throw new TypeError("Metamorphic Fixture Baseline 必须绑定可重放 Snapshot。");
  }
  const fixtureMutationIdentity =
    input.identity_overrides?.fixture_mutation ??
    ({
      authority_id: authoritativeFixtureUuid(201),
      principal_id: "metamorphic-fixture-authority",
      key_id: "metamorphic-fixture-key@1.0.0",
    } satisfies AuthorityIdentity);
  const metamorphicVerifierIdentity =
    input.identity_overrides?.metamorphic_verifier ??
    ({
      authority_id: authoritativeFixtureUuid(202),
      principal_id: "metamorphic-verifier-authority",
      key_id: "metamorphic-verifier-key@1.0.0",
    } satisfies AuthorityIdentity);
  const resultProducerIdentity =
    input.identity_overrides?.result_producer ??
    ({
      authority_id: authoritativeFixtureUuid(203),
      principal_id: "metamorphic-result-producer-authority",
      key_id: "metamorphic-result-producer-key@1.0.0",
    } satisfies AuthorityIdentity);
  const authorityIdentities = {
    fixture_mutation: {
      ...fixtureMutationIdentity,
      role: "FIXTURE_MUTATION",
    },
    sandbox_execution: {
      ...sandbox.sandbox_execution_identity.identity,
      role: "SANDBOX_EXECUTION",
    },
    metamorphic_verifier: {
      ...metamorphicVerifierIdentity,
      role: "METAMORPHIC_VERIFIER",
    },
    result_producer: {
      ...resultProducerIdentity,
      role: "RESULT_PRODUCER",
    },
  } as const satisfies FixtureAuthorityIdentities;
  let storeAdapter = input.store_adapter;
  const sandboxCommittedArtifacts = sandbox.committed_artifacts;
  const sandboxAuthorityRecords = sandbox.authority_records;
  if (storeAdapter && sandboxCommittedArtifacts) {
    const upstream = storeAdapter;
    const upstreamResolveCommitted = upstream.resolveCommitted.bind(upstream);
    const upstreamVerifyCommitted = upstream.verifyCommitted.bind(upstream);
    const upstreamVerifyExactArtifactRevision = upstream.verifyExactArtifactRevision.bind(upstream);
    const upstreamCommit = upstream.commit.bind(upstream);
    const upstreamNow = upstream.now.bind(upstream);
    storeAdapter = {
      async resolveCommitted(reference) {
        const identity = artifactReferenceIdentity(reference);
        return sandboxCommittedArtifacts.has(identity)
          ? (sandboxCommittedArtifacts.get(identity) ?? null)
          : upstreamResolveCommitted(reference);
      },
      async verifyCommitted(reference) {
        return (
          sandboxCommittedArtifacts.has(artifactReferenceIdentity(reference)) ||
          upstreamVerifyCommitted(reference)
        );
      },
      async verifyExactArtifactRevision(reference, artifact) {
        const identity = artifactReferenceIdentity(reference);
        if (!sandboxCommittedArtifacts.has(identity)) {
          return upstreamVerifyExactArtifactRevision(reference, artifact);
        }
        const committed = sandboxCommittedArtifacts.get(identity);
        return (
          committed !== undefined && canonicalizeJson(committed) === canonicalizeJson(artifact)
        );
      },
      now: upstreamNow,
      commit(reference, payload) {
        const identity = artifactReferenceIdentity(reference);
        sandboxCommittedArtifacts.set(identity, payload);
        sandboxAuthorityRecords?.set(`artifact:${identity}`, payload);
        upstreamCommit(reference, payload);
      },
    };
  }
  if (!storeAdapter) {
    const committedArtifacts = sandboxCommittedArtifacts;
    const authorityRecords = sandboxAuthorityRecords;
    if (!committedArtifacts || !authorityRecords) {
      throw new TypeError("外部 Metamorphic Sandbox Context 必须提供 store_adapter。");
    }
    storeAdapter = {
      async resolveCommitted(reference) {
        return committedArtifacts.get(artifactReferenceIdentity(reference)) ?? null;
      },
      async verifyCommitted(reference) {
        return committedArtifacts.has(artifactReferenceIdentity(reference));
      },
      async verifyExactArtifactRevision(reference, artifact) {
        const committed = committedArtifacts.get(artifactReferenceIdentity(reference));
        return (
          committed !== undefined && canonicalizeJson(committed) === canonicalizeJson(artifact)
        );
      },
      now: () => input.evaluated_at,
      commit(reference, payload) {
        const identity = artifactReferenceIdentity(reference);
        committedArtifacts.set(identity, payload);
        authorityRecords.set(`artifact:${identity}`, payload);
      },
    };
  }
  const artifactContext = input.artifact_context ?? sandbox.artifact_context;
  const queryContractReference =
    artifactContext?.query_contract_ref ??
    systemReference(baseline.receipt.receipt_ref, "QueryContract", authoritativeFixtureUuid(210));
  const groundingPackageReference =
    artifactContext?.grounding_package_ref ??
    systemReference(
      baseline.receipt.receipt_ref,
      "GroundingPackage",
      authoritativeFixtureUuid(211),
    );
  const logicalPlanReference =
    artifactContext?.logical_plan_ref ??
    systemReference(baseline.receipt.receipt_ref, "LogicalPlan", authoritativeFixtureUuid(212));
  const globalAggregate = baseline.result.columns.length === 1;
  const groupKey = canonicalizeJson(globalAggregate ? [] : ["new"]);
  const applicabilityProfile =
    input.applicability_profile ??
    artifactContext?.applicability_profile ??
    ({
      suite: "ADDITIVE_INTEGER_V1",
      aggregate_kind: "sum",
      distinct: false,
      source_measure_data_type: "integer",
      result_data_type: "INTEGER",
      metric_id: baseline.result.columns.at(-1)?.name ?? "metric.net_revenue",
      dimension_ids: globalAggregate
        ? []
        : baseline.result.columns.slice(0, -1).map(({ name }) => name),
      group_key_arity: globalAggregate ? 0 : 1,
    } as const);
  const halfOpenBounds = deriveHalfOpenPartitionBounds(baseline.sql_artifact);
  const witnesses = {
    fan_out: {
      fact_key: "order-100",
      group_key: groupKey,
      join_path: ["orders.order_items"],
      original_child_key: "line-100",
      added_child_key: "line-101",
      measure_minor_units: 10,
      baseline_multiplicity: 1,
      follow_up_multiplicity: 2,
    },
    null_anti_membership: {
      probe_key: "eligible-customer",
      inserted_null_row_key: "anti-membership-null-row",
      group_key: groupKey,
      measure_minor_units: 10,
    },
    half_open: {
      group_key: groupKey,
      start_at: halfOpenBounds.start_at,
      midpoint_at: halfOpenBounds.midpoint_at,
      end_at: halfOpenBounds.end_at,
      boundary_fact_key: "order-at-midpoint",
      boundary_measure_minor_units: 10,
    },
    same_valued_distinct: {
      original_fact_key: "order-original",
      added_fact_key: "order-same-valued",
      group_key: groupKey,
      occurred_at: "2026-02-10T00:00:00.000Z",
      measure_minor_units: 10,
    },
  } as const;
  const singleMutations = [
    {
      relation_kind: "FAN_OUT",
      case_id: metaFixtureIds.fanOutCase,
      follow_up_snapshot_id: sandbox.evidence.fan_out.receipt.snapshot_token,
      witness: witnesses.fan_out,
      sequence: 220,
    },
    {
      relation_kind: "NULL_ANTI_MEMBERSHIP",
      case_id: metaFixtureIds.nullCase,
      follow_up_snapshot_id: sandbox.evidence.null_anti_membership.receipt.snapshot_token,
      witness: witnesses.null_anti_membership,
      sequence: 221,
    },
    {
      relation_kind: "SAME_VALUED_DISTINCT_FACT",
      case_id: metaFixtureIds.distinctCase,
      follow_up_snapshot_id: sandbox.evidence.same_valued_distinct_fact.receipt.snapshot_token,
      witness: witnesses.same_valued_distinct,
      sequence: 222,
    },
  ] as const;
  const mutationBindings = await Promise.all(
    singleMutations.map(async (mutation) => {
      if (!mutation.follow_up_snapshot_id) {
        throw new TypeError("Single-mutation Fixture 必须绑定 Follow-up Snapshot。");
      }
      const descriptor = fixtureMutationRecordSchema.parse({
        artifact_type: "FixtureMutationRecord",
        scope: baseline.receipt.scope,
        run_id: baseline.receipt.run_id,
        case_id:
          input.mutation_record_binding === "FAN_OUT_WRONG_CASE" &&
          mutation.relation_kind === "FAN_OUT"
            ? metaFixtureIds.nullCase
            : mutation.case_id,
        relation_kind: mutation.relation_kind,
        baseline_snapshot_id: baselineSnapshot,
        follow_up_snapshot_id: mutation.follow_up_snapshot_id,
        witness: mutation.witness,
      });
      const descriptorHash = await computeFixtureMutationRecordHash(descriptor);
      const mutationReference = {
        ...systemReference(
          baseline.receipt.receipt_ref,
          "FixtureMutationRecord",
          authoritativeFixtureUuid(mutation.sequence),
        ),
        content_hash: descriptorHash,
      };
      storeAdapter.commit(mutationReference, descriptor);
      return {
        mutation_record_ref: mutationReference,
        mutation_descriptor_hash: descriptorHash,
      };
    }),
  );
  const [fanMutation, nullMutation, distinctMutation] = mutationBindings;
  if (!fanMutation || !nullMutation || !distinctMutation) {
    throw new TypeError("Metamorphic Fixture 必须包含三个 single-mutation record。");
  }
  const fixtureCases = [
    {
      relation_kind: "FAN_OUT",
      case_id: metaFixtureIds.fanOutCase,
      follow_up_snapshot_id: metaFixtureSnapshots.fanOut,
      follow_up_execution_input_hash: sandbox.evidence.fan_out.receipt.input_hash,
      selection_probe: evidenceBinding(sandbox.evidence.fan_out_selection_probe),
      selection_probe_input_hash: sandbox.evidence.fan_out_selection_probe.receipt.input_hash,
      ...fanMutation,
      witness: witnesses.fan_out,
    },
    {
      relation_kind: "NULL_ANTI_MEMBERSHIP",
      case_id: metaFixtureIds.nullCase,
      follow_up_snapshot_id: metaFixtureSnapshots.nullAntiMembership,
      follow_up_execution_input_hash: sandbox.evidence.null_anti_membership.receipt.input_hash,
      selection_probe: evidenceBinding(sandbox.evidence.null_anti_membership_selection_probe),
      selection_probe_input_hash:
        sandbox.evidence.null_anti_membership_selection_probe.receipt.input_hash,
      ...nullMutation,
      witness: witnesses.null_anti_membership,
    },
    {
      relation_kind: "HALF_OPEN_ADDITIVE_PARTITION",
      case_id: metaFixtureIds.partitionCase,
      snapshot_id: baselineSnapshot,
      whole_execution_input_hash: baseline.receipt.input_hash,
      left_execution_input_hash: sandbox.evidence.left_partition.receipt.input_hash,
      right_execution_input_hash: sandbox.evidence.right_partition.receipt.input_hash,
      selection_probe: evidenceBinding(sandbox.evidence.half_open_selection_probe),
      selection_probe_input_hash: sandbox.evidence.half_open_selection_probe.receipt.input_hash,
      query_variant_hashes: {
        whole: sandbox.evidence.baseline.sql_artifact.query_hash,
        left_half_open: sandbox.evidence.left_partition.sql_artifact.query_hash,
        right_half_open: sandbox.evidence.right_partition.sql_artifact.query_hash,
      },
      witness: witnesses.half_open,
    },
    {
      relation_kind: "SAME_VALUED_DISTINCT_FACT",
      case_id: metaFixtureIds.distinctCase,
      follow_up_snapshot_id: metaFixtureSnapshots.sameValuedFact,
      follow_up_execution_input_hash: sandbox.evidence.same_valued_distinct_fact.receipt.input_hash,
      selection_probe: evidenceBinding(sandbox.evidence.same_valued_distinct_selection_probe),
      selection_probe_input_hash:
        sandbox.evidence.same_valued_distinct_selection_probe.receipt.input_hash,
      ...distinctMutation,
      witness: witnesses.same_valued_distinct,
    },
  ] as const;
  const fixtureReference = systemReference(
    baseline.receipt.receipt_ref,
    "MetamorphicFixtureReceipt",
    authoritativeFixtureUuid(230),
  );
  const fixtureEvidence = {
    sql_artifact_ref: baseline.receipt.sql_artifact_ref,
    query_contract_ref: queryContractReference,
    grounding_package_ref: groundingPackageReference,
    logical_plan_ref: logicalPlanReference,
    oracle_id: "text2sql-metamorphic-oracle",
    oracle_version: "text2sql-metamorphic-oracle@1.0.0",
    fixture_id: "commerce-metamorphic-fixture",
    fixture_version: "commerce-metamorphic-fixture@1.0.0",
    issuer: fixtureMutationIdentity,
    issuer_role: "FIXTURE_MUTATION",
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
    applicability_profile: applicabilityProfile,
    baseline: {
      snapshot_id: baselineSnapshot,
      execution_input_hash: baseline.receipt.input_hash,
    },
    cases: fixtureCases,
  } as const;
  const fixtureDraft = metamorphicFixtureReceiptSchema.parse({
    artifact_type: "MetamorphicFixtureReceipt",
    receipt_ref: fixtureReference,
    scope: baseline.receipt.scope,
    run_id: baseline.receipt.run_id,
    ...fixtureEvidence,
    evidence_hash: await computeMetamorphicFixtureEvidenceHash(fixtureEvidence),
    issued_at: input.evaluated_at,
    receipt_hash: fixtureReference.content_hash,
  });
  const fixtureReceiptHash = await computeMetamorphicFixtureReceiptHash(fixtureDraft);
  const fixtureReceipt = metamorphicFixtureReceiptSchema.parse({
    ...fixtureDraft,
    receipt_ref: {
      ...fixtureReference,
      content_hash: fixtureReceiptHash,
    },
    receipt_hash: fixtureReceiptHash,
  });
  storeAdapter.commit(fixtureReceipt.receipt_ref, fixtureReceipt);

  const relationMaterials = [
    {
      relation_kind: "FAN_OUT",
      case_id: metaFixtureIds.fanOutCase,
      follow_up_snapshot_id: metaFixtureSnapshots.fanOut,
      follow_up: evidenceBinding(sandbox.evidence.fan_out),
      witness: witnesses.fan_out,
      verdict: input.relation_verdicts?.FAN_OUT ?? "PASS",
    },
    {
      relation_kind: "NULL_ANTI_MEMBERSHIP",
      case_id: metaFixtureIds.nullCase,
      follow_up_snapshot_id: metaFixtureSnapshots.nullAntiMembership,
      follow_up: evidenceBinding(sandbox.evidence.null_anti_membership),
      witness: witnesses.null_anti_membership,
      verdict: input.relation_verdicts?.NULL_ANTI_MEMBERSHIP ?? "PASS",
    },
    {
      relation_kind: "HALF_OPEN_ADDITIVE_PARTITION",
      case_id: metaFixtureIds.partitionCase,
      whole_source: "METAMORPHIC_BASELINE",
      snapshot_id: baselineSnapshot,
      left_partition: evidenceBinding(sandbox.evidence.left_partition),
      right_partition: evidenceBinding(sandbox.evidence.right_partition),
      witness: witnesses.half_open,
      verdict: input.relation_verdicts?.HALF_OPEN_ADDITIVE_PARTITION ?? "PASS",
    },
    {
      relation_kind: "SAME_VALUED_DISTINCT_FACT",
      case_id: metaFixtureIds.distinctCase,
      follow_up_snapshot_id: metaFixtureSnapshots.sameValuedFact,
      follow_up: evidenceBinding(sandbox.evidence.same_valued_distinct_fact),
      witness: witnesses.same_valued_distinct,
      verdict: input.relation_verdicts?.SAME_VALUED_DISTINCT_FACT ?? "PASS",
    },
  ] as const;
  const relationSamples = await Promise.all(
    relationMaterials.map(async (material) => ({
      ...material,
      sample_hash: await computeMetamorphicRelationSampleHash(material),
    })),
  );
  const receiptReference = systemReference(
    baseline.receipt.receipt_ref,
    "MetamorphicOracleReceipt",
    metaFixtureIds.receipt,
  );
  const oracleEvidence = {
    sql_artifact_ref: baseline.receipt.sql_artifact_ref,
    fixture_receipt_ref: fixtureReceipt.receipt_ref,
    verifier: metamorphicVerifierIdentity,
    verifier_role: "METAMORPHIC_VERIFIER",
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
    baseline: evidenceBinding(baseline),
    relation_samples: relationSamples,
    metamorphic_verdict: relationSamples.every(({ verdict }) => verdict === "PASS")
      ? ("PASS" as const)
      : ("FAIL" as const),
  } as const;
  const receiptDraft = metamorphicOracleReceiptSchema.parse({
    artifact_type: "MetamorphicOracleReceipt",
    receipt_ref: receiptReference,
    scope: baseline.receipt.scope,
    run_id: baseline.receipt.run_id,
    ...oracleEvidence,
    evidence_hash: await computeMetamorphicOracleEvidenceHash(oracleEvidence),
    evaluated_at: input.evaluated_at,
    receipt_hash: receiptReference.content_hash,
  });
  const receiptHash = await computeMetamorphicOracleReceiptHash(receiptDraft);
  const receipt = metamorphicOracleReceiptSchema.parse({
    ...receiptDraft,
    receipt_ref: {
      ...receiptReference,
      content_hash: receiptHash,
    },
    receipt_hash: receiptHash,
  });
  storeAdapter.commit(receipt.receipt_ref, receipt);
  return {
    fixture_receipt: fixtureReceipt,
    receipt,
    authority_identities: authorityIdentities,
    store_adapter: storeAdapter,
  };
}

function systemReference<const T extends ArtifactReference["artifact_type"]>(
  baseline: ArtifactReference,
  artifactType: T,
  artifactId: string,
): ArtifactReference & { readonly artifact_type: T } {
  return {
    app_id: baseline.app_id,
    tenant_id: baseline.tenant_id,
    environment: baseline.environment,
    run_id: baseline.run_id,
    artifact_id: artifactId,
    artifact_type: artifactType,
    revision: 1,
    content_hash: `sha256:${"0".repeat(64)}`,
  };
}

export async function createMetamorphicOracleFixture(
  input: AuthoritativeMetamorphicOracleFixtureInput,
): Promise<AuthoritativeMetamorphicOracleFixture> {
  const prepared = await prepareAuthoritativeMetamorphicOracleFixture(input);
  const resolveCommitted = prepared.store_adapter.resolveCommitted.bind(prepared.store_adapter);
  const verifyCommitted = prepared.store_adapter.verifyCommitted.bind(prepared.store_adapter);
  const verifyExactArtifactRevision = prepared.store_adapter.verifyExactArtifactRevision.bind(
    prepared.store_adapter,
  );
  const fixtureRegistration = {
    identity: prepared.fixture_receipt.issuer,
    sandbox_authority: input.sandbox_fixture.sandbox_authority,
    resolveCommitted,
    verifyCommitted,
    verifyExactArtifactRevision,
  };
  const fixtureAuthority = registerTrustedMetamorphicFixtureAuthority(fixtureRegistration);
  const verifierRegistration = {
    identity: prepared.receipt.verifier,
    fixture_authority: fixtureAuthority,
    sandbox_authority: input.sandbox_fixture.sandbox_authority,
    resolveCommitted,
    verifyCommitted,
    verifyExactArtifactRevision,
    now: () => input.evaluated_at,
  };
  return {
    ...prepared,
    fixture_authority: fixtureAuthority,
    verifier: registerTrustedMetamorphicOracleVerifier(verifierRegistration),
  };
}
