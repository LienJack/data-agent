import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  FALCON_DATABASE_COUNT,
  FALCON_DATASET_VERSION,
  FALCON_DEV_CASE_COUNT,
  FALCON_SOURCE_COMMIT,
  FALCON_TEST_CASE_COUNT,
  falconSchemaNameSchema,
} from "./falcon.js";

export const FALCON_AGENT_GATE_VERSION = "falcon-agent-release-gate@1.0.0" as const;
export const FALCON_AGENT_ORACLE_VERSION = "falcon-postgres-expected-result@1.0.0" as const;
export const FALCON_DEV_DATABASE_CASE_COUNTS = Object.freeze({
  4: 22,
  5: 15,
  7: 9,
  8: 16,
  9: 8,
  14: 32,
  15: 29,
  16: 16,
  17: 14,
  18: 16,
  19: 10,
  20: 29,
  21: 35,
  24: 17,
  26: 24,
  28: 17,
} as const);

const publicReferenceSchema = z.strictObject({
  resource_id: immutableIdSchema,
  resource_revision: z.number().int().positive().safe(),
  resource_hash: contentHashSchema,
});

export const falconSemanticBundleIndexEntrySchema = z.strictObject({
  database_id: z.number().int().min(1).max(FALCON_DATABASE_COUNT),
  schema_name: falconSchemaNameSchema,
  package_ref: publicReferenceSchema,
  schema_snapshot_hash: contentHashSchema,
  admission_receipt_ref: publicReferenceSchema,
  coverage_receipt_hash: contentHashSchema,
  physical_object_count: z.number().int().positive(),
  queryable_mapping_count: z.number().int().positive(),
  join_count: z.number().int().nonnegative(),
  mandatory_assertions_passed: z.boolean(),
});

const falconSemanticBundleIndexDraftSchema = z.strictObject({
  schema_version: z.literal("falcon-semantic-bundle-index@1.0.0"),
  scope: appScopeSchema,
  workspace_id: immutableIdSchema,
  semantic_domain: z.literal("falcon"),
  dataset_version: z.literal(FALCON_DATASET_VERSION),
  source_commit: z.literal(FALCON_SOURCE_COMMIT),
  source_digest: contentHashSchema,
  release_set_ref: publicReferenceSchema,
  first_release_receipt_ref: publicReferenceSchema,
  entries: z.array(falconSemanticBundleIndexEntrySchema).length(FALCON_DATABASE_COUNT),
  created_at: timestampSchema,
});

export const falconSemanticBundleIndexSchema = falconSemanticBundleIndexDraftSchema.extend({
  bundle_index_hash: contentHashSchema,
});

function closeBundleEntries(
  entries: readonly z.input<typeof falconSemanticBundleIndexEntrySchema>[],
) {
  const parsed = entries.map((entry) => falconSemanticBundleIndexEntrySchema.parse(entry));
  const byDatabase = new Map(parsed.map((entry) => [entry.database_id, entry]));
  if (byDatabase.size !== parsed.length) throw new Error("FALCON_SEMANTIC_DATABASE_DUPLICATE");
  return Array.from({ length: FALCON_DATABASE_COUNT }, (_, index) => {
    const databaseId = index + 1;
    const entry = byDatabase.get(databaseId);
    if (!entry) throw new Error(`FALCON_SEMANTIC_DATABASE_MISSING:${databaseId}`);
    const expectedSchema = `falcon_db_${String(databaseId).padStart(2, "0")}`;
    if (entry.schema_name !== expectedSchema) {
      throw new Error(`FALCON_SEMANTIC_SCHEMA_MISMATCH:${databaseId}`);
    }
    if (!entry.mandatory_assertions_passed) {
      throw new Error(`FALCON_SEMANTIC_ASSERTION_FAILED:${databaseId}`);
    }
    return entry;
  });
}

export async function buildFalconSemanticBundleIndex(input: unknown) {
  const parsed = falconSemanticBundleIndexDraftSchema.parse(input);
  const draft = falconSemanticBundleIndexDraftSchema.parse({
    ...parsed,
    entries: closeBundleEntries(parsed.entries),
  });
  return falconSemanticBundleIndexSchema.parse({
    ...draft,
    bundle_index_hash: await sha256ContentHash(draft),
  });
}

export async function verifyFalconSemanticBundleIndex(input: unknown) {
  const index = falconSemanticBundleIndexSchema.parse(input);
  closeBundleEntries(index.entries);
  const { bundle_index_hash: actual, ...draft } = index;
  if ((await sha256ContentHash(falconSemanticBundleIndexDraftSchema.parse(draft))) !== actual) {
    throw new Error("FALCON_SEMANTIC_BUNDLE_INDEX_HASH_MISMATCH");
  }
  return index;
}

const falconSemanticUsageDraftSchema = z.strictObject({
  schema_version: z.literal("falcon-semantic-usage-receipt@1.0.0"),
  scope: appScopeSchema,
  receipt_id: immutableIdSchema,
  case_id: versionIdentifierSchema,
  database_id: z.number().int().min(1).max(FALCON_DATABASE_COUNT),
  run_id: immutableIdSchema,
  task_id: immutableIdSchema,
  release_set_hash: contentHashSchema,
  package_ref: publicReferenceSchema,
  context_receipt_ref: publicReferenceSchema,
  physical_object_ids: z.array(versionIdentifierSchema).min(1).max(512),
  mapping_ids: z.array(versionIdentifierSchema).min(1).max(512),
  join_ids: z.array(versionIdentifierSchema).max(512),
  provider_invocation_ref: publicReferenceSchema,
  query_evidence_ref: publicReferenceSchema,
  token_usage: z.discriminatedUnion("availability", [
    z.strictObject({
      availability: z.literal("AVAILABLE"),
      source: z.literal("PROVIDER_REPORTED"),
      input_tokens: z.number().int().nonnegative().safe(),
      output_tokens: z.number().int().nonnegative().safe(),
    }),
    z.strictObject({
      availability: z.literal("UNAVAILABLE"),
      source: z.literal("PROVIDER_DID_NOT_REPORT"),
      input_tokens: z.null(),
      output_tokens: z.null(),
    }),
  ]),
  accepted_at: timestampSchema,
});

export const falconSemanticUsageReceiptSchema = falconSemanticUsageDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

export async function buildFalconSemanticUsageReceipt(input: unknown) {
  const draft = falconSemanticUsageDraftSchema.parse(input);
  return falconSemanticUsageReceiptSchema.parse({
    ...draft,
    physical_object_ids: [...draft.physical_object_ids].sort(),
    mapping_ids: [...draft.mapping_ids].sort(),
    join_ids: [...draft.join_ids].sort(),
    receipt_hash: await sha256ContentHash({
      ...draft,
      physical_object_ids: [...draft.physical_object_ids].sort(),
      mapping_ids: [...draft.mapping_ids].sort(),
      join_ids: [...draft.join_ids].sort(),
    }),
  });
}

export const falconDatabaseGateScoreSchema = z.strictObject({
  database_id: z.number().int().min(1).max(FALCON_DATABASE_COUNT),
  case_count: z.number().int().positive(),
  first_passed: z.number().int().nonnegative(),
  final_passed: z.number().int().nonnegative(),
  terminal_cases: z.number().int().nonnegative(),
});

const falconAgentReleaseGateDraftSchema = z.strictObject({
  schema_version: z.literal(FALCON_AGENT_GATE_VERSION),
  artifact_id: immutableIdSchema,
  scope: appScopeSchema,
  workspace_id: immutableIdSchema,
  dataset_version: z.literal(FALCON_DATASET_VERSION),
  source_commit: z.literal(FALCON_SOURCE_COMMIT),
  source_digest: contentHashSchema,
  oracle_version: z.literal(FALCON_AGENT_ORACLE_VERSION),
  semantic_bundle_index_ref: publicReferenceSchema,
  workspace_journey_ref: publicReferenceSchema,
  model_profile_ref: publicReferenceSchema,
  agent_profile_set_hash: contentHashSchema,
  dev: z.strictObject({
    case_count: z.literal(FALCON_DEV_CASE_COUNT),
    terminal_cases: z.number().int().nonnegative(),
    first_passed: z.number().int().nonnegative(),
    final_passed: z.number().int().nonnegative(),
    database_scores: z
      .array(falconDatabaseGateScoreSchema)
      .length(Object.keys(FALCON_DEV_DATABASE_CASE_COUNTS).length),
  }),
  demo: z.strictObject({ case_count: z.literal(10), passed: z.number().int().nonnegative() }),
  db24: z.strictObject({ case_count: z.literal(17), passed: z.number().int().nonnegative() }),
  db14: z.strictObject({ case_count: z.literal(32), passed: z.number().int().nonnegative() }),
  holdout: z.strictObject({ case_count: z.literal(5), passed: z.number().int().nonnegative() }),
  stability: z.strictObject({
    case_count: z.number().int().positive(),
    passed: z.number().int().nonnegative(),
    flake_count: z.number().int().nonnegative(),
    cold_restart_verified: z.boolean(),
  }),
  test_submission: z.strictObject({
    case_count: z.literal(FALCON_TEST_CASE_COUNT),
    completed: z.number().int().nonnegative(),
    local_verdict_count: z.number().int().nonnegative(),
    submission_hash: contentHashSchema,
  }),
  evidence: z.strictObject({
    team_case_count: z.number().int().nonnegative(),
    semantic_usage_count: z.number().int().nonnegative(),
    provider_invocation_count: z.number().int().nonnegative(),
    report_count: z.number().int().nonnegative(),
    report_citation_passed: z.number().int().nonnegative(),
    taint_violation_count: z.number().int().nonnegative(),
    infrastructure_failure_count: z.number().int().nonnegative(),
  }),
  runtime_health: z.strictObject({
    postgres: z.boolean(),
    worker: z.boolean(),
    provider: z.boolean(),
    team_runtime: z.boolean(),
    oracle: z.boolean(),
  }),
  result: z.literal("GO"),
  completed_at: timestampSchema,
});

export const falconAgentReleaseGateArtifactSchema = falconAgentReleaseGateDraftSchema.extend({
  artifact_hash: contentHashSchema,
});

function assertFalconGate(draft: z.infer<typeof falconAgentReleaseGateDraftSchema>): void {
  if (
    draft.demo.passed !== 10 ||
    draft.db24.passed !== 17 ||
    draft.db14.passed !== 32 ||
    draft.holdout.passed < 4 ||
    draft.dev.terminal_cases !== FALCON_DEV_CASE_COUNT ||
    draft.dev.first_passed < 217 ||
    draft.dev.final_passed < 248 ||
    draft.test_submission.completed !== FALCON_TEST_CASE_COUNT ||
    draft.test_submission.local_verdict_count !== 0 ||
    draft.evidence.team_case_count !== FALCON_DEV_CASE_COUNT + FALCON_TEST_CASE_COUNT ||
    draft.evidence.semantic_usage_count !== FALCON_DEV_CASE_COUNT + FALCON_TEST_CASE_COUNT ||
    draft.evidence.provider_invocation_count < FALCON_DEV_CASE_COUNT + FALCON_TEST_CASE_COUNT ||
    draft.evidence.report_count !== 17 ||
    draft.evidence.report_citation_passed !== 17 ||
    draft.evidence.taint_violation_count !== 0 ||
    draft.evidence.infrastructure_failure_count !== 0 ||
    !draft.stability.cold_restart_verified ||
    draft.stability.flake_count !== 0 ||
    draft.stability.passed !== draft.stability.case_count ||
    Object.values(draft.runtime_health).some((healthy) => !healthy)
  ) {
    throw new Error("FALCON_AGENT_RELEASE_GATE_HOLD");
  }
  const databaseIds = new Set<number>();
  let firstPassed = 0;
  let finalPassed = 0;
  let terminalCases = 0;
  for (const score of draft.dev.database_scores) {
    if (databaseIds.has(score.database_id)) throw new Error("FALCON_DATABASE_SCORE_DUPLICATE");
    databaseIds.add(score.database_id);
    const requiredCaseCount =
      FALCON_DEV_DATABASE_CASE_COUNTS[
        score.database_id as keyof typeof FALCON_DEV_DATABASE_CASE_COUNTS
      ];
    if (
      requiredCaseCount === undefined ||
      score.case_count !== requiredCaseCount ||
      score.terminal_cases !== score.case_count ||
      score.final_passed / score.case_count < 0.6
    ) {
      throw new Error(`FALCON_DATABASE_SCORE_BELOW_FLOOR:${score.database_id}`);
    }
    firstPassed += score.first_passed;
    finalPassed += score.final_passed;
    terminalCases += score.terminal_cases;
  }
  if (
    firstPassed !== draft.dev.first_passed ||
    finalPassed !== draft.dev.final_passed ||
    terminalCases !== draft.dev.terminal_cases
  ) {
    throw new Error("FALCON_DATABASE_SCORE_TOTAL_MISMATCH");
  }
}

export async function buildFalconAgentReleaseGateArtifact(input: unknown) {
  const draft = falconAgentReleaseGateDraftSchema.parse(input);
  assertFalconGate(draft);
  return falconAgentReleaseGateArtifactSchema.parse({
    ...draft,
    artifact_hash: await sha256ContentHash(draft),
  });
}

export async function verifyFalconAgentReleaseGateArtifact(input: unknown) {
  const artifact = falconAgentReleaseGateArtifactSchema.parse(input);
  const { artifact_hash: actual, ...draft } = artifact;
  const parsed = falconAgentReleaseGateDraftSchema.parse(draft);
  assertFalconGate(parsed);
  if ((await sha256ContentHash(parsed)) !== actual) {
    throw new Error("FALCON_AGENT_RELEASE_GATE_HASH_MISMATCH");
  }
  return artifact;
}

export type FalconSemanticBundleIndex = z.infer<typeof falconSemanticBundleIndexSchema>;
export type FalconSemanticUsageReceipt = z.infer<typeof falconSemanticUsageReceiptSchema>;
export type FalconAgentReleaseGateArtifact = z.infer<typeof falconAgentReleaseGateArtifactSchema>;
