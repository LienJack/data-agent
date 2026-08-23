import {
  type AuthorityIdentity,
  artifactReferenceIdentity,
  canonicalizeJson,
  computeFixtureMutationRecordHash,
  computeMetamorphicOracleEvidenceHash,
  computeMetamorphicOracleReceiptHash,
  computeMetamorphicRelationSampleHash,
  executionPermitSchema,
  fixtureMutationRecordSchema,
  groundingPackageSchema,
  isAuthoritativeSandboxExecutionReceipt,
  isAuthoritativeSandboxResult,
  logicalPlanSchema,
  metamorphicApplicabilityProfileSchema,
  metamorphicAuthorityRolePolicySchema,
  metamorphicOracleReceiptSchema,
  queryContractSchema,
  semanticQuerySchema,
  sqlArtifactSchema,
} from "@data-agent/contracts";
import {
  isAuthoritativeMetamorphicFixtureReceipt,
  isAuthoritativeMetamorphicOracleReceipt,
} from "@data-agent/contracts/server";
import { describe, expect, it } from "vitest";
import {
  type AuthoritativeMetamorphicOracleFixtureInput,
  createAuthoritativeMetamorphicSandboxFixture,
  createMetamorphicOracleFixture,
  type MetamorphicRelationRows,
} from "./support/metamorphic-oracle-fixture.js";

const zeroHash = `sha256:${"0".repeat(64)}` as const;
const evaluatedAt = "2026-07-26T00:30:00.000Z";

async function authoritativeOracleFixture(
  options: Readonly<{
    relation_rows?: MetamorphicRelationRows;
    global_aggregate?: boolean;
    aggregate_kind?: "sum" | "count";
    relation_verdicts?: AuthoritativeMetamorphicOracleFixtureInput["relation_verdicts"];
  }> = {},
) {
  const sandbox = await createAuthoritativeMetamorphicSandboxFixture(options);
  const fixture = await createMetamorphicOracleFixture({
    sandbox_fixture: sandbox,
    evaluated_at: evaluatedAt,
    ...(options.relation_verdicts ? { relation_verdicts: options.relation_verdicts } : {}),
  });
  return {
    sandbox,
    ...fixture,
  };
}

function bareIdentity(identity: AuthorityIdentity): AuthorityIdentity {
  return {
    authority_id: identity.authority_id,
    principal_id: identity.principal_id,
    key_id: identity.key_id,
  };
}

describe("Metamorphic Result Oracle", () => {
  it("Fixture 只把完整 Sandbox Authority Map 授权的 baseline/follow-up 交给 verifier", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture();

    expect(sandbox.authority_records).toBeInstanceOf(Map);
    expect(sandbox.committed_artifacts).toBeInstanceOf(Map);
    expect(sandbox.execution_records).toBeInstanceOf(Map);
    for (const evidence of Object.values(sandbox.evidence)) {
      expect(sandbox.authority_records.get(`request:${evidence.receipt.input_hash}`)).toBe(
        evidence.request,
      );
      expect(sandbox.authority_records.get(`execution-record:${evidence.receipt.input_hash}`)).toBe(
        evidence.execution_record,
      );
      expect(
        sandbox.authority_records.get(
          `artifact:${artifactReferenceIdentity(evidence.receipt.execution_permit_ref)}`,
        ),
      ).toBe(evidence.execution_permit);
      expect(
        sandbox.authority_records.get(
          `artifact:${artifactReferenceIdentity(evidence.receipt.sql_artifact_ref)}`,
        ),
      ).toBe(evidence.sql_artifact);
      expect(
        sandbox.authority_records.get(
          `artifact:${artifactReferenceIdentity(evidence.raw_receipt.receipt_ref)}`,
        ),
      ).toBe(evidence.raw_receipt);
      expect(
        sandbox.authority_records.get(
          `artifact:${artifactReferenceIdentity(evidence.raw_result.result_ref)}`,
        ),
      ).toBe(evidence.raw_result);

      expect(isAuthoritativeSandboxExecutionReceipt(evidence.receipt)).toBe(true);
      expect(isAuthoritativeSandboxResult(evidence.result)).toBe(true);
      expect(isAuthoritativeSandboxExecutionReceipt(evidence.raw_receipt)).toBe(false);
      expect(isAuthoritativeSandboxResult(evidence.raw_result)).toBe(false);
      expect(isAuthoritativeSandboxExecutionReceipt({ ...evidence.receipt })).toBe(false);
      expect(isAuthoritativeSandboxResult({ ...evidence.result })).toBe(false);
    }
  });

  it("可复用当前 SQL/Permit/执行域重签完整十组 Sandbox evidence", async () => {
    const current = await createAuthoritativeMetamorphicSandboxFixture();
    const currentBaseline = current.evidence.baseline;
    const currentSnapshot = currentBaseline.receipt.snapshot_token;
    if (!currentSnapshot) {
      throw new TypeError("External Metamorphic context 必须复用可重放 Snapshot。");
    }
    const rebuilt = await createAuthoritativeMetamorphicSandboxFixture({
      execution_context: {
        scope: currentBaseline.receipt.scope,
        run_id: currentBaseline.receipt.run_id,
        sandbox_identity: current.sandbox_execution_identity.identity,
        sql_artifact_ref: currentBaseline.receipt.sql_artifact_ref,
        sql_artifact: sqlArtifactSchema.parse(currentBaseline.sql_artifact),
        execution_permit_ref: currentBaseline.receipt.execution_permit_ref,
        execution_permit: executionPermitSchema.parse(currentBaseline.execution_permit),
        authority_epoch: currentBaseline.receipt.authority_revalidation.authority_epoch,
        artifact_context: current.artifact_context,
        baseline: {
          columns: currentBaseline.result.columns,
          rows: currentBaseline.result.rows,
          snapshot_token: currentSnapshot,
          started_at: currentBaseline.receipt.started_at,
          completed_at: currentBaseline.receipt.completed_at,
        },
      },
    });

    expect(Object.keys(rebuilt.evidence)).toHaveLength(10);
    for (const [label, evidence] of Object.entries(rebuilt.evidence)) {
      const isHalfOpenVariant = label === "left_partition" || label === "right_partition";
      if (isHalfOpenVariant) {
        expect(evidence.receipt.sql_artifact_ref).not.toEqual(
          currentBaseline.receipt.sql_artifact_ref,
        );
        expect(evidence.receipt.execution_permit_ref).not.toEqual(
          currentBaseline.receipt.execution_permit_ref,
        );
      } else {
        expect(evidence.receipt.sql_artifact_ref).toEqual(currentBaseline.receipt.sql_artifact_ref);
        expect(evidence.receipt.execution_permit_ref).toEqual(
          currentBaseline.receipt.execution_permit_ref,
        );
      }
      expect(evidence.receipt).toMatchObject({
        datasource_id: currentBaseline.receipt.datasource_id,
        schema_version: currentBaseline.receipt.schema_version,
        settings_hash: currentBaseline.receipt.settings_hash,
        execution_settings: currentBaseline.receipt.execution_settings,
        authority_revalidation: {
          effective_principal_id:
            currentBaseline.receipt.authority_revalidation.effective_principal_id,
          policy_receipt_ref: currentBaseline.receipt.authority_revalidation.policy_receipt_ref,
          authority_epoch: currentBaseline.receipt.authority_revalidation.authority_epoch,
        },
      });
    }

    const committed = new Map(current.committed_artifacts);
    const fixture = await createMetamorphicOracleFixture({
      sandbox_fixture: rebuilt,
      evaluated_at: evaluatedAt,
      artifact_context: current.artifact_context,
      store_adapter: {
        async resolveCommitted(reference) {
          return committed.get(artifactReferenceIdentity(reference)) ?? null;
        },
        async verifyCommitted(reference) {
          return committed.has(artifactReferenceIdentity(reference));
        },
        async verifyExactArtifactRevision(reference, artifact) {
          const payload = committed.get(artifactReferenceIdentity(reference));
          return payload !== undefined && canonicalizeJson(payload) === canonicalizeJson(artifact);
        },
        now: () => evaluatedAt,
        commit(reference, payload) {
          committed.set(artifactReferenceIdentity(reference), payload);
        },
      },
    });
    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toMatchObject({
      computed_verdict: "PASS",
    });
  });

  it("single mutation 使用新 Snapshot，half-open whole/left/right 与选择探针使用同一 Snapshot", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture();
    const { evidence } = sandbox;
    const baselineSnapshot = evidence.baseline.receipt.snapshot_token;

    expect(evidence.fan_out.receipt.snapshot_token).not.toBe(baselineSnapshot);
    expect(evidence.null_anti_membership.receipt.snapshot_token).not.toBe(baselineSnapshot);
    expect(evidence.same_valued_distinct_fact.receipt.snapshot_token).not.toBe(baselineSnapshot);
    expect(evidence.left_partition.receipt.snapshot_token).toBe(baselineSnapshot);
    expect(evidence.right_partition.receipt.snapshot_token).toBe(baselineSnapshot);
    expect(evidence.half_open_selection_probe.receipt.snapshot_token).toBe(baselineSnapshot);
    const halfOpenExecutions = [
      evidence.baseline,
      evidence.left_partition,
      evidence.right_partition,
    ];
    expect(
      new Set(
        halfOpenExecutions.map(({ receipt }) =>
          artifactReferenceIdentity(receipt.sql_artifact_ref),
        ),
      ),
    ).toHaveLength(3);
    expect(
      new Set(
        halfOpenExecutions.map(({ receipt }) =>
          artifactReferenceIdentity(receipt.execution_permit_ref),
        ),
      ),
    ).toHaveLength(3);
    expect(
      new Set(
        halfOpenExecutions.map(({ receipt }) =>
          artifactReferenceIdentity(receipt.resource_admission_ref),
        ),
      ),
    ).toHaveLength(3);
    expect(
      new Set(halfOpenExecutions.map(({ sql_artifact }) => sql_artifact.query_hash)),
    ).toHaveLength(3);
    expect(evidence.fan_out_selection_probe.result.columns.map(({ name }) => name)).toEqual([
      "fact_key",
      "dimension.customer_segment",
      "measure_minor_units",
    ]);
    expect(
      evidence.null_anti_membership_selection_probe.result.columns.map(({ name }) => name),
    ).toEqual(["probe_key", "dimension.customer_segment", "measure_minor_units"]);
    expect(evidence.half_open_selection_probe.result.columns.map(({ name }) => name)).toEqual([
      "boundary_fact_key",
      "dimension.customer_segment",
      "occurred_at",
      "measure_minor_units",
    ]);
    expect(
      evidence.same_valued_distinct_selection_probe.result.columns.map(({ name }) => name),
    ).toEqual([
      "original_fact_key",
      "dimension.customer_segment",
      "occurred_at",
      "measure_minor_units",
    ]);

    for (const probe of [
      evidence.fan_out_selection_probe,
      evidence.null_anti_membership_selection_probe,
      evidence.half_open_selection_probe,
      evidence.same_valued_distinct_selection_probe,
    ]) {
      expect(isAuthoritativeSandboxExecutionReceipt(probe.receipt)).toBe(true);
      expect(isAuthoritativeSandboxResult(probe.result)).toBe(true);
      expect(probe.result.rows).toHaveLength(1);
      expect(probe.result.rows[0]?.at(-1)).toBeGreaterThan(0);
    }
  });

  it("无维度整数 SUM fixture 使用 canonical [] group key", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture({
      global_aggregate: true,
    });

    expect(sandbox.evidence.baseline.result.columns).toEqual([
      { name: "metric.net_revenue", type: "INTEGER" },
    ]);
    expect(sandbox.evidence.baseline.result.rows).toEqual([[200]]);
    for (const probe of [
      sandbox.evidence.fan_out_selection_probe,
      sandbox.evidence.null_anti_membership_selection_probe,
      sandbox.evidence.half_open_selection_probe,
      sandbox.evidence.same_valued_distinct_selection_probe,
    ]) {
      expect(probe.result.rows).toHaveLength(1);
      expect(probe.result.rows[0]?.slice(1, -1)).toEqual(
        probe.result.columns.some(({ name }) => name === "occurred_at")
          ? [probe.result.rows[0]?.at(-2)]
          : [],
      );
      expect(probe.result.rows[0]?.at(-1)).toBe(10);
    }
  });

  it("Fixture Authority 封存四角色、整数 SUM applicability、selection probe 与两类 case lineage", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture({
      global_aggregate: true,
    });
    const fixture = await createMetamorphicOracleFixture({
      sandbox_fixture: sandbox,
      evaluated_at: evaluatedAt,
    });
    const authorityIdentities = Object.values(fixture.authority_identities);

    expect(authorityIdentities.map(({ role }) => role)).toEqual([
      "FIXTURE_MUTATION",
      "SANDBOX_EXECUTION",
      "METAMORPHIC_VERIFIER",
      "RESULT_PRODUCER",
    ]);
    expect(new Set(authorityIdentities.map(({ authority_id }) => authority_id))).toHaveLength(4);
    expect(new Set(authorityIdentities.map(({ principal_id }) => principal_id))).toHaveLength(4);
    expect(new Set(authorityIdentities.map(({ key_id }) => key_id))).toHaveLength(4);
    const {
      authority_id: fixtureAuthorityId,
      principal_id: fixturePrincipalId,
      key_id: fixtureKeyId,
    } = fixture.authority_identities.fixture_mutation;
    const fixtureIdentity = {
      authority_id: fixtureAuthorityId,
      principal_id: fixturePrincipalId,
      key_id: fixtureKeyId,
    };
    expect(fixture.fixture_receipt).toMatchObject({
      artifact_type: "MetamorphicFixtureReceipt",
      issuer: fixtureIdentity,
      issuer_role: "FIXTURE_MUTATION",
      authority_role_policy_version: "authority_role_policy@1.0.0",
      applicability_profile: {
        suite: "ADDITIVE_INTEGER_V1",
        aggregate_kind: "sum",
        distinct: false,
        source_measure_data_type: "integer",
        result_data_type: "INTEGER",
        metric_id: "metric.net_revenue",
        dimension_ids: [],
        group_key_arity: 0,
      },
      baseline: {
        snapshot_id: sandbox.evidence.baseline.receipt.snapshot_token,
        execution_input_hash: sandbox.evidence.baseline.receipt.input_hash,
      },
    });
    expect(fixture.fixture_receipt.cases.map(({ relation_kind }) => relation_kind)).toEqual([
      "FAN_OUT",
      "NULL_ANTI_MEMBERSHIP",
      "HALF_OPEN_ADDITIVE_PARTITION",
      "SAME_VALUED_DISTINCT_FACT",
    ]);

    for (const fixtureCase of [
      fixture.fixture_receipt.cases[0],
      fixture.fixture_receipt.cases[1],
      fixture.fixture_receipt.cases[3],
    ]) {
      expect(fixtureCase.follow_up_snapshot_id).not.toBe(
        fixture.fixture_receipt.baseline.snapshot_id,
      );
      expect(fixtureCase.selection_probe_input_hash).toBeTruthy();
      expect(fixtureCase.mutation_record_ref.artifact_type).toBe("FixtureMutationRecord");
      expect(fixtureCase.witness.group_key).toBe("[]");
    }

    const halfOpenCase = fixture.fixture_receipt.cases[2];
    expect(halfOpenCase).toMatchObject({
      relation_kind: "HALF_OPEN_ADDITIVE_PARTITION",
      snapshot_id: fixture.fixture_receipt.baseline.snapshot_id,
      whole_execution_input_hash: sandbox.evidence.baseline.receipt.input_hash,
      left_execution_input_hash: sandbox.evidence.left_partition.receipt.input_hash,
      right_execution_input_hash: sandbox.evidence.right_partition.receipt.input_hash,
      selection_probe_input_hash: sandbox.evidence.half_open_selection_probe.receipt.input_hash,
    });
    expect(halfOpenCase.witness.group_key).toBe("[]");
    expect(new Set(Object.values(halfOpenCase.query_variant_hashes))).toHaveLength(3);
    expect(halfOpenCase.query_variant_hashes).toEqual({
      whole: sandbox.evidence.baseline.sql_artifact.query_hash,
      left_half_open: sandbox.evidence.left_partition.sql_artifact.query_hash,
      right_half_open: sandbox.evidence.right_partition.sql_artifact.query_hash,
    });

    const sqlArtifact = sqlArtifactSchema.parse(
      sandbox.committed_artifacts.get(
        artifactReferenceIdentity(fixture.fixture_receipt.sql_artifact_ref),
      ),
    );
    const logicalPlan = logicalPlanSchema.parse(
      sandbox.committed_artifacts.get(
        artifactReferenceIdentity(fixture.fixture_receipt.logical_plan_ref),
      ),
    );
    const semanticQuery = semanticQuerySchema.parse(
      sandbox.committed_artifacts.get(artifactReferenceIdentity(logicalPlan.semantic_query_ref)),
    );
    const groundingPackage = groundingPackageSchema.parse(
      sandbox.committed_artifacts.get(
        artifactReferenceIdentity(fixture.fixture_receipt.grounding_package_ref),
      ),
    );
    const queryContract = queryContractSchema.parse(
      sandbox.committed_artifacts.get(
        artifactReferenceIdentity(fixture.fixture_receipt.query_contract_ref),
      ),
    );
    expect(sqlArtifact.logical_plan_ref).toEqual(fixture.fixture_receipt.logical_plan_ref);
    expect(semanticQuery.grounding_package_ref).toEqual(
      fixture.fixture_receipt.grounding_package_ref,
    );
    expect(groundingPackage.query_contract_ref).toEqual(fixture.fixture_receipt.query_contract_ref);
    expect(queryContract.result_contract.columns).toEqual(["metric.net_revenue"]);
    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toMatchObject({
      computed_verdict: "PASS",
    });
  });

  it("Meta Receipt 精确引用 Fixture，并把 half-open whole 固定为同 Snapshot baseline", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture();
    const fixture = await createMetamorphicOracleFixture({
      sandbox_fixture: sandbox,
      evaluated_at: evaluatedAt,
    });
    const halfOpenSample = fixture.receipt.relation_samples[2];
    const {
      authority_id: verifierAuthorityId,
      principal_id: verifierPrincipalId,
      key_id: verifierKeyId,
    } = fixture.authority_identities.metamorphic_verifier;
    const verifierIdentity = {
      authority_id: verifierAuthorityId,
      principal_id: verifierPrincipalId,
      key_id: verifierKeyId,
    };

    expect(fixture.receipt).toMatchObject({
      fixture_receipt_ref: fixture.fixture_receipt.receipt_ref,
      verifier: verifierIdentity,
      verifier_role: "METAMORPHIC_VERIFIER",
      authority_role_policy_version: "authority_role_policy@1.0.0",
    });
    expect(halfOpenSample).toMatchObject({
      relation_kind: "HALF_OPEN_ADDITIVE_PARTITION",
      whole_source: "METAMORPHIC_BASELINE",
      snapshot_id: sandbox.evidence.baseline.receipt.snapshot_token,
      left_partition: {
        sandbox_execution_receipt_ref: sandbox.evidence.left_partition.receipt.receipt_ref,
        result_artifact_ref: sandbox.evidence.left_partition.result.result_ref,
      },
      right_partition: {
        sandbox_execution_receipt_ref: sandbox.evidence.right_partition.receipt.receipt_ref,
        result_artifact_ref: sandbox.evidence.right_partition.result.result_ref,
      },
    });
    expect("follow_up_snapshot_id" in halfOpenSample).toBe(false);
  });

  it("四角色 authority_id/principal_id/key_id 均两两独立", async () => {
    const fixture = await authoritativeOracleFixture();
    const identities = fixture.authority_identities;
    const policy = {
      policy_version: "authority_role_policy@1.0.0",
      role_identities: {
        FIXTURE_MUTATION: bareIdentity(identities.fixture_mutation),
        SANDBOX_EXECUTION: bareIdentity(identities.sandbox_execution),
        METAMORPHIC_VERIFIER: bareIdentity(identities.metamorphic_verifier),
        RESULT_PRODUCER: bareIdentity(identities.result_producer),
      },
    } as const;

    expect(metamorphicAuthorityRolePolicySchema.safeParse(policy).success).toBe(true);
    for (const field of ["authority_id", "principal_id", "key_id"] as const) {
      expect(
        metamorphicAuthorityRolePolicySchema.safeParse({
          ...policy,
          role_identities: {
            ...policy.role_identities,
            RESULT_PRODUCER: {
              ...policy.role_identities.RESULT_PRODUCER,
              [field]: policy.role_identities.FIXTURE_MUTATION[field],
            },
          },
        }).success,
      ).toBe(false);
    }
  });

  it.each(["authority_id", "principal_id", "key_id"] as const)(
    "Fixture/Sandbox/Meta 三角色复用 %s 时 verifier fail closed",
    async (field) => {
      const sandbox = await createAuthoritativeMetamorphicSandboxFixture();
      const fixtureMutation = {
        authority_id: "50000000-0000-4000-8000-000000000301",
        principal_id: "fixture-independent-principal",
        key_id: "fixture-independent-key@1.0.0",
      } as const satisfies AuthorityIdentity;
      const verifierIdentity = {
        authority_id: "50000000-0000-4000-8000-000000000302",
        principal_id: "verifier-independent-principal",
        key_id: "verifier-independent-key@1.0.0",
        [field]: fixtureMutation[field],
      } as const satisfies AuthorityIdentity;
      const fixture = await createMetamorphicOracleFixture({
        sandbox_fixture: sandbox,
        evaluated_at: evaluatedAt,
        identity_overrides: {
          fixture_mutation: fixtureMutation,
          metamorphic_verifier: verifierIdentity,
        },
      });

      await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
    },
  );

  it.each(["authority_id", "principal_id", "key_id"] as const)(
    "Fixture/Meta 三角色用大小写不同的 UUID 复用 %s 时 verifier fail closed",
    async (field) => {
      const sandbox = await createAuthoritativeMetamorphicSandboxFixture();
      const sharedUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const fixtureMutation = {
        authority_id: "50000000-0000-4000-8000-000000000301",
        principal_id: "fixture-independent-principal",
        key_id: "fixture-independent-key@1.0.0",
        [field]: sharedUuid,
      } as const satisfies AuthorityIdentity;
      const verifierIdentity = {
        authority_id: "50000000-0000-4000-8000-000000000302",
        principal_id: "verifier-independent-principal",
        key_id: "verifier-independent-key@1.0.0",
        [field]: sharedUuid.toUpperCase(),
      } as const satisfies AuthorityIdentity;
      const fixture = await createMetamorphicOracleFixture({
        sandbox_fixture: sandbox,
        evaluated_at: evaluatedAt,
        identity_overrides: {
          fixture_mutation: fixtureMutation,
          metamorphic_verifier: verifierIdentity,
        },
      });

      await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
    },
  );

  it.each([
    {
      name: "COUNT DISTINCT",
      profile: {
        aggregate_kind: "count",
        distinct: true,
        source_measure_data_type: "not_applicable_for_count",
      },
    },
    {
      name: "AVG",
      profile: {
        aggregate_kind: "avg",
        distinct: false,
        source_measure_data_type: "integer",
      },
    },
    {
      name: "MIN",
      profile: {
        aggregate_kind: "min",
        distinct: false,
        source_measure_data_type: "integer",
      },
    },
    {
      name: "MAX",
      profile: {
        aggregate_kind: "max",
        distinct: false,
        source_measure_data_type: "integer",
      },
    },
    {
      name: "numeric SUM",
      profile: {
        aggregate_kind: "sum",
        distinct: false,
        source_measure_data_type: "numeric",
      },
    },
  ] as const)("$name 不属于 ADDITIVE_INTEGER_V1 applicability", ({ profile }) => {
    expect(
      metamorphicApplicabilityProfileSchema.safeParse({
        suite: "ADDITIVE_INTEGER_V1",
        result_data_type: "INTEGER",
        metric_id: "order_count",
        dimension_ids: ["segment"],
        group_key_arity: 1,
        ...profile,
      }).success,
    ).toBe(false);
  });

  it("合法结构但不匹配五件 lineage 派生结果的 applicability profile 被拒绝", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture();
    const fixture = await createMetamorphicOracleFixture({
      sandbox_fixture: sandbox,
      evaluated_at: evaluatedAt,
      applicability_profile: {
        ...sandbox.artifact_context.applicability_profile,
        metric_id: "metric.forged_revenue",
      },
    });

    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
  });

  it.each([
    { name: "COUNT DISTINCT", aggregateKind: "count_distinct", numericSource: false },
    { name: "AVG", aggregateKind: "avg", numericSource: false },
    { name: "numeric SUM", aggregateKind: "sum", numericSource: true },
  ] as const)(
    "五件 committed lineage 声明 $name 时仍不可获得 applicability",
    async ({ aggregateKind, numericSource }) => {
      const sandbox = await createAuthoritativeMetamorphicSandboxFixture();
      const groundingIdentity = artifactReferenceIdentity(
        sandbox.artifact_context.grounding_package_ref,
      );
      const logicalIdentity = artifactReferenceIdentity(sandbox.artifact_context.logical_plan_ref);
      const grounding = groundingPackageSchema.parse(
        sandbox.committed_artifacts.get(groundingIdentity),
      );
      const logical = logicalPlanSchema.parse(sandbox.committed_artifacts.get(logicalIdentity));
      const semanticIdentity = artifactReferenceIdentity(logical.semantic_query_ref);
      const semantic = semanticQuerySchema.parse(sandbox.committed_artifacts.get(semanticIdentity));
      const metric = {
        ...grounding.metric,
        aggregation: aggregateKind,
      };
      sandbox.committed_artifacts.set(
        groundingIdentity,
        groundingPackageSchema.parse({
          ...grounding,
          metric,
          allowed_schema: numericSource
            ? {
                tables: grounding.allowed_schema.tables.map((table) => ({
                  ...table,
                  columns: table.columns.map((column) =>
                    column.column_id === grounding.metric.column_id
                      ? { ...column, data_type: "numeric" }
                      : column,
                  ),
                })),
              }
            : grounding.allowed_schema,
        }),
      );
      sandbox.committed_artifacts.set(
        semanticIdentity,
        semanticQuerySchema.parse({
          ...semantic,
          metric,
        }),
      );
      sandbox.committed_artifacts.set(
        logicalIdentity,
        logicalPlanSchema.parse({
          ...logical,
          operations: logical.operations.map((operation) =>
            operation.operation === "aggregate" || operation.operation === "preaggregate"
              ? {
                  ...operation,
                  measures: operation.measures.map((measure) => ({
                    ...measure,
                    function: aggregateKind,
                    distinct: aggregateKind === "count_distinct",
                  })),
                }
              : operation,
          ),
        }),
      );
      const fixture = await createMetamorphicOracleFixture({
        sandbox_fixture: sandbox,
        evaluated_at: evaluatedAt,
      });

      await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
    },
  );

  it("Selection Probe 即使同 group 且非零，fake key 也不能关闭 witness", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture({
      selection_probe_rows: {
        fan_out_selection_probe: [["unrelated-order", "new", 10]],
      },
    });
    const fixture = await createMetamorphicOracleFixture({
      sandbox_fixture: sandbox,
      evaluated_at: evaluatedAt,
    });

    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
  });

  it("half-open 复用同一 SQL/Permit 的 fake partition 即使结果可加仍被拒绝", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture({
      half_open_query_variants: "REUSE_BASELINE",
    });
    const fixture = await createMetamorphicOracleFixture({
      sandbox_fixture: sandbox,
      evaluated_at: evaluatedAt,
    });

    expect(sandbox.evidence.left_partition.receipt.sql_artifact_ref).toEqual(
      sandbox.evidence.baseline.receipt.sql_artifact_ref,
    );
    expect(sandbox.evidence.right_partition.receipt.sql_artifact_ref).toEqual(
      sandbox.evidence.baseline.receipt.sql_artifact_ref,
    );
    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
  });

  it("half-open 仅追加注释制造不同 query_hash 时仍拒绝语义相同的 fake partition", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture({
      half_open_query_variants: "COMMENT_ONLY",
    });
    const fixture = await createMetamorphicOracleFixture({
      sandbox_fixture: sandbox,
      evaluated_at: evaluatedAt,
    });

    expect(sandbox.evidence.left_partition.sql_artifact.parameters).toEqual(
      sandbox.evidence.baseline.sql_artifact.parameters,
    );
    expect(sandbox.evidence.right_partition.sql_artifact.parameters).toEqual(
      sandbox.evidence.baseline.sql_artifact.parameters,
    );
    expect(
      new Set([
        sandbox.evidence.baseline.sql_artifact.query_hash,
        sandbox.evidence.left_partition.sql_artifact.query_hash,
        sandbox.evidence.right_partition.sql_artifact.query_hash,
      ]),
    ).toHaveLength(3);
    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
  });

  it("从原始 Sandbox rows 重算固定四类非空关系", async () => {
    const fixture = await authoritativeOracleFixture();

    const verification = await fixture.verifier.verify(fixture.receipt.receipt_ref);

    expect(verification).not.toBeNull();
    expect(isAuthoritativeMetamorphicFixtureReceipt(verification?.fixture_receipt)).toBe(true);
    expect(isAuthoritativeMetamorphicOracleReceipt(verification?.receipt)).toBe(true);
    expect(isAuthoritativeMetamorphicFixtureReceipt(fixture.fixture_receipt)).toBe(false);
    expect(isAuthoritativeMetamorphicOracleReceipt(fixture.receipt)).toBe(false);
    expect(isAuthoritativeMetamorphicFixtureReceipt({ ...verification?.fixture_receipt })).toBe(
      false,
    );
    expect(isAuthoritativeMetamorphicOracleReceipt({ ...verification?.receipt })).toBe(false);
    expect(verification?.computed_verdict).toBe("PASS");
    expect(
      verification?.relation_verifications.map(
        ({ relation_kind, computed_verdict }) => [relation_kind, computed_verdict] as const,
      ),
    ).toEqual([
      ["FAN_OUT", "PASS"],
      ["NULL_ANTI_MEMBERSHIP", "PASS"],
      ["HALF_OPEN_ADDITIVE_PARTITION", "PASS"],
      ["SAME_VALUED_DISTINCT_FACT", "PASS"],
    ]);
  });

  it("普通 COUNT 的 SAME_VALUED_DISTINCT_FACT 按 +1 而不是 measure_minor_units", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture({
      aggregate_kind: "count",
    });
    const fixture = await createMetamorphicOracleFixture({
      sandbox_fixture: sandbox,
      evaluated_at: evaluatedAt,
    });

    expect(sandbox.evidence.same_valued_distinct_fact.result.rows).toEqual([
      ["new", 121],
      ["returning", 80],
    ]);
    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toMatchObject({
      computed_verdict: "PASS",
      relation_verifications: expect.arrayContaining([
        expect.objectContaining({
          relation_kind: "SAME_VALUED_DISTINCT_FACT",
          computed_verdict: "PASS",
        }),
      ]),
    });
  });

  it.each(["sum", "count"] as const)(
    "分组 %s 的 HALF_OPEN 允许 left 为空且 whole 等于 right",
    async (aggregateKind) => {
      const wholeRows = [
        ["new", 120],
        ["returning", 80],
      ] as const;
      const fixture = await authoritativeOracleFixture({
        aggregate_kind: aggregateKind,
        relation_rows: {
          left_partition: [],
          right_partition: wholeRows,
        },
      });

      const verification = await fixture.verifier.verify(fixture.receipt.receipt_ref);

      expect(
        verification?.relation_verifications.find(
          ({ relation_kind }) => relation_kind === "HALF_OPEN_ADDITIVE_PARTITION",
        ),
      ).toMatchObject({
        declared_verdict: "PASS",
        computed_verdict: "PASS",
      });
    },
  );

  it.each([
    {
      name: "全局聚合 left 为空",
      global_aggregate: true,
      relation_rows: {
        left_partition: [],
        right_partition: [[200]],
      },
    },
    {
      name: "分组聚合 right 为空",
      global_aggregate: false,
      relation_rows: {
        left_partition: [
          ["new", 120],
          ["returning", 80],
        ],
        right_partition: [],
      },
    },
  ] as const)("$name 时 HALF_OPEN 不能 vacuous PASS", async (input) => {
    const fixture = await authoritativeOracleFixture(input);

    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
  });

  it("结构与全部 Hash 自洽但错绑 Case 的 mutation record 不能品牌化", async () => {
    const sandbox = await createAuthoritativeMetamorphicSandboxFixture();
    const fixture = await createMetamorphicOracleFixture({
      sandbox_fixture: sandbox,
      evaluated_at: evaluatedAt,
      mutation_record_binding: "FAN_OUT_WRONG_CASE",
    });
    const fanOutCase = fixture.fixture_receipt.cases[0];
    const rawRecord = await fixture.store_adapter.resolveCommitted(fanOutCase.mutation_record_ref);
    const record = fixtureMutationRecordSchema.parse(rawRecord);
    const recordHash = await computeFixtureMutationRecordHash(record);

    expect(recordHash).toBe(fanOutCase.mutation_record_ref.content_hash);
    expect(recordHash).toBe(fanOutCase.mutation_descriptor_hash);
    expect(record.case_id).not.toBe(fanOutCase.case_id);
    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
  });

  it.each([
    {
      relation: "FAN_OUT",
      relationRows: {
        fan_out: [
          ["returning", 80],
          ["new", 120],
        ],
      },
    },
    {
      relation: "NULL_ANTI_MEMBERSHIP",
      relationRows: {
        null_anti_membership: [
          ["returning", 80],
          ["new", 120],
        ],
      },
    },
  ] as const)("$relation 忽略无 ORDER BY 的行顺序变化", async ({ relation, relationRows }) => {
    const fixture = await authoritativeOracleFixture({
      relation_rows: relationRows satisfies MetamorphicRelationRows,
    });

    const verification = await fixture.verifier.verify(fixture.receipt.receipt_ref);

    expect(
      verification?.relation_verifications.find(({ relation_kind }) => relation_kind === relation),
    ).toMatchObject({
      declared_verdict: "PASS",
      computed_verdict: "PASS",
    });
  });

  it.each([
    {
      name: "FAN_OUT 新增重复行",
      relation: "FAN_OUT",
      relationRows: {
        fan_out: [
          ["new", 120],
          ["returning", 80],
          ["returning", 80],
        ],
      },
    },
    {
      name: "FAN_OUT 删除一行",
      relation: "FAN_OUT",
      relationRows: {
        fan_out: [["new", 120]],
      },
    },
    {
      name: "NULL 新增重复行",
      relation: "NULL_ANTI_MEMBERSHIP",
      relationRows: {
        null_anti_membership: [
          ["new", 120],
          ["returning", 80],
          ["returning", 80],
        ],
      },
    },
    {
      name: "NULL 删除一行",
      relation: "NULL_ANTI_MEMBERSHIP",
      relationRows: {
        null_anti_membership: [["new", 120]],
      },
    },
  ] as const)(
    "$name 时 row multiset 保留 multiplicity 并判 FAIL",
    async ({ relation, relationRows }) => {
      const fixture = await authoritativeOracleFixture({
        relation_rows: relationRows satisfies MetamorphicRelationRows,
        relation_verdicts: {
          [relation]: "FAIL",
        },
      });

      const verification = await fixture.verifier.verify(fixture.receipt.receipt_ref);
      const relationVerification = verification?.relation_verifications.find(
        ({ relation_kind }) => relation_kind === relation,
      );

      expect(verification?.computed_verdict).toBe("FAIL");
      expect(relationVerification).toMatchObject({
        declared_verdict: "FAIL",
        computed_verdict: "FAIL",
      });
    },
  );

  it.each([
    {
      name: "Fan-Out 膨胀",
      relation: "FAN_OUT",
      rows: {
        fan_out: [
          ["new", 240],
          ["returning", 80],
        ],
      },
    },
    {
      name: "NULL anti-membership survivor 消失",
      relation: "NULL_ANTI_MEMBERSHIP",
      rows: {
        null_anti_membership: [["returning", 80]],
      },
    },
    {
      name: "半开边界在左右分区重复计数",
      relation: "HALF_OPEN_ADDITIVE_PARTITION",
      rows: {
        right_partition: [
          ["new", 90],
          ["returning", 50],
        ],
      },
    },
    {
      name: "SUM DISTINCT 吞掉同值新事实",
      relation: "SAME_VALUED_DISTINCT_FACT",
      rows: {
        same_valued_distinct_fact: [
          ["new", 120],
          ["returning", 80],
        ],
      },
    },
  ] as const)("$name 的声明必须与固定算法一致", async ({ relation, rows }) => {
    const forgedPass = await authoritativeOracleFixture({
      relation_rows: rows satisfies MetamorphicRelationRows,
    });
    expect(forgedPass.receipt.metamorphic_verdict).toBe("PASS");
    await expect(forgedPass.verifier.verify(forgedPass.receipt.receipt_ref)).resolves.toBeNull();

    const authoritativeFailure = await authoritativeOracleFixture({
      relation_rows: rows satisfies MetamorphicRelationRows,
      relation_verdicts: {
        [relation]: "FAIL",
      },
    });
    const verification = await authoritativeFailure.verifier.verify(
      authoritativeFailure.receipt.receipt_ref,
    );

    expect(authoritativeFailure.receipt.metamorphic_verdict).toBe("FAIL");
    expect(verification?.computed_verdict).toBe("FAIL");
    expect(
      verification?.relation_verifications.find(({ relation_kind }) => relation_kind === relation),
    ).toMatchObject({
      declared_verdict: "FAIL",
      computed_verdict: "FAIL",
    });
  });

  it("空结果不能形成 vacuous PASS", async () => {
    const fixture = await authoritativeOracleFixture({
      relation_rows: {
        fan_out: [],
      },
    });

    const verification = await fixture.verifier.verify(fixture.receipt.receipt_ref);

    expect(verification).toBeNull();
  });

  it("未提交引用与 Reference A/Payload B 不能获得 verification", async () => {
    const fixture = await authoritativeOracleFixture();
    const receiptIdentity = artifactReferenceIdentity(fixture.receipt.receipt_ref);
    fixture.sandbox.committed_artifacts.delete(receiptIdentity);
    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();

    fixture.sandbox.committed_artifacts.set(receiptIdentity, {
      ...fixture.receipt,
      receipt_ref: {
        ...fixture.receipt.receipt_ref,
        artifact_id: "50000000-0000-4000-8000-000000000999",
      },
    });
    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
  });

  it("注册后篡改原 store callbacks 不能把未提交 Meta Receipt 伪造成 PASS", async () => {
    const fixture = await authoritativeOracleFixture();
    const committedSnapshot = new Map(fixture.sandbox.committed_artifacts);
    const receiptIdentity = artifactReferenceIdentity(fixture.receipt.receipt_ref);
    fixture.sandbox.committed_artifacts.delete(receiptIdentity);

    fixture.store_adapter.resolveCommitted = async (reference) =>
      committedSnapshot.get(artifactReferenceIdentity(reference)) ?? null;
    fixture.store_adapter.verifyCommitted = async () => true;
    fixture.store_adapter.verifyExactArtifactRevision = async () => true;

    await expect(fixture.verifier.verify(fixture.receipt.receipt_ref)).resolves.toBeNull();
  });

  it("Hash 合法但声明 snapshot 与实际 Sandbox snapshot_token 不一致时拒绝", async () => {
    const fixture = await authoritativeOracleFixture();
    const forgedSampleMaterial = {
      ...fixture.receipt.relation_samples[0],
      follow_up_snapshot_id: "metamorphic-snapshot@forged",
      sample_hash: zeroHash,
    };
    const forgedSample = {
      ...forgedSampleMaterial,
      sample_hash: await computeMetamorphicRelationSampleHash(forgedSampleMaterial),
    };
    const relationSamples = [forgedSample, ...fixture.receipt.relation_samples.slice(1)] as const;
    const receiptMaterial = {
      ...fixture.receipt,
      receipt_ref: {
        ...fixture.receipt.receipt_ref,
        content_hash: zeroHash,
      },
      relation_samples: relationSamples,
      evidence_hash: zeroHash,
      receipt_hash: zeroHash,
    };
    const evidenceHash = await computeMetamorphicOracleEvidenceHash(receiptMaterial);
    const draft = metamorphicOracleReceiptSchema.parse({
      ...receiptMaterial,
      evidence_hash: evidenceHash,
    });
    const receiptHash = await computeMetamorphicOracleReceiptHash(draft);
    const forgedReceipt = metamorphicOracleReceiptSchema.parse({
      ...draft,
      receipt_ref: {
        ...draft.receipt_ref,
        content_hash: receiptHash,
      },
      receipt_hash: receiptHash,
    });
    fixture.store_adapter.commit(forgedReceipt.receipt_ref, forgedReceipt);

    await expect(fixture.verifier.verify(forgedReceipt.receipt_ref)).resolves.toBeNull();
  });
});
