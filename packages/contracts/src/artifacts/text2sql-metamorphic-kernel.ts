import { canonicalizeJson, deepFreeze } from "../common/index.js";
import type {
  AuthoritativeSandboxExecutionIdentity,
  AuthoritativeSandboxExecutionReceipt,
  AuthoritativeSandboxResult,
  SandboxResult,
} from "../ports/sandbox.js";
import { type ArtifactReference, artifactReferenceIdentity } from "./envelope.js";
import {
  computeSqlArtifactQueryHash,
  groundingPackageSchema,
  logicalPlanSchema,
  queryContractSchema,
  semanticQuerySchema,
  sqlArtifactSchema,
} from "./l2.js";
import {
  canonicalizeAuthorityIdentityComparisonValue,
  computeFixtureMutationRecordHash,
  type FixtureMutationRecord,
  type MetamorphicFixtureReceipt,
  type MetamorphicOracleReceipt,
  type ResultOracleReceipt,
} from "./text2sql-evidence.js";

export type MetamorphicKernelStore = Readonly<{
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  verifyExactArtifactRevision(reference: ArtifactReference, artifact: unknown): Promise<boolean>;
}>;

export type MetamorphicKernelSandboxEvidence = Readonly<{
  receipt: AuthoritativeSandboxExecutionReceipt;
  result: AuthoritativeSandboxResult;
  execution_identity: AuthoritativeSandboxExecutionIdentity;
}>;

export type MetamorphicFixtureKernelInput = Readonly<{
  receipt: MetamorphicFixtureReceipt;
  mutation_records: readonly Readonly<{
    reference: ArtifactReference;
    record: FixtureMutationRecord;
  }>[];
  selection_probes: readonly MetamorphicKernelSandboxEvidence[];
}>;

export type MetamorphicOracleKernelInput = Readonly<{
  receipt: MetamorphicOracleReceipt;
  fixture: MetamorphicFixtureReceipt;
  selection_probes: readonly MetamorphicKernelSandboxEvidence[];
  baseline: MetamorphicKernelSandboxEvidence;
  relation_evidence: readonly MetamorphicKernelSandboxEvidence[];
}>;

export type MetamorphicKernelRelationVerification = Readonly<{
  relation_kind: MetamorphicOracleReceipt["relation_samples"][number]["relation_kind"];
  declared_verdict: "PASS" | "FAIL";
  computed_verdict: "PASS" | "FAIL";
}>;

export type MetamorphicOracleKernelProjection = Readonly<{
  relation_verifications: readonly MetamorphicKernelRelationVerification[];
  computed_verdict: "PASS" | "FAIL";
}>;

type MetamorphicRelationSample = MetamorphicOracleReceipt["relation_samples"][number];
type MetamorphicApplicabilityProfile = MetamorphicFixtureReceipt["applicability_profile"];

function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function resultDataIdentity(result: SandboxResult): string {
  const rowCounts = new Map<string, number>();
  for (const row of result.rows) {
    const rowIdentity = canonicalizeJson(row);
    rowCounts.set(rowIdentity, (rowCounts.get(rowIdentity) ?? 0) + 1);
  }
  return canonicalizeJson({
    columns: result.columns,
    row_multiset: [...rowCounts].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  });
}

function equalResultData(left: SandboxResult, right: SandboxResult): boolean {
  return resultDataIdentity(left) === resultDataIdentity(right);
}

type IntegerAggregate = Readonly<{
  columns_identity: string;
  values: ReadonlyMap<string, number>;
}>;

function integerAggregate(
  result: SandboxResult,
  profile: MetamorphicApplicabilityProfile,
  options: Readonly<{ allow_empty_grouped_rows?: boolean }> = {},
): IntegerAggregate | null {
  const expectedColumnNames = [...profile.dimension_ids, profile.metric_id];
  if (
    (result.rows.length === 0 &&
      (!options.allow_empty_grouped_rows || profile.group_key_arity === 0)) ||
    result.columns.length !== profile.group_key_arity + 1 ||
    !result.columns.every(({ name }, index) => name === expectedColumnNames[index])
  ) {
    return null;
  }
  const measureColumn = result.columns.at(-1);
  if (!measureColumn || measureColumn.type !== profile.result_data_type) return null;
  const values = new Map<string, number>();
  for (const row of result.rows) {
    if (row.length !== result.columns.length) return null;
    const value = row.at(-1);
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      (profile.aggregate_kind === "count" && value < 0)
    ) {
      return null;
    }
    const groupKey = canonicalizeJson(row.slice(0, -1));
    if (values.has(groupKey)) return null;
    values.set(groupKey, value);
  }
  return {
    columns_identity: canonicalizeJson(result.columns),
    values,
  };
}

function exactKeySet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

function verifyAdditivePartition(
  wholeResult: SandboxResult,
  leftResult: SandboxResult,
  rightResult: SandboxResult,
  profile: MetamorphicApplicabilityProfile,
): boolean {
  const whole = integerAggregate(wholeResult, profile);
  const left = integerAggregate(leftResult, profile, {
    allow_empty_grouped_rows: true,
  });
  const right = integerAggregate(rightResult, profile);
  if (
    !whole ||
    !left ||
    !right ||
    whole.columns_identity !== left.columns_identity ||
    whole.columns_identity !== right.columns_identity
  ) {
    return false;
  }
  const partitionKeys = new Set([...left.values.keys(), ...right.values.keys()]);
  if (!exactKeySet(new Set(whole.values.keys()), partitionKeys)) return false;
  return [...whole.values].every(([key, value]) => {
    const partitionValue = (left.values.get(key) ?? 0) + (right.values.get(key) ?? 0);
    return Number.isSafeInteger(partitionValue) && value === partitionValue;
  });
}

function verifySameValuedDistinctFact(
  baselineResult: SandboxResult,
  followUpResult: SandboxResult,
  groupKey: string,
  measureMinorUnits: number,
  profile: MetamorphicApplicabilityProfile,
): boolean {
  const baseline = integerAggregate(baselineResult, profile);
  const followUp = integerAggregate(followUpResult, profile);
  if (
    !baseline ||
    !followUp ||
    baseline.columns_identity !== followUp.columns_identity ||
    !exactKeySet(new Set(baseline.values.keys()), new Set(followUp.values.keys())) ||
    !baseline.values.has(groupKey)
  ) {
    return false;
  }
  const expectedDelta = profile.aggregate_kind === "count" ? 1 : measureMinorUnits;
  return [...baseline.values].every(([key, value]) => {
    const expected = key === groupKey ? value + expectedDelta : value;
    return Number.isSafeInteger(expected) && followUp.values.get(key) === expected;
  });
}

function assertNever(value: never): never {
  throw new TypeError(`TEXT2SQL_METAMORPHIC_RELATION_UNSUPPORTED:${String(value)}`);
}

function sameExecutionDomain(
  baseline: MetamorphicKernelSandboxEvidence,
  candidate: MetamorphicKernelSandboxEvidence,
): boolean {
  const left = baseline.receipt;
  const right = candidate.receipt;
  return (
    left.datasource_id === right.datasource_id &&
    left.schema_version === right.schema_version &&
    left.settings_hash === right.settings_hash &&
    sameJson(left.execution_settings, right.execution_settings) &&
    left.authority_revalidation.effective_principal_id ===
      right.authority_revalidation.effective_principal_id &&
    sameReference(
      left.authority_revalidation.policy_receipt_ref,
      right.authority_revalidation.policy_receipt_ref,
    ) &&
    left.authority_revalidation.authority_epoch === right.authority_revalidation.authority_epoch
  );
}

function sameExecutionContext(
  baseline: MetamorphicKernelSandboxEvidence,
  candidate: MetamorphicKernelSandboxEvidence,
): boolean {
  const left = baseline.receipt;
  const right = candidate.receipt;
  return (
    sameExecutionDomain(baseline, candidate) &&
    sameReference(left.sql_artifact_ref, right.sql_artifact_ref) &&
    sameReference(left.execution_permit_ref, right.execution_permit_ref) &&
    sameReference(left.resource_admission_ref, right.resource_admission_ref)
  );
}

function threeAuthorityIdentitiesAreIndependent(
  fixture: MetamorphicFixtureReceipt["issuer"],
  sandbox: AuthoritativeSandboxExecutionIdentity["identity"],
  verifier: MetamorphicOracleReceipt["verifier"],
): boolean {
  const identities = [fixture, sandbox, verifier];
  return (["authority_id", "principal_id", "key_id"] as const).every(
    (field) =>
      new Set(
        identities.map((identity) => canonicalizeAuthorityIdentityComparisonValue(identity[field])),
      ).size === identities.length,
  );
}

function verifyRelation(
  sample: MetamorphicRelationSample,
  baseline: MetamorphicKernelSandboxEvidence,
  followUps: readonly MetamorphicKernelSandboxEvidence[],
  profile: MetamorphicApplicabilityProfile,
): MetamorphicKernelRelationVerification | null {
  let computed: boolean;
  switch (sample.relation_kind) {
    case "FAN_OUT": {
      const followUp = followUps[0];
      if (!followUp) return null;
      computed =
        baseline.result.row_count > 0 &&
        followUp.result.row_count > 0 &&
        equalResultData(baseline.result, followUp.result);
      break;
    }
    case "NULL_ANTI_MEMBERSHIP": {
      const followUp = followUps[0];
      if (!followUp) return null;
      computed =
        baseline.result.row_count > 0 &&
        followUp.result.row_count > 0 &&
        equalResultData(baseline.result, followUp.result);
      break;
    }
    case "HALF_OPEN_ADDITIVE_PARTITION": {
      const [left, right] = followUps;
      if (!left || !right) return null;
      computed =
        baseline.result.row_count > 0 &&
        right.result.row_count > 0 &&
        (profile.group_key_arity > 0 || left.result.row_count > 0) &&
        verifyAdditivePartition(baseline.result, left.result, right.result, profile);
      break;
    }
    case "SAME_VALUED_DISTINCT_FACT": {
      const followUp = followUps[0];
      if (!followUp) return null;
      computed =
        baseline.result.row_count > 0 &&
        followUp.result.row_count > 0 &&
        verifySameValuedDistinctFact(
          baseline.result,
          followUp.result,
          sample.witness.group_key,
          sample.witness.measure_minor_units,
          profile,
        );
      break;
    }
    default:
      return assertNever(sample);
  }
  return deepFreeze({
    relation_kind: sample.relation_kind,
    declared_verdict: sample.verdict,
    computed_verdict: computed ? ("PASS" as const) : ("FAIL" as const),
  });
}

function selectionProbeClosesWitness(
  fixtureCase: MetamorphicFixtureReceipt["cases"][number],
  evidence: MetamorphicKernelSandboxEvidence,
  profile: MetamorphicApplicabilityProfile,
): boolean {
  let groupKey: unknown;
  try {
    groupKey = JSON.parse(fixtureCase.witness.group_key);
  } catch {
    return false;
  }
  if (!Array.isArray(groupKey) || groupKey.length !== profile.group_key_arity) {
    return false;
  }
  const witness =
    fixtureCase.relation_kind === "FAN_OUT"
      ? {
          key_column: "fact_key",
          key: fixtureCase.witness.fact_key,
          occurred_at: null,
          measure_minor_units: fixtureCase.witness.measure_minor_units,
        }
      : fixtureCase.relation_kind === "NULL_ANTI_MEMBERSHIP"
        ? {
            key_column: "probe_key",
            key: fixtureCase.witness.probe_key,
            occurred_at: null,
            measure_minor_units: fixtureCase.witness.measure_minor_units,
          }
        : fixtureCase.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION"
          ? {
              key_column: "boundary_fact_key",
              key: fixtureCase.witness.boundary_fact_key,
              occurred_at: fixtureCase.witness.midpoint_at,
              measure_minor_units: fixtureCase.witness.boundary_measure_minor_units,
            }
          : {
              key_column: "original_fact_key",
              key: fixtureCase.witness.original_fact_key,
              occurred_at: fixtureCase.witness.occurred_at,
              measure_minor_units: fixtureCase.witness.measure_minor_units,
            };
  const expectedColumnNames = [
    witness.key_column,
    ...profile.dimension_ids,
    ...(witness.occurred_at === null ? [] : ["occurred_at"]),
    "measure_minor_units",
  ];
  const row = evidence.result.rows[0];
  const measureColumn = evidence.result.columns.at(-1);
  if (
    evidence.result.rows.length !== 1 ||
    !row ||
    row.length !== expectedColumnNames.length ||
    !evidence.result.columns.every(({ name }, index) => name === expectedColumnNames[index]) ||
    measureColumn?.type !== "INTEGER" ||
    row[0] !== witness.key ||
    !sameJson(row.slice(1, 1 + profile.group_key_arity), groupKey)
  ) {
    return false;
  }
  const occurredAtIndex = 1 + profile.group_key_arity;
  if (witness.occurred_at !== null && row[occurredAtIndex] !== witness.occurred_at) {
    return false;
  }
  const measure = row.at(-1);
  return (
    typeof measure === "number" &&
    Number.isSafeInteger(measure) &&
    measure !== 0 &&
    measure === witness.measure_minor_units
  );
}

async function resolveExactCommittedArtifact(
  store: MetamorphicKernelStore,
  reference: ArtifactReference,
): Promise<unknown | null> {
  const artifact = await store.resolveCommitted(reference);
  if (
    artifact === null ||
    !(await store.verifyCommitted(reference)) ||
    !(await store.verifyExactArtifactRevision(reference, artifact))
  ) {
    return null;
  }
  return artifact;
}

function sameScopeAndRun(left: ArtifactReference, right: ArtifactReference): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id
  );
}

async function deriveAuthoritativeApplicabilityProfile(
  receipt: MetamorphicFixtureReceipt,
  store: MetamorphicKernelStore,
): Promise<MetamorphicApplicabilityProfile | null> {
  const [queryContractArtifact, groundingArtifact, logicalPlanArtifact, sqlArtifact] =
    await Promise.all([
      resolveExactCommittedArtifact(store, receipt.query_contract_ref),
      resolveExactCommittedArtifact(store, receipt.grounding_package_ref),
      resolveExactCommittedArtifact(store, receipt.logical_plan_ref),
      resolveExactCommittedArtifact(store, receipt.sql_artifact_ref),
    ]);
  const queryContract = queryContractSchema.safeParse(queryContractArtifact);
  const grounding = groundingPackageSchema.safeParse(groundingArtifact);
  const logicalPlan = logicalPlanSchema.safeParse(logicalPlanArtifact);
  const sql = sqlArtifactSchema.safeParse(sqlArtifact);
  if (
    !queryContract.success ||
    !grounding.success ||
    !logicalPlan.success ||
    !sql.success ||
    !sameReference(grounding.data.query_contract_ref, receipt.query_contract_ref) ||
    !sameReference(sql.data.logical_plan_ref, receipt.logical_plan_ref) ||
    !sameScopeAndRun(logicalPlan.data.semantic_query_ref, receipt.receipt_ref) ||
    logicalPlan.data.grounding_hash !== grounding.data.grounding_hash
  ) {
    return null;
  }

  const semanticArtifact = await resolveExactCommittedArtifact(
    store,
    logicalPlan.data.semantic_query_ref,
  );
  const semanticQuery = semanticQuerySchema.safeParse(semanticArtifact);
  if (
    !semanticQuery.success ||
    !sameReference(semanticQuery.data.query_contract_ref, receipt.query_contract_ref) ||
    !sameReference(semanticQuery.data.grounding_package_ref, receipt.grounding_package_ref) ||
    !sameJson(semanticQuery.data.metric, grounding.data.metric) ||
    !sameJson(semanticQuery.data.dimensions, grounding.data.dimensions)
  ) {
    return null;
  }

  const metric = grounding.data.metric;
  const dimensionIds = grounding.data.dimensions.map(({ dimension_id }) => dimension_id);
  const semanticSignature = logicalPlan.data.semantic_signature;
  if (
    queryContract.data.datasource_id !== grounding.data.datasource_id ||
    queryContract.data.metric !== metric.metric_id ||
    !sameJson(queryContract.data.dimensions, dimensionIds) ||
    queryContract.data.grain !== metric.grain ||
    queryContract.data.unit !== metric.unit ||
    semanticSignature.metric_id !== metric.metric_id ||
    !sameJson(semanticSignature.dimension_ids, dimensionIds) ||
    semanticSignature.grain !== metric.grain ||
    semanticSignature.unit !== metric.unit ||
    semanticSignature.time_semantics !== "HALF_OPEN" ||
    metric.additivity !== "additive"
  ) {
    return null;
  }

  const expectedMeasure = {
    metric_id: metric.metric_id,
    function: metric.aggregation,
    field: {
      table_id: metric.table_id,
      column_id: metric.column_id,
    },
    alias: metric.metric_id,
    unit: metric.unit,
    null_policy: metric.null_policy,
    distinct: metric.aggregation === "count_distinct",
  };
  const measures = logicalPlan.data.operations.flatMap((operation) =>
    operation.operation === "aggregate" || operation.operation === "preaggregate"
      ? operation.measures
      : [],
  );
  const finalAggregates = logicalPlan.data.operations.filter(
    (operation) => operation.operation === "aggregate",
  );
  const finalAggregate = finalAggregates[0];
  const rootOperation = logicalPlan.data.operations.find(
    ({ operation_id }) => operation_id === logicalPlan.data.root_operation_id,
  );
  const expectedGroupBy = grounding.data.dimensions.map(({ table_id, column_id }) => ({
    table_id,
    column_id,
  }));
  const expectedProjection = [
    ...grounding.data.dimensions.map(({ column_id, dimension_id }) => ({
      source_kind: "group" as const,
      source_id: column_id,
      alias: dimension_id,
    })),
    {
      source_kind: "measure" as const,
      source_id: metric.metric_id,
      alias: metric.metric_id,
    },
  ];
  if (
    measures.length === 0 ||
    measures.some((measure) => !sameJson(measure, expectedMeasure)) ||
    finalAggregates.length !== 1 ||
    !finalAggregate ||
    rootOperation?.operation !== "project" ||
    rootOperation.input_id !== finalAggregate.operation_id ||
    !sameJson(finalAggregate.group_by, expectedGroupBy) ||
    !sameJson(rootOperation.columns, expectedProjection) ||
    (metric.aggregation !== "sum" && metric.aggregation !== "count") ||
    finalAggregate.measures[0]?.distinct !== false ||
    (finalAggregate.measures[0]?.function !== "sum" &&
      finalAggregate.measures[0]?.function !== "count")
  ) {
    return null;
  }

  const sourceColumn = grounding.data.allowed_schema.tables
    .find(({ table_id }) => table_id === metric.table_id)
    ?.columns.find(({ column_id }) => column_id === metric.column_id);
  if (!sourceColumn || (metric.aggregation === "sum" && sourceColumn.data_type !== "integer")) {
    return null;
  }
  return deepFreeze({
    suite: "ADDITIVE_INTEGER_V1",
    aggregate_kind: metric.aggregation,
    distinct: false,
    source_measure_data_type:
      metric.aggregation === "sum" ? ("integer" as const) : ("not_applicable_for_count" as const),
    result_data_type: "INTEGER",
    metric_id: metric.metric_id,
    dimension_ids: dimensionIds,
    group_key_arity: dimensionIds.length,
  });
}

export async function verifyMetamorphicFixtureKernel(
  input: MetamorphicFixtureKernelInput,
  store: MetamorphicKernelStore,
): Promise<boolean> {
  const expectedProfile = await deriveAuthoritativeApplicabilityProfile(input.receipt, store);
  if (
    !expectedProfile ||
    !sameJson(expectedProfile, input.receipt.applicability_profile) ||
    input.selection_probes.length !== input.receipt.cases.length
  ) {
    return false;
  }
  const firstProbe = input.selection_probes[0];
  if (
    !firstProbe ||
    input.selection_probes.some((probe, index) => {
      const fixtureCase = input.receipt.cases[index];
      return (
        !fixtureCase ||
        !sameExecutionDomain(firstProbe, probe) ||
        !selectionProbeClosesWitness(fixtureCase, probe, input.receipt.applicability_profile)
      );
    })
  ) {
    return false;
  }
  const mutationCases = input.receipt.cases.filter(
    (fixtureCase) => fixtureCase.relation_kind !== "HALF_OPEN_ADDITIVE_PARTITION",
  );
  if (mutationCases.length !== input.mutation_records.length) return false;
  const mutationVerdicts = await Promise.all(
    mutationCases.map(async (fixtureCase, index) => {
      const mutation = input.mutation_records[index];
      return (
        mutation !== undefined &&
        sameReference(mutation.reference, fixtureCase.mutation_record_ref) &&
        (await computeFixtureMutationRecordHash(mutation.record)) ===
          fixtureCase.mutation_descriptor_hash &&
        mutation.reference.content_hash === fixtureCase.mutation_descriptor_hash &&
        sameJson(mutation.record.scope, input.receipt.scope) &&
        mutation.record.run_id === input.receipt.run_id &&
        mutation.record.case_id === fixtureCase.case_id &&
        mutation.record.relation_kind === fixtureCase.relation_kind &&
        mutation.record.baseline_snapshot_id === input.receipt.baseline.snapshot_id &&
        mutation.record.follow_up_snapshot_id === fixtureCase.follow_up_snapshot_id &&
        sameJson(mutation.record.witness, fixtureCase.witness)
      );
    }),
  );
  return mutationVerdicts.every(Boolean);
}

function relationEvidenceForSample(
  sample: MetamorphicRelationSample,
  evidence: readonly MetamorphicKernelSandboxEvidence[],
  cursor: number,
): Readonly<{
  values: readonly MetamorphicKernelSandboxEvidence[];
  next_cursor: number;
}> | null {
  const width = sample.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION" ? 2 : 1;
  const values = evidence.slice(cursor, cursor + width);
  return values.length === width
    ? {
        values,
        next_cursor: cursor + width,
      }
    : null;
}

async function verifyHalfOpenQueryVariantClosure(
  fixtureCase: Extract<
    MetamorphicFixtureReceipt["cases"][number],
    { readonly relation_kind: "HALF_OPEN_ADDITIVE_PARTITION" }
  >,
  queryContractRef: ArtifactReference,
  baseline: MetamorphicKernelSandboxEvidence,
  left: MetamorphicKernelSandboxEvidence,
  right: MetamorphicKernelSandboxEvidence,
  store: MetamorphicKernelStore,
): Promise<boolean> {
  const references = [
    baseline.receipt.sql_artifact_ref,
    left.receipt.sql_artifact_ref,
    right.receipt.sql_artifact_ref,
  ];
  const inputHashes = [
    baseline.receipt.input_hash,
    left.receipt.input_hash,
    right.receipt.input_hash,
  ];
  if (
    new Set(references.map(artifactReferenceIdentity)).size !== references.length ||
    new Set(inputHashes).size !== inputHashes.length ||
    inputHashes[0] !== fixtureCase.whole_execution_input_hash ||
    inputHashes[1] !== fixtureCase.left_execution_input_hash ||
    inputHashes[2] !== fixtureCase.right_execution_input_hash
  ) {
    return false;
  }
  const [wholeArtifact, leftArtifact, rightArtifact, queryContractArtifact] = await Promise.all([
    ...references.map((reference) => resolveExactCommittedArtifact(store, reference)),
    resolveExactCommittedArtifact(store, queryContractRef),
  ]);
  const whole = sqlArtifactSchema.safeParse(wholeArtifact);
  const leftVariant = sqlArtifactSchema.safeParse(leftArtifact);
  const rightVariant = sqlArtifactSchema.safeParse(rightArtifact);
  const queryContract = queryContractSchema.safeParse(queryContractArtifact);
  if (!whole.success || !leftVariant.success || !rightVariant.success || !queryContract.success) {
    return false;
  }

  const variants = [whole.data, leftVariant.data, rightVariant.data] as const;
  const declaredQueryHashes = [
    fixtureCase.query_variant_hashes.whole,
    fixtureCase.query_variant_hashes.left_half_open,
    fixtureCase.query_variant_hashes.right_half_open,
  ] as const;
  if (
    new Set(variants.map(({ query_hash }) => query_hash)).size !== variants.length ||
    !variants.every(({ query_hash }, index) => query_hash === declaredQueryHashes[index]) ||
    !variants.every(
      (variant) =>
        variant.sql === whole.data.sql &&
        variant.compiler_version === whole.data.compiler_version &&
        variant.ast_hash === whole.data.ast_hash &&
        sameReference(variant.logical_plan_ref, whole.data.logical_plan_ref),
    )
  ) {
    return false;
  }

  const recomputedQueryHashes = await Promise.all(variants.map(computeSqlArtifactQueryHash));
  if (!variants.every(({ query_hash }, index) => query_hash === recomputedQueryHashes[index])) {
    return false;
  }

  const witness = fixtureCase.witness;
  if (
    queryContract.data.time_range.start !== witness.start_at ||
    queryContract.data.time_range.end !== witness.end_at ||
    Date.parse(witness.start_at) >= Date.parse(witness.midpoint_at) ||
    Date.parse(witness.midpoint_at) >= Date.parse(witness.end_at)
  ) {
    return false;
  }

  const comparisonPattern =
    /("(?:[^"]|"")+"\."(?:[^"]|"")+")\s*OPERATOR\(pg_catalog\.(>=|<)\)\s*(\$[1-9][0-9]*)::pg_catalog\.(?:timestamp|timestamptz)\b/g;
  const comparisons = [...whole.data.sql.matchAll(comparisonPattern)];
  const lowerCandidates = comparisons.filter(
    ([, , operator, placeholder]) =>
      operator === ">=" && whole.data.parameters[placeholder ?? ""] === witness.start_at,
  );
  const upperCandidates = comparisons.filter(
    ([, , operator, placeholder]) =>
      operator === "<" && whole.data.parameters[placeholder ?? ""] === witness.end_at,
  );
  const lower = lowerCandidates[0];
  const upper = upperCandidates[0];
  const lowerColumn = lower?.[1];
  const lowerPlaceholder = lower?.[3];
  const upperColumn = upper?.[1];
  const upperPlaceholder = upper?.[3];
  if (
    lowerCandidates.length !== 1 ||
    upperCandidates.length !== 1 ||
    !lowerColumn ||
    lowerColumn !== upperColumn ||
    !lowerPlaceholder ||
    !upperPlaceholder ||
    lowerPlaceholder === upperPlaceholder
  ) {
    return false;
  }

  const parameterKeys = Object.keys(whole.data.parameters).sort();
  if (
    !sameJson(parameterKeys, Object.keys(leftVariant.data.parameters).sort()) ||
    !sameJson(parameterKeys, Object.keys(rightVariant.data.parameters).sort())
  ) {
    return false;
  }
  return parameterKeys.every((key) => {
    const wholeValue = whole.data.parameters[key];
    const leftValue = leftVariant.data.parameters[key];
    const rightValue = rightVariant.data.parameters[key];
    if (key === lowerPlaceholder) {
      return (
        wholeValue === witness.start_at &&
        leftValue === witness.start_at &&
        rightValue === witness.midpoint_at
      );
    }
    if (key === upperPlaceholder) {
      return (
        wholeValue === witness.end_at &&
        leftValue === witness.midpoint_at &&
        rightValue === witness.end_at
      );
    }
    return sameJson(wholeValue, leftValue) && sameJson(wholeValue, rightValue);
  });
}

export async function verifyMetamorphicOracleKernel(
  input: MetamorphicOracleKernelInput,
  store: MetamorphicKernelStore,
): Promise<MetamorphicOracleKernelProjection | null> {
  const profile = input.fixture.applicability_profile;
  const evaluatedAt = Date.parse(input.receipt.evaluated_at);
  const fixtureIssuedAt = Date.parse(input.fixture.issued_at);
  if (
    !Number.isFinite(evaluatedAt) ||
    !Number.isFinite(fixtureIssuedAt) ||
    fixtureIssuedAt > evaluatedAt ||
    !threeAuthorityIdentitiesAreIndependent(
      input.fixture.issuer,
      input.baseline.execution_identity.identity,
      input.receipt.verifier,
    ) ||
    input.selection_probes.some(
      (evidence) =>
        !sameExecutionDomain(input.baseline, evidence) ||
        Date.parse(evidence.receipt.completed_at) > evaluatedAt,
    ) ||
    [input.baseline, ...input.relation_evidence].some(
      (evidence) =>
        !sameExecutionDomain(input.baseline, evidence) ||
        Date.parse(evidence.receipt.completed_at) > evaluatedAt,
    ) ||
    !sameReference(input.baseline.receipt.sql_artifact_ref, input.receipt.sql_artifact_ref)
  ) {
    return null;
  }

  const relationVerifications: MetamorphicKernelRelationVerification[] = [];
  let cursor = 0;
  for (const sample of input.receipt.relation_samples) {
    const resolved = relationEvidenceForSample(sample, input.relation_evidence, cursor);
    if (!resolved) return null;
    const fixtureCase = input.fixture.cases[relationVerifications.length];
    if (!fixtureCase || fixtureCase.relation_kind !== sample.relation_kind) {
      return null;
    }
    if (sample.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION") {
      if (
        fixtureCase.relation_kind !== "HALF_OPEN_ADDITIVE_PARTITION" ||
        !resolved.values[0] ||
        !resolved.values[1] ||
        !(await verifyHalfOpenQueryVariantClosure(
          fixtureCase,
          input.fixture.query_contract_ref,
          input.baseline,
          resolved.values[0],
          resolved.values[1],
          store,
        ))
      ) {
        return null;
      }
    } else if (!resolved.values[0] || !sameExecutionContext(input.baseline, resolved.values[0])) {
      return null;
    }
    const verification = verifyRelation(sample, input.baseline, resolved.values, profile);
    if (!verification) return null;
    relationVerifications.push(verification);
    cursor = resolved.next_cursor;
  }
  if (cursor !== input.relation_evidence.length) return null;
  if (
    relationVerifications.some(
      ({ declared_verdict, computed_verdict }) => declared_verdict !== computed_verdict,
    )
  ) {
    return null;
  }
  const computedVerdict = relationVerifications.every(
    ({ computed_verdict }) => computed_verdict === "PASS",
  )
    ? ("PASS" as const)
    : ("FAIL" as const);
  if (input.receipt.metamorphic_verdict !== computedVerdict) {
    return null;
  }
  return deepFreeze({
    relation_verifications: relationVerifications,
    computed_verdict: computedVerdict,
  });
}

export function verifyResultOracleKernel(
  receipt: ResultOracleReceipt,
  metamorphic: MetamorphicOracleReceipt,
): boolean {
  const expectedVerdict =
    metamorphic.metamorphic_verdict === "PASS" &&
    receipt.invariant_verdicts.every(({ verdict }) => verdict === "PASS")
      ? ("PASS" as const)
      : ("FAIL" as const);
  return (
    receipt.metamorphic_verdict === metamorphic.metamorphic_verdict &&
    receipt.oracle_verdict === expectedVerdict
  );
}
