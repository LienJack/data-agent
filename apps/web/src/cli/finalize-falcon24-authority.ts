import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildBuiltinTeamMaterialization,
  materializeBuiltinTeamProfiles,
} from "@data-agent/agent-runtime";
import { contentHashSchema, sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24DatabaseVerificationReceiptV2,
  buildFalcon24E1DatabaseImportReceipt,
  buildFalcon24RetainedAssetsManifestV2,
  FALCON24_E1_EXPECTED_CATALOG_INVENTORY_HASH,
  falconSourceManifestSchema,
  verifyFalcon24AuthorityBaselineDocument,
  verifyFalcon24RetainedAssetsManifest,
} from "@data-agent/contracts/evals";
import {
  buildFalcon24StagingReceiptV2,
  type Falcon24E1StagingReceipt,
  type Falcon24StagingReceiptV2,
  falcon24AuthorityEpochSchema,
  type falcon24SuccessorAuthorityEpochSchema,
  verifyFalcon24E1StagingReceipt,
  verifyFalcon24StagingReceiptV2,
} from "@data-agent/contracts/runs";
import { loadRuntimeBuildIdentity, type RuntimeBuildIdentity } from "@data-agent/contracts/server";
import { createPostgresAgentProfileRegistry } from "@data-agent/platform/agents";
import { adaptPgCatalogPool, verifyFalcon24CatalogInventory } from "@data-agent/platform/catalog";
import { createPostgresSkillRegistry } from "@data-agent/platform/extensions";
import { createPostgresModelControlRepository } from "@data-agent/platform/models";
import { adaptPgPool } from "@data-agent/platform/persistence";
import {
  createPostgresEffectiveConfigResolver,
  createPostgresFalcon24AuthorityEpoch,
  createPostgresFalcon24SemanticClosureReader,
} from "@data-agent/platform/runs";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import {
  buildFalcon24ModelAuthorityProof,
  createPostgresSemanticSuccessorSmokeAuthority,
} from "@data-agent/platform/semantic-postgres";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import {
  SEMANTIC_PUBLICATION_COMPILER_VERSION,
  semanticPublicationCompilerBundleDigest,
} from "@data-agent/semantic/production";
import pg from "pg";
import { z } from "zod";
import {
  parseTurboBuildDryRun,
  projectRuntimeBuildIdentities,
  readWorkspaceBuildAttestation,
  verifyWorkspaceBuildAttestation,
} from "../../../../scripts/lib/workspace-build-integrity.js";
import { verifyOpenSandboxAnalysisAttestation } from "../../../../scripts/verify-opensandbox-analysis-attestation.js";
import {
  resolveBuiltinTeamMaterializationInput,
  verifyCurrentBuiltinTeamAuthority,
} from "../lib/builtin-team-authority";
import { stageFalcon24E4SuccessorAuthority } from "../lib/falcon24-successor-authority-staging";
import {
  buildFalcon24SuccessorChangeSet,
  falcon24SuccessorOperationId,
} from "../lib/falcon24-successor-change-set";
import { finalizeFalcon24SemanticSuccessor } from "../lib/falcon24-successor-finalization";
import { createFalcon24SuccessorFinalizationReadback } from "../lib/falcon24-successor-readback";
import { createFalcon24SuccessorSmokeProcess } from "../lib/falcon24-successor-smoke-process";
import { loadFalcon24E4SupportingAuthorityContext } from "../lib/falcon24-successor-supporting-authority";
import { createPostgresSemanticPublicationAuthority } from "../lib/postgres-semantic-publication";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_AUTHORITY_ACTIVATION";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-00000000e124";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-00000000e125";
const DEFAULT_STAGING_ID = "00000000-0000-4000-8000-00000000e230";
const DEFAULT_DATASOURCE_ID = "37653002-af62-53c9-bf21-519468aa39ab";
const TARGET_AUTHORITY_EPOCH = "E4" as const;
const SEMANTIC_DOMAIN = "falcon24" as const;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const execFileAsync = promisify(execFile);

const configurationSchema = z.strictObject({
  database_url: z.string().min(1),
  authority_epoch: z.literal(TARGET_AUTHORITY_EPOCH),
  deployment_id: z.uuid(),
  workspace_id: z.uuid(),
  principal_id: z.uuid(),
  staging_id: z.uuid(),
  datasource_id: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  web_build_identity_file: z.string().min(1).max(4_096).refine(isAbsolute),
  worker_build_identity_file: z.string().min(1).max(4_096).refine(isAbsolute),
  build_attestation_file: z.string().min(1).max(4_096).refine(isAbsolute),
});

const ACCEPTANCE_CONTRACT_SOURCES = Object.freeze({
  qualification: Object.freeze([
    "apps/web/src/cli/falcon24-qualification.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010774_app_data_agent_falcon24_qualification_authority.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010781_app_data_agent_falcon24_e2_authority.sql",
    "packages/contracts/src/evals/falcon24-qualification.ts",
    "packages/platform/src/runs/postgres-falcon24-qualification.ts",
  ]),
  campaign: Object.freeze([
    "apps/web/src/cli/falcon24-agent-acceptance.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010766_app_data_agent_falcon24_acceptance_campaign_authority.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010781_app_data_agent_falcon24_e2_authority.sql",
    "packages/contracts/src/evals/falcon24-acceptance-campaign.ts",
    "packages/platform/src/runs/postgres-falcon24-acceptance-campaign.ts",
  ]),
  qa_e2e: Object.freeze([
    "apps/web/src/cli/falcon24-browser-trace-gate.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010777_app_data_agent_falcon24_e1_trace.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010781_app_data_agent_falcon24_e2_authority.sql",
    "packages/contracts/src/runs/authority-epoch.ts",
  ]),
  trace_ui: Object.freeze([
    "apps/web/src/cli/falcon24-browser-trace-gate.ts",
    "apps/web/src/cli/falcon24-resolution-trace-gate.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010777_app_data_agent_falcon24_e1_trace.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010781_app_data_agent_falcon24_e2_authority.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010782_app_data_agent_falcon24_analysis_publication.sql",
  ]),
  reclamation: Object.freeze([
    "apps/worker/src/evals/falcon24-qualification-reclamation-cli.ts",
    "apps/worker/src/evals/falcon24-sandbox-reclamation-cli.ts",
    "infra/supabase/apps/data-agent/migrations/20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority.sql",
    "infra/supabase/apps/data-agent/migrations/20260725010781_app_data_agent_falcon24_e2_authority.sql",
    "packages/contracts/src/evals/falcon24-acceptance-campaign.ts",
  ]),
});

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function rawHash(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function exactContentHash(value: string): `sha256:${string}` {
  return contentHashSchema.parse(value) as `sha256:${string}`;
}

export async function buildFalcon24SuccessorSmokeIdempotencyKey(input: {
  readonly stage_identity: `sha256:${string}`;
  readonly worker_build_identity: RuntimeBuildIdentity;
}): Promise<string> {
  const smokeIdentity = await sha256ContentHash({
    schema_version: "falcon24-e4-successor-smoke-identity@2.0.0",
    stage_identity: exactContentHash(input.stage_identity),
    worker_build_identity: input.worker_build_identity,
  });
  return stableUuid(`falcon24:E4:semantic-smoke-idempotency:${smokeIdentity}`);
}

function requireValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function stableFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(message)
    ? message
    : "FALCON24_AUTHORITY_ACTIVATION_FINALIZATION_FAILED";
}

function reportedAuthorityEpoch(environment: NodeJS.ProcessEnv): string {
  const parsed = z
    .literal(TARGET_AUTHORITY_EPOCH)
    .safeParse(environment.FALCON24_AUTHORITY_EPOCH ?? TARGET_AUTHORITY_EPOCH);
  return parsed.success ? parsed.data : TARGET_AUTHORITY_EPOCH;
}

async function contractHash(root: string, paths: readonly string[]) {
  return sha256ContentHash({
    schema_version: "falcon24-acceptance-contract-source-set@2.0.0",
    source_files: [...paths].sort().map((path) => ({ path, hash: rawHash(resolve(root, path)) })),
  });
}

const BASELINE_RECEIPT_COMPONENTS = Object.freeze({
  AGENT_PROFILES: "agent_profiles",
  DATASET: "dataset",
  LLM_CONFIGURATION: "llm_configuration",
  OPERATOR_REGISTRY: "operator_registry",
  SANDBOX_RUNTIME: "sandbox_runtime",
  SEMANTIC_RELEASE: "semantic_release",
} as const satisfies Readonly<Record<Falcon24StagingReceiptV2["component"], string>>);

type HistoricalStagingReceipt = Falcon24E1StagingReceipt | Falcon24StagingReceiptV2;

export async function verifyFalcon24PredecessorStagingReceipt(input: {
  readonly authority_epoch: string;
  readonly receipt_document: unknown;
}): Promise<HistoricalStagingReceipt> {
  const authorityEpoch = falcon24AuthorityEpochSchema.parse(input.authority_epoch);
  if (authorityEpoch === "E1") {
    return verifyFalcon24E1StagingReceipt(input.receipt_document);
  }
  const receipt = await verifyFalcon24StagingReceiptV2(input.receipt_document);
  if (receipt.authority_epoch !== authorityEpoch) {
    throw new TypeError("FALCON24_AUTHORITY_PREDECESSOR_RECEIPT_EPOCH_MISMATCH");
  }
  return receipt;
}

export function resolveFalcon24PredecessorDatasetSubjectHash(input: {
  readonly predecessor_receipt: HistoricalStagingReceipt;
  readonly e1_import_receipt_hash: HistoricalStagingReceipt["subject_hash"];
  readonly versioned_verification_receipt_hash: HistoricalStagingReceipt["subject_hash"];
}): HistoricalStagingReceipt["subject_hash"] {
  return input.predecessor_receipt.schema_version === "falcon24-e1-staging-receipt@1.0.0"
    ? input.e1_import_receipt_hash
    : input.versioned_verification_receipt_hash;
}

async function loadPredecessorStagingReceipts(input: {
  readonly pool: pg.Pool;
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
  };
  readonly authority_epoch: string;
  readonly baseline_id: string;
  readonly baseline_hash: string;
}) {
  const baselineResult = await input.pool.query<{ readonly baseline_document: unknown }>(
    `select baseline_document
       from app_data_agent.falcon24_authority_baselines
      where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
        and authority_epoch=$4::text and baseline_id=$5::uuid and baseline_hash=$6::text
        and status='ACTIVE'`,
    [
      input.scope.app_id,
      input.scope.tenant_id,
      input.scope.environment,
      input.authority_epoch,
      input.baseline_id,
      input.baseline_hash,
    ],
  );
  const baselineRow = baselineResult.rows[0];
  if (baselineResult.rowCount !== 1 || !baselineRow) {
    throw new TypeError("FALCON24_AUTHORITY_PREDECESSOR_BASELINE_REQUIRED");
  }
  const baseline = await verifyFalcon24AuthorityBaselineDocument(baselineRow.baseline_document);
  if (
    baseline.authority_epoch !== input.authority_epoch ||
    baseline.baseline_id !== input.baseline_id ||
    baseline.baseline_hash !== input.baseline_hash
  ) {
    throw new TypeError("FALCON24_AUTHORITY_PREDECESSOR_BASELINE_MISMATCH");
  }
  const expectedHashes = Object.entries(BASELINE_RECEIPT_COMPONENTS).map(
    ([component, field]) => [component, baseline.staging_receipts[field]] as const,
  );
  const receiptResult = await input.pool.query<{ readonly receipt_document: unknown }>(
    `select receipt_document
       from app_data_agent.falcon24_authority_staging_receipts
      where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
        and authority_epoch=$4::text and receipt_hash=any($5::text[])
      order by component`,
    [
      input.scope.app_id,
      input.scope.tenant_id,
      input.scope.environment,
      input.authority_epoch,
      expectedHashes.map(([, hash]) => hash),
    ],
  );
  if (receiptResult.rows.length !== expectedHashes.length) {
    throw new TypeError("FALCON24_AUTHORITY_PREDECESSOR_RECEIPTS_INCOMPLETE");
  }
  const receipts = new Map<Falcon24StagingReceiptV2["component"], HistoricalStagingReceipt>();
  for (const row of receiptResult.rows) {
    const receipt = await verifyFalcon24PredecessorStagingReceipt({
      authority_epoch: input.authority_epoch,
      receipt_document: row.receipt_document,
    });
    const field = BASELINE_RECEIPT_COMPONENTS[receipt.component];
    if (
      receipt.receipt_hash !== baseline.staging_receipts[field] ||
      receipts.has(receipt.component)
    ) {
      throw new TypeError("FALCON24_AUTHORITY_PREDECESSOR_RECEIPT_MISMATCH");
    }
    receipts.set(receipt.component, receipt);
  }
  return receipts;
}

function requirePredecessorReceipt(
  receipts: ReadonlyMap<Falcon24StagingReceiptV2["component"], HistoricalStagingReceipt>,
  component: Falcon24StagingReceiptV2["component"],
) {
  const receipt = receipts.get(component);
  if (!receipt) throw new TypeError("FALCON24_AUTHORITY_PREDECESSOR_RECEIPTS_INCOMPLETE");
  return receipt;
}

async function recordStagingReceipt(input: {
  readonly authority_epoch: z.infer<typeof falcon24SuccessorAuthorityEpochSchema>;
  readonly staging_id: string;
  readonly component: Falcon24StagingReceiptV2["component"];
  readonly subject_hash: string;
  readonly evidence_hash: string;
  readonly production_isolation_proven: boolean;
  readonly capability: unknown;
  readonly epoch: ReturnType<typeof createPostgresFalcon24AuthorityEpoch>;
}) {
  const receipt = await buildFalcon24StagingReceiptV2({
    schema_version: "falcon24-staging-receipt@2.0.0",
    authority_epoch: input.authority_epoch,
    staging_id: input.staging_id,
    component: input.component,
    subject_hash: input.subject_hash,
    evidence_hash: input.evidence_hash,
    production_isolation_proven: input.production_isolation_proven,
  });
  return verifyFalcon24StagingReceiptV2(
    requireValue(await input.epoch.recordReceipt(input.capability, receipt)),
  );
}

export async function buildFalcon24AcceptanceContractHashes(input: {
  readonly repository_root: string;
  readonly oracle_contract_hash: `sha256:${string}`;
}) {
  const entries = await Promise.all(
    Object.entries(ACCEPTANCE_CONTRACT_SOURCES).map(async ([key, paths]) => [
      key,
      await contractHash(input.repository_root, paths),
    ]),
  );
  return Object.freeze({
    oracle: input.oracle_contract_hash,
    ...(Object.fromEntries(entries) as {
      qualification: `sha256:${string}`;
      campaign: `sha256:${string}`;
      qa_e2e: `sha256:${string}`;
      trace_ui: `sha256:${string}`;
      reclamation: `sha256:${string}`;
    }),
  });
}

async function frozenCommit(root: string): Promise<string> {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root }),
    execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }),
  ]);
  if (status.trim().length > 0) throw new TypeError("FALCON24_AUTHORITY_SOURCE_NOT_FROZEN");
  return z
    .string()
    .regex(/^[0-9a-f]{40}$/u)
    .parse(commit.trim());
}

async function verifyReleaseBuildClosure(input: {
  readonly repository_root: string;
  readonly source_commit: string;
  readonly attestation_file: string;
  readonly web_build: ReturnType<typeof loadRuntimeBuildIdentity>;
  readonly worker_build: ReturnType<typeof loadRuntimeBuildIdentity>;
}) {
  const { stdout } = await execFileAsync(
    "pnpm",
    [
      "turbo",
      "run",
      "build",
      "--dry=json",
      "--filter=@data-agent/web...",
      "--filter=@data-agent/worker...",
    ],
    { cwd: input.repository_root, maxBuffer: 20 * 1_024 * 1_024 },
  );
  const currentBuild = parseTurboBuildDryRun(JSON.parse(stdout));
  const attestation = verifyWorkspaceBuildAttestation({
    repoRoot: input.repository_root,
    attestation: readWorkspaceBuildAttestation(input.attestation_file),
    currentBuild,
  });
  const projected = new Map(
    projectRuntimeBuildIdentities(attestation).map((identity) => [
      identity.consumer_role,
      identity,
    ]),
  );
  const projectedWeb = projected.get("web");
  const projectedWorker = projected.get("worker");
  const identityMatches = (
    projectedIdentity: NonNullable<typeof projectedWeb>,
    loadedIdentity: ReturnType<typeof loadRuntimeBuildIdentity>,
  ) =>
    projectedIdentity.schema_version === loadedIdentity.schema_version &&
    projectedIdentity.consumer_role === loadedIdentity.consumer_role &&
    projectedIdentity.generation_id === loadedIdentity.generation_id &&
    projectedIdentity.build_id === loadedIdentity.build_id &&
    projectedIdentity.built_at === loadedIdentity.built_at &&
    projectedIdentity.git_commit === loadedIdentity.git_commit &&
    projectedIdentity.git_dirty === loadedIdentity.git_dirty;
  if (
    attestation.git_dirty ||
    attestation.git_commit !== input.source_commit ||
    !projectedWeb ||
    !projectedWorker ||
    !identityMatches(projectedWeb, input.web_build) ||
    !identityMatches(projectedWorker, input.worker_build)
  ) {
    throw new TypeError("FALCON24_AUTHORITY_RELEASE_BUILD_IDENTITY_MISMATCH");
  }
  return Object.freeze({
    generation_id: attestation.generation_id,
    web_build_id: projectedWeb.build_id,
    worker_build_id: projectedWorker.build_id,
  });
}

async function stageDatasetReceipt(input: {
  readonly authority_epoch: z.infer<typeof falcon24SuccessorAuthorityEpochSchema>;
  readonly staging_id: string;
  readonly retained: Awaited<ReturnType<typeof verifyFalcon24RetainedAssetsManifest>>;
  readonly predecessor_receipts: ReadonlyMap<
    Falcon24StagingReceiptV2["component"],
    HistoricalStagingReceipt
  >;
  readonly pool: pg.Pool;
  readonly capability: unknown;
  readonly epoch: ReturnType<typeof createPostgresFalcon24AuthorityEpoch>;
}) {
  const sourceManifestPath = resolve(REPOSITORY_ROOT, input.retained.upstream.manifest_path);
  const bundlePath = resolve(REPOSITORY_ROOT, input.retained.active_dataset.bundle_path);
  if (rawHash(sourceManifestPath) !== input.retained.upstream.manifest_hash) {
    throw new TypeError("FALCON24_DATASET_SOURCE_MANIFEST_HASH_MISMATCH");
  }
  const sourceManifest = falconSourceManifestSchema.parse(json(sourceManifestPath));
  const source = sourceManifest.files.find(({ db_id: databaseId }) => databaseId === 24);
  if (
    !source ||
    sourceManifest.source_commit !== input.retained.upstream.source_commit ||
    sourceManifest.source_digest !== input.retained.upstream.source_digest ||
    source.bundle_sha256 !== input.retained.active_dataset.bundle_sha256 ||
    source.content_digest !== input.retained.active_dataset.content_digest ||
    source.source_sqlite_sha256 !== input.retained.active_dataset.seed_hash ||
    source.table_count !== input.retained.active_dataset.table_count ||
    source.column_count !== input.retained.active_dataset.column_count ||
    source.row_count !== input.retained.active_dataset.row_count
  ) {
    throw new TypeError("FALCON24_DATASET_RETAINED_SOURCE_MISMATCH");
  }
  const observedBundleHash = rawHash(bundlePath);
  const inventory = await verifyFalcon24CatalogInventory(adaptPgCatalogPool(input.pool));
  const historicalImport = await buildFalcon24E1DatabaseImportReceipt({
    source,
    observed_bundle_sha256: observedBundleHash,
    expected_inventory_hash: FALCON24_E1_EXPECTED_CATALOG_INVENTORY_HASH,
    catalog_inventory: inventory,
  });
  const predecessor = requirePredecessorReceipt(input.predecessor_receipts, "DATASET");
  const predecessorVerification =
    predecessor.schema_version === "falcon24-staging-receipt@2.0.0"
      ? await buildFalcon24DatabaseVerificationReceiptV2({
          authority_epoch: predecessor.authority_epoch,
          source,
          observed_bundle_sha256: observedBundleHash,
          expected_inventory_hash: FALCON24_E1_EXPECTED_CATALOG_INVENTORY_HASH,
          catalog_inventory: inventory,
        })
      : undefined;
  const expectedPredecessorSubjectHash = resolveFalcon24PredecessorDatasetSubjectHash({
    predecessor_receipt: predecessor,
    e1_import_receipt_hash: historicalImport.receipt_hash,
    versioned_verification_receipt_hash:
      predecessorVerification?.receipt_hash ?? historicalImport.receipt_hash,
  });
  if (
    historicalImport.status !== "READY" ||
    predecessorVerification?.status === "HOLD" ||
    expectedPredecessorSubjectHash !== predecessor.subject_hash ||
    inventory.inventory_hash !== predecessor.evidence_hash
  ) {
    throw new TypeError("FALCON24_DATASET_PREDECESSOR_PROOF_MISMATCH");
  }
  const verification = await buildFalcon24DatabaseVerificationReceiptV2({
    authority_epoch: input.authority_epoch,
    source,
    observed_bundle_sha256: observedBundleHash,
    expected_inventory_hash: FALCON24_E1_EXPECTED_CATALOG_INVENTORY_HASH,
    catalog_inventory: inventory,
  });
  if (verification.status !== "READY") {
    throw new TypeError("FALCON24_DATASET_VERIFICATION_HOLD");
  }
  const receipt = await recordStagingReceipt({
    authority_epoch: input.authority_epoch,
    staging_id: input.staging_id,
    component: "DATASET",
    subject_hash: verification.receipt_hash,
    evidence_hash: inventory.inventory_hash,
    production_isolation_proven: false,
    capability: input.capability,
    epoch: input.epoch,
  });
  return Object.freeze({
    receipt,
    verification_receipt_hash: verification.receipt_hash,
    inventory_hash: inventory.inventory_hash,
    table_count: inventory.table_count,
    column_count: inventory.column_count,
    row_count: inventory.row_count,
    null_count: inventory.null_count,
    content_digest: inventory.content_digest,
  });
}

async function stageModelReceipt(input: {
  readonly authority_epoch: z.infer<typeof falcon24SuccessorAuthorityEpochSchema>;
  readonly staging_id: string;
  readonly retained: Awaited<ReturnType<typeof verifyFalcon24RetainedAssetsManifest>>;
  readonly predecessor_receipts: ReadonlyMap<
    Falcon24StagingReceiptV2["component"],
    HistoricalStagingReceipt
  >;
  readonly sql_pool: ReturnType<typeof adaptPgPool>;
  readonly deployment_id: string;
  readonly principal_id: string;
  readonly capability: unknown;
  readonly epoch: ReturnType<typeof createPostgresFalcon24AuthorityEpoch>;
}) {
  const llmManifestPath = resolve(REPOSITORY_ROOT, input.retained.llm.manifest_path);
  if (rawHash(llmManifestPath) !== input.retained.llm.manifest_hash) {
    throw new TypeError("FALCON24_LLM_MANIFEST_HASH_MISMATCH");
  }
  for (const source of input.retained.llm.source_files) {
    if (rawHash(resolve(REPOSITORY_ROOT, source.path)) !== source.hash) {
      throw new TypeError("FALCON24_LLM_RETAINED_SOURCE_DRIFT");
    }
  }
  if (
    (await sha256ContentHash(input.retained.llm.source_files)) !==
    input.retained.llm.source_bundle_hash
  ) {
    throw new TypeError("FALCON24_LLM_SOURCE_BUNDLE_MISMATCH");
  }
  const repository = createPostgresModelControlRepository(input.sql_pool);
  const adminContext = {
    deployment_id: input.deployment_id,
    principal_id: input.principal_id,
  };
  const [providers, models, certifications] = await Promise.all([
    repository.listProviderConnections(adminContext).then(requireValue),
    repository.listModels(adminContext).then(requireValue),
    repository.listModelAuthentications(adminContext).then(requireValue),
  ]);
  const retainedProfile = input.retained.llm.profiles[0];
  if (!retainedProfile) throw new TypeError("FALCON24_LLM_PROFILE_REQUIRED");
  const matchingModels = models.filter(
    (candidate) =>
      candidate.provider === retainedProfile.runtime_provider &&
      candidate.model_id === retainedProfile.model_id &&
      candidate.display_name === retainedProfile.display_name &&
      candidate.base_url === retainedProfile.base_url &&
      candidate.is_system_default,
  );
  const model = matchingModels[0];
  if (matchingModels.length !== 1 || !model?.provider_connection_id) {
    throw new TypeError("FALCON24_MODEL_AUTHORITY_REQUIRED");
  }
  const provider = providers.find(
    ({ provider_connection_id: providerId }) => providerId === model.provider_connection_id,
  );
  if (!provider) throw new TypeError("FALCON24_MODEL_PROVIDER_REQUIRED");
  const certification = certifications.find(
    (candidate) =>
      candidate.model_profile_id === model.model_profile_id &&
      candidate.model_config_version === model.config_version &&
      candidate.state === "PASS",
  );
  const proof = await buildFalcon24ModelAuthorityProof({
    retained_llm: input.retained.llm,
    llm_manifest: json(llmManifestPath),
    provider,
    model,
    credential_ref: model.credential_ref,
    ...(certification ? { certification } : {}),
    require_ready: true,
  });
  const predecessor = requirePredecessorReceipt(input.predecessor_receipts, "LLM_CONFIGURATION");
  if (
    proof.subject_hash !== predecessor.subject_hash ||
    proof.evidence_hash !== predecessor.evidence_hash
  ) {
    throw new TypeError("FALCON24_MODEL_PREDECESSOR_PROOF_MISMATCH");
  }
  const receipt = await recordStagingReceipt({
    authority_epoch: input.authority_epoch,
    staging_id: input.staging_id,
    component: "LLM_CONFIGURATION",
    subject_hash: proof.subject_hash,
    evidence_hash: proof.evidence_hash,
    production_isolation_proven: false,
    capability: input.capability,
    epoch: input.epoch,
  });
  return Object.freeze({ receipt, ...proof });
}

async function stageRuntimeReceipts(input: {
  readonly authority_epoch: z.infer<typeof falcon24SuccessorAuthorityEpochSchema>;
  readonly staging_id: string;
  readonly retained: Awaited<ReturnType<typeof verifyFalcon24RetainedAssetsManifest>>;
  readonly runtime_attestation: Awaited<ReturnType<typeof verifyOpenSandboxAnalysisAttestation>>;
  readonly predecessor_receipts: ReadonlyMap<
    Falcon24StagingReceiptV2["component"],
    HistoricalStagingReceipt
  >;
  readonly capability: unknown;
  readonly epoch: ReturnType<typeof createPostgresFalcon24AuthorityEpoch>;
}) {
  const runtime = input.runtime_attestation;
  if (
    runtime.attestation_hash !== input.retained.analysis_runtime.attestation_hash ||
    runtime.operator_manifest_hash !== input.retained.analysis_runtime.operator_manifest_hash ||
    runtime.operator_registry_digest !== input.retained.analysis_runtime.operator_registry_digest ||
    runtime.source_bundle_hash !== input.retained.analysis_runtime.source_bundle_hash ||
    runtime.production_gate !== input.retained.analysis_runtime.production_gate ||
    runtime.production_isolation_proven !==
      input.retained.analysis_runtime.production_isolation_proven
  ) {
    throw new TypeError("FALCON24_RUNTIME_ATTESTATION_MISMATCH");
  }
  const predecessorOperator = requirePredecessorReceipt(
    input.predecessor_receipts,
    "OPERATOR_REGISTRY",
  );
  const predecessorSandbox = requirePredecessorReceipt(
    input.predecessor_receipts,
    "SANDBOX_RUNTIME",
  );
  if (
    predecessorOperator.subject_hash !== runtime.operator_registry_digest ||
    predecessorOperator.evidence_hash !== runtime.operator_manifest_hash ||
    predecessorSandbox.subject_hash !== runtime.attestation_hash ||
    predecessorSandbox.evidence_hash !== runtime.attestation_evidence_hash
  ) {
    throw new TypeError("FALCON24_RUNTIME_PREDECESSOR_PROOF_MISMATCH");
  }
  const operator = await recordStagingReceipt({
    authority_epoch: input.authority_epoch,
    staging_id: input.staging_id,
    component: "OPERATOR_REGISTRY",
    subject_hash: runtime.operator_registry_digest,
    evidence_hash: runtime.operator_manifest_hash,
    production_isolation_proven: false,
    capability: input.capability,
    epoch: input.epoch,
  });
  const sandbox = await recordStagingReceipt({
    authority_epoch: input.authority_epoch,
    staging_id: input.staging_id,
    component: "SANDBOX_RUNTIME",
    subject_hash: runtime.attestation_hash,
    evidence_hash: runtime.attestation_evidence_hash,
    production_isolation_proven: runtime.production_isolation_proven,
    capability: input.capability,
    epoch: input.epoch,
  });
  return Object.freeze({ operator, sandbox, attestation: runtime });
}

export async function buildFalcon24AgentProfileAuthorityProof(input: {
  readonly authority_epoch: z.infer<typeof falcon24SuccessorAuthorityEpochSchema>;
  readonly built: Awaited<ReturnType<typeof buildBuiltinTeamMaterialization>>;
  readonly materialization_input: Awaited<
    ReturnType<typeof resolveBuiltinTeamMaterializationInput>
  >;
  readonly worker_build: ReturnType<typeof loadRuntimeBuildIdentity>;
}) {
  const subjectHash = await sha256ContentHash({
    profile_revisions: input.built.profile_revisions.map((profile) => profile.revision_hash),
    skill_revisions: input.built.skill_revisions.map((skill) => skill.revision_hash),
  });
  const evidence = Object.freeze({
    schema_version: "falcon24-agent-profile-authority-proof@2.0.0" as const,
    authority_epoch: input.authority_epoch,
    materialization_manifest_hash: input.built.manifest_hash,
    model_profile_refs: input.materialization_input.model_profile_refs,
    context_policy_refs: input.materialization_input.context_policy_refs,
    execution_safety_policy_refs: input.materialization_input.execution_safety_policy_refs,
    profile_revisions: input.built.profile_revisions.map((profile) => ({
      profile_id: profile.profile_id,
      revision: profile.revision,
      revision_hash: profile.revision_hash,
    })),
    skill_revisions: input.built.skill_revisions.map((skill) => ({
      skill_id: skill.skill_id,
      revision: skill.revision,
      revision_hash: skill.revision_hash,
    })),
    worker_build: {
      build_id: input.worker_build.build_id,
      generation_id: input.worker_build.generation_id,
    },
  });
  const evidenceHash = await sha256ContentHash(evidence);
  return Object.freeze({ subject_hash: subjectHash, evidence_hash: evidenceHash, evidence });
}

async function stageAgentProfileReceipt(input: {
  readonly authority_epoch: z.infer<typeof falcon24SuccessorAuthorityEpochSchema>;
  readonly staging_id: string;
  readonly built: Awaited<ReturnType<typeof buildBuiltinTeamMaterialization>>;
  readonly materialization_input: Awaited<
    ReturnType<typeof resolveBuiltinTeamMaterializationInput>
  >;
  readonly worker_build: ReturnType<typeof loadRuntimeBuildIdentity>;
  readonly capability: unknown;
  readonly epoch: ReturnType<typeof createPostgresFalcon24AuthorityEpoch>;
}) {
  const proof = await buildFalcon24AgentProfileAuthorityProof(input);
  const receipt = await recordStagingReceipt({
    authority_epoch: input.authority_epoch,
    staging_id: input.staging_id,
    component: "AGENT_PROFILES",
    subject_hash: proof.subject_hash,
    evidence_hash: proof.evidence_hash,
    production_isolation_proven: false,
    capability: input.capability,
    epoch: input.epoch,
  });
  return Object.freeze({ receipt, ...proof });
}

export async function runFalcon24AuthorityFinalization(
  environment: NodeJS.ProcessEnv = loadRuntimeEnvironment().environment,
) {
  const authorityEpoch = z
    .literal(TARGET_AUTHORITY_EPOCH)
    .parse(environment.FALCON24_AUTHORITY_EPOCH ?? TARGET_AUTHORITY_EPOCH);
  if (environment[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
    return {
      schema_version: "falcon24-authority-finalization-result@2.0.0" as const,
      authority_epoch: authorityEpoch,
      terminal: "NOT_RUN" as const,
      reason_code: "FALCON24_AUTHORITY_ACTIVATION_CONFIRMATION_REQUIRED" as const,
    };
  }
  const webBuildIdentityFile =
    environment.FALCON24_WEB_BUILD_IDENTITY_FILE ??
    environment.DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE;
  const configuration = configurationSchema.parse({
    database_url: environment.DATABASE_URL,
    authority_epoch: authorityEpoch,
    deployment_id: environment.WORKER_DEPLOYMENT_ID ?? DEFAULT_DEPLOYMENT_ID,
    workspace_id: environment.WORKER_TENANT_ID ?? DEFAULT_WORKSPACE_ID,
    principal_id: environment.WORKER_PRINCIPAL_ID ?? DEFAULT_PRINCIPAL_ID,
    staging_id: environment.FALCON24_STAGING_ID ?? DEFAULT_STAGING_ID,
    datasource_id: environment.FALCON24_DATASOURCE_ID ?? DEFAULT_DATASOURCE_ID,
    environment: environment.FALCON24_ENVIRONMENT ?? "local",
    web_build_identity_file: webBuildIdentityFile,
    worker_build_identity_file:
      environment.FALCON24_WORKER_BUILD_IDENTITY_FILE ??
      (webBuildIdentityFile ? resolve(dirname(webBuildIdentityFile), "worker.json") : undefined),
    build_attestation_file:
      environment.FALCON24_BUILD_ATTESTATION_FILE ??
      (webBuildIdentityFile
        ? resolve(dirname(webBuildIdentityFile), "attestation.json")
        : undefined),
  });
  const retainedE1 = await verifyFalcon24RetainedAssetsManifest(
    json(resolve(REPOSITORY_ROOT, "infra/falcon/e1/retained-assets-manifest.json")),
  );
  const { manifest_hash: _historicalManifestHash, ...retainedMaterial } = retainedE1;
  const retained = await buildFalcon24RetainedAssetsManifestV2({
    ...retainedMaterial,
    schema_version: "falcon24-retained-assets@2.0.0",
    authority_epoch: configuration.authority_epoch,
  });
  const runtimeAttestation = await verifyOpenSandboxAnalysisAttestation(REPOSITORY_ROOT);
  if (configuration.environment === "prod" || configuration.environment === "production") {
    throw new TypeError("FALCON24_AUTHORITY_PRODUCTION_ISOLATION_REQUIRED");
  }
  const sourceCommit = await frozenCommit(REPOSITORY_ROOT);
  const webBuildIdentity = loadRuntimeBuildIdentity({
    expectedRole: "web",
    environment: {
      ...environment,
      DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE: configuration.web_build_identity_file,
    },
  });
  const workerBuildIdentity = loadRuntimeBuildIdentity({
    expectedRole: "worker",
    environment: {
      ...environment,
      DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE: configuration.worker_build_identity_file,
    },
  });
  const releaseBuildClosure = await verifyReleaseBuildClosure({
    repository_root: REPOSITORY_ROOT,
    source_commit: sourceCommit,
    attestation_file: configuration.build_attestation_file,
    web_build: webBuildIdentity,
    worker_build: workerBuildIdentity,
  });
  const pool = new pg.Pool({
    connectionString: configuration.database_url,
    application_name: `data-agent-falcon24-${configuration.authority_epoch.toLowerCase()}-finalization`,
    max: 4,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 120_000,
  });
  try {
    const sqlPool = adaptPgPool(pool);
    const authority = createPostgresCapabilityAuthority(sqlPool);
    const capability = requireValue(
      await authority.resolveForServerContext({
        deployment_id: configuration.deployment_id,
        tenant_id: configuration.workspace_id,
        principal_id: configuration.principal_id,
        access: "WRITE",
      }),
    );
    if (
      capability.scope.app_id !== APP_ID ||
      capability.scope.environment !== configuration.environment
    ) {
      throw new TypeError("FALCON24_AUTHORITY_FINALIZATION_SCOPE_MISMATCH");
    }
    const epoch = createPostgresFalcon24AuthorityEpoch({
      pool: sqlPool,
      authorizer: authority.authorizer,
    });
    const currentAuthority = requireValue(await epoch.loadCurrent(capability));
    if (currentAuthority?.authority_epoch !== "E3") {
      throw new TypeError("FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR");
    }
    const predecessorReceipts = await loadPredecessorStagingReceipts({
      pool,
      scope: capability.scope,
      authority_epoch: currentAuthority.authority_epoch,
      baseline_id: currentAuthority.baseline_id,
      baseline_hash: currentAuthority.baseline_hash,
    });
    const successorAuthority = createPostgresSemanticSuccessorSmokeAuthority({
      pool: sqlPool,
      authorizer: authority.authorizer,
    });
    const readback = createFalcon24SuccessorFinalizationReadback({
      capability,
      semantic_domain: SEMANTIC_DOMAIN,
      closure_reader: createPostgresFalcon24SemanticClosureReader({
        pool: sqlPool,
        authorizer: authority.authorizer,
      }),
      successor_reader: successorAuthority,
    });
    const before = await readback.loadCurrentClosure();
    if (
      before.scope.app_id !== capability.scope.app_id ||
      before.scope.tenant_id !== capability.scope.tenant_id ||
      before.scope.environment !== capability.scope.environment ||
      before.scope.semantic_domain !== SEMANTIC_DOMAIN ||
      before.authority.authority_epoch !== "E3" ||
      before.authority.baseline_id !== currentAuthority.baseline_id ||
      before.authority.baseline_hash !== currentAuthority.baseline_hash ||
      before.semantic_pointer.release.datasource_id !== configuration.datasource_id
    ) {
      throw new TypeError("FALCON24_SEMANTIC_SUCCESSOR_PREFLIGHT_MISMATCH");
    }
    const supporting = await loadFalcon24E4SupportingAuthorityContext({
      capability,
      defaults_reader: createPostgresEffectiveConfigResolver({
        pool: sqlPool,
        authorizer: authority.authorizer,
      }),
      scope: before.scope,
      expected_semantic_predecessor: {
        release_id: before.semantic_pointer.release.release_id,
        generation: before.semantic_pointer.release.generation,
        release_digest: exactContentHash(before.semantic_pointer.release.release_digest),
      },
      expected_datasource_id: configuration.datasource_id,
      expected_defaults_version: before.workspace_defaults.version,
    });
    if (supporting.schema_snapshot_ref.resource_revision !== 1) {
      throw new TypeError("FALCON24_E4_SUPPORTING_AUTHORITY_INCOMPLETE");
    }
    const sourceSnapshotHash = exactContentHash(supporting.schema_snapshot_ref.resource_hash);
    const compilerBundleHash = await semanticPublicationCompilerBundleDigest();
    const publicationAuthority = createPostgresSemanticPublicationAuthority(pool, {
      appId: capability.scope.app_id,
      workspaceId: capability.scope.tenant_id,
      environment: capability.scope.environment,
      principalId: capability.principal,
      datasourceId: configuration.datasource_id,
      semanticDomain: SEMANTIC_DOMAIN,
    });
    const successorChangeSet = await buildFalcon24SuccessorChangeSet({
      repository_root: REPOSITORY_ROOT,
      scope: before.scope,
      base_release: {
        release_id: before.semantic_pointer.release.release_id,
        generation: before.semantic_pointer.release.generation,
        release_hash: before.semantic_pointer.release.release_digest,
      },
      expected_datasource_id: configuration.datasource_id,
      revision: 1,
    });
    const preparedReview = await publicationAuthority.prepareSuccessorReview({
      idempotency_key: falcon24SuccessorOperationId(
        `falcon24:E4:successor-review:${successorChangeSet.change_set.change_set_hash}`,
      ),
      expected_predecessor: {
        release_id: before.semantic_pointer.release.release_id,
        generation: before.semantic_pointer.release.generation,
        release_digest: before.semantic_pointer.release.release_digest,
      },
      expected_pointer_version: before.semantic_pointer.version,
      change_set: successorChangeSet.change_set,
    });
    const publishPreparationDigest = await sha256ContentHash({
      schema_version: "falcon24-successor-publish-preparation-identity@1.0.0",
      scope: before.scope,
      change_set_ref: preparedReview.change_set_ref,
      review_id: preparedReview.review_packet_ref.review_id,
      compiler_bundle_digest: compilerBundleHash,
      expected_predecessor: before.semantic_pointer.release,
      expected_pointer_version: before.semantic_pointer.version,
      target_generation: 2,
    });
    const approvedSuccessor = await publicationAuthority.prepareApprovedSuccessor({
      review_id: preparedReview.review_packet_ref.review_id,
      change_set_ref: preparedReview.change_set_ref,
      compiler_bundle_digest: compilerBundleHash,
      target_generation: 2,
      idempotency_digest: publishPreparationDigest,
      expected_predecessor: {
        release_id: before.semantic_pointer.release.release_id,
        generation: before.semantic_pointer.release.generation,
        release_digest: before.semantic_pointer.release.release_digest,
      },
      expected_pointer_version: before.semantic_pointer.version,
    });
    const acceptanceContracts = await buildFalcon24AcceptanceContractHashes({
      repository_root: REPOSITORY_ROOT,
      oracle_contract_hash: exactContentHash(retained.analysis_runtime.oracle_contract_hash),
    });
    const stageIdentity = await sha256ContentHash({
      schema_version: "falcon24-e4-successor-finalization-identity@1.0.0",
      scope: before.scope,
      change_set_ref: approvedSuccessor.change_set_ref,
      review_ref: approvedSuccessor.review_ref,
      source_snapshot_ref: {
        snapshot_id: supporting.schema_snapshot_ref.resource_id,
        snapshot_revision: supporting.schema_snapshot_ref.resource_revision,
        snapshot_hash: sourceSnapshotHash,
      },
      compiler_bundle_ref: {
        compiler_version: SEMANTIC_PUBLICATION_COMPILER_VERSION,
        compiler_bundle_hash: compilerBundleHash,
      },
      expected_predecessor: before.semantic_pointer.release,
      expected_pointer_version: before.semantic_pointer.version,
      target_generation: 2,
    });
    let supportingProofs: unknown;
    let team: unknown;
    const stageSupportingReceipts = async () => {
      const dataset = await stageDatasetReceipt({
        authority_epoch: configuration.authority_epoch,
        staging_id: configuration.staging_id,
        retained: retainedE1,
        predecessor_receipts: predecessorReceipts,
        pool,
        capability,
        epoch,
      });
      const model = await stageModelReceipt({
        authority_epoch: configuration.authority_epoch,
        staging_id: configuration.staging_id,
        retained: retainedE1,
        predecessor_receipts: predecessorReceipts,
        sql_pool: sqlPool,
        deployment_id: configuration.deployment_id,
        principal_id: configuration.principal_id,
        capability,
        epoch,
      });
      const runtime = await stageRuntimeReceipts({
        authority_epoch: configuration.authority_epoch,
        staging_id: configuration.staging_id,
        retained: retainedE1,
        runtime_attestation: runtimeAttestation,
        predecessor_receipts: predecessorReceipts,
        capability,
        epoch,
      });
      const materializationInput = await resolveBuiltinTeamMaterializationInput({
        pool: sqlPool,
        capability,
        deployment_id: configuration.deployment_id,
        context_policy_ref: supporting.context_policy_ref,
        execution_safety_policy_ref: supporting.execution_safety_policy_ref,
      });
      const built = await buildBuiltinTeamMaterialization(materializationInput);
      const agentProfiles = await stageAgentProfileReceipt({
        authority_epoch: configuration.authority_epoch,
        staging_id: configuration.staging_id,
        built,
        materialization_input: materializationInput,
        worker_build: workerBuildIdentity,
        capability,
        epoch,
      });
      const skills = createPostgresSkillRegistry({
        pool: sqlPool,
        authorizer: authority.authorizer,
      });
      const profiles = createPostgresAgentProfileRegistry({
        pool: sqlPool,
        authorizer: authority.authorizer,
      });
      requireValue(
        await materializeBuiltinTeamProfiles(
          {
            ...materializationInput,
            capability_input: capability,
            actor_principal_id: capability.principal,
            create_operation_id: (material) =>
              stableUuid(
                `falcon24:${configuration.authority_epoch}:team-materialization:${material}`,
              ),
            idempotency_prefix: `falcon24:${configuration.authority_epoch}:builtin-team:v2`,
          },
          { skills, profiles },
        ),
      );
      const [profileItems, skillItems] = await Promise.all([
        profiles.listManagedV2(capability).then(requireValue),
        skills.list(capability, false).then(requireValue),
      ]);
      team = await verifyCurrentBuiltinTeamAuthority({
        materialization_input: materializationInput,
        profile_items: profileItems,
        skill_items: skillItems,
      });
      supportingProofs = Object.freeze({
        dataset,
        llm_configuration: model,
        agent_profiles: {
          receipt: agentProfiles.receipt,
          subject_hash: agentProfiles.subject_hash,
          evidence_hash: agentProfiles.evidence_hash,
        },
        runtime,
      });
      return Object.freeze([
        dataset.receipt,
        model.receipt,
        agentProfiles.receipt,
        runtime.operator,
        runtime.sandbox,
      ]);
    };
    const result = await finalizeFalcon24SemanticSuccessor({
      stage_command: {
        schema_version: "stage-reviewed-semantic-successor-command@1.0.0",
        command_id: stableUuid(`falcon24:E4:semantic-stage:${stageIdentity}`),
        idempotency_key: stableUuid(`falcon24:E4:semantic-stage-idempotency:${stageIdentity}`),
        scope: before.scope,
        change_set_ref: approvedSuccessor.change_set_ref,
        review_ref: approvedSuccessor.review_ref,
        source_snapshot_ref: {
          snapshot_id: supporting.schema_snapshot_ref.resource_id,
          snapshot_revision: supporting.schema_snapshot_ref.resource_revision,
          snapshot_hash: sourceSnapshotHash,
        },
        compiler_bundle_ref: {
          compiler_version: SEMANTIC_PUBLICATION_COMPILER_VERSION,
          compiler_bundle_hash: compilerBundleHash,
        },
        expected_predecessor: {
          release_id: before.semantic_pointer.release.release_id,
          generation: before.semantic_pointer.release.generation,
          release_digest: before.semantic_pointer.release.release_digest,
        },
        expected_pointer_version: before.semantic_pointer.version,
        target_generation: 2,
      },
      smoke_idempotency_key: await buildFalcon24SuccessorSmokeIdempotencyKey({
        stage_identity: stageIdentity,
        worker_build_identity: workerBuildIdentity,
      }),
      worker_build_identity: workerBuildIdentity,
      smoke_capability: capability,
      activation: {
        command_id: stableUuid(`falcon24:E4:combined-activation:${stageIdentity}`),
        idempotency_key: stableUuid(`falcon24:E4:combined-activation-idempotency:${stageIdentity}`),
      },
      publication_authority: publicationAuthority,
      smoke: createFalcon24SuccessorSmokeProcess({
        repository_root: REPOSITORY_ROOT,
        database_url: configuration.database_url,
        deployment_id: configuration.deployment_id,
        tenant_id: configuration.workspace_id,
        principal_id: configuration.principal_id,
        worker_build_identity_file: configuration.worker_build_identity_file,
        environment,
      }),
      stage_falcon_authority: async ({ stage, semantic_proof: semanticProof }) =>
        stageFalcon24E4SuccessorAuthority({
          capability,
          epoch,
          stage: stage.stage,
          semantic_proof: semanticProof,
          staging_id: configuration.staging_id,
          retained_assets_hash: exactContentHash(retained.manifest_hash),
          source_commit: sourceCommit,
          web_build_hash: webBuildIdentity.build_id,
          acceptance_contracts: acceptanceContracts,
          production_isolation_proven: runtimeAttestation.production_isolation_proven,
          production_gate: runtimeAttestation.production_gate,
          stage_supporting_receipts: stageSupportingReceipts,
        }),
      readback,
    });
    if (!supportingProofs || !team) {
      throw new TypeError("FALCON24_AUTHORITY_STAGING_INCOMPLETE");
    }
    return Object.freeze({
      schema_version: "falcon24-authority-finalization-result@2.0.0" as const,
      authority_epoch: configuration.authority_epoch,
      terminal: "ACTIVE" as const,
      authority: result.readback.authority,
      source_commit: sourceCommit,
      web_build: {
        build_id: webBuildIdentity.build_id,
        generation_id: webBuildIdentity.generation_id,
      },
      worker_build: {
        build_id: workerBuildIdentity.build_id,
        generation_id: workerBuildIdentity.generation_id,
      },
      release_build_closure: releaseBuildClosure,
      staging_id: configuration.staging_id,
      semantic_successor: {
        stage_ref: {
          stage_id: result.stage.stage.stage_id,
          stage_digest: result.stage.stage.stage_digest,
        },
        candidate_release: result.stage.stage.candidate_release,
        validation_receipt_hash: result.validation_receipt.validation_receipt_hash,
        smoke_receipt_hash: result.smoke_receipt.smoke_receipt_hash,
        semantic_proof_hash: result.semantic_proof.proof_hash,
        activation_receipt_hash: result.activation_receipt.activation_receipt_hash,
      },
      staging_proofs: supportingProofs,
      schema_snapshot: supporting.schema_snapshot_ref,
      workspace_defaults: result.readback.workspace_defaults,
      builtin_team: team,
      production_readiness: runtimeAttestation.production_gate,
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  let environment: NodeJS.ProcessEnv = process.env;
  try {
    environment = loadRuntimeEnvironment({
      cwd: REPOSITORY_ROOT,
      environment: process.env,
    }).environment;
    Object.assign(process.env, environment);
    const result = await runFalcon24AuthorityFinalization(environment);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.terminal === "NOT_RUN") process.exitCode = 2;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "falcon24-authority-finalization-result@2.0.0",
        authority_epoch: reportedAuthorityEpoch(environment),
        terminal: "HOLD",
        reason_code: stableFailureCode(error),
        production_readiness: "HOLD",
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1]?.endsWith("finalize-falcon24-authority.ts") ||
  process.argv[1]?.endsWith("finalize-falcon24-authority.js")
) {
  await main();
}
