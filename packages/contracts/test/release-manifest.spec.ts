import { describe, expect, expectTypeOf, it } from "vitest";
import {
  authorizeReleaseManifest,
  computeReleaseManifestHash,
  isAuthoritativeReleaseManifest,
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
