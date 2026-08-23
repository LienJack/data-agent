import { describe, expect, it } from "vitest";
import {
  AUTHORITY_ROLE_POLICY_VERSION,
  AUTHORITY_ROLES,
  authorityIdentitySchema,
  canonicalizeAuthorityIdentityComparisonValue,
  computeMetamorphicFixtureEvidenceHash,
  computeMetamorphicFixtureReceiptHash,
  computeMetamorphicOracleEvidenceHash,
  computeMetamorphicOracleReceiptHash,
  computeMetamorphicRelationSampleHash,
  L2_ARTIFACT_TYPES,
  METAMORPHIC_RELATIONS,
  metamorphicAuthorityRolePolicySchema,
  metamorphicFixtureCasesSchema,
  metamorphicFixtureReceiptSchema,
  metamorphicOracleReceiptSchema,
  metamorphicRelationSamplesSchema,
  SYSTEM_ARTIFACT_TYPES,
} from "../src/index.js";
import { hashes, ids, makeArtifactReference } from "./fixtures.js";

const scope = {
  app_id: ids.appA,
  tenant_id: ids.tenantA,
  environment: "test",
} as const;

const authorityIdentities = {
  FIXTURE_MUTATION: {
    authority_id: "00000000-0000-4000-8000-000000000601",
    principal_id: "fixture-principal",
    key_id: "fixture-key@1",
  },
  SANDBOX_EXECUTION: {
    authority_id: "00000000-0000-4000-8000-000000000602",
    principal_id: "sandbox-principal",
    key_id: "sandbox-key@1",
  },
  METAMORPHIC_VERIFIER: {
    authority_id: "00000000-0000-4000-8000-000000000603",
    principal_id: "metamorphic-principal",
    key_id: "metamorphic-key@1",
  },
  RESULT_PRODUCER: {
    authority_id: "00000000-0000-4000-8000-000000000604",
    principal_id: "result-principal",
    key_id: "result-key@1",
  },
} as const;

const evidenceIds = {
  fixture: "00000000-0000-4000-8000-000000000610",
  sql: "00000000-0000-4000-8000-000000000611",
  query: "00000000-0000-4000-8000-000000000612",
  grounding: "00000000-0000-4000-8000-000000000613",
  plan: "00000000-0000-4000-8000-000000000614",
  fanCase: "00000000-0000-4000-8000-000000000615",
  nullCase: "00000000-0000-4000-8000-000000000616",
  halfCase: "00000000-0000-4000-8000-000000000617",
  distinctCase: "00000000-0000-4000-8000-000000000618",
  fanMutation: "00000000-0000-4000-8000-000000000619",
  nullMutation: "00000000-0000-4000-8000-000000000620",
  distinctMutation: "00000000-0000-4000-8000-000000000621",
  meta: "00000000-0000-4000-8000-000000000622",
} as const;

function sandboxEvidence(index: number) {
  const suffix = String(700 + index).padStart(12, "0");
  return {
    sandbox_execution_receipt_ref: makeArtifactReference(
      "SandboxExecutionReceipt",
      `00000000-0000-4000-8000-${suffix}`,
    ),
    result_artifact_ref: makeArtifactReference(
      "SandboxResult",
      `00000000-0000-4000-8001-${suffix}`,
    ),
  };
}

const emptyGroupWitness = {
  group_key: "[]",
  measure_minor_units: 1,
} as const;

function fixtureCaseMaterials() {
  return [
    {
      relation_kind: "FAN_OUT",
      case_id: evidenceIds.fanCase,
      follow_up_snapshot_id: "snapshot-fan",
      follow_up_execution_input_hash: hashes.execution,
      selection_probe: sandboxEvidence(1),
      selection_probe_input_hash: hashes.input,
      mutation_record_ref: makeArtifactReference("FixtureMutationRecord", evidenceIds.fanMutation),
      mutation_descriptor_hash: hashes.artifact,
      witness: {
        ...emptyGroupWitness,
        fact_key: "fact-1",
        join_path: ["orders.order_items"],
        original_child_key: "child-1",
        added_child_key: "child-2",
        baseline_multiplicity: 1,
        follow_up_multiplicity: 2,
      },
    },
    {
      relation_kind: "NULL_ANTI_MEMBERSHIP",
      case_id: evidenceIds.nullCase,
      follow_up_snapshot_id: "snapshot-null",
      follow_up_execution_input_hash: hashes.execution,
      selection_probe: sandboxEvidence(2),
      selection_probe_input_hash: hashes.input,
      mutation_record_ref: makeArtifactReference("FixtureMutationRecord", evidenceIds.nullMutation),
      mutation_descriptor_hash: hashes.artifact,
      witness: {
        ...emptyGroupWitness,
        probe_key: "probe-1",
        inserted_null_row_key: "null-row-1",
      },
    },
    {
      relation_kind: "HALF_OPEN_ADDITIVE_PARTITION",
      case_id: evidenceIds.halfCase,
      snapshot_id: "snapshot-baseline",
      whole_execution_input_hash: hashes.execution,
      left_execution_input_hash: hashes.input,
      right_execution_input_hash: hashes.artifact,
      selection_probe: sandboxEvidence(3),
      selection_probe_input_hash: hashes.input,
      query_variant_hashes: {
        whole: hashes.execution,
        left_half_open: hashes.input,
        right_half_open: hashes.artifact,
      },
      witness: {
        group_key: "[]",
        start_at: "2026-01-01T00:00:00.000Z",
        midpoint_at: "2026-02-01T00:00:00.000Z",
        end_at: "2026-03-01T00:00:00.000Z",
        boundary_fact_key: "boundary-fact",
        boundary_measure_minor_units: 1,
      },
    },
    {
      relation_kind: "SAME_VALUED_DISTINCT_FACT",
      case_id: evidenceIds.distinctCase,
      follow_up_snapshot_id: "snapshot-distinct",
      follow_up_execution_input_hash: hashes.execution,
      selection_probe: sandboxEvidence(4),
      selection_probe_input_hash: hashes.input,
      mutation_record_ref: makeArtifactReference(
        "FixtureMutationRecord",
        evidenceIds.distinctMutation,
      ),
      mutation_descriptor_hash: hashes.artifact,
      witness: {
        ...emptyGroupWitness,
        original_fact_key: "fact-1",
        added_fact_key: "fact-2",
        occurred_at: "2026-02-10T00:00:00.000Z",
      },
    },
  ] as const;
}

async function makeFixtureReceipt() {
  const evidence = {
    sql_artifact_ref: makeArtifactReference("SqlArtifact", evidenceIds.sql),
    query_contract_ref: makeArtifactReference("QueryContract", evidenceIds.query),
    grounding_package_ref: makeArtifactReference("GroundingPackage", evidenceIds.grounding),
    logical_plan_ref: makeArtifactReference("LogicalPlan", evidenceIds.plan),
    oracle_id: "additive-integer",
    oracle_version: "additive-integer@1",
    fixture_id: "retail-additive",
    fixture_version: "retail-additive@1",
    issuer: authorityIdentities.FIXTURE_MUTATION,
    issuer_role: "FIXTURE_MUTATION",
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
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
      snapshot_id: "snapshot-baseline",
      execution_input_hash: hashes.execution,
    },
    cases: fixtureCaseMaterials(),
  } as const;
  const evidenceHash = await computeMetamorphicFixtureEvidenceHash(evidence);
  const draft = metamorphicFixtureReceiptSchema.parse({
    artifact_type: "MetamorphicFixtureReceipt",
    receipt_ref: {
      ...makeArtifactReference("MetamorphicFixtureReceipt", evidenceIds.fixture),
      content_hash: hashes.artifact,
    },
    scope,
    run_id: ids.run,
    ...evidence,
    evidence_hash: evidenceHash,
    issued_at: "2026-07-26T15:00:00.000Z",
    receipt_hash: hashes.artifact,
  });
  const receiptHash = await computeMetamorphicFixtureReceiptHash(draft);
  return metamorphicFixtureReceiptSchema.parse({
    ...draft,
    receipt_ref: { ...draft.receipt_ref, content_hash: receiptHash },
    receipt_hash: receiptHash,
  });
}

async function makeMetaReceipt() {
  const fixture = await makeFixtureReceipt();
  const sampleMaterials = [
    {
      relation_kind: "FAN_OUT",
      case_id: evidenceIds.fanCase,
      follow_up_snapshot_id: "snapshot-fan",
      follow_up: sandboxEvidence(11),
      witness: fixture.cases[0].witness,
      verdict: "PASS",
    },
    {
      relation_kind: "NULL_ANTI_MEMBERSHIP",
      case_id: evidenceIds.nullCase,
      follow_up_snapshot_id: "snapshot-null",
      follow_up: sandboxEvidence(12),
      witness: fixture.cases[1].witness,
      verdict: "PASS",
    },
    {
      relation_kind: "HALF_OPEN_ADDITIVE_PARTITION",
      case_id: evidenceIds.halfCase,
      whole_source: "METAMORPHIC_BASELINE",
      snapshot_id: "snapshot-baseline",
      left_partition: sandboxEvidence(13),
      right_partition: sandboxEvidence(14),
      witness: fixture.cases[2].witness,
      verdict: "PASS",
    },
    {
      relation_kind: "SAME_VALUED_DISTINCT_FACT",
      case_id: evidenceIds.distinctCase,
      follow_up_snapshot_id: "snapshot-distinct",
      follow_up: sandboxEvidence(15),
      witness: fixture.cases[3].witness,
      verdict: "PASS",
    },
  ] as const;
  const relationSamples = await Promise.all(
    sampleMaterials.map(async (sample) => ({
      ...sample,
      sample_hash: await computeMetamorphicRelationSampleHash(sample),
    })),
  );
  const evidence = {
    sql_artifact_ref: fixture.sql_artifact_ref,
    fixture_receipt_ref: fixture.receipt_ref,
    verifier: authorityIdentities.METAMORPHIC_VERIFIER,
    verifier_role: "METAMORPHIC_VERIFIER",
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
    baseline: sandboxEvidence(10),
    relation_samples: relationSamples,
    metamorphic_verdict: "PASS",
  } as const;
  const evidenceHash = await computeMetamorphicOracleEvidenceHash(evidence);
  const draft = metamorphicOracleReceiptSchema.parse({
    artifact_type: "MetamorphicOracleReceipt",
    receipt_ref: {
      ...makeArtifactReference("MetamorphicOracleReceipt", evidenceIds.meta),
      content_hash: hashes.artifact,
    },
    scope,
    run_id: ids.run,
    ...evidence,
    evidence_hash: evidenceHash,
    evaluated_at: "2026-07-26T15:01:00.000Z",
    receipt_hash: hashes.artifact,
  });
  const receiptHash = await computeMetamorphicOracleReceiptHash(draft);
  return metamorphicOracleReceiptSchema.parse({
    ...draft,
    receipt_ref: { ...draft.receipt_ref, content_hash: receiptHash },
    receipt_hash: receiptHash,
  });
}

describe("RQ090 T007 contracts", () => {
  it("freezes four authority roles and fails closed on reused authority, principal, or key", () => {
    expect(AUTHORITY_ROLES).toEqual([
      "FIXTURE_MUTATION",
      "SANDBOX_EXECUTION",
      "METAMORPHIC_VERIFIER",
      "RESULT_PRODUCER",
    ]);
    expect(authorityIdentitySchema.parse(authorityIdentities.FIXTURE_MUTATION)).toEqual(
      authorityIdentities.FIXTURE_MUTATION,
    );
    const valid = {
      policy_version: AUTHORITY_ROLE_POLICY_VERSION,
      role_identities: authorityIdentities,
    };
    expect(metamorphicAuthorityRolePolicySchema.safeParse(valid).success).toBe(true);
    for (const field of ["authority_id", "principal_id", "key_id"] as const) {
      expect(
        metamorphicAuthorityRolePolicySchema.safeParse({
          ...valid,
          role_identities: {
            ...valid.role_identities,
            RESULT_PRODUCER: {
              ...valid.role_identities.RESULT_PRODUCER,
              [field]: valid.role_identities.FIXTURE_MUTATION[field],
            },
          },
        }).success,
        field,
      ).toBe(false);
    }
    const lowercaseAuthorityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(canonicalizeAuthorityIdentityComparisonValue(lowercaseAuthorityId.toUpperCase())).toBe(
      lowercaseAuthorityId,
    );
    expect(canonicalizeAuthorityIdentityComparisonValue("CaseSensitivePrincipal")).toBe(
      "CaseSensitivePrincipal",
    );
    expect(
      authorityIdentitySchema.parse({
        ...authorityIdentities.FIXTURE_MUTATION,
        authority_id: lowercaseAuthorityId.toUpperCase(),
      }).authority_id,
    ).toBe(lowercaseAuthorityId);
    expect(
      metamorphicAuthorityRolePolicySchema.safeParse({
        ...valid,
        role_identities: {
          ...valid.role_identities,
          FIXTURE_MUTATION: {
            ...valid.role_identities.FIXTURE_MUTATION,
            authority_id: lowercaseAuthorityId,
          },
          SANDBOX_EXECUTION: {
            ...valid.role_identities.SANDBOX_EXECUTION,
            authority_id: lowercaseAuthorityId.toUpperCase(),
          },
        },
      }).success,
    ).toBe(false);
    for (const field of ["principal_id", "key_id"] as const) {
      expect(
        metamorphicAuthorityRolePolicySchema.safeParse({
          ...valid,
          role_identities: {
            ...valid.role_identities,
            FIXTURE_MUTATION: {
              ...valid.role_identities.FIXTURE_MUTATION,
              [field]: lowercaseAuthorityId,
            },
            SANDBOX_EXECUTION: {
              ...valid.role_identities.SANDBOX_EXECUTION,
              [field]: lowercaseAuthorityId.toUpperCase(),
            },
          },
        }).success,
        `${field} UUID alias`,
      ).toBe(false);
    }
    expect(
      metamorphicAuthorityRolePolicySchema.safeParse({
        ...valid,
        role_identities: {
          ...valid.role_identities,
          FIXTURE_MUTATION: {
            ...valid.role_identities.FIXTURE_MUTATION,
            principal_id: "CaseSensitivePrincipal",
            key_id: "CaseSensitiveKey@1",
          },
          SANDBOX_EXECUTION: {
            ...valid.role_identities.SANDBOX_EXECUTION,
            principal_id: "casesensitiveprincipal",
            key_id: "casesensitivekey@1",
          },
        },
      }).success,
    ).toBe(true);
  });

  it("adds Fixture/Mutation only to system artifacts and fixes the four case order/snapshots", async () => {
    expect(SYSTEM_ARTIFACT_TYPES).toContain("MetamorphicFixtureReceipt");
    expect(SYSTEM_ARTIFACT_TYPES).toContain("FixtureMutationRecord");
    expect(L2_ARTIFACT_TYPES).not.toContain("MetamorphicFixtureReceipt");
    expect(METAMORPHIC_RELATIONS).toEqual([
      "FAN_OUT",
      "NULL_ANTI_MEMBERSHIP",
      "HALF_OPEN_ADDITIVE_PARTITION",
      "SAME_VALUED_DISTINCT_FACT",
    ]);
    expect(metamorphicFixtureCasesSchema.safeParse(fixtureCaseMaterials()).success).toBe(true);
    expect(
      metamorphicFixtureCasesSchema.safeParse([
        fixtureCaseMaterials()[1],
        fixtureCaseMaterials()[0],
        fixtureCaseMaterials()[2],
        fixtureCaseMaterials()[3],
      ]).success,
    ).toBe(false);
    const fixture = await makeFixtureReceipt();
    expect(
      metamorphicFixtureReceiptSchema.safeParse({
        ...fixture,
        cases: fixture.cases.map((fixtureCase, index) =>
          index === 1 && fixtureCase.relation_kind === "NULL_ANTI_MEMBERSHIP"
            ? {
                ...fixtureCase,
                follow_up_snapshot_id: fixture.cases[0].follow_up_snapshot_id,
              }
            : fixtureCase,
        ),
      }).success,
    ).toBe(false);
  });

  it("accepts [] as the canonical global group key and closes it to arity zero", async () => {
    const fixture = await makeFixtureReceipt();

    expect(fixture.applicability_profile.dimension_ids).toEqual([]);
    expect(fixture.applicability_profile.group_key_arity).toBe(0);
    expect(fixture.cases.every(({ witness }) => witness.group_key === "[]")).toBe(true);
    expect(
      metamorphicFixtureReceiptSchema.safeParse({
        ...fixture,
        applicability_profile: {
          ...fixture.applicability_profile,
          group_key_arity: 1,
        },
      }).success,
    ).toBe(false);
  });

  it("discriminates the same-snapshot half-open sample from mutation follow-ups", async () => {
    const receipt = await makeMetaReceipt();
    const halfOpen = receipt.relation_samples[2];

    expect(metamorphicRelationSamplesSchema.parse(receipt.relation_samples)).toEqual(
      receipt.relation_samples,
    );
    expect(halfOpen.relation_kind).toBe("HALF_OPEN_ADDITIVE_PARTITION");
    if (halfOpen.relation_kind !== "HALF_OPEN_ADDITIVE_PARTITION") {
      throw new Error("half-open sample discriminator drifted");
    }
    expect(halfOpen.whole_source).toBe("METAMORPHIC_BASELINE");
    expect(halfOpen.snapshot_id).toBe("snapshot-baseline");
    expect("follow_up_snapshot_id" in halfOpen).toBe(false);
    expect(
      metamorphicOracleReceiptSchema.safeParse({
        ...receipt,
        relation_samples: receipt.relation_samples.map((sample, index) =>
          index === 2
            ? { ...sample, follow_up_snapshot_id: "snapshot-forbidden-on-half-open" }
            : sample,
        ),
      }).success,
    ).toBe(false);
  });
});
