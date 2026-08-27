import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MODEL_PROVIDER_CATALOG } from "../apps/web/src/lib/model-provider-catalog.js";
import {
  buildFalcon24RetainedAssetsManifest,
  buildFalcon24RetainedAssetsManifestV2,
  FALCON24_AUTHORITY_EPOCH,
  FALCON24_DISCARDED_CATEGORIES,
  FALCON24_RETAINED_CATEGORIES,
  FALCON24_TARGET_AUTHORITY_EPOCH,
  falcon24RetainedLlmConfigSchema,
  falcon24TargetAuthorityEpochSchema,
  sha256ContentHash,
} from "../packages/contracts/src/index.js";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "../packages/evals/src/test-center/falcon24-agent-analysis-suite.js";

function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function rawHash(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function fileReferences(root: string, paths: readonly string[]) {
  return [...paths].sort().map((path) => ({ path, hash: rawHash(resolve(root, path)) }));
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const authorityEpochArgument = argument("authority-epoch");
  const parsedTargetEpoch = falcon24TargetAuthorityEpochSchema.safeParse(authorityEpochArgument);
  if (authorityEpochArgument !== undefined && !parsedTargetEpoch.success) {
    throw new TypeError("FALCON24_AUTHORITY_EPOCH_INVALID");
  }
  const authorityEpoch = parsedTargetEpoch.success
    ? parsedTargetEpoch.data
    : FALCON24_AUTHORITY_EPOCH;
  const epochDirectory = authorityEpoch.toLowerCase();
  const exportPath = resolve(
    root,
    argument("export") ?? `.data/falcon24-${epochDirectory}-retained-export.json`,
  );
  const outputPath = resolve(
    root,
    argument("output") ?? `infra/falcon/${epochDirectory}/retained-assets-manifest.json`,
  );
  const sourceManifest = json(resolve(root, "infra/falcon/v1/source-manifest.json")) as {
    source_commit: string;
    source_digest: `sha256:${string}`;
    database_count: number;
    case_count: number;
    dev_case_count: number;
    public_cases_sha256: `sha256:${string}`;
    sealed_cases_sha256: `sha256:${string}`;
    test_cases_sha256: `sha256:${string}`;
    files: Array<{
      db_id: number;
      schema_name: string;
      relative_path: string;
      bundle_sha256: `sha256:${string}`;
      content_digest: `sha256:${string}`;
      source_sqlite_sha256: `sha256:${string}`;
      table_count: number;
      column_count: number;
      row_count: number;
    }>;
  };
  const db24 = sourceManifest.files.find(({ db_id: dbId }) => dbId === 24);
  if (!db24 || sourceManifest.database_count !== 28 || sourceManifest.case_count !== 500) {
    throw new TypeError("FALCON24_E1_SOURCE_MANIFEST_INVALID");
  }
  const bundlePath = `infra/falcon/v1/${db24.relative_path}`;
  if (rawHash(resolve(root, bundlePath)) !== db24.bundle_sha256) {
    throw new TypeError("FALCON24_E1_DB24_BUNDLE_HASH_INVALID");
  }
  const publicPath = "infra/falcon/v1/public-cases.json";
  const sealedPath = "infra/falcon/v1/sealed/dev-cases.json";
  const testPath = "infra/falcon/v1/test-cases.json";
  if (
    rawHash(resolve(root, publicPath)) !== sourceManifest.public_cases_sha256 ||
    rawHash(resolve(root, sealedPath)) !== sourceManifest.sealed_cases_sha256 ||
    rawHash(resolve(root, testPath)) !== sourceManifest.test_cases_sha256
  ) {
    throw new TypeError("FALCON24_E1_QUESTION_MANIFEST_HASH_INVALID");
  }
  const publicCases = json(resolve(root, publicPath)) as Array<{
    database_id: string;
    ordinal: number;
  }>;
  const sealedCases = json(resolve(root, sealedPath)) as Array<{
    public_case: { database_id: string; ordinal: number };
  }>;
  const activePublic = publicCases
    .filter(({ database_id: databaseId }) => databaseId === "falcon_db_24")
    .sort((left, right) => left.ordinal - right.ordinal);
  const activeSealed = sealedCases
    .filter(({ public_case: publicCase }) => publicCase.database_id === "falcon_db_24")
    .sort((left, right) => left.public_case.ordinal - right.public_case.ordinal);
  if (activePublic.length !== 17 || activeSealed.length !== 17) {
    throw new TypeError("FALCON24_E1_ACTIVE_QUESTION_SET_INVALID");
  }
  const retainedExport = json(exportPath) as {
    schema_version: string;
    terminal: string;
    semantic: {
      source_bundle_hash: `sha256:${string}`;
      database_export_hash: `sha256:${string}`;
      expected_definition_count: number;
      competency_closure_hash: `sha256:${string}`;
      diff: {
        status: "MATCH" | "HOLD";
        diff_hash: `sha256:${string}`;
        differences: string[];
      };
    };
    llm: {
      diff: {
        status: "MATCH" | "RECREATE" | "HOLD";
        diff_hash: `sha256:${string}`;
        differences: string[];
      };
    };
  };
  if (
    retainedExport.schema_version !== "falcon24-retained-export@1.0.0" ||
    retainedExport.terminal !== "READY" ||
    retainedExport.semantic.diff.status !== "MATCH" ||
    retainedExport.llm.diff.status === "HOLD"
  ) {
    throw new TypeError("FALCON24_E1_RETAINED_EXPORT_NOT_READY");
  }
  const llmPath = "infra/falcon/e1/llm-provider-model-profile.json";
  const llm = falcon24RetainedLlmConfigSchema.parse(json(resolve(root, llmPath)));
  const catalogCapabilities = Object.freeze({
    LLM: "LLM",
    推理: "REASONING",
    流式: "STREAMING",
    结构化输出: "STRUCTURED_OUTPUT",
    工具调用: "TOOLS",
    视觉: "VISION",
  } as const);
  for (const profile of llm.profiles) {
    const provider = MODEL_PROVIDER_CATALOG.find(({ id }) => id === profile.vendor_id);
    const preset = provider?.models.find(({ id }) => id === profile.model_id);
    const expectedCapabilities = preset?.capabilities
      .map((capability) => catalogCapabilities[capability])
      .sort();
    if (
      !provider ||
      !preset ||
      provider.runtimeProvider !== profile.runtime_provider ||
      provider.defaultBaseUrl !== profile.base_url ||
      JSON.stringify(expectedCapabilities) !== JSON.stringify(profile.capabilities)
    ) {
      throw new TypeError("FALCON24_E1_LLM_CATALOG_MISMATCH");
    }
  }
  const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
  const semanticFiles = await fileReferences(root, [
    "packages/evals/src/test-center/falcon24-agent-analysis-suite.ts",
    "apps/worker/src/evals/falcon24-semantic-catalog.ts",
    "apps/worker/src/evals/falcon24-semantic-change-set.ts",
  ]);
  const llmSourceFiles = await fileReferences(root, [
    "apps/web/src/lib/model-provider-catalog.ts",
    "packages/contracts/src/models/index.ts",
  ]);
  const analysisFiles = await fileReferences(root, [
    "packages/contracts/src/generated/statistical-operators.ts",
    "infra/docker/Dockerfile.opensandbox-analysis-agent",
    "infra/docker/Dockerfile.opensandbox-analysis-operator",
    "infra/docker/opensandbox-analysis-core-requirements.lock",
    "infra/docker/opensandbox-analysis-ml-requirements.lock",
    "infra/docker/opensandbox-analysis-causal-requirements.lock",
    ...[
      "__init__.py",
      "attestation.py",
      "cell_policy.py",
      "cohort.py",
      "decomposition.py",
      "delivery.py",
      "dispatcher.py",
      "inventory.py",
      "manifest.py",
      "marketing.py",
      "models.py",
      "multiple_testing.py",
      "registry.py",
      "regression.py",
      "robust_trend.py",
    ].map((file) => `services/sandbox/src/data_agent_stats/${file}`),
  ]);
  const attestationPath = "infra/docker/opensandbox-analysis-attestation.json";
  const attestation = json(resolve(root, attestationPath)) as {
    operator: { registry_digest: `sha256:${string}`; manifest_sha256: `sha256:${string}` };
    local_probe: { production_isolation_proven: boolean };
    production_gate: { decision: "GO" | "HOLD" };
  };
  const operatorManifestPath = "services/sandbox/src/data_agent_stats/manifest.json";
  if (rawHash(resolve(root, operatorManifestPath)) !== attestation.operator.manifest_sha256) {
    throw new TypeError("FALCON24_E1_OPERATOR_MANIFEST_ATTESTATION_INVALID");
  }
  const methodRegistryHash = await sha256ContentHash(
    suite.cases.map(({ case_id, required_methods, required_operator_calls }) => ({
      case_id,
      required_methods,
      required_operator_calls,
    })),
  );
  const manifestInput = {
    schema_version:
      authorityEpoch === FALCON24_TARGET_AUTHORITY_EPOCH
        ? "falcon24-retained-assets@2.0.0"
        : "falcon24-retained-assets@1.0.0",
    authority_epoch: authorityEpoch,
    retained_categories: FALCON24_RETAINED_CATEGORIES,
    discarded_categories: FALCON24_DISCARDED_CATEGORIES,
    upstream: {
      source_commit: sourceManifest.source_commit,
      source_digest: sourceManifest.source_digest,
      manifest_path: "infra/falcon/v1/source-manifest.json",
      manifest_hash: rawHash(resolve(root, "infra/falcon/v1/source-manifest.json")),
      database_count: sourceManifest.database_count,
      public_case_count: sourceManifest.case_count,
      sealed_case_count: sourceManifest.dev_case_count,
    },
    active_dataset: {
      database_id: "falcon_db_24",
      db_id: 24,
      bundle_path: bundlePath,
      bundle_sha256: db24.bundle_sha256,
      content_digest: db24.content_digest,
      seed_hash: db24.source_sqlite_sha256,
      table_count: db24.table_count,
      column_count: db24.column_count,
      row_count: db24.row_count,
      active_subset_hash: await sha256ContentHash(db24),
    },
    questions: {
      public_manifest_path: publicPath,
      public_manifest_hash: sourceManifest.public_cases_sha256,
      sealed_manifest_path: sealedPath,
      sealed_manifest_hash: sourceManifest.sealed_cases_sha256,
      test_manifest_path: testPath,
      test_manifest_hash: sourceManifest.test_cases_sha256,
      active_public_subset_hash: await sha256ContentHash(activePublic),
      active_sealed_subset_hash: await sha256ContentHash(activeSealed),
      active_case_count: activePublic.length,
      suite_version: suite.schema_version,
      suite_hash: suite.suite_hash,
      case_ids: suite.cases.map(({ case_id: caseId }) => caseId).sort(),
    },
    semantics: {
      source_files: semanticFiles,
      source_bundle_hash: retainedExport.semantic.source_bundle_hash,
      expected_table_count: db24.table_count,
      expected_column_count: db24.column_count,
      expected_join_count: 8,
      expected_definition_count: retainedExport.semantic.expected_definition_count,
      competency_closure_hash: retainedExport.semantic.competency_closure_hash,
      database_export_hash: retainedExport.semantic.database_export_hash,
      semantic_diff: retainedExport.semantic.diff,
    },
    llm: {
      manifest_path: llmPath,
      source_files: llmSourceFiles,
      source_bundle_hash: await sha256ContentHash(llmSourceFiles),
      profiles: llm.profiles,
      manifest_hash: rawHash(resolve(root, llmPath)),
      database_diff: retainedExport.llm.diff,
    },
    analysis_runtime: {
      operator_manifest_path: operatorManifestPath,
      operator_manifest_hash: attestation.operator.manifest_sha256,
      operator_registry_digest: attestation.operator.registry_digest,
      attestation_path: attestationPath,
      attestation_hash: rawHash(resolve(root, attestationPath)),
      source_files: analysisFiles,
      source_bundle_hash: await sha256ContentHash(analysisFiles),
      method_registry_hash: methodRegistryHash,
      oracle_contract_hash: rawHash(
        resolve(root, "packages/evals/src/test-center/falcon24-analysis-oracles.ts"),
      ),
      production_isolation_proven: attestation.local_probe.production_isolation_proven,
      production_gate: attestation.production_gate.decision,
    },
  };
  const manifest =
    authorityEpoch === FALCON24_TARGET_AUTHORITY_EPOCH
      ? await buildFalcon24RetainedAssetsManifestV2(manifestInput)
      : await buildFalcon24RetainedAssetsManifest(manifestInput);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ terminal: "READY", manifest_hash: manifest.manifest_hash, output: outputPath })}\n`,
  );
}

await main().catch((error) => {
  const code =
    error instanceof Error && /^[A-Z][A-Z0-9_:-]+$/u.test(error.message)
      ? error.message
      : "FALCON24_E1_BASELINE_BUILD_FAILED";
  process.stderr.write(`${JSON.stringify({ terminal: "HOLD", reason_code: code })}\n`);
  process.exitCode = 1;
});
