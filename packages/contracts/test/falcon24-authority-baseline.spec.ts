import { describe, expect, it } from "vitest";
import {
  buildFalcon24AuthorityBaseline,
  buildFalcon24AuthorityBaselineV2,
  buildFalcon24RetainedAssetsManifest,
  buildFalcon24RetainedAssetsManifestV2,
  buildFalcon24SemanticReleaseAuthorityProofV2,
  verifyFalcon24AuthorityBaseline,
  verifyFalcon24AuthorityBaselineDocument,
  verifyFalcon24RetainedAssetsManifest,
  verifyFalcon24RetainedAssetsManifestDocument,
  verifyFalcon24SemanticReleaseAuthorityProofV2,
} from "../src/evals/falcon24-authority-baseline.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function retainedMaterial() {
  return {
    schema_version: "falcon24-retained-assets@1.0.0" as const,
    authority_epoch: "E1" as const,
    retained_categories: [
      "ANALYSIS_RUNTIME",
      "DATASET_AND_ORACLE",
      "FALCON_QUESTIONS",
      "LLM_CONFIGURATION",
      "SEMANTIC_DEFINITIONS",
      "SOURCE_MANIFEST",
    ] as const,
    discarded_categories: [
      "ARTIFACTS_AND_TRACES",
      "CAMPAIGNS_AND_QUALIFICATIONS",
      "CREDENTIALS_AND_CERTIFICATIONS",
      "HISTORICAL_IDENTITIES",
      "RUNS_AND_CONVERSATIONS",
      "SANDBOX_AND_JOURNAL_STATE",
    ] as const,
    upstream: {
      source_commit: "8ff29caa36f439aabbc6606c62c22f4ba9c27e6e",
      source_digest: hash("1"),
      manifest_path: "infra/falcon/v1/source-manifest.json",
      manifest_hash: hash("2"),
      database_count: 28,
      public_case_count: 500,
      sealed_case_count: 309,
    },
    active_dataset: {
      database_id: "falcon_db_24" as const,
      db_id: 24 as const,
      bundle_path: "infra/falcon/v1/bundles/falcon_db_24.sql.gz",
      bundle_sha256: hash("3"),
      content_digest: hash("4"),
      seed_hash: hash("5"),
      table_count: 9,
      column_count: 70,
      row_count: 121_445,
      active_subset_hash: hash("6"),
    },
    questions: {
      public_manifest_path: "infra/falcon/v1/public-cases.json",
      public_manifest_hash: hash("7"),
      sealed_manifest_path: "infra/falcon/v1/sealed/dev-cases.json",
      sealed_manifest_hash: hash("8"),
      test_manifest_path: "infra/falcon/v1/test-cases.json",
      test_manifest_hash: hash("9"),
      active_public_subset_hash: hash("a"),
      active_sealed_subset_hash: hash("b"),
      active_case_count: 17,
      suite_version: "falcon24-agent-analysis-suite@3.0.0",
      suite_hash: hash("c"),
      case_ids: [
        "falcon24-business-review-18m",
        "falcon24-cohort-retention-m0-m6",
        "falcon24-delivery-experience-12m",
        "falcon24-inventory-damage-12m",
        "falcon24-marketing-lag-effect",
      ],
    },
    semantics: {
      source_files: [
        { path: "apps/worker/src/evals/falcon24-semantic-catalog.ts", hash: hash("d") },
        { path: "apps/worker/src/evals/falcon24-semantic-change-set.ts", hash: hash("e") },
      ],
      source_bundle_hash: hash("f"),
      expected_table_count: 9,
      expected_column_count: 70,
      expected_join_count: 8,
      expected_definition_count: 31,
      competency_closure_hash: hash("0"),
      database_export_hash: hash("1"),
      semantic_diff: { status: "MATCH" as const, diff_hash: hash("2"), differences: [] },
    },
    llm: {
      manifest_path: "infra/falcon/e1/llm-provider-model-profile.json",
      source_files: [
        { path: "apps/web/src/lib/model-provider-catalog.ts", hash: hash("1") },
        { path: "packages/contracts/src/models/index.ts", hash: hash("2") },
      ],
      source_bundle_hash: hash("3"),
      profiles: [
        {
          logical_profile_key: "falcon24-analysis-deepseek",
          vendor_id: "deepseek",
          runtime_provider: "deepseek",
          display_name: "Falcon24 DeepSeek Analysis",
          base_url: "https://api.deepseek.com",
          model_id: "deepseek-v4-flash",
          capabilities: ["LLM", "STRUCTURED_OUTPUT", "TOOLS"],
          default: true,
        },
      ],
      manifest_hash: hash("4"),
      database_diff: {
        status: "RECREATE" as const,
        diff_hash: hash("5"),
        differences: ["MISSING_DATABASE_PROFILE:falcon24-analysis-deepseek"],
      },
    },
    analysis_runtime: {
      operator_manifest_path: "services/sandbox/src/data_agent_stats/manifest.json",
      operator_manifest_hash: hash("4"),
      operator_registry_digest: hash("5"),
      attestation_path: "infra/docker/opensandbox-analysis-attestation.json",
      attestation_hash: hash("6"),
      source_files: [
        { path: "infra/docker/Dockerfile.opensandbox-analysis-agent", hash: hash("7") },
        { path: "infra/docker/opensandbox-analysis-core-requirements.lock", hash: hash("8") },
      ],
      source_bundle_hash: hash("9"),
      method_registry_hash: hash("a"),
      oracle_contract_hash: hash("b"),
      production_isolation_proven: false,
      production_gate: "HOLD" as const,
    },
  };
}

describe("Falcon24 E1 authority baseline", () => {
  it("canonicalizes retained file traversal and verifies a stable content hash", async () => {
    const material = retainedMaterial();
    const reversed = {
      ...material,
      semantics: {
        ...material.semantics,
        source_files: [...material.semantics.source_files].reverse(),
      },
      analysis_runtime: {
        ...material.analysis_runtime,
        source_files: [...material.analysis_runtime.source_files].reverse(),
      },
    };

    const left = await buildFalcon24RetainedAssetsManifest(material);
    const right = await buildFalcon24RetainedAssetsManifest(reversed);

    expect(right).toEqual(left);
    await expect(verifyFalcon24RetainedAssetsManifest(left)).resolves.toEqual(left);
  });

  it("changes the retained root when any frozen component changes", async () => {
    const baseline = await buildFalcon24RetainedAssetsManifest(retainedMaterial());
    const changed = await buildFalcon24RetainedAssetsManifest({
      ...retainedMaterial(),
      active_dataset: { ...retainedMaterial().active_dataset, bundle_sha256: hash("c") },
    });

    expect(changed.manifest_hash).not.toBe(baseline.manifest_hash);
    await expect(
      verifyFalcon24RetainedAssetsManifest({
        ...baseline,
        active_dataset: changed.active_dataset,
      }),
    ).rejects.toThrow("FALCON24_RETAINED_ASSETS_HASH_INVALID");
  });

  it("rejects credentials, historical identities, unsafe URLs, and duplicate canonical keys", async () => {
    const material = retainedMaterial();
    await expect(
      buildFalcon24RetainedAssetsManifest({ ...material, api_key: "not-allowed" }),
    ).rejects.toThrow();
    await expect(
      buildFalcon24RetainedAssetsManifest({ ...material, old_release_id: id(90) }),
    ).rejects.toThrow();
    await expect(
      buildFalcon24RetainedAssetsManifest({
        ...material,
        llm: {
          ...material.llm,
          profiles: [
            { ...material.llm.profiles[0], base_url: "https://user:pass@example.com?q=1" },
          ],
        },
      }),
    ).rejects.toThrow("LLM base_url");
    await expect(
      buildFalcon24RetainedAssetsManifest({
        ...material,
        semantics: {
          ...material.semantics,
          source_files: [material.semantics.source_files[0], material.semantics.source_files[0]],
        },
      }),
    ).rejects.toThrow("source_files");
    await expect(
      buildFalcon24RetainedAssetsManifest({
        ...material,
        llm: {
          ...material.llm,
          profiles: [material.llm.profiles[0], material.llm.profiles[0]],
        },
      }),
    ).rejects.toThrow("LLM profiles");
    await expect(
      buildFalcon24RetainedAssetsManifest({
        ...material,
        llm: {
          ...material.llm,
          database_diff: { ...material.llm.database_diff, status: "MATCH" },
        },
      }),
    ).rejects.toThrow("database_diff");
  });

  it("builds a runtime baseline only from the complete frozen E1 closure", async () => {
    const retained = await buildFalcon24RetainedAssetsManifest(retainedMaterial());
    const material = {
      schema_version: "falcon24-authority-baseline@1.0.0" as const,
      baseline_id: id(1),
      authority_epoch: "E1" as const,
      source_commit: "a".repeat(40),
      retained_assets_hash: retained.manifest_hash,
      web_build_hash: hash("1"),
      staging_receipts: {
        dataset: hash("2"),
        semantic_release: hash("3"),
        llm_configuration: hash("4"),
        agent_profiles: hash("5"),
        operator_registry: hash("6"),
        sandbox_runtime: hash("7"),
      },
      acceptance_contracts: {
        oracle: hash("8"),
        qualification: hash("9"),
        campaign: hash("a"),
        qa_e2e: hash("b"),
        trace_ui: hash("c"),
        reclamation: hash("d"),
      },
      production_isolation_proven: false,
      production_gate: "HOLD" as const,
    };
    const baseline = await buildFalcon24AuthorityBaseline(material);

    await expect(verifyFalcon24AuthorityBaseline(baseline)).resolves.toEqual(baseline);
    await expect(
      buildFalcon24AuthorityBaseline({
        ...material,
        staging_receipts: { ...material.staging_receipts, sandbox_runtime: undefined },
      }),
    ).rejects.toThrow();
    await expect(
      buildFalcon24AuthorityBaseline({
        ...material,
        production_isolation_proven: true,
        production_gate: "HOLD",
      }),
    ).rejects.toThrow("production_gate");
  });

  it("preserves E1 v1 while signing E2 only under v2 document versions", async () => {
    const e1 = await buildFalcon24RetainedAssetsManifest(retainedMaterial());
    const e2 = await buildFalcon24RetainedAssetsManifestV2({
      ...retainedMaterial(),
      schema_version: "falcon24-retained-assets@2.0.0",
      authority_epoch: "E2",
    });
    const e2Reordered = await buildFalcon24RetainedAssetsManifestV2({
      ...retainedMaterial(),
      schema_version: "falcon24-retained-assets@2.0.0",
      authority_epoch: "E2",
      semantics: {
        ...retainedMaterial().semantics,
        source_files: [...retainedMaterial().semantics.source_files].reverse(),
      },
    });

    await expect(verifyFalcon24RetainedAssetsManifestDocument(e1)).resolves.toEqual(e1);
    await expect(verifyFalcon24RetainedAssetsManifestDocument(e2)).resolves.toEqual(e2);
    expect(e2Reordered).toEqual(e2);
    await expect(
      buildFalcon24RetainedAssetsManifestV2({
        ...retainedMaterial(),
        authority_epoch: "E2",
      }),
    ).rejects.toThrow();
    await expect(
      buildFalcon24RetainedAssetsManifest({
        ...retainedMaterial(),
        authority_epoch: "E2",
      }),
    ).rejects.toThrow();

    const baselineMaterial = {
      schema_version: "falcon24-authority-baseline@2.0.0" as const,
      baseline_id: id(91),
      authority_epoch: "E2" as const,
      source_commit: "b".repeat(40),
      retained_assets_hash: e2.manifest_hash,
      web_build_hash: hash("1"),
      staging_receipts: {
        dataset: hash("2"),
        semantic_release: hash("3"),
        llm_configuration: hash("4"),
        agent_profiles: hash("5"),
        operator_registry: hash("6"),
        sandbox_runtime: hash("7"),
      },
      acceptance_contracts: {
        oracle: hash("8"),
        qualification: hash("9"),
        campaign: hash("a"),
        qa_e2e: hash("b"),
        trace_ui: hash("c"),
        reclamation: hash("d"),
      },
      production_isolation_proven: false,
      production_gate: "HOLD" as const,
    };
    const baseline = await buildFalcon24AuthorityBaselineV2(baselineMaterial);
    await expect(verifyFalcon24AuthorityBaselineDocument(baseline)).resolves.toEqual(baseline);
    await expect(
      buildFalcon24AuthorityBaselineV2({ ...baselineMaterial, authority_epoch: "E1" }),
    ).rejects.toThrow();
  });
});

describe("Falcon24 E4 semantic successor proof", () => {
  function proofMaterial() {
    return {
      schema_version: "falcon24-semantic-release-authority-proof@2.0.0" as const,
      authority_epoch: "E4" as const,
      predecessor_release: {
        release_id: id(100),
        generation: 1,
        release_digest: hash("1"),
        datasource_id: id(101),
      },
      candidate_release: {
        release_id: id(102),
        generation: 2,
        release_digest: hash("2"),
        datasource_id: id(101),
      },
      projections: {
        executable: { projection_id: id(103), projection_digest: hash("3") },
        relationship: { projection_id: id(104), projection_digest: hash("4") },
        runtime_restriction: { projection_id: id(105), projection_digest: hash("5") },
        graph: { projection_id: id(106), projection_digest: hash("6") },
      },
      change_set_ref: { change_set_id: id(107), change_set_hash: hash("7") },
      review_ref: { review_id: id(108), review_hash: hash("8") },
      source_snapshot_ref: {
        snapshot_id: id(109),
        snapshot_revision: 7,
        snapshot_hash: hash("9"),
      },
      compiler_bundle_ref: {
        compiler_version: "semantic-change-set-publication@2",
        compiler_bundle_hash: hash("a"),
      },
      validation_receipt_ref: {
        schema_version: "semantic-runtime-closure-validation-receipt@1.0.0" as const,
        receipt_id: id(110),
        validation_receipt_hash: hash("b"),
      },
      smoke_receipt_ref: {
        schema_version: "semantic-runtime-smoke-receipt@1.0.0" as const,
        receipt_id: id(111),
        smoke_receipt_hash: hash("c"),
      },
      expected_versions: {
        semantic_pointer: 3,
        semantic_runtime: 3,
        workspace_defaults: 9,
      },
    };
  }

  it("binds a distinct generation 2 successor and exact validation/smoke hash domains", async () => {
    const proof = await buildFalcon24SemanticReleaseAuthorityProofV2(proofMaterial());
    await expect(verifyFalcon24SemanticReleaseAuthorityProofV2(proof)).resolves.toEqual(proof);
    expect(proof.candidate_release.release_id).not.toBe(proof.predecessor_release.release_id);
    await expect(
      buildFalcon24SemanticReleaseAuthorityProofV2({
        ...proofMaterial(),
        candidate_release: {
          ...proofMaterial().candidate_release,
          generation: 1,
        },
      }),
    ).rejects.toThrow("FALCON24_SEMANTIC_SUCCESSOR_LINEAGE_INVALID");
    await expect(
      verifyFalcon24SemanticReleaseAuthorityProofV2({
        ...proof,
        proof_hash: hash("f"),
      }),
    ).rejects.toThrow("FALCON24_SEMANTIC_SUCCESSOR_PROOF_HASH_INVALID");
  });

  it("rejects a smoke hash masquerading as a validation receipt field", async () => {
    await expect(
      buildFalcon24SemanticReleaseAuthorityProofV2({
        ...proofMaterial(),
        validation_receipt_ref: {
          schema_version: "semantic-runtime-smoke-receipt@1.0.0",
          receipt_id: id(110),
          smoke_receipt_hash: hash("b"),
        },
      }),
    ).rejects.toThrow();
  });
});
