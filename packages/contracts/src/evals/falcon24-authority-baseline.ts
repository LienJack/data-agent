import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import { falcon24AnalysisCaseIdSchema } from "./falcon24-agent-analysis.js";

export const FALCON24_RETAINED_ASSETS_VERSION = "falcon24-retained-assets@1.0.0" as const;
export const FALCON24_AUTHORITY_BASELINE_VERSION = "falcon24-authority-baseline@1.0.0" as const;

export const FALCON24_RETAINED_CATEGORIES = Object.freeze([
  "ANALYSIS_RUNTIME",
  "DATASET_AND_ORACLE",
  "FALCON_QUESTIONS",
  "LLM_CONFIGURATION",
  "SEMANTIC_DEFINITIONS",
  "SOURCE_MANIFEST",
] as const);

export const FALCON24_DISCARDED_CATEGORIES = Object.freeze([
  "ARTIFACTS_AND_TRACES",
  "CAMPAIGNS_AND_QUALIFICATIONS",
  "CREDENTIALS_AND_CERTIFICATIONS",
  "HISTORICAL_IDENTITIES",
  "RUNS_AND_CONVERSATIONS",
  "SANDBOX_AND_JOURNAL_STATE",
] as const);

const gitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const safeRepositoryPathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@/+~-]+$/u);
const stableKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u);

function addCanonicalArrayIssue(
  values: readonly string[],
  expected: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (
    values.length !== expected.length ||
    values.some((value, index) => value !== expected[index])
  ) {
    context.addIssue({
      code: "custom",
      message: `${String(path[0])} 必须是唯一、完整且规范排序的冻结集合。`,
      path,
    });
  }
}

const sourceFileSchema = z.strictObject({
  path: safeRepositoryPathSchema,
  hash: contentHashSchema,
});

const canonicalSourceFilesSchema = z
  .array(sourceFileSchema)
  .min(1)
  .max(256)
  .superRefine((files, context) => {
    const paths = files.map(({ path }) => path);
    const sorted = [...paths].sort();
    if (
      new Set(paths).size !== paths.length ||
      paths.some((path, index) => path !== sorted[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "source_files 必须按 path 唯一且规范排序。",
      });
    }
  });

const llmProfileSchema = z
  .strictObject({
    logical_profile_key: stableKeySchema,
    vendor_id: stableKeySchema,
    runtime_provider: stableKeySchema,
    display_name: z.string().trim().min(1).max(256),
    base_url: z.url().max(2_048),
    model_id: stableKeySchema,
    capabilities: z.array(stableKeySchema).min(1).max(32),
    default: z.boolean(),
  })
  .superRefine((profile, context) => {
    let url: URL;
    try {
      url = new URL(profile.base_url);
    } catch {
      context.addIssue({ code: "custom", message: "LLM base_url 必须是有效 HTTPS URL。" });
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      context.addIssue({
        code: "custom",
        message: "LLM base_url 必须使用 HTTPS 且不含 userinfo、query 或 fragment。",
        path: ["base_url"],
      });
    }
    const sortedCapabilities = [...profile.capabilities].sort();
    if (
      new Set(profile.capabilities).size !== profile.capabilities.length ||
      profile.capabilities.some((capability, index) => capability !== sortedCapabilities[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "LLM capabilities 必须唯一且规范排序。",
        path: ["capabilities"],
      });
    }
  });

export const falcon24RetainedLlmConfigSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-retained-llm-config@1.0.0"),
    profiles: z.array(llmProfileSchema).min(1).max(32),
  })
  .superRefine((llm, context) => {
    addCanonicalLlmProfilesIssue(llm.profiles, context);
  });

function addCanonicalLlmProfilesIssue(
  profiles: readonly z.infer<typeof llmProfileSchema>[],
  context: z.RefinementCtx,
): void {
  const profileKeys = profiles.map(({ logical_profile_key: key }) => key);
  const sortedKeys = [...profileKeys].sort();
  if (
    new Set(profileKeys).size !== profileKeys.length ||
    profileKeys.some((key, index) => key !== sortedKeys[index]) ||
    profiles.filter(({ default: isDefault }) => isDefault).length !== 1
  ) {
    context.addIssue({
      code: "custom",
      message: "LLM profiles 必须有唯一且规范排序的 logical key 和唯一 default。",
      path: ["profiles"],
    });
  }
}

const semanticDiffSchema = z
  .strictObject({
    status: z.enum(["MATCH", "HOLD"]),
    diff_hash: contentHashSchema,
    differences: z.array(z.string().trim().min(1).max(2_048)).max(1_000),
  })
  .superRefine((diff, context) => {
    if ((diff.status === "MATCH") !== (diff.differences.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "semantic_diff status 必须与 differences 是否为空一致。",
      });
    }
  });

const llmDatabaseDiffSchema = z
  .strictObject({
    status: z.enum(["MATCH", "RECREATE", "HOLD"]),
    diff_hash: contentHashSchema,
    differences: z.array(z.string().trim().min(1).max(2_048)).max(1_000),
  })
  .superRefine((diff, context) => {
    const onlyMissingProfiles =
      diff.differences.length > 0 &&
      diff.differences.every((difference) => difference.startsWith("MISSING_DATABASE_PROFILE:"));
    if (
      (diff.status === "MATCH" && diff.differences.length !== 0) ||
      (diff.status === "RECREATE" && !onlyMissingProfiles) ||
      (diff.status === "HOLD" && (diff.differences.length === 0 || onlyMissingProfiles))
    ) {
      context.addIssue({
        code: "custom",
        message: "LLM database_diff status 与安全投影差异不一致。",
      });
    }
  });

const retainedLlmProjectionSchema = z
  .strictObject({
    manifest_path: safeRepositoryPathSchema,
    manifest_hash: contentHashSchema,
    source_files: canonicalSourceFilesSchema,
    source_bundle_hash: contentHashSchema,
    profiles: z.array(llmProfileSchema).min(1).max(32),
    database_diff: llmDatabaseDiffSchema,
  })
  .superRefine((llm, context) => {
    addCanonicalLlmProfilesIssue(llm.profiles, context);
  });

const retainedAssetsMaterialSchema = z
  .strictObject({
    schema_version: z.literal(FALCON24_RETAINED_ASSETS_VERSION),
    authority_epoch: z.literal("E1"),
    retained_categories: z.array(z.enum(FALCON24_RETAINED_CATEGORIES)).length(6),
    discarded_categories: z.array(z.enum(FALCON24_DISCARDED_CATEGORIES)).length(6),
    upstream: z.strictObject({
      source_commit: gitCommitSchema,
      source_digest: contentHashSchema,
      manifest_path: safeRepositoryPathSchema,
      manifest_hash: contentHashSchema,
      database_count: z.literal(28),
      public_case_count: z.literal(500),
      sealed_case_count: z.literal(309),
    }),
    active_dataset: z.strictObject({
      database_id: z.literal("falcon_db_24"),
      db_id: z.literal(24),
      bundle_path: safeRepositoryPathSchema,
      bundle_sha256: contentHashSchema,
      content_digest: contentHashSchema,
      seed_hash: contentHashSchema,
      table_count: z.literal(9),
      column_count: z.literal(70),
      row_count: z.literal(121_445),
      active_subset_hash: contentHashSchema,
    }),
    questions: z.strictObject({
      public_manifest_path: safeRepositoryPathSchema,
      public_manifest_hash: contentHashSchema,
      sealed_manifest_path: safeRepositoryPathSchema,
      sealed_manifest_hash: contentHashSchema,
      test_manifest_path: safeRepositoryPathSchema,
      test_manifest_hash: contentHashSchema,
      active_public_subset_hash: contentHashSchema,
      active_sealed_subset_hash: contentHashSchema,
      active_case_count: z.literal(17),
      suite_version: versionIdentifierSchema,
      suite_hash: contentHashSchema,
      case_ids: z.array(falcon24AnalysisCaseIdSchema).length(5),
    }),
    semantics: z.strictObject({
      source_files: canonicalSourceFilesSchema,
      source_bundle_hash: contentHashSchema,
      expected_table_count: z.literal(9),
      expected_column_count: z.literal(70),
      expected_join_count: z.literal(8),
      expected_definition_count: z.number().int().positive().max(1_000),
      competency_closure_hash: contentHashSchema,
      database_export_hash: contentHashSchema,
      semantic_diff: semanticDiffSchema,
    }),
    llm: retainedLlmProjectionSchema,
    analysis_runtime: z.strictObject({
      operator_manifest_path: safeRepositoryPathSchema,
      operator_manifest_hash: contentHashSchema,
      operator_registry_digest: contentHashSchema,
      attestation_path: safeRepositoryPathSchema,
      attestation_hash: contentHashSchema,
      source_files: canonicalSourceFilesSchema,
      source_bundle_hash: contentHashSchema,
      method_registry_hash: contentHashSchema,
      oracle_contract_hash: contentHashSchema,
      production_isolation_proven: z.boolean(),
      production_gate: z.enum(["GO", "HOLD"]),
    }),
  })
  .superRefine((material, context) => {
    addCanonicalArrayIssue(material.retained_categories, FALCON24_RETAINED_CATEGORIES, context, [
      "retained_categories",
    ]);
    addCanonicalArrayIssue(material.discarded_categories, FALCON24_DISCARDED_CATEGORIES, context, [
      "discarded_categories",
    ]);
    addCanonicalArrayIssue(
      material.questions.case_ids,
      [...falcon24AnalysisCaseIdSchema.options].sort(),
      context,
      ["questions", "case_ids"],
    );
    if (
      material.analysis_runtime.production_isolation_proven !==
      (material.analysis_runtime.production_gate === "GO")
    ) {
      context.addIssue({
        code: "custom",
        message: "analysis_runtime production_gate 必须与 isolation 证明一致。",
        path: ["analysis_runtime", "production_gate"],
      });
    }
  });

export const falcon24RetainedAssetsManifestSchema = retainedAssetsMaterialSchema.extend({
  manifest_hash: contentHashSchema,
});

function normalizeSourceFiles(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  const parsed = z.array(sourceFileSchema).safeParse(input);
  if (!parsed.success) return input;
  return parsed.data.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeRetainedMaterial(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const semantics = record.semantics;
  const llm = record.llm;
  const analysisRuntime = record.analysis_runtime;
  return {
    ...record,
    ...(typeof semantics === "object" && semantics !== null && !Array.isArray(semantics)
      ? {
          semantics: {
            ...(semantics as Record<string, unknown>),
            source_files: normalizeSourceFiles((semantics as Record<string, unknown>).source_files),
          },
        }
      : {}),
    ...(typeof llm === "object" && llm !== null && !Array.isArray(llm)
      ? {
          llm: {
            ...(llm as Record<string, unknown>),
            source_files: normalizeSourceFiles((llm as Record<string, unknown>).source_files),
          },
        }
      : {}),
    ...(typeof analysisRuntime === "object" &&
    analysisRuntime !== null &&
    !Array.isArray(analysisRuntime)
      ? {
          analysis_runtime: {
            ...(analysisRuntime as Record<string, unknown>),
            source_files: normalizeSourceFiles(
              (analysisRuntime as Record<string, unknown>).source_files,
            ),
          },
        }
      : {}),
  };
}

export async function buildFalcon24RetainedAssetsManifest(input: unknown) {
  const material = retainedAssetsMaterialSchema.parse(normalizeRetainedMaterial(input));
  return falcon24RetainedAssetsManifestSchema.parse({
    ...material,
    manifest_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24RetainedAssetsManifest(input: unknown) {
  const manifest = falcon24RetainedAssetsManifestSchema.parse(input);
  const { manifest_hash: observedHash, ...material } = manifest;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_RETAINED_ASSETS_HASH_INVALID");
  }
  return manifest;
}

const authorityBaselineMaterialSchema = z
  .strictObject({
    schema_version: z.literal(FALCON24_AUTHORITY_BASELINE_VERSION),
    baseline_id: immutableIdSchema,
    authority_epoch: z.literal("E1"),
    source_commit: gitCommitSchema,
    retained_assets_hash: contentHashSchema,
    web_build_hash: contentHashSchema,
    staging_receipts: z.strictObject({
      dataset: contentHashSchema,
      semantic_release: contentHashSchema,
      llm_configuration: contentHashSchema,
      agent_profiles: contentHashSchema,
      operator_registry: contentHashSchema,
      sandbox_runtime: contentHashSchema,
    }),
    acceptance_contracts: z.strictObject({
      oracle: contentHashSchema,
      qualification: contentHashSchema,
      campaign: contentHashSchema,
      qa_e2e: contentHashSchema,
      trace_ui: contentHashSchema,
      reclamation: contentHashSchema,
    }),
    production_isolation_proven: z.boolean(),
    production_gate: z.enum(["GO", "HOLD"]),
  })
  .superRefine((material, context) => {
    if (material.production_isolation_proven !== (material.production_gate === "GO")) {
      context.addIssue({
        code: "custom",
        message: "production_gate 必须与 production_isolation_proven 一致。",
        path: ["production_gate"],
      });
    }
  });

export const falcon24AuthorityBaselineSchema = authorityBaselineMaterialSchema.extend({
  baseline_hash: contentHashSchema,
});

export async function buildFalcon24AuthorityBaseline(input: unknown) {
  const material = authorityBaselineMaterialSchema.parse(input);
  return falcon24AuthorityBaselineSchema.parse({
    ...material,
    baseline_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24AuthorityBaseline(input: unknown) {
  const baseline = falcon24AuthorityBaselineSchema.parse(input);
  const { baseline_hash: observedHash, ...material } = baseline;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_AUTHORITY_BASELINE_HASH_INVALID");
  }
  return baseline;
}

export type Falcon24RetainedAssetsManifest = z.infer<typeof falcon24RetainedAssetsManifestSchema>;
export type Falcon24AuthorityBaseline = z.infer<typeof falcon24AuthorityBaselineSchema>;
