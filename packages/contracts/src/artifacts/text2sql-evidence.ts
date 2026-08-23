import { z } from "zod";
import {
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  EXECUTABLE_QUERY_LIMITS,
  immutableIdSchema,
  postgresqlOutputAliasSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { artifactReferenceFor, artifactReferenceIdentity } from "./envelope.js";

const stableIdentifierListSchema = z.array(versionIdentifierSchema).superRefine((values, ctx) => {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => {
      const previous = values[index - 1];
      return previous !== undefined && previous >= value;
    })
  ) {
    ctx.addIssue({
      code: "custom",
      message: "权威证据中的标识符列表必须唯一并按字典序排列。",
    });
  }
});

/**
 * PostgreSQL `EXPLAIN (FORMAT JSON)` 的 `Node Type` 原值。
 *
 * 保留空格并执行精确比较，不能把 `Nested Loop` 归一化成 `NestedLoop`。
 */
export const postgresqlPlanNodeTypeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/,
    "PostgreSQL Plan Node Type 必须保留由单个空格分隔的原始 ASCII 名称。",
  );

const sortedPostgresqlPlanNodeTypeListSchema = z
  .array(postgresqlPlanNodeTypeSchema)
  .superRefine((values, ctx) => {
    if (
      new Set(values).size !== values.length ||
      values.some((value, index) => {
        const previous = values[index - 1];
        return previous !== undefined && previous >= value;
      })
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt 的 Node Type 必须唯一并按字典序排列。",
      });
    }
  });

const resourceEstimateMaterialSchema = z.strictObject({
  query_hash: contentHashSchema,
  datasource_id: immutableIdSchema,
  schema_version: versionIdentifierSchema,
  settings_hash: contentHashSchema,
  total_cost: z.number().finite().nonnegative(),
  plan_rows: z.number().int().nonnegative(),
  plan_width: z.number().int().nonnegative(),
  node_types: sortedPostgresqlPlanNodeTypeListSchema.min(1),
  relation_names: stableIdentifierListSchema,
  has_cartesian_join: z.boolean(),
});

export const postgresqlExecutionSettingsSchema = z.strictObject({
  database_role: versionIdentifierSchema,
  search_path: z
    .array(
      z
        .string()
        .min(1)
        .max(63)
        .regex(/^[a-z_][a-z0-9_]*$/, "PostgreSQL search_path 只能包含规范化非引用标识符。"),
    )
    .min(1),
  plan_cache_mode: z.literal("force_custom_plan"),
  statement_timeout_ms: z.number().int().positive().max(300_000),
  lock_timeout_ms: z.number().int().positive().max(300_000),
});

const resourceAdmissionReceiptObjectSchema = z.strictObject({
  artifact_type: z.literal("ResourceAdmissionReceipt"),
  receipt_ref: artifactReferenceFor("ResourceAdmissionReceipt"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  principal_id: z.string().min(1).max(256),
  policy_receipt_ref: artifactReferenceFor("PolicyReceipt"),
  ...resourceEstimateMaterialSchema.shape,
  execution_settings: postgresqlExecutionSettingsSchema,
  estimate_hash: contentHashSchema,
  policy_version: versionIdentifierSchema,
  forbidden_node_types: sortedPostgresqlPlanNodeTypeListSchema,
  max_total_cost: z.number().finite().positive(),
  max_plan_rows: z.number().int().positive(),
  max_plan_bytes: z.number().int().positive(),
  lock_timeout_ms: z.number().int().positive().max(300_000),
  timeout_ms: z.number().int().positive().max(300_000),
  max_rows: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_rows),
  max_bytes: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_bytes),
  max_memory_mb: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_memory_mb),
  evaluated_at: timestampSchema,
  receipt_hash: contentHashSchema,
});

function sameScope(
  reference: z.infer<ReturnType<typeof artifactReferenceFor>>,
  scope: z.infer<typeof appScopeSchema>,
  runId: string,
): boolean {
  return (
    reference.app_id === scope.app_id &&
    reference.tenant_id === scope.tenant_id &&
    reference.environment === scope.environment &&
    reference.run_id === runId
  );
}

export const resourceAdmissionReceiptSchema = resourceAdmissionReceiptObjectSchema.superRefine(
  (receipt, ctx) => {
    if (
      !sameScope(receipt.receipt_ref, receipt.scope, receipt.run_id) ||
      !sameScope(receipt.sql_artifact_ref, receipt.scope, receipt.run_id) ||
      !sameScope(receipt.policy_receipt_ref, receipt.scope, receipt.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt 与 SqlArtifact 必须属于同一 Scope/Run。",
        path: ["receipt_ref"],
      });
    }
    if (receipt.receipt_ref.content_hash !== receipt.receipt_hash) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt Reference 必须携带 Receipt Hash。",
        path: ["receipt_ref", "content_hash"],
      });
    }
    if (receipt.lock_timeout_ms >= receipt.timeout_ms) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt.lock_timeout_ms 必须小于 timeout_ms。",
        path: ["lock_timeout_ms"],
      });
    }
    if (
      receipt.execution_settings.statement_timeout_ms !== receipt.timeout_ms ||
      receipt.execution_settings.lock_timeout_ms !== receipt.lock_timeout_ms ||
      new Set(receipt.execution_settings.search_path).size !==
        receipt.execution_settings.search_path.length
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "ResourceAdmissionReceipt 的 PostgreSQL Settings 必须唯一且与 Timeout Policy 精确一致。",
        path: ["execution_settings"],
      });
    }
    const plannedBytes = receipt.plan_rows * receipt.plan_width;
    if (!Number.isSafeInteger(plannedBytes)) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt 计划字节数必须可安全计算。",
        path: ["plan_rows"],
      });
    }
  },
);

export type ResourceAdmissionReceipt = z.infer<typeof resourceAdmissionReceiptSchema>;

export async function computePostgresqlExecutionSettingsHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(postgresqlExecutionSettingsSchema.parse(input));
}

export async function computeResourceEstimateHash(input: unknown): Promise<`sha256:${string}`> {
  const receipt = resourceAdmissionReceiptObjectSchema.safeParse(input);
  const material = receipt.success
    ? {
        query_hash: receipt.data.query_hash,
        datasource_id: receipt.data.datasource_id,
        schema_version: receipt.data.schema_version,
        settings_hash: receipt.data.settings_hash,
        total_cost: receipt.data.total_cost,
        plan_rows: receipt.data.plan_rows,
        plan_width: receipt.data.plan_width,
        node_types: receipt.data.node_types,
        relation_names: receipt.data.relation_names,
        has_cartesian_join: receipt.data.has_cartesian_join,
      }
    : input;
  return sha256ContentHash(resourceEstimateMaterialSchema.parse(material));
}

export async function computeResourceAdmissionReceiptHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const receipt = resourceAdmissionReceiptSchema.parse(input);
  const {
    receipt_hash: _receiptHash,
    receipt_ref: { content_hash: _referenceHash, ...receiptReference },
    ...material
  } = receipt;
  return sha256ContentHash({
    ...material,
    receipt_ref: receiptReference,
  });
}

export const METAMORPHIC_RELATIONS = [
  "FAN_OUT",
  "NULL_ANTI_MEMBERSHIP",
  "HALF_OPEN_ADDITIVE_PARTITION",
  "SAME_VALUED_DISTINCT_FACT",
] as const;

export const metamorphicRelationKindSchema = z.enum(METAMORPHIC_RELATIONS);

export const AUTHORITY_ROLE_POLICY_VERSION = "authority_role_policy@1.0.0" as const;

export const AUTHORITY_ROLES = [
  "FIXTURE_MUTATION",
  "SANDBOX_EXECUTION",
  "METAMORPHIC_VERIFIER",
  "RESULT_PRODUCER",
] as const;

export const authorityRoleSchema = z.enum(AUTHORITY_ROLES);

const canonicalAuthorityIdSchema = immutableIdSchema.transform((value) => value.toLowerCase());

/**
 * 规范 Authority Identity 字段的比较值。
 *
 * UUID-shaped authority/principal/key 统一为小写；普通标识符保持原值与大小写语义。
 */
export function canonicalizeAuthorityIdentityComparisonValue(value: string): string {
  return immutableIdSchema.safeParse(value).success ? value.toLowerCase() : value;
}

export const authorityIdentitySchema = z.strictObject({
  authority_id: canonicalAuthorityIdSchema,
  principal_id: z.string().min(1).max(256),
  key_id: versionIdentifierSchema,
});

export const metamorphicAuthorityRolePolicySchema = z
  .strictObject({
    policy_version: z.literal(AUTHORITY_ROLE_POLICY_VERSION),
    role_identities: z.strictObject({
      FIXTURE_MUTATION: authorityIdentitySchema,
      SANDBOX_EXECUTION: authorityIdentitySchema,
      METAMORPHIC_VERIFIER: authorityIdentitySchema,
      RESULT_PRODUCER: authorityIdentitySchema,
    }),
  })
  .superRefine((policy, ctx) => {
    for (const field of ["authority_id", "principal_id", "key_id"] as const) {
      const values = AUTHORITY_ROLES.map((role) =>
        canonicalizeAuthorityIdentityComparisonValue(policy.role_identities[role][field]),
      );
      if (new Set(values).size !== values.length) {
        ctx.addIssue({
          code: "custom",
          message: `authority_role_policy@1.0.0 要求四个角色的 ${field} 两两不同。`,
          path: ["role_identities"],
        });
      }
    }
  });

export type AuthorityRole = z.infer<typeof authorityRoleSchema>;
export type AuthorityIdentity = z.infer<typeof authorityIdentitySchema>;
export type MetamorphicAuthorityRolePolicy = z.infer<typeof metamorphicAuthorityRolePolicySchema>;

const nonBlankWitnessValueSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/\S/, "Metamorphic witness 不能是空白字符串。");

export const metamorphicGroupKeySchema = z
  .string()
  .min(2)
  .max(4_096)
  .refine(
    (value) => {
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) && canonicalizeJson(parsed) === value;
      } catch {
        return false;
      }
    },
    {
      message: "Metamorphic witness.group_key 必须是 Canonical JSON 数组；全局聚合使用 []。",
    },
  );

function canonicalGroupKeyArity(groupKey: string): number | null {
  try {
    const parsed: unknown = JSON.parse(groupKey);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

const nonZeroMinorUnitsSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
  .refine((value) => value !== 0, {
    message: "Metamorphic witness 的最小货币单位必须非零。",
  });

export const metamorphicSandboxEvidenceRefSchema = z.strictObject({
  sandbox_execution_receipt_ref: artifactReferenceFor("SandboxExecutionReceipt"),
  result_artifact_ref: artifactReferenceFor("SandboxResult"),
});

const fanOutWitnessSchema = z
  .strictObject({
    fact_key: nonBlankWitnessValueSchema,
    group_key: metamorphicGroupKeySchema,
    join_path: z.array(nonBlankWitnessValueSchema).min(1).max(32),
    original_child_key: nonBlankWitnessValueSchema,
    added_child_key: nonBlankWitnessValueSchema,
    measure_minor_units: nonZeroMinorUnitsSchema,
    baseline_multiplicity: z.literal(1),
    follow_up_multiplicity: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((witness, ctx) => {
    if (witness.original_child_key === witness.added_child_key) {
      ctx.addIssue({
        code: "custom",
        message: "FAN_OUT witness 必须绑定两个不同的 child key。",
        path: ["added_child_key"],
      });
    }
    if (new Set(witness.join_path).size !== witness.join_path.length) {
      ctx.addIssue({
        code: "custom",
        message: "FAN_OUT witness.join_path 不能重复同一 Join Edge。",
        path: ["join_path"],
      });
    }
  });

const nullAntiMembershipWitnessSchema = z.strictObject({
  probe_key: nonBlankWitnessValueSchema,
  inserted_null_row_key: nonBlankWitnessValueSchema,
  group_key: metamorphicGroupKeySchema,
  measure_minor_units: nonZeroMinorUnitsSchema,
});

const halfOpenAdditivePartitionWitnessSchema = z
  .strictObject({
    group_key: metamorphicGroupKeySchema,
    start_at: timestampSchema,
    midpoint_at: timestampSchema,
    end_at: timestampSchema,
    boundary_fact_key: nonBlankWitnessValueSchema,
    boundary_measure_minor_units: nonZeroMinorUnitsSchema,
  })
  .superRefine((witness, ctx) => {
    const start = Date.parse(witness.start_at);
    const midpoint = Date.parse(witness.midpoint_at);
    const end = Date.parse(witness.end_at);
    if (!(start < midpoint && midpoint < end)) {
      ctx.addIssue({
        code: "custom",
        message: "HALF_OPEN witness 必须满足 start_at < midpoint_at < end_at。",
        path: ["midpoint_at"],
      });
    }
  });

const sameValuedDistinctFactWitnessSchema = z
  .strictObject({
    original_fact_key: nonBlankWitnessValueSchema,
    added_fact_key: nonBlankWitnessValueSchema,
    group_key: metamorphicGroupKeySchema,
    occurred_at: timestampSchema,
    measure_minor_units: nonZeroMinorUnitsSchema,
  })
  .superRefine((witness, ctx) => {
    if (witness.original_fact_key === witness.added_fact_key) {
      ctx.addIssue({
        code: "custom",
        message: "SAME_VALUED_DISTINCT_FACT witness 必须绑定两个不同的 fact key。",
        path: ["added_fact_key"],
      });
    }
  });

const fixtureMutationRecordBaseShape = {
  artifact_type: z.literal("FixtureMutationRecord"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  case_id: immutableIdSchema,
  baseline_snapshot_id: versionIdentifierSchema,
  follow_up_snapshot_id: versionIdentifierSchema,
} as const;

const fanOutFixtureMutationRecordSchema = z.strictObject({
  ...fixtureMutationRecordBaseShape,
  relation_kind: z.literal("FAN_OUT"),
  witness: fanOutWitnessSchema,
});

const nullAntiMembershipFixtureMutationRecordSchema = z.strictObject({
  ...fixtureMutationRecordBaseShape,
  relation_kind: z.literal("NULL_ANTI_MEMBERSHIP"),
  witness: nullAntiMembershipWitnessSchema,
});

const sameValuedDistinctFactFixtureMutationRecordSchema = z.strictObject({
  ...fixtureMutationRecordBaseShape,
  relation_kind: z.literal("SAME_VALUED_DISTINCT_FACT"),
  witness: sameValuedDistinctFactWitnessSchema,
});

/**
 * 已提交的 single-mutation System Artifact。
 *
 * Record 自身绑定 Fixture Case 的完整语义，不能只用一个可重算 Hash 替代
 * relation/case/snapshot/witness 的逐字段闭包。
 */
export const fixtureMutationRecordSchema = z
  .discriminatedUnion("relation_kind", [
    fanOutFixtureMutationRecordSchema,
    nullAntiMembershipFixtureMutationRecordSchema,
    sameValuedDistinctFactFixtureMutationRecordSchema,
  ])
  .superRefine((record, ctx) => {
    if (record.baseline_snapshot_id === record.follow_up_snapshot_id) {
      ctx.addIssue({
        code: "custom",
        message: "FixtureMutationRecord 的 Follow-up Snapshot 必须不同于 Baseline Snapshot。",
        path: ["follow_up_snapshot_id"],
      });
    }
  });

export type FixtureMutationRecord = z.infer<typeof fixtureMutationRecordSchema>;

export async function computeFixtureMutationRecordHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(fixtureMutationRecordSchema.parse(input));
}

export const metamorphicApplicabilityProfileSchema = z
  .strictObject({
    suite: z.literal("ADDITIVE_INTEGER_V1"),
    aggregate_kind: z.enum(["sum", "count"]),
    distinct: z.literal(false),
    source_measure_data_type: z.enum(["integer", "not_applicable_for_count"]),
    result_data_type: z.literal("INTEGER"),
    metric_id: versionIdentifierSchema,
    dimension_ids: z.array(versionIdentifierSchema).max(64),
    group_key_arity: z.number().int().nonnegative().max(64),
  })
  .superRefine((profile, ctx) => {
    if (new Set(profile.dimension_ids).size !== profile.dimension_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Metamorphic applicability dimension_ids 必须唯一。",
        path: ["dimension_ids"],
      });
    }
    if (profile.group_key_arity !== profile.dimension_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Metamorphic group_key_arity 必须等于 QueryContract dimension 数量。",
        path: ["group_key_arity"],
      });
    }
    if (
      (profile.aggregate_kind === "sum" && profile.source_measure_data_type !== "integer") ||
      (profile.aggregate_kind === "count" &&
        profile.source_measure_data_type !== "not_applicable_for_count")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ADDITIVE_INTEGER_V1 只接受整数 sum 或 not_applicable_for_count 的普通 count。",
        path: ["source_measure_data_type"],
      });
    }
  });

const singleMutationFixtureCaseBaseShape = {
  case_id: immutableIdSchema,
  follow_up_snapshot_id: versionIdentifierSchema,
  follow_up_execution_input_hash: contentHashSchema,
  selection_probe: metamorphicSandboxEvidenceRefSchema,
  selection_probe_input_hash: contentHashSchema,
  mutation_record_ref: artifactReferenceFor("FixtureMutationRecord"),
  mutation_descriptor_hash: contentHashSchema,
} as const;

const fanOutFixtureCaseSchema = z.strictObject({
  ...singleMutationFixtureCaseBaseShape,
  relation_kind: z.literal("FAN_OUT"),
  witness: fanOutWitnessSchema,
});

const nullAntiMembershipFixtureCaseSchema = z.strictObject({
  ...singleMutationFixtureCaseBaseShape,
  relation_kind: z.literal("NULL_ANTI_MEMBERSHIP"),
  witness: nullAntiMembershipWitnessSchema,
});

const halfOpenFixtureCaseSchema = z.strictObject({
  relation_kind: z.literal("HALF_OPEN_ADDITIVE_PARTITION"),
  case_id: immutableIdSchema,
  snapshot_id: versionIdentifierSchema,
  whole_execution_input_hash: contentHashSchema,
  left_execution_input_hash: contentHashSchema,
  right_execution_input_hash: contentHashSchema,
  selection_probe: metamorphicSandboxEvidenceRefSchema,
  selection_probe_input_hash: contentHashSchema,
  query_variant_hashes: z.strictObject({
    whole: contentHashSchema,
    left_half_open: contentHashSchema,
    right_half_open: contentHashSchema,
  }),
  witness: halfOpenAdditivePartitionWitnessSchema,
});

const sameValuedDistinctFixtureCaseSchema = z.strictObject({
  ...singleMutationFixtureCaseBaseShape,
  relation_kind: z.literal("SAME_VALUED_DISTINCT_FACT"),
  witness: sameValuedDistinctFactWitnessSchema,
});

export const metamorphicFixtureCaseSchema = z.discriminatedUnion("relation_kind", [
  fanOutFixtureCaseSchema,
  nullAntiMembershipFixtureCaseSchema,
  halfOpenFixtureCaseSchema,
  sameValuedDistinctFixtureCaseSchema,
]);

export const metamorphicFixtureCasesSchema = z.tuple([
  fanOutFixtureCaseSchema,
  nullAntiMembershipFixtureCaseSchema,
  halfOpenFixtureCaseSchema,
  sameValuedDistinctFixtureCaseSchema,
]);

const metamorphicFixtureEvidenceMaterialSchema = z.strictObject({
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  query_contract_ref: artifactReferenceFor("QueryContract"),
  grounding_package_ref: artifactReferenceFor("GroundingPackage"),
  logical_plan_ref: artifactReferenceFor("LogicalPlan"),
  oracle_id: versionIdentifierSchema,
  oracle_version: versionIdentifierSchema,
  fixture_id: versionIdentifierSchema,
  fixture_version: versionIdentifierSchema,
  issuer: authorityIdentitySchema,
  issuer_role: z.literal("FIXTURE_MUTATION"),
  authority_role_policy_version: z.literal(AUTHORITY_ROLE_POLICY_VERSION),
  applicability_profile: metamorphicApplicabilityProfileSchema,
  baseline: z.strictObject({
    snapshot_id: versionIdentifierSchema,
    execution_input_hash: contentHashSchema,
  }),
  cases: metamorphicFixtureCasesSchema,
});

const metamorphicFixtureReceiptObjectSchema = z.strictObject({
  artifact_type: z.literal("MetamorphicFixtureReceipt"),
  receipt_ref: artifactReferenceFor("MetamorphicFixtureReceipt"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  ...metamorphicFixtureEvidenceMaterialSchema.shape,
  evidence_hash: contentHashSchema,
  issued_at: timestampSchema,
  receipt_hash: contentHashSchema,
});

function fixtureCaseEvidenceRefs(
  fixtureCase: z.infer<typeof metamorphicFixtureCaseSchema>,
): readonly z.infer<ReturnType<typeof artifactReferenceFor>>[] {
  const selectionReferences = [
    fixtureCase.selection_probe.sandbox_execution_receipt_ref,
    fixtureCase.selection_probe.result_artifact_ref,
  ];
  return fixtureCase.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION"
    ? selectionReferences
    : [...selectionReferences, fixtureCase.mutation_record_ref];
}

export const metamorphicFixtureReceiptSchema = metamorphicFixtureReceiptObjectSchema.superRefine(
  (receipt, ctx) => {
    const references = [
      receipt.receipt_ref,
      receipt.sql_artifact_ref,
      receipt.query_contract_ref,
      receipt.grounding_package_ref,
      receipt.logical_plan_ref,
      ...receipt.cases.flatMap(fixtureCaseEvidenceRefs),
    ];
    if (references.some((reference) => !sameScope(reference, receipt.scope, receipt.run_id))) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicFixtureReceipt 的全部引用必须属于同一 Scope/Run。",
        path: ["receipt_ref"],
      });
    }
    if (receipt.receipt_ref.content_hash !== receipt.receipt_hash) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicFixtureReceipt Reference 必须携带 Receipt Hash。",
        path: ["receipt_ref", "content_hash"],
      });
    }
    const caseIds = receipt.cases.map(({ case_id }) => case_id);
    if (new Set(caseIds).size !== caseIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicFixtureReceipt.case_id 必须唯一。",
        path: ["cases"],
      });
    }
    const evidenceReferenceIdentities = receipt.cases
      .flatMap(fixtureCaseEvidenceRefs)
      .map(artifactReferenceIdentity);
    if (new Set(evidenceReferenceIdentities).size !== evidenceReferenceIdentities.length) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicFixtureReceipt 的 Mutation/Selection Evidence 引用必须互异。",
        path: ["cases"],
      });
    }
    const mutationSnapshotIds = [
      receipt.cases[0].follow_up_snapshot_id,
      receipt.cases[1].follow_up_snapshot_id,
      receipt.cases[3].follow_up_snapshot_id,
    ];
    if (new Set(mutationSnapshotIds).size !== mutationSnapshotIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicFixtureReceipt 的 single-mutation Snapshot 必须两两不同。",
        path: ["cases"],
      });
    }
    for (const [index, fixtureCase] of receipt.cases.entries()) {
      const arity = canonicalGroupKeyArity(fixtureCase.witness.group_key);
      if (arity !== receipt.applicability_profile.group_key_arity) {
        ctx.addIssue({
          code: "custom",
          message: "Fixture witness.group_key 必须匹配 applicability_profile.group_key_arity。",
          path: ["cases", index, "witness", "group_key"],
        });
      }
      if (
        fixtureCase.relation_kind === "HALF_OPEN_ADDITIVE_PARTITION"
          ? fixtureCase.snapshot_id !== receipt.baseline.snapshot_id ||
            fixtureCase.whole_execution_input_hash !== receipt.baseline.execution_input_hash
          : fixtureCase.follow_up_snapshot_id === receipt.baseline.snapshot_id
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Single-mutation 必须产生新 Snapshot；half-open 必须复用 Baseline Snapshot/Input。",
          path: ["cases", index],
        });
      }
    }
  },
);

export type MetamorphicFixtureCase = z.infer<typeof metamorphicFixtureCaseSchema>;
export type MetamorphicFixtureCases = z.infer<typeof metamorphicFixtureCasesSchema>;
export type MetamorphicFixtureReceipt = z.infer<typeof metamorphicFixtureReceiptSchema>;

export async function computeMetamorphicFixtureEvidenceHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const receipt = metamorphicFixtureReceiptObjectSchema.safeParse(input);
  const material = metamorphicFixtureEvidenceMaterialSchema.parse(
    receipt.success
      ? {
          sql_artifact_ref: receipt.data.sql_artifact_ref,
          query_contract_ref: receipt.data.query_contract_ref,
          grounding_package_ref: receipt.data.grounding_package_ref,
          logical_plan_ref: receipt.data.logical_plan_ref,
          oracle_id: receipt.data.oracle_id,
          oracle_version: receipt.data.oracle_version,
          fixture_id: receipt.data.fixture_id,
          fixture_version: receipt.data.fixture_version,
          issuer: receipt.data.issuer,
          issuer_role: receipt.data.issuer_role,
          authority_role_policy_version: receipt.data.authority_role_policy_version,
          applicability_profile: receipt.data.applicability_profile,
          baseline: receipt.data.baseline,
          cases: receipt.data.cases,
        }
      : input,
  );
  return sha256ContentHash(material);
}

export async function computeMetamorphicFixtureReceiptHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const receipt = metamorphicFixtureReceiptSchema.parse(input);
  const {
    receipt_hash: _receiptHash,
    receipt_ref: { content_hash: _referenceHash, ...receiptReference },
    ...material
  } = receipt;
  return sha256ContentHash({
    ...material,
    receipt_ref: receiptReference,
  });
}

const metamorphicRelationSampleBaseShape = {
  case_id: immutableIdSchema,
  verdict: z.enum(["PASS", "FAIL"]),
} as const;

const fanOutRelationSampleMaterialSchema = z.strictObject({
  ...metamorphicRelationSampleBaseShape,
  relation_kind: z.literal("FAN_OUT"),
  follow_up_snapshot_id: versionIdentifierSchema,
  follow_up: metamorphicSandboxEvidenceRefSchema,
  witness: fanOutWitnessSchema,
});

const nullAntiMembershipRelationSampleMaterialSchema = z.strictObject({
  ...metamorphicRelationSampleBaseShape,
  relation_kind: z.literal("NULL_ANTI_MEMBERSHIP"),
  follow_up_snapshot_id: versionIdentifierSchema,
  follow_up: metamorphicSandboxEvidenceRefSchema,
  witness: nullAntiMembershipWitnessSchema,
});

const halfOpenAdditivePartitionRelationSampleMaterialSchema = z.strictObject({
  ...metamorphicRelationSampleBaseShape,
  relation_kind: z.literal("HALF_OPEN_ADDITIVE_PARTITION"),
  whole_source: z.literal("METAMORPHIC_BASELINE"),
  snapshot_id: versionIdentifierSchema,
  left_partition: metamorphicSandboxEvidenceRefSchema,
  right_partition: metamorphicSandboxEvidenceRefSchema,
  witness: halfOpenAdditivePartitionWitnessSchema,
});

const sameValuedDistinctFactRelationSampleMaterialSchema = z.strictObject({
  ...metamorphicRelationSampleBaseShape,
  relation_kind: z.literal("SAME_VALUED_DISTINCT_FACT"),
  follow_up_snapshot_id: versionIdentifierSchema,
  follow_up: metamorphicSandboxEvidenceRefSchema,
  witness: sameValuedDistinctFactWitnessSchema,
});

const metamorphicRelationSampleMaterialSchema = z.discriminatedUnion("relation_kind", [
  fanOutRelationSampleMaterialSchema,
  nullAntiMembershipRelationSampleMaterialSchema,
  halfOpenAdditivePartitionRelationSampleMaterialSchema,
  sameValuedDistinctFactRelationSampleMaterialSchema,
]);

const fanOutRelationSampleSchema = fanOutRelationSampleMaterialSchema.extend({
  sample_hash: contentHashSchema,
});
const nullAntiMembershipRelationSampleSchema =
  nullAntiMembershipRelationSampleMaterialSchema.extend({
    sample_hash: contentHashSchema,
  });
const halfOpenAdditivePartitionRelationSampleSchema =
  halfOpenAdditivePartitionRelationSampleMaterialSchema.extend({
    sample_hash: contentHashSchema,
  });
const sameValuedDistinctFactRelationSampleSchema =
  sameValuedDistinctFactRelationSampleMaterialSchema.extend({
    sample_hash: contentHashSchema,
  });

export const metamorphicRelationSampleSchema = z.discriminatedUnion("relation_kind", [
  fanOutRelationSampleSchema,
  nullAntiMembershipRelationSampleSchema,
  halfOpenAdditivePartitionRelationSampleSchema,
  sameValuedDistinctFactRelationSampleSchema,
]);

export const metamorphicRelationSamplesSchema = z.tuple([
  fanOutRelationSampleSchema,
  nullAntiMembershipRelationSampleSchema,
  halfOpenAdditivePartitionRelationSampleSchema,
  sameValuedDistinctFactRelationSampleSchema,
]);

export type MetamorphicRelationKind = z.infer<typeof metamorphicRelationKindSchema>;
export type MetamorphicSandboxEvidenceRef = z.infer<typeof metamorphicSandboxEvidenceRefSchema>;
export type MetamorphicRelationSample = z.infer<typeof metamorphicRelationSampleSchema>;
export type MetamorphicRelationSamples = z.infer<typeof metamorphicRelationSamplesSchema>;

export async function computeMetamorphicRelationSampleHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const sample = metamorphicRelationSampleSchema.safeParse(input);
  if (sample.success) {
    const { sample_hash: _sampleHash, ...material } = sample.data;
    return sha256ContentHash(material);
  }
  return sha256ContentHash(metamorphicRelationSampleMaterialSchema.parse(input));
}

const metamorphicOracleEvidenceMaterialSchema = z.strictObject({
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  fixture_receipt_ref: artifactReferenceFor("MetamorphicFixtureReceipt"),
  verifier: authorityIdentitySchema,
  verifier_role: z.literal("METAMORPHIC_VERIFIER"),
  authority_role_policy_version: z.literal(AUTHORITY_ROLE_POLICY_VERSION),
  baseline: metamorphicSandboxEvidenceRefSchema,
  relation_samples: metamorphicRelationSamplesSchema,
  metamorphic_verdict: z.enum(["PASS", "FAIL"]),
});

const metamorphicOracleReceiptObjectSchema = z.strictObject({
  artifact_type: z.literal("MetamorphicOracleReceipt"),
  receipt_ref: artifactReferenceFor("MetamorphicOracleReceipt"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  ...metamorphicOracleEvidenceMaterialSchema.shape,
  evidence_hash: contentHashSchema,
  evaluated_at: timestampSchema,
  receipt_hash: contentHashSchema,
});

function metamorphicSampleEvidenceRefs(
  sample: z.infer<typeof metamorphicRelationSampleSchema>,
): readonly z.infer<typeof metamorphicSandboxEvidenceRefSchema>[] {
  switch (sample.relation_kind) {
    case "FAN_OUT":
    case "NULL_ANTI_MEMBERSHIP":
    case "SAME_VALUED_DISTINCT_FACT":
      return [sample.follow_up];
    case "HALF_OPEN_ADDITIVE_PARTITION":
      return [sample.left_partition, sample.right_partition];
  }
}

export const metamorphicOracleReceiptSchema = metamorphicOracleReceiptObjectSchema.superRefine(
  (receipt, ctx) => {
    const evidenceBindings = [
      receipt.baseline,
      ...receipt.relation_samples.flatMap(metamorphicSampleEvidenceRefs),
    ];
    const references = [
      receipt.receipt_ref,
      receipt.sql_artifact_ref,
      receipt.fixture_receipt_ref,
      ...evidenceBindings.flatMap((binding) => [
        binding.sandbox_execution_receipt_ref,
        binding.result_artifact_ref,
      ]),
    ];
    if (references.some((reference) => !sameScope(reference, receipt.scope, receipt.run_id))) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicOracleReceipt 的全部引用必须属于同一 Scope/Run。",
        path: ["receipt_ref"],
      });
    }
    const referenceIdentities = references.map(artifactReferenceIdentity);
    if (new Set(referenceIdentities).size !== referenceIdentities.length) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicOracleReceipt 的 baseline/follow-up 引用必须全部互异。",
        path: ["relation_samples"],
      });
    }
    if (receipt.receipt_ref.content_hash !== receipt.receipt_hash) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicOracleReceipt Reference 必须携带 Receipt Hash。",
        path: ["receipt_ref", "content_hash"],
      });
    }
    const caseIds = receipt.relation_samples.map(({ case_id }) => case_id);
    if (new Set(caseIds).size !== caseIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicOracleReceipt.case_id 必须唯一。",
        path: ["relation_samples"],
      });
    }
    const halfOpenSnapshot = receipt.relation_samples[2].snapshot_id;
    const mutationSnapshotIds = [
      receipt.relation_samples[0].follow_up_snapshot_id,
      receipt.relation_samples[1].follow_up_snapshot_id,
      receipt.relation_samples[3].follow_up_snapshot_id,
    ];
    if (
      new Set(mutationSnapshotIds).size !== mutationSnapshotIds.length ||
      mutationSnapshotIds.includes(halfOpenSnapshot)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "MetamorphicOracleReceipt 的 single-mutation Snapshot 必须互异且不同于 half-open Baseline Snapshot。",
        path: ["relation_samples"],
      });
    }
    const hasFailure = receipt.relation_samples.some(({ verdict }) => verdict === "FAIL");
    if ((receipt.metamorphic_verdict === "PASS") === hasFailure) {
      ctx.addIssue({
        code: "custom",
        message: "MetamorphicOracleReceipt 总 Verdict 必须与四项 Relation Verdict 一致。",
        path: ["metamorphic_verdict"],
      });
    }
  },
);

export type MetamorphicOracleReceipt = z.infer<typeof metamorphicOracleReceiptSchema>;

export async function computeMetamorphicOracleEvidenceHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const receipt = metamorphicOracleReceiptObjectSchema.safeParse(input);
  const material = metamorphicOracleEvidenceMaterialSchema.parse(
    receipt.success
      ? {
          sql_artifact_ref: receipt.data.sql_artifact_ref,
          fixture_receipt_ref: receipt.data.fixture_receipt_ref,
          verifier: receipt.data.verifier,
          verifier_role: receipt.data.verifier_role,
          authority_role_policy_version: receipt.data.authority_role_policy_version,
          baseline: receipt.data.baseline,
          relation_samples: receipt.data.relation_samples,
          metamorphic_verdict: receipt.data.metamorphic_verdict,
        }
      : input,
  );
  return sha256ContentHash(material);
}

export async function computeMetamorphicOracleReceiptHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const receipt = metamorphicOracleReceiptSchema.parse(input);
  const {
    receipt_hash: _receiptHash,
    receipt_ref: { content_hash: _referenceHash, ...receiptReference },
    ...material
  } = receipt;
  return sha256ContentHash({
    ...material,
    receipt_ref: receiptReference,
  });
}

const resultInvariantVerdictSchema = z.strictObject({
  invariant_id: versionIdentifierSchema,
  verdict: z.enum(["PASS", "FAIL"]),
});

const resultOracleEvidenceMaterialSchema = z.strictObject({
  producer: authorityIdentitySchema,
  producer_role: z.literal("RESULT_PRODUCER"),
  authority_role_policy_version: z.literal(AUTHORITY_ROLE_POLICY_VERSION),
  oracle_version: versionIdentifierSchema,
  query_hash: contentHashSchema,
  result_hash: contentHashSchema,
  result_columns: z
    .array(postgresqlOutputAliasSchema)
    .min(1)
    .max(EXECUTABLE_QUERY_LIMITS.max_columns),
  row_count: z.number().int().nonnegative().max(EXECUTABLE_QUERY_LIMITS.max_rows),
  invariant_verdicts: z.array(resultInvariantVerdictSchema).min(1),
  metamorphic_oracle_receipt_ref: artifactReferenceFor("MetamorphicOracleReceipt"),
  metamorphic_verdict: z.enum(["PASS", "FAIL"]),
  oracle_verdict: z.enum(["PASS", "FAIL"]),
  result_artifact_ref: artifactReferenceFor("SandboxResult"),
});

const resultOracleReceiptObjectSchema = z.strictObject({
  artifact_type: z.literal("ResultOracleReceipt"),
  receipt_ref: artifactReferenceFor("ResultOracleReceipt"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  execution_receipt_ref: artifactReferenceFor("ExecutionReceipt"),
  ...resultOracleEvidenceMaterialSchema.shape,
  evidence_hash: contentHashSchema,
  evaluated_at: timestampSchema,
  receipt_hash: contentHashSchema,
});

export const resultOracleReceiptSchema = resultOracleReceiptObjectSchema.superRefine(
  (receipt, ctx) => {
    const references = [
      receipt.receipt_ref,
      receipt.sql_artifact_ref,
      receipt.execution_receipt_ref,
      receipt.metamorphic_oracle_receipt_ref,
      receipt.result_artifact_ref,
    ];
    if (references.some((reference) => !sameScope(reference, receipt.scope, receipt.run_id))) {
      ctx.addIssue({
        code: "custom",
        message: "ResultOracleReceipt 的全部引用必须属于同一 Scope/Run。",
        path: ["receipt_ref"],
      });
    }
    if (receipt.receipt_ref.content_hash !== receipt.receipt_hash) {
      ctx.addIssue({
        code: "custom",
        message: "ResultOracleReceipt Reference 必须携带 Receipt Hash。",
        path: ["receipt_ref", "content_hash"],
      });
    }
    const invariantIds = receipt.invariant_verdicts.map(({ invariant_id }) => invariant_id);
    if (new Set(invariantIds).size !== invariantIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "ResultOracleReceipt invariant_id 必须唯一。",
        path: ["invariant_verdicts"],
      });
    }
    const hasFailure =
      receipt.metamorphic_verdict === "FAIL" ||
      receipt.invariant_verdicts.some(({ verdict }) => verdict === "FAIL");
    if ((receipt.oracle_verdict === "PASS") === hasFailure) {
      ctx.addIssue({
        code: "custom",
        message: "ResultOracleReceipt 总 Verdict 必须与逐项 Invariant Verdict 一致。",
        path: ["oracle_verdict"],
      });
    }
  },
);

export type ResultOracleReceipt = z.infer<typeof resultOracleReceiptSchema>;

export async function computeResultOracleEvidenceHash(input: unknown): Promise<`sha256:${string}`> {
  const receipt = resultOracleReceiptObjectSchema.safeParse(input);
  const material = resultOracleEvidenceMaterialSchema.parse(
    receipt.success
      ? {
          producer: receipt.data.producer,
          producer_role: receipt.data.producer_role,
          authority_role_policy_version: receipt.data.authority_role_policy_version,
          oracle_version: receipt.data.oracle_version,
          query_hash: receipt.data.query_hash,
          result_hash: receipt.data.result_hash,
          result_columns: receipt.data.result_columns,
          row_count: receipt.data.row_count,
          invariant_verdicts: receipt.data.invariant_verdicts,
          metamorphic_oracle_receipt_ref: receipt.data.metamorphic_oracle_receipt_ref,
          metamorphic_verdict: receipt.data.metamorphic_verdict,
          oracle_verdict: receipt.data.oracle_verdict,
          result_artifact_ref: receipt.data.result_artifact_ref,
        }
      : input,
  );
  return sha256ContentHash(material);
}

export async function computeResultOracleReceiptHash(input: unknown): Promise<`sha256:${string}`> {
  const receipt = resultOracleReceiptSchema.parse(input);
  const {
    receipt_hash: _receiptHash,
    receipt_ref: { content_hash: _referenceHash, ...receiptReference },
    ...material
  } = receipt;
  return sha256ContentHash({
    ...material,
    receipt_ref: receiptReference,
  });
}

export function sameText2SqlEvidenceReference(
  left: z.infer<ReturnType<typeof artifactReferenceFor>>,
  right: z.infer<ReturnType<typeof artifactReferenceFor>>,
): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

export function canonicalText2SqlEvidence(input: unknown): string {
  return canonicalizeJson(input);
}
