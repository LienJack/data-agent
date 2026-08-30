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
  verifyFalcon24FourLayerBusinessReceipt,
  verifyFalcon24FourLayerGateManifest,
  verifyFalcon24FourLayerQaUiReceipt,
  verifyFalcon24FourLayerTerminalReceipt,
  verifyFalcon24FourLayerTraceUiReceipt,
  verifyFalcon24RetainedAssetsManifest,
} from "@data-agent/contracts/evals";
import {
  buildFalcon24StagingReceiptV2,
  type Falcon24E1StagingReceipt,
  type Falcon24LlmExecutionAuthorityProof,
  type Falcon24StagingReceiptV2,
  falcon24AuthorityBindingV2Schema,
  falcon24AuthorityEpochOrdinal,
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
import { createPostgresProviderInvocationStore } from "@data-agent/platform/providers";
import {
  createPostgresEffectiveConfigResolver,
  createPostgresFalcon24AuthorityEpoch,
  createPostgresFalcon24DiagnosticAuthority,
  createPostgresFalcon24FourLayerGateAuthority,
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
import { finalizeFalcon24RetainedAuthority } from "../lib/falcon24-retained-finalization";
import {
  stageFalcon24E4SuccessorAuthority,
  stageFalcon24RetainedAuthority,
} from "../lib/falcon24-successor-authority-staging";
import {
  buildFalcon24SuccessorChangeSet,
  falcon24SuccessorOperationId,
} from "../lib/falcon24-successor-change-set";
import { finalizeFalcon24SemanticSuccessor } from "../lib/falcon24-successor-finalization";
import { createFalcon24SuccessorFinalizationReadback } from "../lib/falcon24-successor-readback";
import { createFalcon24SuccessorSmokeProcess } from "../lib/falcon24-successor-smoke-process";
import {
  loadFalcon24E4SupportingAuthorityContext,
  loadFalcon24SupportingAuthorityContext,
} from "../lib/falcon24-successor-supporting-authority";
import { createPostgresSemanticPublicationAuthority } from "../lib/postgres-semantic-publication";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_AUTHORITY_ACTIVATION";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-00000000e124";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-00000000e125";
const DEFAULT_STAGING_ID = "00000000-0000-4000-8000-00000000e230";
const DEFAULT_DATASOURCE_ID = "37653002-af62-53c9-bf21-519468aa39ab";
const TARGET_AUTHORITY_EPOCH = "E4" as const;
const supportedFinalizationEpochSchema = falcon24AuthorityEpochSchema.refine(
  (epoch) => epoch === "E4" || falcon24AuthorityEpochOrdinal(epoch) >= 5n,
  "FALCON24_AUTHORITY_FINALIZATION_EPOCH_UNSUPPORTED",
);
const SEMANTIC_DOMAIN = "falcon24" as const;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const execFileAsync = promisify(execFile);

export type Falcon24RetainedRecoveryKind =
  | "DIAGNOSTIC"
  | "CLOSURE_FAILURE"
  | "TERMINAL_DIAGNOSTIC"
  | "FINALIZATION_FAILURE"
  | "FOUR_LAYER_FAILURE";

export function resolveFalcon24RetainedRecoveryKind(input: {
  readonly authority_epoch: string;
  readonly llm_execution_stage_id?: string;
  readonly predecessor_diagnostic_attempt_id?: string;
  readonly predecessor_closure_failure_receipt_id?: string;
  readonly predecessor_finalization_failure_receipt_id?: string;
  readonly predecessor_four_layer_attempt_id?: string;
}): Falcon24RetainedRecoveryKind | null {
  const ordinal = falcon24AuthorityEpochOrdinal(input.authority_epoch);
  const hasStage = Boolean(input.llm_execution_stage_id);
  const hasDiagnostic = Boolean(input.predecessor_diagnostic_attempt_id);
  const hasClosureFailure = Boolean(input.predecessor_closure_failure_receipt_id);
  const hasFinalizationFailure = Boolean(input.predecessor_finalization_failure_receipt_id);
  if (input.predecessor_four_layer_attempt_id) {
    if (
      ordinal < 12n ||
      !hasStage ||
      hasDiagnostic ||
      hasClosureFailure ||
      hasFinalizationFailure
    ) {
      throw new TypeError("FALCON24_FOUR_LAYER_RECOVERY_CONFIGURATION_REQUIRED");
    }
    return "FOUR_LAYER_FAILURE";
  }
  if (ordinal < 7n) {
    if (hasStage || hasDiagnostic || hasClosureFailure || hasFinalizationFailure) {
      throw new TypeError("FALCON24_RECOVERY_ACTIVATION_EPOCH_INVALID");
    }
    return null;
  }
  if (ordinal === 7n) {
    if (!hasStage || !hasDiagnostic || hasClosureFailure || hasFinalizationFailure) {
      throw new TypeError("FALCON24_E7_RECOVERY_CONFIGURATION_REQUIRED");
    }
    return "DIAGNOSTIC";
  }
  if (ordinal === 8n) {
    if (!hasStage || hasDiagnostic || !hasClosureFailure || hasFinalizationFailure) {
      throw new TypeError("FALCON24_E8_RECOVERY_CONFIGURATION_REQUIRED");
    }
    return "CLOSURE_FAILURE";
  }
  if (
    !hasStage ||
    hasClosureFailure ||
    hasDiagnostic === hasFinalizationFailure ||
    (ordinal === 9n && hasFinalizationFailure)
  ) {
    throw new TypeError(
      ordinal === 9n
        ? "FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_CONFIGURATION_REQUIRED"
        : "FALCON24_TERMINAL_RECOVERY_CONFIGURATION_REQUIRED",
    );
  }
  return hasDiagnostic ? "TERMINAL_DIAGNOSTIC" : "FINALIZATION_FAILURE";
}

export async function loadFalcon24FourLayerRecoveryPredecessor(input: {
  readonly gate: Pick<
    ReturnType<typeof createPostgresFalcon24FourLayerGateAuthority>,
    "loadAttempt" | "loadTurn"
  >;
  readonly capability: unknown;
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
  };
  readonly principal_id: string;
  readonly current_authority: unknown;
  readonly predecessor_attempt_id: unknown;
}) {
  const predecessorId = z.uuid().parse(input.predecessor_attempt_id);
  const current = falcon24AuthorityBindingV2Schema.parse(input.current_authority);
  const attempt = requireValue(
    await input.gate.loadAttempt(input.capability, { attempt_id: predecessorId }),
  );
  const invalid = () => new TypeError("FALCON24_FOUR_LAYER_RECOVERY_PREFLIGHT_MISMATCH");
  if (
    attempt?.status !== "FAILED" ||
    attempt.attempt_id !== predecessorId ||
    attempt.first_failure_turn_ordinal === null ||
    !attempt.first_failure_run_id ||
    !attempt.first_failure_code ||
    attempt.authority_epoch !== current.authority_epoch ||
    attempt.authority_baseline_id !== current.baseline_id ||
    attempt.authority_baseline_hash !== current.baseline_hash ||
    attempt.authority_activation_attempt_id !== current.activation_attempt_id ||
    attempt.app_id !== input.scope.app_id ||
    attempt.tenant_id !== input.scope.tenant_id ||
    attempt.environment !== input.scope.environment ||
    attempt.principal_id !== input.principal_id
  )
    throw invalid();
  const manifest = await verifyFalcon24FourLayerGateManifest(attempt.manifest_document);
  for (const key of [
    "gate_id",
    "attempt_id",
    "authority_epoch",
    "authority_baseline_id",
    "authority_baseline_hash",
    "authority_activation_attempt_id",
    "source_commit",
    "worker_build_hash",
    "worker_generation_hash",
    "web_build_hash",
    "web_generation_hash",
    "semantic_release_hash",
    "datasource_binding_hash",
    "model_config_hash",
    "runtime_attestation_hash",
    "manifest_hash",
  ] as const) {
    if (attempt[key] !== manifest[key]) throw invalid();
  }
  const turn = requireValue(
    await input.gate.loadTurn(input.capability, {
      attempt_id: predecessorId,
      turn_ordinal: attempt.first_failure_turn_ordinal,
    }),
  );
  if (
    turn?.status !== "FAILED" ||
    turn.attempt_id !== predecessorId ||
    turn.turn_ordinal !== attempt.first_failure_turn_ordinal ||
    turn.run_id !== attempt.first_failure_run_id ||
    turn.app_id !== attempt.app_id ||
    turn.tenant_id !== attempt.tenant_id ||
    turn.environment !== attempt.environment ||
    turn.principal_id !== attempt.principal_id ||
    !turn.terminal_receipt ||
    !turn.business_receipt
  )
    throw invalid();
  const terminal = await verifyFalcon24FourLayerTerminalReceipt(turn.terminal_receipt);
  const business = await verifyFalcon24FourLayerBusinessReceipt(turn.business_receipt);
  const qa = turn.qa_ui_receipt
    ? await verifyFalcon24FourLayerQaUiReceipt(turn.qa_ui_receipt)
    : null;
  const trace = turn.trace_ui_receipt
    ? await verifyFalcon24FourLayerTraceUiReceipt(turn.trace_ui_receipt)
    : null;
  const blueprint = manifest.turns[turn.turn_ordinal];
  if (
    !blueprint ||
    terminal.status !== "FAILED" ||
    terminal.failure_code !== attempt.first_failure_code ||
    terminal.receipt_hash !== turn.terminal_receipt_hash ||
    terminal.attempt_id !== predecessorId ||
    terminal.manifest_hash !== manifest.manifest_hash ||
    terminal.gate_id !== manifest.gate_id ||
    terminal.run_id !== turn.run_id ||
    terminal.turn_ordinal !== turn.turn_ordinal ||
    terminal.conversation_id !== turn.conversation_id ||
    terminal.conversation_resource_version !== turn.conversation_resource_version ||
    terminal.worker_build_hash !== manifest.worker_build_hash ||
    terminal.worker_generation_hash !== manifest.worker_generation_hash ||
    terminal.semantic_release_hash !== manifest.semantic_release_hash ||
    terminal.business_receipt_hash !== business.receipt_hash ||
    business.receipt_hash !== turn.business_receipt_hash ||
    terminal.qa_ui_receipt_hash !== (qa?.receipt_hash ?? null) ||
    terminal.qa_ui_receipt_hash !== turn.qa_ui_receipt_hash ||
    terminal.trace_ui_receipt_hash !== (trace?.receipt_hash ?? null) ||
    terminal.trace_ui_receipt_hash !== turn.trace_ui_receipt_hash
  )
    throw invalid();
  for (const key of [
    "turn_id",
    "layer",
    "scenario_id",
    "scenario_turn_index",
    "question_hash",
  ] as const) {
    if (terminal[key] !== turn[key] || turn[key] !== blueprint[key]) throw invalid();
  }
  for (const receipt of [business, qa, trace]) {
    if (!receipt) continue;
    for (const key of [
      "gate_id",
      "attempt_id",
      "manifest_hash",
      "turn_ordinal",
      "turn_id",
      "layer",
      "scenario_id",
      "scenario_turn_index",
      "conversation_id",
      "conversation_resource_version",
      "run_id",
      "question_hash",
      "worker_build_hash",
      "worker_generation_hash",
      "semantic_release_hash",
    ] as const) {
      if (receipt[key] !== terminal[key]) throw invalid();
    }
  }
  for (const receipt of [qa, trace]) {
    if (
      receipt &&
      (receipt.web_build_hash !== manifest.web_build_hash ||
        receipt.web_generation_hash !== manifest.web_generation_hash)
    )
      throw invalid();
  }
  if (qa && qa.answer_hash !== business.answer_hash) throw invalid();
  if (
    trace &&
    (trace.public_event_hash !== business.public_event_hash ||
      trace.accepted_artifact_refs_hash !==
        (await sha256ContentHash(business.accepted_artifact_refs)))
  )
    throw invalid();
  const failedStage =
    business.status === "FAIL" && !qa && !trace
      ? business
      : business.status === "PASS" && qa?.status === "FAIL" && !trace
        ? qa
        : business.status === "PASS" && qa?.status === "PASS" && trace?.status === "FAIL"
          ? trace
          : null;
  if (!failedStage || failedStage.failure_code !== terminal.failure_code) throw invalid();
  return Object.freeze({ predecessor_manifest: manifest, predecessor_terminal_receipt: terminal });
}

const configurationSchema = z
  .strictObject({
    database_url: z.string().min(1),
    authority_epoch: supportedFinalizationEpochSchema,
    deployment_id: z.uuid(),
    workspace_id: z.uuid(),
    principal_id: z.uuid(),
    staging_id: z.uuid(),
    datasource_id: z.uuid(),
    llm_execution_stage_id: z.uuid().optional(),
    predecessor_diagnostic_attempt_id: z.uuid().optional(),
    predecessor_closure_failure_receipt_id: z.uuid().optional(),
    predecessor_finalization_failure_receipt_id: z.uuid().optional(),
    predecessor_four_layer_attempt_id: z.uuid().optional(),
    environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
    web_build_identity_file: z.string().min(1).max(4_096).refine(isAbsolute),
    worker_build_identity_file: z.string().min(1).max(4_096).refine(isAbsolute),
    build_attestation_file: z.string().min(1).max(4_096).refine(isAbsolute),
  })
  .superRefine((configuration, context) => {
    try {
      resolveFalcon24RetainedRecoveryKind(configuration);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "FALCON24_RECOVERY_CONFIGURATION_REQUIRED",
        path: ["authority_epoch"],
      });
    }
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
  const parsed = supportedFinalizationEpochSchema.safeParse(
    environment.FALCON24_AUTHORITY_EPOCH ?? TARGET_AUTHORITY_EPOCH,
  );
  return parsed.success ? parsed.data : TARGET_AUTHORITY_EPOCH;
}

function predecessorAuthorityEpoch(target: string): string {
  const ordinal = falcon24AuthorityEpochOrdinal(target);
  if (target === "E4") return "E3";
  if (ordinal < 5n) throw new TypeError("FALCON24_AUTHORITY_FINALIZATION_EPOCH_UNSUPPORTED");
  return `E${ordinal - 1n}`;
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
  readonly llm_execution_proof?: Falcon24LlmExecutionAuthorityProof;
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
  const recoveryTarget = falcon24AuthorityEpochOrdinal(input.authority_epoch) >= 7n;
  if (recoveryTarget) {
    const recovery = input.llm_execution_proof;
    if (
      !recovery ||
      recovery.target_authority_epoch !== input.authority_epoch ||
      recovery.staging_id !== input.staging_id ||
      recovery.model_profile_id !== model.model_profile_id ||
      recovery.model_config_version !== model.config_version ||
      recovery.provider !== model.provider ||
      recovery.model_id !== model.model_id
    ) {
      throw new TypeError("FALCON24_E7_MODEL_EXECUTION_PROOF_MISMATCH");
    }
  } else if (
    proof.subject_hash !== predecessor.subject_hash ||
    proof.evidence_hash !== predecessor.evidence_hash
  ) {
    throw new TypeError("FALCON24_MODEL_PREDECESSOR_PROOF_MISMATCH");
  }
  const receipt = await recordStagingReceipt({
    authority_epoch: input.authority_epoch,
    staging_id: input.staging_id,
    component: "LLM_CONFIGURATION",
    subject_hash: input.llm_execution_proof?.model_resource_hash ?? proof.subject_hash,
    evidence_hash: input.llm_execution_proof?.proof_hash ?? proof.evidence_hash,
    production_isolation_proven: false,
    capability: input.capability,
    epoch: input.epoch,
  });
  return Object.freeze({
    receipt,
    ...proof,
    llm_execution_proof: input.llm_execution_proof ?? null,
  });
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
  const authorityEpoch = supportedFinalizationEpochSchema.parse(
    environment.FALCON24_AUTHORITY_EPOCH ?? TARGET_AUTHORITY_EPOCH,
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
    web_build_identity_file: webBuildIdentityFile,
    worker_build_identity_file:
      environment.FALCON24_WORKER_BUILD_IDENTITY_FILE ??
      (webBuildIdentityFile ? resolve(dirname(webBuildIdentityFile), "worker.json") : undefined),
    build_attestation_file:
      environment.FALCON24_BUILD_ATTESTATION_FILE ??
      (webBuildIdentityFile
        ? resolve(dirname(webBuildIdentityFile), "attestation.json")
        : undefined),
    llm_execution_stage_id: environment.FALCON24_LLM_EXECUTION_STAGE_ID,
    predecessor_diagnostic_attempt_id: environment.FALCON24_PREDECESSOR_DIAGNOSTIC_ATTEMPT_ID,
    predecessor_closure_failure_receipt_id:
      environment.FALCON24_PREDECESSOR_CLOSURE_FAILURE_RECEIPT_ID,
    predecessor_finalization_failure_receipt_id:
      environment.FALCON24_PREDECESSOR_FINALIZATION_FAILURE_RECEIPT_ID,
    predecessor_four_layer_attempt_id: environment.FALCON24_PREDECESSOR_FOUR_LAYER_ATTEMPT_ID,
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
    const retainedTarget = configuration.authority_epoch !== "E4";
    const recoveryKind = resolveFalcon24RetainedRecoveryKind(configuration);
    const recoveryTarget = recoveryKind !== null;
    const expectedCurrentEpoch = predecessorAuthorityEpoch(configuration.authority_epoch);
    if (currentAuthority?.authority_epoch !== expectedCurrentEpoch) {
      throw new TypeError("FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR");
    }
    const recovery = recoveryTarget
      ? await (async () => {
          const stageId = configuration.llm_execution_stage_id;
          if (!stageId) throw new TypeError("FALCON24_RECOVERY_CONFIGURATION_REQUIRED");
          const stage = requireValue(
            await epoch.loadLlmExecutionStage(capability, { stage_id: stageId }),
          );
          const llmExecutionProof = stage.proof_document;
          if (
            stage.status !== "STAGED" ||
            stage.certification_is_active ||
            stage.activation_attempt_id !== null ||
            llmExecutionProof.target_authority_epoch !== configuration.authority_epoch ||
            llmExecutionProof.staging_id !== configuration.staging_id ||
            llmExecutionProof.worker_build.build_id !== workerBuildIdentity.build_id ||
            llmExecutionProof.worker_build.generation_id !== workerBuildIdentity.generation_id ||
            llmExecutionProof.scope.app_id !== capability.scope.app_id ||
            llmExecutionProof.scope.tenant_id !== capability.scope.tenant_id ||
            llmExecutionProof.scope.environment !== capability.scope.environment ||
            llmExecutionProof.scope.semantic_domain !== SEMANTIC_DOMAIN
          ) {
            throw new TypeError("FALCON24_RECOVERY_PROOF_PREFLIGHT_MISMATCH");
          }
          if (recoveryKind === "DIAGNOSTIC") {
            const diagnosticAttemptId = configuration.predecessor_diagnostic_attempt_id;
            if (!diagnosticAttemptId) {
              throw new TypeError("FALCON24_E7_RECOVERY_CONFIGURATION_REQUIRED");
            }
            const predecessorDiagnosticFailure = requireValue(
              await epoch.loadRecoveryContext(capability, { attempt_id: diagnosticAttemptId }),
            );
            return Object.freeze({
              kind: "DIAGNOSTIC" as const,
              llm_execution_proof: llmExecutionProof,
              predecessor_diagnostic_failure: predecessorDiagnosticFailure,
            });
          }
          if (recoveryKind === "CLOSURE_FAILURE") {
            const failureReceiptId = configuration.predecessor_closure_failure_receipt_id;
            if (!failureReceiptId) {
              throw new TypeError("FALCON24_E8_RECOVERY_CONFIGURATION_REQUIRED");
            }
            const predecessorClosureFailure = requireValue(
              await epoch.loadEpochClosureFailure(capability, { receipt_id: failureReceiptId }),
            );
            if (
              predecessorClosureFailure.authority.authority_epoch !==
                currentAuthority.authority_epoch ||
              predecessorClosureFailure.authority.baseline_id !== currentAuthority.baseline_id ||
              predecessorClosureFailure.authority.baseline_hash !==
                currentAuthority.baseline_hash ||
              predecessorClosureFailure.authority.activation_attempt_id !==
                currentAuthority.activation_attempt_id ||
              predecessorClosureFailure.failure_class !== "FROZEN_CLOSURE_CHANGE_REQUIRED" ||
              predecessorClosureFailure.failure_code !== "PROVIDER_PROFILE_BINDING_NOT_SELECTED"
            ) {
              throw new TypeError("FALCON24_E8_CLOSURE_FAILURE_PREFLIGHT_MISMATCH");
            }
            return Object.freeze({
              kind: "CLOSURE_FAILURE" as const,
              llm_execution_proof: llmExecutionProof,
              predecessor_closure_failure: predecessorClosureFailure,
            });
          }
          if (recoveryKind === "TERMINAL_DIAGNOSTIC") {
            const diagnosticAttemptId = configuration.predecessor_diagnostic_attempt_id;
            if (!diagnosticAttemptId) {
              throw new TypeError("FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_CONFIGURATION_REQUIRED");
            }
            const diagnosticAuthority = createPostgresFalcon24DiagnosticAuthority({
              pool: sqlPool,
              authorizer: authority.authorizer,
            });
            const predecessorDiagnostic = requireValue(
              await diagnosticAuthority.load(capability, diagnosticAttemptId),
            );
            if (
              predecessorDiagnostic?.status !== "FAILED" ||
              predecessorDiagnostic.failure_class !== "FROZEN_CLOSURE_CHANGE_REQUIRED" ||
              !predecessorDiagnostic.failure_code ||
              !predecessorDiagnostic.terminal_receipt_hash ||
              predecessorDiagnostic.authority_epoch !== currentAuthority.authority_epoch ||
              predecessorDiagnostic.authority_baseline_id !== currentAuthority.baseline_id ||
              predecessorDiagnostic.authority_baseline_hash !== currentAuthority.baseline_hash ||
              predecessorDiagnostic.authority_activation_attempt_id !==
                currentAuthority.activation_attempt_id
            ) {
              throw new TypeError("FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_PREFLIGHT_MISMATCH");
            }
            return Object.freeze({
              kind: "TERMINAL_DIAGNOSTIC" as const,
              llm_execution_proof: llmExecutionProof,
              predecessor_diagnostic_receipt: Object.freeze({
                attempt_id: predecessorDiagnostic.attempt_id,
                run_id: predecessorDiagnostic.run_id,
                manifest_hash: predecessorDiagnostic.manifest_hash,
                receipt_hash: predecessorDiagnostic.terminal_receipt_hash,
                failure_class: predecessorDiagnostic.failure_class,
                failure_code: predecessorDiagnostic.failure_code,
              }),
            });
          }
          if (recoveryKind === "FOUR_LAYER_FAILURE") {
            const predecessor = await loadFalcon24FourLayerRecoveryPredecessor({
              gate: createPostgresFalcon24FourLayerGateAuthority({
                pool: sqlPool,
                authorizer: authority.authorizer,
              }),
              capability,
              scope: capability.scope,
              principal_id: configuration.principal_id,
              current_authority: currentAuthority,
              predecessor_attempt_id: configuration.predecessor_four_layer_attempt_id,
            });
            return Object.freeze({
              kind: "FOUR_LAYER_FAILURE" as const,
              llm_execution_proof: llmExecutionProof,
              ...predecessor,
            });
          }
          const finalizationFailureReceiptId =
            configuration.predecessor_finalization_failure_receipt_id;
          if (!finalizationFailureReceiptId) {
            throw new TypeError("FALCON24_FINALIZATION_FAILURE_RECOVERY_CONFIGURATION_REQUIRED");
          }
          const predecessorFinalizationFailure = requireValue(
            await epoch.loadFinalizationFailure(capability, {
              receipt_id: finalizationFailureReceiptId,
            }),
          );
          if (
            predecessorFinalizationFailure.authority.authority_epoch !==
              currentAuthority.authority_epoch ||
            predecessorFinalizationFailure.authority.baseline_id !== currentAuthority.baseline_id ||
            predecessorFinalizationFailure.authority.baseline_hash !==
              currentAuthority.baseline_hash ||
            predecessorFinalizationFailure.authority.activation_attempt_id !==
              currentAuthority.activation_attempt_id ||
            predecessorFinalizationFailure.failure_class !== "FROZEN_CLOSURE_CHANGE_REQUIRED" ||
            predecessorFinalizationFailure.failure_code !==
              "CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS" ||
            predecessorFinalizationFailure.observed_sqlstate !== "42702"
          ) {
            throw new TypeError("FALCON24_FINALIZATION_FAILURE_RECOVERY_PREFLIGHT_MISMATCH");
          }
          return Object.freeze({
            kind: "FINALIZATION_FAILURE" as const,
            llm_execution_proof: llmExecutionProof,
            predecessor_finalization_failure: predecessorFinalizationFailure,
          });
        })()
      : undefined;
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
      before.authority.authority_epoch !== expectedCurrentEpoch ||
      before.authority.baseline_id !== currentAuthority.baseline_id ||
      before.authority.baseline_hash !== currentAuthority.baseline_hash ||
      before.semantic_pointer.release.datasource_id !== configuration.datasource_id
    ) {
      throw new TypeError(
        retainedTarget
          ? "FALCON24_RETAINED_SEMANTIC_PREFLIGHT_MISMATCH"
          : "FALCON24_SEMANTIC_SUCCESSOR_PREFLIGHT_MISMATCH",
      );
    }
    const defaultsReader = createPostgresEffectiveConfigResolver({
      pool: sqlPool,
      authorizer: authority.authorizer,
    });
    const expectedSemanticRelease = {
      release_id: before.semantic_pointer.release.release_id,
      generation: before.semantic_pointer.release.generation,
      release_digest: exactContentHash(before.semantic_pointer.release.release_digest),
    };
    const supporting = retainedTarget
      ? await loadFalcon24SupportingAuthorityContext({
          capability,
          defaults_reader: defaultsReader,
          scope: before.scope,
          expected_semantic_release: expectedSemanticRelease,
          expected_datasource_id: configuration.datasource_id,
          expected_defaults_version: before.workspace_defaults.version,
        })
      : await loadFalcon24E4SupportingAuthorityContext({
          capability,
          defaults_reader: defaultsReader,
          scope: before.scope,
          expected_semantic_predecessor: expectedSemanticRelease,
          expected_datasource_id: configuration.datasource_id,
          expected_defaults_version: before.workspace_defaults.version,
        });
    if (supporting.schema_snapshot_ref.resource_revision !== 1) {
      throw new TypeError(
        retainedTarget
          ? "FALCON24_RETAINED_SUPPORTING_AUTHORITY_INCOMPLETE"
          : "FALCON24_E4_SUPPORTING_AUTHORITY_INCOMPLETE",
      );
    }
    const sourceSnapshotHash = exactContentHash(supporting.schema_snapshot_ref.resource_hash);
    const acceptanceContracts = await buildFalcon24AcceptanceContractHashes({
      repository_root: REPOSITORY_ROOT,
      oracle_contract_hash: exactContentHash(retained.analysis_runtime.oracle_contract_hash),
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
        ...(recovery ? { llm_execution_proof: recovery.llm_execution_proof } : {}),
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
    if (retainedTarget) {
      const providerInvocationStore = createPostgresProviderInvocationStore({
        pool: sqlPool,
        authorizer: authority.authorizer,
      });
      const result = await finalizeFalcon24RetainedAuthority({
        capability,
        authority_epoch: configuration.authority_epoch,
        web_build_identity: webBuildIdentity,
        worker_build_identity: workerBuildIdentity,
        epoch,
        readback,
        ...(recovery ? { recovery } : {}),
        load_provider_execution_profiles: () =>
          providerInvocationStore.listExecutionProfiles(capability).then(requireValue),
        resolve_current_execution_certification: (request) =>
          providerInvocationStore
            .resolveCurrentExecutionCertification(capability, {
              schema_version: "current-provider-execution-certification-resolve@1.0.0",
              ...request,
            })
            .then(requireValue),
        resolve_current_execution_certification_v2: (request) =>
          providerInvocationStore
            .resolveCurrentExecutionCertificationV2(capability, {
              schema_version: "current-provider-execution-certification-resolve@2.0.0",
              ...request,
            })
            .then(requireValue),
        stage_falcon_authority: async ({
          semantic_release_digest: semanticReleaseDigest,
          retained_semantic_proof_hash: retainedSemanticProofHash,
        }) =>
          stageFalcon24RetainedAuthority({
            capability,
            epoch,
            authority_epoch: configuration.authority_epoch,
            semantic_release_digest: semanticReleaseDigest,
            retained_semantic_proof_hash: retainedSemanticProofHash,
            staging_id: configuration.staging_id,
            retained_assets_hash: exactContentHash(retained.manifest_hash),
            source_commit: sourceCommit,
            web_build_hash: webBuildIdentity.build_id,
            acceptance_contracts: acceptanceContracts,
            production_isolation_proven: runtimeAttestation.production_isolation_proven,
            production_gate: runtimeAttestation.production_gate,
            stage_supporting_receipts: stageSupportingReceipts,
          }),
        hold_activation_attempt: async (request) => {
          requireValue(await epoch.holdActivationAttempt(capability, request));
        },
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
        retained_semantic_authority: {
          semantic_release: result.semantic_proof.semantic_release,
          projection_refs: result.semantic_proof.projections,
          expected_versions: result.semantic_proof.expected_versions,
          semantic_proof_hash: result.semantic_proof.proof_hash,
        },
        staging_proofs: supportingProofs,
        schema_snapshot: supporting.schema_snapshot_ref,
        workspace_defaults: result.readback.workspace_defaults,
        builtin_team: team,
        production_readiness: runtimeAttestation.production_gate,
      });
    }

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
      hold_activation_attempt: async (request) => {
        requireValue(await epoch.holdActivationAttempt(capability, request));
      },
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
