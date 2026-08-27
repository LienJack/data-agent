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
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24AuthorityBaselineV2,
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
  FALCON24_TARGET_AUTHORITY_EPOCH,
  type Falcon24StagingReceiptV2,
  falcon24AuthorityEpochOrdinal,
  falcon24SuccessorAuthorityEpochSchema,
  verifyFalcon24E1StagingReceipt,
  verifyFalcon24StagingReceiptV2,
} from "@data-agent/contracts/runs";
import { loadRuntimeBuildIdentity } from "@data-agent/contracts/server";
import {
  buildWorkspaceDefaultsCasUpdateCommandCandidate,
  type VersionedResourceReference,
} from "@data-agent/contracts/workspaces";
import { createPostgresAgentProfileRegistry } from "@data-agent/platform/agents";
import {
  adaptPgCatalogPool,
  createPostgresCatalogScanner,
  createPostgresSchemaSnapshotStore,
  verifyFalcon24CatalogInventory,
} from "@data-agent/platform/catalog";
import { createPostgresSkillRegistry } from "@data-agent/platform/extensions";
import { createPostgresModelControlRepository } from "@data-agent/platform/models";
import { adaptPgPool } from "@data-agent/platform/persistence";
import {
  createPostgresEffectiveConfigResolver,
  createPostgresFalcon24AuthorityEpoch,
} from "@data-agent/platform/runs";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import {
  buildFalcon24ModelAuthorityProof,
  buildFalcon24SemanticReleaseAuthorityProof,
  createPostgresGreenfieldBootstrapReleaseAuthority,
} from "@data-agent/platform/semantic-postgres";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
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
  BUILTIN_TEAM_ROLE_MODEL_IDS,
  resolveBuiltinTeamMaterializationInput,
  verifyCurrentBuiltinTeamAuthority,
} from "../lib/builtin-team-authority";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_AUTHORITY_ACTIVATION";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-00000000e124";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-00000000e125";
const DEFAULT_STAGING_ID = "00000000-0000-4000-8000-00000000e230";
const DEFAULT_DATASOURCE_ID = "37653002-af62-53c9-bf21-519468aa39ab";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const execFileAsync = promisify(execFile);

const configurationSchema = z.strictObject({
  database_url: z.string().min(1),
  authority_epoch: falcon24SuccessorAuthorityEpochSchema,
  deployment_id: z.uuid(),
  workspace_id: z.uuid(),
  principal_id: z.uuid(),
  staging_id: z.uuid(),
  datasource_id: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  reader_password: z.string().min(1).max(1_024),
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
  const parsed = falcon24SuccessorAuthorityEpochSchema.safeParse(
    environment.FALCON24_AUTHORITY_EPOCH ?? FALCON24_TARGET_AUTHORITY_EPOCH,
  );
  return parsed.success ? parsed.data : FALCON24_TARGET_AUTHORITY_EPOCH;
}

function sameReference(
  actual: VersionedResourceReference | null,
  expected: { readonly resource_id: string; readonly resource_revision: number },
): boolean {
  return (
    actual?.resource_id === expected.resource_id &&
    actual.resource_revision === expected.resource_revision
  );
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

type HistoricalStagingReceipt = Awaited<ReturnType<typeof verifyFalcon24E1StagingReceipt>>;

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
  if (input.authority_epoch !== "E1") {
    throw new TypeError("FALCON24_AUTHORITY_PREDECESSOR_E1_REQUIRED");
  }
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
    const receipt = await verifyFalcon24E1StagingReceipt(row.receipt_document);
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
  readonly oracle_contract_hash: string;
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
  if (
    historicalImport.status !== "READY" ||
    historicalImport.receipt_hash !== predecessor.subject_hash ||
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

async function stageSemanticReleaseReceipt(input: {
  readonly authority_epoch: z.infer<typeof falcon24SuccessorAuthorityEpochSchema>;
  readonly staging_id: string;
  readonly retained: Awaited<ReturnType<typeof verifyFalcon24RetainedAssetsManifest>>;
  readonly predecessor_receipts: ReadonlyMap<
    Falcon24StagingReceiptV2["component"],
    HistoricalStagingReceipt
  >;
  readonly pool: pg.Pool;
  readonly sql_pool: ReturnType<typeof adaptPgPool>;
  readonly authorizer: ReturnType<typeof createPostgresCapabilityAuthority>["authorizer"];
  readonly capability: Parameters<typeof resolveBuiltinTeamMaterializationInput>[0]["capability"];
  readonly epoch: ReturnType<typeof createPostgresFalcon24AuthorityEpoch>;
}) {
  for (const source of input.retained.semantics.source_files) {
    if (rawHash(resolve(REPOSITORY_ROOT, source.path)) !== source.hash) {
      throw new TypeError("FALCON24_SEMANTIC_RETAINED_SOURCE_DRIFT");
    }
  }
  if (
    (await sha256ContentHash(input.retained.semantics.source_files)) !==
    input.retained.semantics.source_bundle_hash
  ) {
    throw new TypeError("FALCON24_SEMANTIC_SOURCE_BUNDLE_MISMATCH");
  }
  const releaseResult = await input.pool.query<{
    readonly release_set_id: string;
    readonly release_set_hash: `sha256:${string}`;
    readonly definition_keys: string[];
  }>(
    `select release.release_set_id::text,release.release_set_hash,
            array(select assertion->>'canonical_key'
                    from pg_catalog.jsonb_array_elements(source.source_payload->'assertions')
                      assertion
                   order by assertion->>'canonical_key') as definition_keys
       from semantic.semantic_active_pointer pointer
       join semantic.initial_semantic_release_sets release
         on release.app_id=pointer.app_id and release.tenant_id=pointer.tenant_id
        and release.environment=pointer.environment
        and release.semantic_domain=pointer.semantic_domain
        and release.release_id=pointer.current_release_id
       join semantic.semantic_candidate_revision revision
         on revision.app_id=release.app_id and revision.tenant_id=release.tenant_id
        and revision.environment=release.environment
        and revision.semantic_domain=release.semantic_domain
        and revision.candidate_id=release.candidate_id
        and revision.revision_id=release.candidate_revision_id
       join semantic.semantic_source_revision source
         on source.app_id=revision.app_id and source.tenant_id=revision.tenant_id
        and source.environment=revision.environment
        and source.semantic_domain=revision.semantic_domain
        and source.revision_id=revision.source_revision_id
      where pointer.app_id=$1::uuid and pointer.tenant_id=$2::uuid
        and pointer.environment=$3::text and pointer.semantic_domain='falcon24'
        and pointer.current_release_generation=1
        and pointer.current_release_digest=release.release_set_hash`,
    [
      input.capability.scope.app_id,
      input.capability.scope.tenant_id,
      input.capability.scope.environment,
    ],
  );
  const release = releaseResult.rows[0];
  if (releaseResult.rowCount !== 1 || !release) {
    throw new TypeError("FALCON24_SEMANTIC_RELEASE_REQUIRED");
  }
  const authority = createPostgresGreenfieldBootstrapReleaseAuthority({
    verifier_pool: input.sql_pool,
    publisher_pool: input.sql_pool,
    authorizer: input.authorizer,
  });
  const loaded = requireValue(
    await authority.loadInitial(input.capability, {
      schema_version: "load-initial-semantic-release-command@1.0.0",
      scope: {
        app_id: input.capability.scope.app_id,
        tenant_id: input.capability.scope.tenant_id,
        workspace_id: input.capability.scope.tenant_id,
        environment: input.capability.scope.environment,
      },
      semantic_domain: "falcon24",
      release_set_ref: {
        release_set_id: release.release_set_id,
        release_set_hash: release.release_set_hash,
      },
    }),
  );
  const proof = await buildFalcon24SemanticReleaseAuthorityProof({
    retained_semantics: input.retained.semantics,
    definition_keys: release.definition_keys,
    loaded_release: loaded,
  });
  const predecessor = requirePredecessorReceipt(input.predecessor_receipts, "SEMANTIC_RELEASE");
  if (
    proof.subject_hash !== predecessor.subject_hash ||
    proof.evidence_hash !== predecessor.evidence_hash
  ) {
    throw new TypeError("FALCON24_SEMANTIC_PREDECESSOR_PROOF_MISMATCH");
  }
  const receipt = await recordStagingReceipt({
    authority_epoch: input.authority_epoch,
    staging_id: input.staging_id,
    component: "SEMANTIC_RELEASE",
    subject_hash: proof.subject_hash,
    evidence_hash: proof.evidence_hash,
    production_isolation_proven: false,
    capability: input.capability,
    epoch: input.epoch,
  });
  return Object.freeze({ receipt, ...proof });
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

async function ensureSchemaSnapshot(input: {
  readonly authority_epoch: string;
  readonly pool: pg.Pool;
  readonly reader_pool: pg.Pool;
  readonly sql_pool: ReturnType<typeof adaptPgPool>;
  readonly capability: Parameters<
    ReturnType<typeof createPostgresSchemaSnapshotStore>["commitSuccess"]
  >[0];
  readonly authorizer: ReturnType<typeof createPostgresCapabilityAuthority>["authorizer"];
  readonly datasource_id: string;
  readonly datasource_fingerprint: `sha256:${string}`;
}) {
  const current = await input.pool.query<{
    snapshot_id: string;
    snapshot_content_hash: `sha256:${string}`;
  }>(
    `select snapshot_id::text,snapshot_content_hash
       from catalog.schema_scan_run
      where datasource_id=$1::text and datasource_fingerprint=$2::text
        and terminal='SUCCEEDED' and snapshot_id is not null
      order by committed_at desc limit 1`,
    [input.datasource_id, input.datasource_fingerprint],
  );
  const existing = current.rows[0];
  if (existing) return { ...existing, created: false as const };
  const scanRunId = stableUuid(
    `falcon24:${input.authority_epoch}:schema-scan:${input.datasource_fingerprint}`,
  );
  const snapshotId = stableUuid(
    `falcon24:${input.authority_epoch}:schema-snapshot:${input.datasource_fingerprint}`,
  );
  const request = {
    schema_version: "schema-scan-request@1.0.0" as const,
    datasource_id: input.datasource_id,
    include_schemas: ["falcon_db_24"],
    page_size: 1_000,
    statement_timeout_ms: 60_000,
    idempotency_key: scanRunId,
  };
  const snapshot = requireValue(
    await createPostgresCatalogScanner(adaptPgCatalogPool(input.reader_pool)).scan({
      request,
      datasource_fingerprint: input.datasource_fingerprint,
      snapshot_id: snapshotId,
      scan_run_id: scanRunId,
      captured_at: new Date().toISOString(),
    }),
  );
  const committed = requireValue(
    await createPostgresSchemaSnapshotStore({
      pool: input.sql_pool,
      authorizer: input.authorizer,
    }).commitSuccess(input.capability, request, snapshot),
  );
  if (
    committed.terminal !== "SUCCEEDED" ||
    !committed.snapshot_id ||
    !committed.snapshot_content_hash
  ) {
    throw new TypeError("FALCON24_AUTHORITY_SCHEMA_SNAPSHOT_COMMIT_FAILED");
  }
  return {
    snapshot_id: committed.snapshot_id,
    snapshot_content_hash: committed.snapshot_content_hash,
    created: committed.created,
  };
}

async function prepareWorkspaceAuthority(input: {
  readonly authority_epoch: string;
  readonly pool: pg.Pool;
  readonly sql_pool: ReturnType<typeof adaptPgPool>;
  readonly capability: Parameters<typeof resolveBuiltinTeamMaterializationInput>[0]["capability"];
  readonly authorizer: ReturnType<typeof createPostgresCapabilityAuthority>["authorizer"];
  readonly deployment_id: string;
  readonly staging_id: string;
  readonly datasource_id: string;
  readonly reader_password: string;
}) {
  const resources = await input.pool.query<{
    datasource_id: string;
    datasource_revision: string;
    host: string;
    port: number;
    database_name: string;
    username: string;
    schema_name: string;
    semantic_id: string;
    semantic_revision: string;
    dataset_subject_hash: `sha256:${string}`;
    dataset_evidence_hash: `sha256:${string}`;
    context_policy: VersionedResourceReference;
    egress_policy: VersionedResourceReference;
    safety_policy: VersionedResourceReference;
  }>(
    `select datasource.datasource_id::text,
            datasource.resource_version::text as datasource_revision,
            datasource.host,datasource.port,datasource.database_name,datasource.username,
            datasource.schema_name,pointer.current_release_id::text as semantic_id,
            pointer.current_release_generation::text as semantic_revision,
            receipt.subject_hash as dataset_subject_hash,
            receipt.evidence_hash as dataset_evidence_hash,
            app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY')
              - array['max_context_tokens','max_resource_bindings'] as context_policy,
            app_data_agent.builtin_effective_config_policy('EGRESS_POLICY')
              - array['allowed_providers','allowed_audiences','classification'] as egress_policy,
            app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY')
              - array['max_tool_calls','max_provider_calls','max_elapsed_ms'] as safety_policy
       from app_data_agent.datasource_connections datasource
       join semantic.semantic_domain_registry domain
         on domain.app_id=datasource.app_id and domain.tenant_id=datasource.tenant_id
        and domain.environment=datasource.environment and domain.datasource_id=datasource.datasource_id
        and domain.semantic_domain='falcon24' and domain.is_active
       join semantic.semantic_active_pointer pointer
         on pointer.app_id=domain.app_id and pointer.tenant_id=domain.tenant_id
        and pointer.environment=domain.environment and pointer.semantic_domain=domain.semantic_domain
        and pointer.current_release_id is not null
       join app_data_agent.falcon24_authority_staging_receipts receipt
         on receipt.app_id=datasource.app_id and receipt.tenant_id=datasource.tenant_id
        and receipt.environment=datasource.environment and receipt.staging_id=$4::uuid
        and receipt.authority_epoch=$6::text and receipt.component='DATASET'
      where datasource.app_id=$1::uuid and datasource.tenant_id=$2::uuid
        and datasource.environment=$3::text and datasource.datasource_id=$5::uuid
        and datasource.status='ACTIVE' and datasource.username='falcon_demo_reader'
        and datasource.schema_name='falcon_db_24'`,
    [
      input.capability.scope.app_id,
      input.capability.scope.tenant_id,
      input.capability.scope.environment,
      input.staging_id,
      input.datasource_id,
      input.authority_epoch,
    ],
  );
  const resource = resources.rows[0];
  if (resources.rowCount !== 1 || !resource) {
    throw new TypeError("FALCON24_AUTHORITY_WORKSPACE_RESOURCES_REQUIRED");
  }
  const datasourceFingerprint = await sha256ContentHash({
    schema_version: "falcon24-datasource-fingerprint@2.0.0",
    authority_epoch: input.authority_epoch,
    datasource_id: resource.datasource_id,
    datasource_revision: Number(resource.datasource_revision),
    dataset_subject_hash: resource.dataset_subject_hash,
    catalog_inventory_hash: resource.dataset_evidence_hash,
    host: resource.host,
    port: resource.port,
    database_name: resource.database_name,
    schema_name: resource.schema_name,
  });
  const readerPool = new pg.Pool({
    host: resource.host,
    port: resource.port,
    database: resource.database_name,
    user: resource.username,
    password: input.reader_password,
    ssl: false,
    application_name: `data-agent-falcon24-${input.authority_epoch.toLowerCase()}-final-schema-scan`,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 65_000,
    max: 1,
  });
  try {
    const snapshot = await ensureSchemaSnapshot({
      authority_epoch: input.authority_epoch,
      pool: input.pool,
      reader_pool: readerPool,
      sql_pool: input.sql_pool,
      capability: input.capability,
      authorizer: input.authorizer,
      datasource_id: input.datasource_id,
      datasource_fingerprint: datasourceFingerprint,
    });
    const baseModels = await input.pool.query<{
      model_profile_id: string;
      config_version: string;
    }>(
      `select model.model_profile_id::text,model.config_version::text
         from app_data_agent.model_catalog_entries model
        where model.app_id=$1::uuid and model.environment=$2::text
          and model.status='ACTIVE' and model.is_system_default
          and model.api_authenticated_config_version=model.config_version
          and model.api_authenticated_at is not null
          and not (model.model_profile_id=any($3::uuid[]))
        order by model.config_version desc,model.model_profile_id limit 1`,
      [
        input.capability.scope.app_id,
        input.capability.scope.environment,
        Object.values(BUILTIN_TEAM_ROLE_MODEL_IDS),
      ],
    );
    const baseModel = baseModels.rows[0];
    if (!baseModel) throw new TypeError("FALCON24_AUTHORITY_AUTHENTICATED_MODEL_REQUIRED");
    const defaults = createPostgresEffectiveConfigResolver({
      pool: input.sql_pool,
      authorizer: input.authorizer,
    });
    const existing = requireValue(await defaults.getWorkspaceDefaults(input.capability));
    const expected = {
      model: {
        resource_id: baseModel.model_profile_id,
        resource_revision: Number(baseModel.config_version),
      },
      datasource: {
        resource_id: resource.datasource_id,
        resource_revision: Number(resource.datasource_revision),
      },
      semantic: {
        resource_id: resource.semantic_id,
        resource_revision: Number(resource.semantic_revision),
      },
      snapshot: { resource_id: snapshot.snapshot_id, resource_revision: 1 },
    };
    const alreadyReady =
      existing !== null &&
      sameReference(existing.revision.defaults.model, expected.model) &&
      sameReference(existing.revision.defaults.datasource, expected.datasource) &&
      sameReference(existing.revision.defaults.semantic_release, expected.semantic) &&
      sameReference(existing.revision.defaults.schema_snapshot, expected.snapshot) &&
      sameReference(existing.revision.defaults.context_policy, resource.context_policy) &&
      sameReference(existing.revision.defaults.egress_policy, resource.egress_policy) &&
      sameReference(existing.revision.defaults.execution_safety_policy, resource.safety_policy) &&
      existing.revision.defaults.files.length === 0 &&
      existing.revision.defaults.knowledge.length === 0 &&
      existing.revision.defaults.mcp_servers.length === 0 &&
      existing.revision.defaults.skills.length === 0;
    const defaultsRevision = alreadyReady
      ? existing.revision
      : requireValue(
          await defaults.updateWorkspaceDefaults(
            input.capability,
            await buildWorkspaceDefaultsCasUpdateCommandCandidate({
              schema_version: "workspace-defaults-cas-update@1.0.0",
              operation_id: stableUuid(
                `falcon24:${input.authority_epoch}:defaults:${input.capability.scope.tenant_id}:${(existing?.revision.defaults_revision ?? 0) + 1}`,
              ),
              workspace_id: input.capability.scope.tenant_id,
              expected_defaults_revision: existing?.revision.defaults_revision ?? 0,
              idempotency_key: stableUuid(
                `falcon24:${input.authority_epoch}:defaults-request:${input.capability.scope.tenant_id}:${(existing?.revision.defaults_revision ?? 0) + 1}`,
              ),
              defaults: {
                model: {
                  resource_id: expected.model.resource_id,
                  expected_revision: expected.model.resource_revision,
                },
                datasource: {
                  resource_id: expected.datasource.resource_id,
                  expected_revision: expected.datasource.resource_revision,
                },
                files: [],
                knowledge: [],
                mcp_servers: [],
                skills: [],
                semantic_release: {
                  resource_id: expected.semantic.resource_id,
                  expected_revision: expected.semantic.resource_revision,
                },
                schema_snapshot: {
                  resource_id: expected.snapshot.resource_id,
                  expected_revision: expected.snapshot.resource_revision,
                },
                context_policy: {
                  resource_id: resource.context_policy.resource_id,
                  expected_revision: resource.context_policy.resource_revision,
                },
                egress_policy: {
                  resource_id: resource.egress_policy.resource_id,
                  expected_revision: resource.egress_policy.resource_revision,
                },
                execution_safety_policy: {
                  resource_id: resource.safety_policy.resource_id,
                  expected_revision: resource.safety_policy.resource_revision,
                },
              },
            }),
          ),
        ).revision;
    return {
      snapshot,
      defaults: defaultsRevision,
      context_policy: resource.context_policy,
      safety_policy: resource.safety_policy,
    };
  } finally {
    await readerPool.end();
  }
}

export async function runFalcon24AuthorityFinalization(
  environment: NodeJS.ProcessEnv = loadRuntimeEnvironment().environment,
) {
  const authorityEpoch = falcon24SuccessorAuthorityEpochSchema.parse(
    environment.FALCON24_AUTHORITY_EPOCH ?? FALCON24_TARGET_AUTHORITY_EPOCH,
  );
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
    reader_password: environment.FALCON_READER_PASSWORD,
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
  let activationAttempt:
    | {
        schema_version: "falcon24-activation-request@2.0.0";
        authority_epoch: string;
        attempt_id: string;
        baseline_id: string;
        expected_baseline_hash: string;
      }
    | undefined;
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
    if (
      !currentAuthority ||
      falcon24AuthorityEpochOrdinal(configuration.authority_epoch) !==
        falcon24AuthorityEpochOrdinal(currentAuthority.authority_epoch) + 1n
    ) {
      throw new TypeError("FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR");
    }
    const predecessorReceipts = await loadPredecessorStagingReceipts({
      pool,
      scope: capability.scope,
      authority_epoch: currentAuthority.authority_epoch,
      baseline_id: currentAuthority.baseline_id,
      baseline_hash: currentAuthority.baseline_hash,
    });
    requireValue(
      await epoch.beginStaging(capability, {
        schema_version: "falcon24-staging-session@2.0.0",
        authority_epoch: configuration.authority_epoch,
        staging_id: configuration.staging_id,
        retained_assets_hash: retained.manifest_hash,
      }),
    );
    const datasetProof = await stageDatasetReceipt({
      authority_epoch: configuration.authority_epoch,
      staging_id: configuration.staging_id,
      retained: retainedE1,
      predecessor_receipts: predecessorReceipts,
      pool,
      capability,
      epoch,
    });
    const workspace = await prepareWorkspaceAuthority({
      authority_epoch: configuration.authority_epoch,
      pool,
      sql_pool: sqlPool,
      capability,
      authorizer: authority.authorizer,
      deployment_id: configuration.deployment_id,
      staging_id: configuration.staging_id,
      datasource_id: configuration.datasource_id,
      reader_password: configuration.reader_password,
    });
    const semanticProof = await stageSemanticReleaseReceipt({
      authority_epoch: configuration.authority_epoch,
      staging_id: configuration.staging_id,
      retained: retainedE1,
      predecessor_receipts: predecessorReceipts,
      pool,
      sql_pool: sqlPool,
      authorizer: authority.authorizer,
      capability,
      epoch,
    });
    const modelProof = await stageModelReceipt({
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
    const runtimeProof = await stageRuntimeReceipts({
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
      context_policy_ref: workspace.context_policy,
      execution_safety_policy_ref: workspace.safety_policy,
    });
    const built = await buildBuiltinTeamMaterialization(materializationInput);
    const agentProfileProof = await stageAgentProfileReceipt({
      authority_epoch: configuration.authority_epoch,
      staging_id: configuration.staging_id,
      built,
      materialization_input: materializationInput,
      worker_build: workerBuildIdentity,
      capability,
      epoch,
    });
    const receiptsResult = await pool.query<{ component: string; receipt_document: unknown }>(
      `select component,receipt_document
         from app_data_agent.falcon24_authority_staging_receipts
        where app_id=$1::uuid and tenant_id=$2::uuid and environment=$3::text
          and staging_id=$4::uuid and authority_epoch=$5::text order by component`,
      [
        capability.scope.app_id,
        capability.scope.tenant_id,
        capability.scope.environment,
        configuration.staging_id,
        configuration.authority_epoch,
      ],
    );
    if (receiptsResult.rows.length !== 6) {
      throw new TypeError("FALCON24_AUTHORITY_STAGING_INCOMPLETE");
    }
    const receiptEntries = await Promise.all(
      receiptsResult.rows.map(async ({ component, receipt_document: document }) => {
        const receipt = await verifyFalcon24StagingReceiptV2(document);
        if (
          receipt.component !== component ||
          receipt.authority_epoch !== configuration.authority_epoch ||
          receipt.staging_id !== configuration.staging_id
        ) {
          throw new TypeError("FALCON24_AUTHORITY_STAGING_RECEIPT_IDENTITY_MISMATCH");
        }
        return [receipt.component, receipt] as const;
      }),
    );
    const receipts = new Map(receiptEntries);
    if (
      receipts.get("AGENT_PROFILES")?.subject_hash !== agentProfileProof.subject_hash ||
      receipts.get("AGENT_PROFILES")?.evidence_hash !== agentProfileProof.evidence_hash
    ) {
      throw new TypeError("FALCON24_AUTHORITY_AGENT_PROFILE_RECEIPT_MISMATCH");
    }
    const skills = createPostgresSkillRegistry({ pool: sqlPool, authorizer: authority.authorizer });
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
    const team = await verifyCurrentBuiltinTeamAuthority({
      materialization_input: materializationInput,
      profile_items: profileItems,
      skill_items: skillItems,
    });
    const receiptHash = (component: Falcon24StagingReceiptV2["component"]): string => {
      const receipt = receipts.get(component);
      if (!receipt) throw new TypeError("FALCON24_AUTHORITY_STAGING_INCOMPLETE");
      return receipt.receipt_hash;
    };
    const acceptanceContracts = await buildFalcon24AcceptanceContractHashes({
      repository_root: REPOSITORY_ROOT,
      oracle_contract_hash: retained.analysis_runtime.oracle_contract_hash,
    });
    const baselineId = stableUuid(
      `falcon24:${configuration.authority_epoch}:baseline:${sourceCommit}:${webBuildIdentity.build_id}:${workerBuildIdentity.build_id}:${configuration.staging_id}`,
    );
    const baseline = await buildFalcon24AuthorityBaselineV2({
      schema_version: "falcon24-authority-baseline@2.0.0",
      baseline_id: baselineId,
      authority_epoch: configuration.authority_epoch,
      source_commit: sourceCommit,
      retained_assets_hash: retained.manifest_hash,
      web_build_hash: webBuildIdentity.build_id,
      staging_receipts: {
        dataset: receiptHash("DATASET"),
        semantic_release: receiptHash("SEMANTIC_RELEASE"),
        llm_configuration: receiptHash("LLM_CONFIGURATION"),
        agent_profiles: receiptHash("AGENT_PROFILES"),
        operator_registry: receiptHash("OPERATOR_REGISTRY"),
        sandbox_runtime: receiptHash("SANDBOX_RUNTIME"),
      },
      acceptance_contracts: acceptanceContracts,
      production_isolation_proven: runtimeAttestation.production_isolation_proven,
      production_gate: runtimeAttestation.production_gate,
    });
    requireValue(
      await epoch.stageBaseline(capability, {
        schema_version: "falcon24-stage-baseline-request@2.0.0",
        authority_epoch: configuration.authority_epoch,
        staging_id: configuration.staging_id,
        baseline,
      }),
    );
    activationAttempt = {
      schema_version: "falcon24-activation-request@2.0.0",
      authority_epoch: configuration.authority_epoch,
      attempt_id: stableUuid(
        `falcon24:${configuration.authority_epoch}:activation:${baseline.baseline_hash}`,
      ),
      baseline_id: baseline.baseline_id,
      expected_baseline_hash: baseline.baseline_hash,
    };
    requireValue(await epoch.beginActivationAttempt(capability, activationAttempt));
    const binding = requireValue(await epoch.activate(capability, activationAttempt));
    return Object.freeze({
      schema_version: "falcon24-authority-finalization-result@2.0.0" as const,
      authority_epoch: configuration.authority_epoch,
      terminal: "ACTIVE" as const,
      authority: binding,
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
      staging_proofs: {
        dataset: datasetProof,
        semantic_release: semanticProof,
        llm_configuration: modelProof,
        agent_profiles: {
          receipt: agentProfileProof.receipt,
          subject_hash: agentProfileProof.subject_hash,
          evidence_hash: agentProfileProof.evidence_hash,
        },
        runtime: runtimeProof,
      },
      schema_snapshot: workspace.snapshot,
      workspace_defaults: {
        defaults_id: workspace.defaults.defaults_id,
        defaults_revision: workspace.defaults.defaults_revision,
        defaults_hash: workspace.defaults.defaults_hash,
      },
      builtin_team: team,
      production_readiness: baseline.production_gate,
    });
  } catch (error) {
    if (activationAttempt) {
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
        await createPostgresFalcon24AuthorityEpoch({
          pool: sqlPool,
          authorizer: authority.authorizer,
        }).holdActivationAttempt(capability, {
          ...activationAttempt,
          failure_code: stableFailureCode(error),
        });
      } catch {
        // The original error is the authoritative failure; a terminal attempt may already be closed.
      }
    }
    throw error;
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
