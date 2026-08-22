import { describe, expect, expectTypeOf, it } from "vitest";
import {
  authorizeReleaseManifest,
  computeDeterministicAnalysisRolloutHash,
  computeReleaseManifestHash,
  DETERMINISTIC_ANALYSIS_CAPABILITY_IDS,
  deterministicAnalysisRolloutSchema,
  isAuthoritativeReleaseManifest,
  isDeterministicAnalysisCapabilityExecutable,
  type ReleaseManifest,
  ReleaseManifestAuthorityError,
  releaseManifestSchema,
  SYNTHETIC_METAMORPHIC_ARTIFACT_TYPES,
} from "../src/runs/release-manifest.js";
import { hashes, makeArtifactReference } from "./fixtures.js";

function makeReleaseManifestDraft() {
  return {
    schema_version: "1.0.0",
    manifest_ref: makeArtifactReference("ReleaseManifest"),
    release_policy_version: "release-policy@1.0.0",
    source_commit: "2964482",
    contract_version: "contracts@0.1.0",
    component_versions: {
      contracts: "0.1.0",
      runtime: "0.1.0",
    },
    workflow_version: "l2-research@1.0.0",
    eval_run_refs: [makeArtifactReference("EvalRun")],
    tenancy_evidence_refs: [makeArtifactReference("EvalRegistryAssignment")],
    deployment_evidence: {
      hosted_refs: [makeArtifactReference("BenchmarkAdapterReceipt")],
      docker_refs: [makeArtifactReference("SandboxExecutionReceipt")],
    },
    signed_outcome_refs: [makeArtifactReference("ScoreCard")],
    verdict: "PASS" as const,
    created_at: "2026-07-25T00:00:00.000Z",
    manifest_hash: hashes.input,
  };
}

function makeRolloutDraft() {
  return {
    schema_version: "deterministic-analysis-rollout@1.0.0" as const,
    suite_version: "ecommerce-analysis-suite@1.0.0",
    suite_hash: hashes.input,
    supply_chain: {
      attestation_hash: hashes.execution,
      sbom_hash: hashes.artifact,
      cve_scan_status: "PASS" as const,
      license_scan_status: "REVIEW_REQUIRED" as const,
      evidence_refs: [makeArtifactReference("OracleVerdictReceipt")],
    },
    f9: {
      registration_status: "NOT_REGISTERED" as const,
      evidence_refs: [],
    },
    l5_gate: {
      decision: "HOLD" as const,
      expires_at: null,
      evidence_refs: [],
    },
    text2sql_isolation: {
      independent_path_verified: true as const,
      verification_hash: hashes.input,
    },
    capabilities: DETERMINISTIC_ANALYSIS_CAPABILITY_IDS.map((capability_id) => ({
      capability_id,
      stage: 0 as const,
      registration_state:
        capability_id === "certified-causal-estimate@1"
          ? ("NOT_REGISTERED" as const)
          : ("FIXTURE_ONLY" as const),
      execution_enabled: false,
      user_visible: false,
      generated_programs_allowed: false,
      kill_switch: {
        engaged: true,
        reason_code: "STAGE_NOT_EXECUTABLE",
      },
      evidence_refs: [],
      promotion_blockers: ["SHADOW_NOT_COMPLETE"],
      shadow_metrics: {
        oracle_score: 100,
        replay_match_rate: 1,
        safety_rejection_rate: null,
        p95_elapsed_ms: null,
      },
    })),
    rollout_hash: hashes.input,
  };
}

async function makeRollout() {
  const draft = makeRolloutDraft();
  return {
    ...draft,
    rollout_hash: await computeDeterministicAnalysisRolloutHash(draft),
  };
}

async function makeReleaseManifest() {
  const draft = makeReleaseManifestDraft();
  const manifestHash = await computeReleaseManifestHash(draft);
  return {
    ...draft,
    manifest_ref: {
      ...draft.manifest_ref,
      content_hash: manifestHash,
    },
    manifest_hash: manifestHash,
  };
}

describe("ReleaseManifest 权威契约", () => {
  it("只有解析自持久化 Authority 且双部署证据完整的 Manifest 才能授权", async () => {
    const manifest = await makeReleaseManifest();
    const authoritative = await authorizeReleaseManifest(manifest.manifest_ref, {
      resolveCommitted: async () => structuredClone(manifest),
      verifyCommitted: async () => true,
    });

    expect(isAuthoritativeReleaseManifest(authoritative)).toBe(true);
    expect(Object.isFrozen(authoritative.deployment_evidence)).toBe(true);
  });

  it("把完整逐技能 rollout 纳入独立 hash，且 kill switch 关闭单项执行", async () => {
    const rollout = await makeRollout();
    expect(deterministicAnalysisRolloutSchema.parse(rollout).capabilities).toHaveLength(11);
    expect(isDeterministicAnalysisCapabilityExecutable(rollout, "trend-change@1")).toBe(false);
    expect(
      await computeDeterministicAnalysisRolloutHash({
        ...rollout,
        suite_version: "ecommerce-analysis-suite@1.0.1",
      }),
    ).not.toBe(rollout.rollout_hash);

    const trendEnabled = {
      ...rollout,
      capabilities: rollout.capabilities.map((capability) =>
        capability.capability_id === "trend-change@1"
          ? { ...capability, execution_enabled: true }
          : capability,
      ),
    };
    expect(deterministicAnalysisRolloutSchema.safeParse(trendEnabled).success).toBe(false);
  });

  it("F9 未注册或 L5 独立门 HOLD 时拒绝启用 Certified Causal", async () => {
    const rollout = await makeRollout();
    const invalid = {
      ...rollout,
      capabilities: rollout.capabilities.map((capability) =>
        capability.capability_id === "certified-causal-estimate@1"
          ? {
              ...capability,
              stage: 4 as const,
              registration_state: "GENERAL_AVAILABILITY" as const,
              execution_enabled: true,
              user_visible: true,
              kill_switch: { engaged: false, reason_code: null },
              evidence_refs: [makeArtifactReference("ResultOracleReceipt")],
              promotion_blockers: [],
            }
          : capability,
      ),
    };
    expect(deterministicAnalysisRolloutSchema.safeParse(invalid).success).toBe(false);
  });

  it("Certified Causal 在 F9/L5 证据闭合后仍按证书有效期失效", async () => {
    const rollout = await makeRollout();
    const valid = deterministicAnalysisRolloutSchema.parse({
      ...rollout,
      supply_chain: { ...rollout.supply_chain, license_scan_status: "PASS" },
      f9: {
        registration_status: "REGISTERED",
        evidence_refs: [makeArtifactReference("BenchmarkAdapterReceipt")],
      },
      l5_gate: {
        decision: "GO",
        expires_at: "2026-09-01T00:00:00.000Z",
        evidence_refs: [makeArtifactReference("SandboxExecutionReceipt")],
      },
      capabilities: rollout.capabilities.map((capability) =>
        capability.capability_id === "certified-causal-estimate@1"
          ? {
              ...capability,
              stage: 4,
              registration_state: "GENERAL_AVAILABILITY",
              execution_enabled: true,
              user_visible: true,
              kill_switch: { engaged: false, reason_code: null },
              evidence_refs: [makeArtifactReference("ResultOracleReceipt")],
              promotion_blockers: [],
            }
          : capability,
      ),
    });
    expect(
      isDeterministicAnalysisCapabilityExecutable(
        valid,
        "certified-causal-estimate@1",
        new Date("2026-08-31T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isDeterministicAnalysisCapabilityExecutable(
        valid,
        "certified-causal-estimate@1",
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("授权时同时验证 rollout 内容 hash", async () => {
    const rollout = await makeRollout();
    const draft = { ...makeReleaseManifestDraft(), deterministic_analysis_rollout: rollout };
    const manifestHash = await computeReleaseManifestHash(draft);
    const manifest = {
      ...draft,
      manifest_ref: { ...draft.manifest_ref, content_hash: manifestHash },
      manifest_hash: manifestHash,
    };
    await expect(
      authorizeReleaseManifest(manifest.manifest_ref, {
        resolveCommitted: async () => manifest,
        verifyCommitted: async () => true,
      }),
    ).resolves.toSatisfy(isAuthoritativeReleaseManifest);

    const drifted = {
      ...manifest,
      deterministic_analysis_rollout: {
        ...manifest.deterministic_analysis_rollout,
        rollout_hash: hashes.input,
      },
    };
    const driftedManifestHash = await computeReleaseManifestHash(drifted);
    await expect(
      authorizeReleaseManifest(
        { ...drifted.manifest_ref, content_hash: driftedManifestHash },
        {
          resolveCommitted: async () => ({
            ...drifted,
            manifest_ref: { ...drifted.manifest_ref, content_hash: driftedManifestHash },
            manifest_hash: driftedManifestHash,
          }),
          verifyCommitted: async () => true,
        },
      ),
    ).rejects.toBeInstanceOf(ReleaseManifestAuthorityError);
  });

  it("缺少 Hosted 或 Docker Evidence 时不能构造 PASS Manifest", () => {
    const draft = makeReleaseManifestDraft();
    expect(
      releaseManifestSchema.safeParse({
        ...draft,
        deployment_evidence: {
          ...draft.deployment_evidence,
          docker_refs: [],
        },
      }).success,
    ).toBe(false);
  });

  it("在运行时与类型层同时拒绝 Fixture/Meta 产物冒充部署或签名 Outcome Evidence", () => {
    const draft = makeReleaseManifestDraft();
    for (const artifactType of SYNTHETIC_METAMORPHIC_ARTIFACT_TYPES) {
      const syntheticReference = makeArtifactReference(artifactType);
      for (const candidate of [
        {
          ...draft,
          deployment_evidence: {
            ...draft.deployment_evidence,
            hosted_refs: [syntheticReference],
          },
        },
        {
          ...draft,
          deployment_evidence: {
            ...draft.deployment_evidence,
            docker_refs: [syntheticReference],
          },
        },
        {
          ...draft,
          signed_outcome_refs: [syntheticReference],
        },
      ]) {
        expect(releaseManifestSchema.safeParse(candidate).success).toBe(false);
      }
    }

    type ReleaseEvidenceArtifactType =
      ReleaseManifest["signed_outcome_refs"][number]["artifact_type"];
    type SyntheticReleaseEvidence = Extract<
      ReleaseEvidenceArtifactType,
      (typeof SYNTHETIC_METAMORPHIC_ARTIFACT_TYPES)[number]
    >;
    expectTypeOf<SyntheticReleaseEvidence>().toEqualTypeOf<never>();
  });

  it("Resolver 返回错 Revision、Hash 漂移或未提交 Evidence 时失败关闭", async () => {
    const manifest = await makeReleaseManifest();
    await expect(
      authorizeReleaseManifest(
        {
          ...manifest.manifest_ref,
          revision: manifest.manifest_ref.revision + 1,
        },
        {
          resolveCommitted: async () => manifest,
          verifyCommitted: async () => true,
        },
      ),
    ).rejects.toBeInstanceOf(ReleaseManifestAuthorityError);

    await expect(
      authorizeReleaseManifest(manifest.manifest_ref, {
        resolveCommitted: async () => ({
          ...manifest,
          workflow_version: "l2-research@2.0.0",
        }),
        verifyCommitted: async () => true,
      }),
    ).rejects.toBeInstanceOf(ReleaseManifestAuthorityError);

    await expect(
      authorizeReleaseManifest(manifest.manifest_ref, {
        resolveCommitted: async () => manifest,
        verifyCommitted: async (reference) => reference.artifact_type !== "SandboxExecutionReceipt",
      }),
    ).rejects.toBeInstanceOf(ReleaseManifestAuthorityError);
  });
});
