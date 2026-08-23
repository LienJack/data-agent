import { describe, expect, it } from "vitest";
import {
  buildFalconAgentReleaseGateArtifact,
  buildFalconSemanticBundleIndex,
  buildFalconSemanticUsageReceipt,
  FALCON_AGENT_GATE_VERSION,
  FALCON_AGENT_ORACLE_VERSION,
  FALCON_DATASET_VERSION,
  FALCON_DEV_DATABASE_CASE_COUNTS,
  FALCON_SOURCE_COMMIT,
  verifyFalconAgentReleaseGateArtifact,
  verifyFalconSemanticBundleIndex,
} from "../src/index.js";

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const ref = (suffix: number, character: string) => ({
  resource_id: id(suffix),
  resource_revision: 1,
  resource_hash: hash(character),
});

function bundleInput() {
  return {
    schema_version: "falcon-semantic-bundle-index@1.0.0" as const,
    scope,
    workspace_id: id(2),
    semantic_domain: "falcon" as const,
    dataset_version: FALCON_DATASET_VERSION,
    source_commit: FALCON_SOURCE_COMMIT,
    source_digest: hash("1"),
    release_set_ref: ref(3, "2"),
    first_release_receipt_ref: ref(4, "3"),
    entries: Array.from({ length: 28 }, (_, index) => ({
      database_id: index + 1,
      schema_name: `falcon_db_${String(index + 1).padStart(2, "0")}`,
      package_ref: ref(100 + index, "4"),
      schema_snapshot_hash: hash("5"),
      admission_receipt_ref: ref(200 + index, "6"),
      coverage_receipt_hash: hash("7"),
      physical_object_count: 1,
      queryable_mapping_count: 1,
      join_count: 0,
      mandatory_assertions_passed: true,
    })),
    created_at: "2026-08-18T00:00:00.000Z",
  };
}

function gateInput() {
  const caseCounts = Object.entries(FALCON_DEV_DATABASE_CASE_COUNTS).map(
    ([databaseId, caseCount]) => ({ database_id: Number(databaseId), case_count: caseCount }),
  );
  function allocate(target: number) {
    const values = caseCounts.map(({ case_count }) => Math.ceil(case_count * 0.6));
    let remaining = target - values.reduce((sum, value) => sum + value, 0);
    for (let index = 0; remaining > 0; index = (index + 1) % values.length) {
      const maximum = caseCounts[index]?.case_count ?? 0;
      const current = values[index] ?? 0;
      if (current >= maximum) continue;
      values[index] = current + 1;
      remaining -= 1;
    }
    return values;
  }
  const first = allocate(217);
  const final = allocate(248);
  return {
    schema_version: FALCON_AGENT_GATE_VERSION,
    artifact_id: id(10),
    scope,
    workspace_id: id(2),
    dataset_version: FALCON_DATASET_VERSION,
    source_commit: FALCON_SOURCE_COMMIT,
    source_digest: hash("1"),
    oracle_version: FALCON_AGENT_ORACLE_VERSION,
    semantic_bundle_index_ref: ref(11, "8"),
    workspace_journey_ref: ref(12, "9"),
    model_profile_ref: ref(13, "a"),
    agent_profile_set_hash: hash("b"),
    dev: {
      case_count: 309 as const,
      terminal_cases: 309,
      first_passed: 217,
      final_passed: 248,
      database_scores: caseCounts.map(({ database_id, case_count }, index) => ({
        database_id,
        case_count,
        first_passed: first[index] ?? 0,
        final_passed: final[index] ?? 0,
        terminal_cases: case_count,
      })),
    },
    demo: { case_count: 10 as const, passed: 10 },
    db24: { case_count: 17 as const, passed: 17 },
    db14: { case_count: 32 as const, passed: 32 },
    holdout: { case_count: 5 as const, passed: 4 },
    stability: {
      case_count: 54,
      passed: 54,
      flake_count: 0,
      cold_restart_verified: true,
    },
    test_submission: {
      case_count: 191 as const,
      completed: 191,
      local_verdict_count: 0,
      submission_hash: hash("c"),
    },
    evidence: {
      team_case_count: 500,
      semantic_usage_count: 500,
      provider_invocation_count: 500,
      report_count: 17,
      report_citation_passed: 17,
      taint_violation_count: 0,
      infrastructure_failure_count: 0,
    },
    runtime_health: {
      postgres: true,
      worker: true,
      provider: true,
      team_runtime: true,
      oracle: true,
    },
    result: "GO" as const,
    completed_at: "2026-08-18T01:00:00.000Z",
  };
}

describe("Falcon semantic release and Agent gate contracts", () => {
  it("builds one stable 28-package index regardless of entry order", async () => {
    const canonical = await buildFalconSemanticBundleIndex(bundleInput());
    const reordered = bundleInput();
    reordered.entries.reverse();
    expect(await buildFalconSemanticBundleIndex(reordered)).toEqual(canonical);
    await expect(verifyFalconSemanticBundleIndex(canonical)).resolves.toEqual(canonical);
  });

  it("rejects missing, duplicate, mismatched and failed database packages", async () => {
    const missing = bundleInput();
    missing.entries.pop();
    await expect(buildFalconSemanticBundleIndex(missing)).rejects.toThrow();

    const duplicate = bundleInput();
    const first = duplicate.entries[0];
    if (!first) throw new Error("FIXTURE_ENTRY_MISSING");
    duplicate.entries[1] = first;
    await expect(buildFalconSemanticBundleIndex(duplicate)).rejects.toThrow(
      "FALCON_SEMANTIC_DATABASE_DUPLICATE",
    );

    const mismatch = bundleInput();
    const mismatchFirst = mismatch.entries[0];
    if (!mismatchFirst) throw new Error("FIXTURE_ENTRY_MISSING");
    mismatch.entries[0] = { ...mismatchFirst, schema_name: "falcon_db_28" };
    await expect(buildFalconSemanticBundleIndex(mismatch)).rejects.toThrow(
      "FALCON_SEMANTIC_SCHEMA_MISMATCH",
    );

    const failed = bundleInput();
    const failedEntry = failed.entries[23];
    if (!failedEntry) throw new Error("FIXTURE_ENTRY_MISSING");
    failed.entries[23] = { ...failedEntry, mandatory_assertions_passed: false };
    await expect(buildFalconSemanticBundleIndex(failed)).rejects.toThrow(
      "FALCON_SEMANTIC_ASSERTION_FAILED",
    );
  });

  it("binds semantic usage to package, context, provider and accepted query evidence", async () => {
    const receipt = await buildFalconSemanticUsageReceipt({
      schema_version: "falcon-semantic-usage-receipt@1.0.0",
      scope,
      receipt_id: id(20),
      case_id: "falcon-dev-14-001",
      database_id: 14,
      run_id: id(21),
      task_id: id(22),
      release_set_hash: hash("d"),
      package_ref: ref(23, "e"),
      context_receipt_ref: ref(24, "f"),
      physical_object_ids: ["toy_sales"],
      mapping_ids: ["mapping-toy-sales"],
      join_ids: [],
      provider_invocation_ref: ref(25, "1"),
      query_evidence_ref: ref(26, "2"),
      token_usage: {
        availability: "UNAVAILABLE",
        source: "PROVIDER_DID_NOT_REPORT",
        input_tokens: null,
        output_tokens: null,
      },
      accepted_at: "2026-08-18T00:30:00.000Z",
    });
    expect(receipt.receipt_hash).toMatch(/^sha256:/u);
    expect(JSON.stringify(receipt)).not.toMatch(/gold|expected|reasoning_content|secret/i);
  });

  it("issues GO only at the absolute thresholds and exact evidence closure", async () => {
    const artifact = await buildFalconAgentReleaseGateArtifact(gateInput());
    await expect(verifyFalconAgentReleaseGateArtifact(artifact)).resolves.toEqual(artifact);

    await expect(
      buildFalconAgentReleaseGateArtifact({
        ...gateInput(),
        dev: { ...gateInput().dev, final_passed: 247 },
      }),
    ).rejects.toThrow("FALCON_AGENT_RELEASE_GATE_HOLD");
    await expect(
      buildFalconAgentReleaseGateArtifact({
        ...gateInput(),
        test_submission: { ...gateInput().test_submission, local_verdict_count: 1 },
      }),
    ).rejects.toThrow("FALCON_AGENT_RELEASE_GATE_HOLD");
    await expect(
      buildFalconAgentReleaseGateArtifact({
        ...gateInput(),
        evidence: { ...gateInput().evidence, team_case_count: 499 },
      }),
    ).rejects.toThrow("FALCON_AGENT_RELEASE_GATE_HOLD");
  });
});
