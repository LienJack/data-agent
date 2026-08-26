import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { BuiltinTeamProfileSetSnapshot } from "@data-agent/agent-runtime";
import { artifactReferenceIdentity } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24AcceptanceRunManifest,
  buildFalcon24ResolutionTraceGateReceipt,
  buildFalcon24ResolutionTraceUiGateReceipt,
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  type Falcon24AcceptanceFailureLayer,
  falcon24AcceptanceCampaignIdSchema,
} from "@data-agent/contracts/evals";
import { buildFalcon24QaE2eReceipt, buildFalcon24TraceUiReceipt } from "@data-agent/contracts/runs";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "@data-agent/evals";
import { createPostgresRepository } from "@data-agent/platform/persistence";
import {
  createPostgresFalcon24AcceptanceCampaignAuthority,
  createPostgresFalcon24AuthorityEpoch,
  createPostgresRunControl,
} from "@data-agent/platform/runs";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import { z } from "zod";
import {
  resolveBuiltinTeamMaterializationInput,
  verifyCurrentBuiltinTeamAuthority,
} from "@/lib/builtin-team-authority";
import { deriveRunCommandIdentities } from "@/lib/run-command-identity";
import { getWebRuntimeBuildIdentity } from "@/lib/runtime-build-identity";
import {
  closeWorkspaceIdentityRuntime,
  getAgentProfileRegistry,
  getEffectiveConfigResolver,
  getResolutionTraceProjector,
  getSkillRegistry,
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import {
  exactRequiredFalcon24ArtifactReferences,
  preflightFalcon24BrowserSubmission,
  runFalcon24BrowserTraceGate,
  submitFalcon24QuestionFromBrowser,
} from "./falcon24-browser-trace-gate";
import { verifyFalcon24ResolutionTraceGate } from "./falcon24-resolution-trace-gate";

const execFileAsync = promisify(execFile);
const scopeSchema = z.strictObject({
  deploymentId: z.uuid(),
  workspaceId: z.uuid(),
  principalId: z.uuid(),
});
const variantSchema = z.enum(["COLD", "WARM"]);

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireStrictPolicy(environment: NodeJS.ProcessEnv): void {
  if (
    environment.DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY?.trim() !==
    FALCON24_STRICT_ACCEPTANCE_POLICY_ID
  ) {
    throw new Error("FALCON24_ACCEPTANCE_EXECUTION_POLICY_REQUIRED");
  }
}

function runIdentity(input: {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly campaignId: string;
  readonly attemptId: string;
  readonly caseId: string;
  readonly variant: "COLD" | "WARM";
  readonly repetition: number;
}) {
  const material = `${input.campaignId}:${input.attemptId}:${input.caseId}:${input.variant}:${input.repetition}`;
  const idempotencyKey = stableUuid(`falcon24:agent-acceptance:${material}`);
  return {
    ...deriveRunCommandIdentities({
      workspace_id: input.workspaceId,
      principal_id: input.principalId,
      idempotency_key: idempotencyKey,
    }),
    idempotencyKey,
    conversationId: stableUuid(`falcon24:agent-acceptance:conversation:${material}`),
  };
}

export function stableErrorCode(error: unknown): string {
  const candidates = [
    typeof error === "object" && error !== null && "code" in error
      ? (error as { readonly code?: unknown }).code
      : null,
    error instanceof Error ? error.message : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    if (/^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate)) return candidate;
    const codes = [...new Set(candidate.match(/[A-Z][A-Z0-9_]{2,127}/gu) ?? [])];
    if (codes.length === 1) return codes[0] ?? "FALCON24_ANALYSIS_CONTROL_FAILED";
  }
  return "FALCON24_ANALYSIS_CONTROL_FAILED";
}

export function failureAt(
  failureLayer: Falcon24AcceptanceFailureLayer,
  error: unknown,
): {
  readonly failure_layer: Falcon24AcceptanceFailureLayer;
  readonly failure_code: string;
} {
  return { failure_layer: failureLayer, failure_code: stableErrorCode(error) };
}

export function requireSucceededFalcon24Run(
  run: { readonly run_id: string; readonly status: string } | null,
  expectedRunId: string,
): void {
  if (!run || run.run_id !== expectedRunId || run.status !== "SUCCEEDED") {
    throw new Error("FALCON24_ACTUAL_RUN_NOT_SUCCEEDED");
  }
}

export function projectFalcon24AcceptanceStatus(
  campaignRun: { readonly status: string } | null,
  persistedRun: { readonly status: string } | null,
) {
  return Object.freeze({
    terminal: "STATUS" as const,
    hard_stopped:
      campaignRun?.status === "HOLD" ||
      (persistedRun !== null && ["FAILED", "CANCELLED"].includes(persistedRun.status)),
  });
}

type CampaignHoldResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string } };

export class Falcon24CampaignHoldDiagnosticError extends Error {
  override readonly name = "Falcon24CampaignHoldDiagnosticError";
  readonly code: string;
  readonly hold_failure_code: string;

  constructor(originalError: unknown, holdError: unknown) {
    const originalCode = stableErrorCode(originalError);
    super(originalCode, { cause: originalError });
    this.code = originalCode;
    this.hold_failure_code = stableErrorCode(holdError);
  }
}

export async function holdCampaignAfterFailure(input: {
  readonly originalError: unknown;
  readonly hold: () => Promise<CampaignHoldResult>;
}): Promise<never> {
  let result: CampaignHoldResult;
  try {
    result = await input.hold();
  } catch (holdError) {
    throw new Falcon24CampaignHoldDiagnosticError(input.originalError, holdError);
  }
  if (!result.ok && result.error.code === "FALCON24_CAMPAIGN_HOLD_REPLAY_MISMATCH") {
    throw input.originalError;
  }
  if (!result.ok) {
    throw new Falcon24CampaignHoldDiagnosticError(input.originalError, result.error);
  }
  throw input.originalError;
}

export async function resolveFalcon24SubmitFailure<T>(input: {
  readonly original_error: unknown;
  readonly resolve: (
    failureCode: string,
  ) => Promise<
    | { readonly disposition: "HELD"; readonly failure_code: string }
    | { readonly disposition: "ACCEPTED" }
  >;
  readonly load_binding: () => Promise<T | null>;
}): Promise<T> {
  let resolution:
    | { readonly disposition: "HELD"; readonly failure_code: string }
    | { readonly disposition: "ACCEPTED" };
  try {
    resolution = await input.resolve(stableErrorCode(input.original_error));
  } catch (resolutionError) {
    throw new Falcon24CampaignHoldDiagnosticError(input.original_error, resolutionError);
  }
  if (resolution.disposition === "HELD") {
    if (resolution.failure_code === stableErrorCode(input.original_error)) {
      throw input.original_error;
    }
    throw new Error(resolution.failure_code, { cause: input.original_error });
  }
  let binding: T | null;
  try {
    binding = await input.load_binding();
  } catch (bindingError) {
    throw new Falcon24CampaignHoldDiagnosticError(input.original_error, bindingError);
  }
  if (!binding) {
    throw new Falcon24CampaignHoldDiagnosticError(
      input.original_error,
      new Error("FALCON24_ACCEPTED_BINDING_MISSING"),
    );
  }
  return binding;
}

function sourceDirtyPath(statusLine: string): string {
  const path = statusLine.slice(3).trim();
  const renameTarget = path.includes(" -> ") ? path.split(" -> ").at(-1) : path;
  return renameTarget ?? path;
}

function isRuntimeOnlyPath(path: string): boolean {
  return (
    path === ".data" ||
    path.startsWith(".data/") ||
    path === "artifacts/falcon24-agent-analysis" ||
    path.startsWith("artifacts/falcon24-agent-analysis/") ||
    path === "apps/web/tsconfig.tsbuildinfo" ||
    path === "apps/web/next-env.d.ts"
  );
}

export async function committedSourceFingerprint(root: string): Promise<string> {
  const [{ stdout: status }, { stdout: governedTree }] = await Promise.all([
    execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }),
    execFileAsync(
      "git",
      [
        "ls-tree",
        "-r",
        "--full-tree",
        "HEAD",
        "--",
        "apps",
        "packages",
        "services",
        "infra",
        "scripts/generate-statistical-operator-contracts.ts",
        "compose.yaml",
        "package.json",
        "pnpm-lock.yaml",
      ],
      { cwd: root },
    ),
  ]);
  const dirtySourcePaths = status
    .split("\n")
    .filter(Boolean)
    .map(sourceDirtyPath)
    .filter((path) => !isRuntimeOnlyPath(path));
  if (dirtySourcePaths.length > 0) throw new Error("FALCON24_COMMITTED_CHANGE_REQUIRED");
  return sha256ContentHash({
    schema_version: "falcon24-governed-source-tree@2.0.0",
    entries: governedTree.trim().split("\n").filter(Boolean),
  });
}

async function main(): Promise<void> {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
  Object.assign(process.env, environment);
  const command = process.argv[2];
  if (!["manifest", "submit", "status", "trace", "finalize", "cancel"].includes(command ?? "")) {
    throw new Error("FALCON24_ANALYSIS_COMMAND_INVALID");
  }
  const scope = scopeSchema.parse({
    deploymentId:
      argument("deployment-id") ??
      environment.WORKER_DEPLOYMENT_ID ??
      environment.SEMANTIC_DEPLOYMENT_ID,
    workspaceId:
      argument("workspace-id") ?? environment.WORKER_TENANT_ID ?? environment.SEMANTIC_TENANT_ID,
    principalId:
      argument("principal-id") ??
      environment.WORKER_PRINCIPAL_ID ??
      environment.SEMANTIC_PRINCIPAL_ID,
  });
  const campaignId = falcon24AcceptanceCampaignIdSchema.parse(argument("campaign-id"));
  const attemptId = z.uuid().parse(argument("attempt-id"));
  const winningQualificationAttemptId = z.uuid().parse(argument("qualification-attempt-id"));
  const workspaceAuthority = getWorkspaceAuthority();
  const capability = requireValue(
    await workspaceAuthority.resolveForServerContext({
      deployment_id: scope.deploymentId,
      workspace_id: scope.workspaceId,
      principal_id: scope.principalId,
      access: "WRITE",
    }),
  );
  const campaignAuthority = createPostgresFalcon24AcceptanceCampaignAuthority({
    pool: getWorkspaceSqlPool(),
    authorizer: workspaceAuthority.authorizer,
  });
  const epochAuthority = createPostgresFalcon24AuthorityEpoch({
    pool: getWorkspaceSqlPool(),
    authorizer: workspaceAuthority.authorizer,
  });
  const runRepository = createPostgresRepository(
    getWorkspaceSqlPool(),
    workspaceAuthority.authorizer,
  );
  const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();

  const loadBuiltinTeamAuthority = async (): Promise<{
    readonly snapshot: BuiltinTeamProfileSetSnapshot;
    readonly frozen_contract_hash: string;
  }> => {
    const defaults = requireValue(
      await getEffectiveConfigResolver().getWorkspaceDefaults(capability),
    );
    const contextPolicy = defaults?.revision.defaults.context_policy;
    const safetyPolicy = defaults?.revision.defaults.execution_safety_policy;
    if (!contextPolicy || !safetyPolicy) {
      throw new Error("FALCON24_BUILTIN_TEAM_POLICY_BINDINGS_REQUIRED");
    }
    const [profileItems, skillItems] = await Promise.all([
      getAgentProfileRegistry().listManagedV2(capability).then(requireValue),
      getSkillRegistry().list(capability, false).then(requireValue),
    ]);
    const snapshot = await verifyCurrentBuiltinTeamAuthority({
      materialization_input: await resolveBuiltinTeamMaterializationInput({
        pool: getWorkspaceSqlPool(),
        capability,
        deployment_id: scope.deploymentId,
        context_policy_ref: contextPolicy,
        execution_safety_policy_ref: safetyPolicy,
      }),
      profile_items: profileItems,
      skill_items: skillItems,
    });
    return {
      snapshot,
      frozen_contract_hash: await sha256ContentHash({
        schema_version: "falcon24-frozen-contract@1.0.0",
        suite_hash: suite.suite_hash,
        builtin_team_profile_set_hash: snapshot.profile_set_hash,
      }),
    };
  };

  if (command === "manifest") {
    requireStrictPolicy(environment);
    const [sourceFingerprint, runtimeAttestationHash, builtinAuthority, currentAuthority] =
      await Promise.all([
        committedSourceFingerprint(root),
        sha256ContentHash(
          JSON.parse(
            await readFile(
              resolve(root, "infra/docker/opensandbox-analysis-attestation.json"),
              "utf8",
            ),
          ),
        ),
        loadBuiltinTeamAuthority(),
        epochAuthority.loadCurrent(capability).then(requireValue),
      ]);
    if (!currentAuthority) throw new Error("FALCON24_E1_NOT_ACTIVE");
    const runs = suite.cases.flatMap((testCase) =>
      (["COLD", "WARM"] as const).flatMap((variant) =>
        [1, 2, 3].map((repetition) => ({
          run_id: runIdentity({
            workspaceId: scope.workspaceId,
            principalId: scope.principalId,
            campaignId,
            attemptId,
            caseId: testCase.case_id,
            variant,
            repetition,
          }).run_id,
          case_id: testCase.case_id,
          run_variant: variant,
          repetition,
        })),
      ),
    );
    const manifest = await buildFalcon24AcceptanceRunManifest({
      schema_version: "falcon24-analysis-run-manifest@2.0.0",
      campaign_id: campaignId,
      attempt_id: attemptId,
      winning_qualification_attempt_id: winningQualificationAttemptId,
      authority_baseline_hash: currentAuthority.baseline_hash,
      source_fingerprint: sourceFingerprint,
      frozen_contract_hash: builtinAuthority.frozen_contract_hash,
      runtime_attestation_hash: runtimeAttestationHash,
      runs,
    });
    const campaign = requireValue(await campaignAuthority.begin(capability, manifest));
    const outputPath = resolve(
      root,
      argument("output") ?? "artifacts/falcon24-agent-analysis/run-manifest.json",
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    report({
      terminal: "READY",
      campaign_id: campaignId,
      attempt_id: campaign.attempt_id,
      attempt_number: campaign.campaign_version,
      winning_qualification_attempt_id: campaign.winning_qualification_attempt_id,
      source_fingerprint: sourceFingerprint,
      frozen_contract_hash: builtinAuthority.frozen_contract_hash,
      builtin_team_profile_set_hash: builtinAuthority.snapshot.profile_set_hash,
      runtime_attestation_hash: runtimeAttestationHash,
      run_count: runs.length,
      output_path: outputPath,
    });
    return;
  }

  const caseId = argument("case-id");
  const testCase = suite.cases.find((candidate) => candidate.case_id === caseId);
  const variant = variantSchema.parse(argument("variant"));
  const repetition = z.coerce.number().int().min(1).max(3).parse(argument("repetition"));
  const runOrdinal = z.coerce.number().int().min(0).max(29).parse(argument("ordinal"));
  if (!testCase) throw new Error("FALCON24_ANALYSIS_CASE_UNKNOWN");
  const identities = runIdentity({
    workspaceId: scope.workspaceId,
    principalId: scope.principalId,
    campaignId,
    attemptId,
    caseId: testCase.case_id,
    variant,
    repetition,
  });
  const claimFenceToken = randomUUID();
  const claim = {
    campaign_id: campaignId,
    run_ordinal: runOrdinal,
    run_id: identities.run_id,
    case_id: testCase.case_id,
    run_variant: variant,
    repetition,
    claim_fence_token: claimFenceToken,
  } as const;

  const assertCurrentAttempt = <T extends { readonly attempt_id: string }>(value: T | null): T => {
    if (!value || value.attempt_id !== attemptId) {
      throw new Error("FALCON24_E1_GATE_ATTEMPT_MISMATCH");
    }
    return value;
  };

  if (command === "status") {
    const [campaign, binding, campaignRun, persistedRun] = await Promise.all([
      campaignAuthority.load(capability, { campaign_id: campaignId }).then(requireValue),
      getWorkspaceDataRepository().getRunBinding(capability, identities.run_id).then(requireValue),
      campaignAuthority
        .loadRun(capability, { campaign_id: campaignId, run_id: identities.run_id })
        .then(requireValue),
      runRepository.getRun(capability, { run_id: identities.run_id }).then(requireValue),
    ]);
    assertCurrentAttempt(campaign);
    report({
      ...projectFalcon24AcceptanceStatus(campaignRun, persistedRun),
      campaign_id: campaignId,
      attempt_id: attemptId,
      run_ordinal: runOrdinal,
      case_id: testCase.case_id,
      run_variant: variant,
      repetition,
      run_id: identities.run_id,
      campaign_run: campaignRun,
      persisted_run: persistedRun,
      binding,
    });
    return;
  }

  const loadAndVerifyTrace = async () => {
    const persistedRun = requireValue(
      await runRepository.getRun(capability, { run_id: identities.run_id }),
    );
    requireSucceededFalcon24Run(persistedRun, identities.run_id);
    const projector = getResolutionTraceProjector();
    const trace = requireValue(
      await projector.loadTrace(capability, { scope: capability.scope, run_id: identities.run_id }),
    );
    if (!trace) throw new Error("FALCON24_RESOLUTION_TRACE_EMPTY");
    const details = [];
    for (const { node_id: nodeId } of trace.nodes) {
      const detail = requireValue(
        await projector.loadDetail(capability, {
          scope: capability.scope,
          run_id: identities.run_id,
          node_id: nodeId,
          expected_trace_hash: trace.trace_hash,
        }),
      );
      if (!detail || detail.node_id !== nodeId) {
        throw new Error("FALCON24_RESOLUTION_TRACE_DETAIL_INVALID");
      }
      details.push(detail);
    }
    return { trace, details, verified: verifyFalcon24ResolutionTraceGate(trace, details) };
  };

  if (command === "trace") {
    try {
      requireStrictPolicy(environment);
      const { trace, details, verified } = await loadAndVerifyTrace();
      const traceGateReceipt = await buildFalcon24ResolutionTraceGateReceipt({
        schema_version: "falcon24-resolution-trace-gate-receipt@2.0.0",
        campaign_id: campaignId,
        run_id: identities.run_id,
        trace_hash: trace.trace_hash,
        ...verified,
        verified_at: new Date().toISOString(),
      });
      requireValue(
        await campaignAuthority.stageTrace(capability, {
          campaign_id: campaignId,
          run_id: identities.run_id,
          receipt: traceGateReceipt,
        }),
      );
      if (trace.conversation_id !== identities.conversationId) {
        throw new Error("FALCON24_BROWSER_CONVERSATION_IDENTITY_INVALID");
      }
      const screenshotPath = resolve(
        root,
        argument("browser-screenshot") ??
          `artifacts/falcon24-agent-analysis/browser/${campaignId}/${identities.run_id}.png`,
      );
      await mkdir(dirname(screenshotPath), { recursive: true });
      const browserWidth = argument("browser-width") === "390" ? 390 : 1440;
      const browserGate = await runFalcon24BrowserTraceGate({
        session: z.string().min(1).parse(argument("browser-session")),
        web_base_url: z.string().url().parse(argument("web-base-url")),
        screenshot_path: screenshotPath,
        workspace_id: scope.workspaceId,
        conversation_id: identities.conversationId,
        question: testCase.question,
        attempt_id: attemptId,
        viewport: { width: browserWidth, height: browserWidth === 390 ? 844 : 900 },
        trace,
        details,
      });
      const browserObservation = browserGate.trace_ui;
      const webBuildIdentity = getWebRuntimeBuildIdentity();
      if (
        browserObservation.web_build.build_id !== webBuildIdentity.build_id ||
        browserObservation.web_build.generation_id !== webBuildIdentity.generation_id
      ) {
        throw new Error("FALCON24_BROWSER_BUILD_IDENTITY_MISMATCH");
      }
      const uiTraceGateReceipt = await buildFalcon24ResolutionTraceUiGateReceipt({
        schema_version: "falcon24-resolution-trace-ui-gate-receipt@1.0.0",
        campaign_id: campaignId,
        run_id: identities.run_id,
        workspace_id: scope.workspaceId,
        conversation_id: identities.conversationId,
        trace_hash: trace.trace_hash,
        ...browserObservation,
      });
      requireValue(
        await campaignAuthority.stageUiTrace(capability, {
          campaign_id: campaignId,
          run_id: identities.run_id,
          receipt: uiTraceGateReceipt,
        }),
      );
      const runAuthority = requireValue(
        await epochAuthority.loadRunBinding(capability, { run_id: identities.run_id }),
      );
      const qaE2eReceipt = await buildFalcon24QaE2eReceipt({
        schema_version: "falcon24-qa-e2e-receipt@1.0.0",
        run_id: identities.run_id,
        conversation_id: identities.conversationId,
        authority: runAuthority,
        web_build: browserGate.qa_e2e.web_build,
        browser_harness_version: browserGate.qa_e2e.browser_harness_version,
        viewport: browserGate.qa_e2e.viewport,
        entry_path: "QUESTION_COMPOSER_SUBMIT_TO_RESULT",
        question_hash: browserGate.qa_e2e.question_hash,
        terminal_status: browserGate.qa_e2e.terminal_status,
        answer_visible: browserGate.qa_e2e.answer_visible,
        table_visible: browserGate.qa_e2e.table_visible,
        chart_rendered: browserGate.qa_e2e.chart_rendered,
        report_visible: browserGate.qa_e2e.report_visible,
        error_banner: null,
        dom_snapshot_hash: browserGate.qa_e2e.dom_snapshot_hash,
        screenshot_hash: browserGate.qa_e2e.screenshot_hash,
        observed_at: browserGate.qa_e2e.observed_at,
      });
      const traceUiReceipt = await buildFalcon24TraceUiReceipt({
        schema_version: "falcon24-trace-ui-receipt@1.0.0",
        run_id: identities.run_id,
        conversation_id: identities.conversationId,
        trace_hash: trace.trace_hash,
        authority: runAuthority,
        web_build: browserObservation.web_build,
        browser_harness_version: "falcon24-agent-browser-trace-gate@2.0.0",
        viewport: { width: browserWidth, height: browserWidth === 390 ? 844 : 900 },
        entry_path: "RESULT_TRACE_ENTRY_TO_EXACT_RUN",
        opened_nodes: browserObservation.opened_nodes,
        opened_artifact_refs: browserObservation.opened_artifact_refs,
        chart_ref: browserObservation.chart_ref,
        chart_rendered: true,
        source_table_visible: true,
        returned_to_result: true,
        error_banner: null,
        dom_snapshot_hash: browserObservation.dom_snapshot_hash,
        screenshot_hash: browserObservation.screenshot_hash,
        observed_at: browserObservation.observed_at,
      });
      requireValue(await epochAuthority.commitUiReceipt(capability, qaE2eReceipt));
      requireValue(await epochAuthority.commitUiReceipt(capability, traceUiReceipt));
      report({
        terminal: "TRACE_UI_VERIFIED",
        campaign_id: campaignId,
        run_ordinal: runOrdinal,
        case_id: testCase.case_id,
        run_variant: variant,
        repetition,
        run_id: identities.run_id,
        trace_hash: trace.trace_hash,
        trace_gate_receipt_hash: traceGateReceipt.receipt_hash,
        ui_trace_gate_receipt_hash: uiTraceGateReceipt.receipt_hash,
        qa_e2e_receipt_hash: qaE2eReceipt.receipt_hash,
        trace_ui_receipt_hash: traceUiReceipt.receipt_hash,
        screenshot_hash: uiTraceGateReceipt.screenshot_hash,
        ...verified,
      });
      return;
    } catch (error) {
      const failure = failureAt("PUBLISHER", error);
      await holdCampaignAfterFailure({
        originalError: error,
        hold: () =>
          campaignAuthority.hold(capability, {
            campaign_id: campaignId,
            run_id: identities.run_id,
            ...failure,
          }),
      });
    }
  }

  if (command === "cancel") {
    const commandId = randomUUID();
    const result = await createPostgresRunControl(
      getWorkspaceSqlPool(),
      workspaceAuthority.authorizer,
      capability,
    ).submit({
      schema_version: "1.0.0",
      scope: capability.scope,
      operation: "CANCEL",
      run_id: identities.run_id,
      command_id: commandId,
      event_id: randomUUID(),
      outbox_id: randomUUID(),
      audit_id: randomUUID(),
      idempotency_key: `falcon24-analysis-cancel:${commandId}`,
      occurred_at: new Date().toISOString(),
    });
    if (!result.ok) throw new Error(result.error.code);
    report({ terminal: "CANCELLED", campaign_id: campaignId, run_id: identities.run_id });
    return;
  }

  if (command === "finalize") {
    let failureLayer: Falcon24AcceptanceFailureLayer = "PUBLISHER";
    try {
      requireStrictPolicy(environment);
      const resultDocument = requireValue(
        await campaignAuthority.loadRunResult(capability, {
          campaign_id: campaignId,
          run_id: identities.run_id,
        }),
      );
      if (!resultDocument) throw new Error("FALCON24_ANALYSIS_RESULT_NOT_STAGED");
      if (
        resultDocument.case_id !== testCase.case_id ||
        resultDocument.run_variant !== variant ||
        resultDocument.repetition !== repetition
      ) {
        throw new Error("FALCON24_ANALYSIS_RESULT_IDENTITY_INVALID");
      }
      const { trace, verified } = await loadAndVerifyTrace();
      const traceGateReceipt = requireValue(
        await campaignAuthority.loadTraceGate(capability, {
          campaign_id: campaignId,
          run_id: identities.run_id,
        }),
      );
      const uiTraceGateReceipt = requireValue(
        await campaignAuthority.loadUiTraceGate(capability, {
          campaign_id: campaignId,
          run_id: identities.run_id,
        }),
      );
      const detailClosure = verified.detail_closure;
      const requiredArtifactIdentities =
        exactRequiredFalcon24ArtifactReferences(trace).map(artifactReferenceIdentity);
      const openedArtifactIdentities =
        uiTraceGateReceipt?.opened_artifact_refs.map(artifactReferenceIdentity);
      const webBuildIdentity = getWebRuntimeBuildIdentity();
      if (
        !traceGateReceipt ||
        traceGateReceipt.trace_hash !== trace.trace_hash ||
        traceGateReceipt.node_count !== verified.node_count ||
        traceGateReceipt.edge_count !== verified.edge_count ||
        traceGateReceipt.detail_count !== verified.detail_count ||
        traceGateReceipt.sql_node_count !== verified.sql_node_count ||
        traceGateReceipt.query_evidence_node_count !== verified.query_evidence_node_count ||
        traceGateReceipt.analysis_evidence_node_count !== verified.analysis_evidence_node_count ||
        traceGateReceipt.chart_node_count !== verified.chart_node_count ||
        traceGateReceipt.report_node_count !== verified.report_node_count ||
        JSON.stringify(traceGateReceipt.detail_closure) !== JSON.stringify(detailClosure) ||
        !uiTraceGateReceipt ||
        uiTraceGateReceipt.trace_hash !== trace.trace_hash ||
        uiTraceGateReceipt.web_build.build_id !== webBuildIdentity.build_id ||
        uiTraceGateReceipt.web_build.generation_id !== webBuildIdentity.generation_id ||
        JSON.stringify(uiTraceGateReceipt.opened_nodes) !== JSON.stringify(detailClosure) ||
        JSON.stringify(openedArtifactIdentities) !== JSON.stringify(requiredArtifactIdentities)
      ) {
        throw new Error("FALCON24_UI_TRACE_STAGE_REQUIRED");
      }
      failureLayer = "SANDBOX_RECLAMATION";
      const receipt = requireValue(
        await campaignAuthority.loadSandboxReclamation(capability, {
          campaign_id: campaignId,
          run_id: identities.run_id,
        }),
      );
      if (!receipt) throw new Error("FALCON24_SANDBOX_RECLAMATION_RECEIPT_MISSING");
      const campaign = requireValue(
        await campaignAuthority.complete(capability, {
          campaign_id: campaignId,
          run_id: identities.run_id,
          result_document: resultDocument,
          sandbox_reclamation_hash: receipt.receipt_hash,
        }),
      );
      report({
        terminal: campaign.status === "PASSED" ? "PASSED" : "VERIFIED",
        campaign_id: campaignId,
        run_ordinal: runOrdinal,
        run_id: identities.run_id,
        trace_hash: trace.trace_hash,
        trace_gate_receipt_hash: traceGateReceipt.receipt_hash,
        ui_trace_gate_receipt_hash: uiTraceGateReceipt.receipt_hash,
        sandbox_reclamation_hash: receipt.receipt_hash,
        ...verified,
      });
      return;
    } catch (error) {
      if (stableErrorCode(error) === "FALCON24_FINALIZE_OUTCOME_UNKNOWN") {
        throw error;
      }
      const failure = failureAt(failureLayer, error);
      await holdCampaignAfterFailure({
        originalError: error,
        hold: () =>
          campaignAuthority.hold(capability, {
            campaign_id: campaignId,
            run_id: identities.run_id,
            ...failure,
          }),
      });
    }
  }

  const loadBinding = () =>
    getWorkspaceDataRepository().getRunBinding(capability, identities.run_id).then(requireValue);
  const resolveSubmitFailure = (error: unknown) =>
    resolveFalcon24SubmitFailure({
      original_error: error,
      resolve: (failureCode) =>
        campaignAuthority
          .resolveSubmitOutcome(capability, {
            campaign_id: campaignId,
            run_id: identities.run_id,
            observed_failure_code: failureCode,
          })
          .then(requireValue),
      load_binding: loadBinding,
    });
  const reportRecovered = (projection: unknown) =>
    report({
      terminal: "SUBMITTED_RECOVERED",
      campaign_id: campaignId,
      run_ordinal: runOrdinal,
      case_id: testCase.case_id,
      run_variant: variant,
      repetition,
      run_id: identities.run_id,
      projection,
    });

  const currentRun = await (async () => {
    try {
      return requireValue(
        await campaignAuthority.loadRun(capability, {
          campaign_id: campaignId,
          run_id: identities.run_id,
        }),
      );
    } catch (error) {
      reportRecovered(await resolveSubmitFailure(error));
      return undefined;
    }
  })();
  if (currentRun === undefined) return;
  if (!currentRun) {
    reportRecovered(await resolveSubmitFailure(new Error("FALCON24_RUN_NOT_FOUND")));
    return;
  }
  if (currentRun.status === "CLAIMED") {
    reportRecovered(await resolveSubmitFailure(new Error("FALCON24_CLAIM_ORPHANED")));
    return;
  }
  if (currentRun.status !== "PLANNED") {
    reportRecovered(await resolveSubmitFailure(new Error("FALCON24_RUN_ORDER_OR_STATE_INVALID")));
    return;
  }

  const loadSubmitPreflight = async () => {
    requireStrictPolicy(environment);
    const [
      campaign,
      builtinAuthority,
      sourceFingerprint,
      runtimeAttestationHash,
      currentAuthority,
    ] = await Promise.all([
      campaignAuthority.load(capability, { campaign_id: campaignId }).then(requireValue),
      loadBuiltinTeamAuthority(),
      committedSourceFingerprint(root),
      sha256ContentHash(
        JSON.parse(
          await readFile(
            resolve(root, "infra/docker/opensandbox-analysis-attestation.json"),
            "utf8",
          ),
        ),
      ),
      epochAuthority.loadCurrent(capability).then(requireValue),
    ]);
    const currentCampaign = assertCurrentAttempt(campaign);
    if (
      !currentAuthority ||
      !["READY", "RUNNING"].includes(currentCampaign.status) ||
      currentCampaign.next_run_ordinal !== runOrdinal ||
      currentCampaign.winning_qualification_attempt_id !== winningQualificationAttemptId ||
      currentCampaign.authority_baseline_hash !== currentAuthority.baseline_hash ||
      currentCampaign.frozen_contract_hash !== builtinAuthority.frozen_contract_hash ||
      currentCampaign.source_fingerprint !== sourceFingerprint ||
      currentCampaign.runtime_attestation_hash !== runtimeAttestationHash
    ) {
      throw new Error("FALCON24_CAMPAIGN_FROZEN_AUTHORITY_MISMATCH");
    }
    const defaults = requireValue(
      await getEffectiveConfigResolver().getWorkspaceDefaults(capability),
    );
    const model = defaults?.revision.defaults.model;
    const datasource = defaults?.revision.defaults.datasource;
    if (!model || !datasource) throw new Error("FALCON24_ANALYSIS_DEFAULTS_REQUIRED");
    const conversations = getWorkspaceDataRepository();
    const existing = requireValue(
      await conversations.getConversation(capability, identities.conversationId),
    );
    if (!existing) {
      requireValue(
        await conversations.createConversation(capability, {
          schema_version: "workspace-conversation-create@1.0.0",
          conversation_id: identities.conversationId,
          title: `Falcon24 ${campaignId} ${testCase.case_id} ${variant}-${repetition}`,
          datasource_id: datasource.resource_id,
          model_id: null,
          model_profile_id: model.resource_id,
        }),
      );
    }
    const browserWidth = argument("browser-width") === "390" ? 390 : 1440;
    await preflightFalcon24BrowserSubmission({
      session: z.string().min(1).parse(argument("browser-session")),
      web_base_url: z.string().url().parse(argument("web-base-url")),
      workspace_id: scope.workspaceId,
      conversation_id: identities.conversationId,
      expected_run_id: identities.run_id,
      expected_web_build: getWebRuntimeBuildIdentity(),
      viewport: { width: browserWidth, height: browserWidth === 390 ? 844 : 900 },
    });
  };
  try {
    await loadSubmitPreflight();
  } catch (error) {
    report({
      terminal: "PREFLIGHT_REJECTED",
      campaign_id: campaignId,
      attempt_id: attemptId,
      run_ordinal: runOrdinal,
      reason_code: stableErrorCode(error),
    });
    return;
  }

  try {
    requireValue(await campaignAuthority.claim(capability, claim));
  } catch (error) {
    reportRecovered(await resolveSubmitFailure(error));
    return;
  }

  try {
    const browserWidth = argument("browser-width") === "390" ? 390 : 1440;
    const submitted = await submitFalcon24QuestionFromBrowser({
      session: z.string().min(1).parse(argument("browser-session")),
      web_base_url: z.string().url().parse(argument("web-base-url")),
      workspace_id: scope.workspaceId,
      conversation_id: identities.conversationId,
      expected_run_id: identities.run_id,
      question: testCase.question,
      viewport: { width: browserWidth, height: browserWidth === 390 ? 844 : 900 },
      claim: {
        schema_version: "falcon24-e1-browser-submit-claim@1.0.0",
        question: testCase.question,
        conversation_id: identities.conversationId,
        idempotency_key: identities.idempotencyKey,
        acceptance_fence: {
          authority_kind: "FINAL_CAMPAIGN",
          campaign_id: "E1-C1",
          attempt_id: attemptId,
          run_id: identities.run_id,
          claim_fence_token: claimFenceToken,
        },
      },
    });
    report({
      terminal: "SUBMITTED",
      campaign_id: campaignId,
      run_ordinal: runOrdinal,
      case_id: testCase.case_id,
      run_variant: variant,
      repetition,
      run_id: identities.run_id,
      browser_submission: submitted,
    });
  } catch (error) {
    reportRecovered(await resolveSubmitFailure(error));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
    .catch((error: unknown) => {
      report({
        terminal: "HOLD",
        reason_code: stableErrorCode(error),
        error_name:
          error instanceof Error && /^[A-Za-z][A-Za-z0-9_.]{0,127}$/u.test(error.name)
            ? error.name
            : null,
        validation_issues:
          error instanceof z.ZodError
            ? error.issues.slice(0, 16).map((issue) => ({
                path: issue.path.length === 0 ? "$" : issue.path.map(String).join("."),
                code: issue.code,
              }))
            : [],
        hold_failure_code:
          error instanceof Falcon24CampaignHoldDiagnosticError ? error.hold_failure_code : null,
      });
      process.exitCode = 2;
    })
    .finally(async () => {
      await closeWorkspaceIdentityRuntime();
    });
}
