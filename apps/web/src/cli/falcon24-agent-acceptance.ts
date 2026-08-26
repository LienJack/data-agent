import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { BuiltinTeamProfileSetSnapshot } from "@data-agent/agent-runtime";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24AcceptanceRunManifest,
  buildFalcon24ResolutionTraceGateReceipt,
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  type Falcon24AcceptanceFailureLayer,
  falcon24AcceptanceCampaignIdSchema,
} from "@data-agent/contracts/evals";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "@data-agent/evals";
import { createPostgresRepository } from "@data-agent/platform/persistence";
import {
  createPostgresFalcon24AcceptanceCampaignAuthority,
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
import { startQuestionRun } from "@/server/qa/start-question-run";
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
  readonly caseId: string;
  readonly variant: "COLD" | "WARM";
  readonly repetition: number;
}) {
  const material = `${input.campaignId}:${input.caseId}:${input.variant}:${input.repetition}`;
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

function stableErrorCode(error: unknown): string {
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

function failureAt(
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
    const campaignVersion = z.coerce.number().int().positive().parse(argument("campaign-version"));
    const sourceFingerprint = await committedSourceFingerprint(root);
    const runtimeAttestationHash = await sha256ContentHash(
      JSON.parse(
        await readFile(resolve(root, "infra/docker/opensandbox-analysis-attestation.json"), "utf8"),
      ),
    );
    const builtinAuthority = await loadBuiltinTeamAuthority();
    const runs = suite.cases.flatMap((testCase) =>
      (["COLD", "WARM"] as const).flatMap((variant) =>
        [1, 2, 3].map((repetition) => ({
          run_id: runIdentity({
            workspaceId: scope.workspaceId,
            principalId: scope.principalId,
            campaignId,
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
      campaign_version: campaignVersion,
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
      campaign_version: campaign.campaign_version,
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

  if (command === "status") {
    const [binding, campaignRun, persistedRun] = await Promise.all([
      getWorkspaceDataRepository().getRunBinding(capability, identities.run_id).then(requireValue),
      campaignAuthority
        .loadRun(capability, { campaign_id: campaignId, run_id: identities.run_id })
        .then(requireValue),
      runRepository.getRun(capability, { run_id: identities.run_id }).then(requireValue),
    ]);
    report({
      ...projectFalcon24AcceptanceStatus(campaignRun, persistedRun),
      campaign_id: campaignId,
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
        }),
      );
      if (!detail || detail.node_id !== nodeId) {
        throw new Error("FALCON24_RESOLUTION_TRACE_DETAIL_INVALID");
      }
      details.push(detail);
    }
    return { trace, verified: verifyFalcon24ResolutionTraceGate(trace, details) };
  };

  if (command === "trace") {
    try {
      requireStrictPolicy(environment);
      const { trace, verified } = await loadAndVerifyTrace();
      const traceGateReceipt = await buildFalcon24ResolutionTraceGateReceipt({
        schema_version: "falcon24-resolution-trace-gate-receipt@1.0.0",
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
      report({
        terminal: "TRACE_VERIFIED",
        campaign_id: campaignId,
        run_ordinal: runOrdinal,
        case_id: testCase.case_id,
        run_variant: variant,
        repetition,
        run_id: identities.run_id,
        trace_hash: trace.trace_hash,
        trace_gate_receipt_hash: traceGateReceipt.receipt_hash,
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
        traceGateReceipt.report_node_count !== verified.report_node_count
      ) {
        throw new Error("FALCON24_TRACE_STAGE_REQUIRED");
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

  try {
    requireValue(await campaignAuthority.claim(capability, claim));
  } catch (error) {
    reportRecovered(await resolveSubmitFailure(error));
    return;
  }

  const loadSubmitPreflight = async () => {
    requireStrictPolicy(environment);
    const [campaign, builtinAuthority, sourceFingerprint, runtimeAttestationHash] =
      await Promise.all([
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
      ]);
    if (
      campaign?.status !== "RUNNING" ||
      campaign.next_run_ordinal !== runOrdinal ||
      campaign.frozen_contract_hash !== builtinAuthority.frozen_contract_hash ||
      campaign.source_fingerprint !== sourceFingerprint ||
      campaign.runtime_attestation_hash !== runtimeAttestationHash
    ) {
      throw new Error("FALCON24_CAMPAIGN_FROZEN_AUTHORITY_MISMATCH");
    }
    const defaults = requireValue(
      await getEffectiveConfigResolver().getWorkspaceDefaults(capability),
    );
    const model = defaults?.revision.defaults.model;
    const datasource = defaults?.revision.defaults.datasource;
    if (!model || !datasource) throw new Error("FALCON24_ANALYSIS_DEFAULTS_REQUIRED");
    return { builtinAuthority, datasource, model };
  };
  let preflight: Awaited<ReturnType<typeof loadSubmitPreflight>>;
  try {
    preflight = await loadSubmitPreflight();
  } catch (error) {
    reportRecovered(await resolveSubmitFailure(error));
    return;
  }

  try {
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
          datasource_id: preflight.datasource.resource_id,
          model_id: null,
          model_profile_id: preflight.model.resource_id,
        }),
      );
    }
    const submitted = await startQuestionRun({
      acceptance_fence: {
        campaign_id: campaignId,
        run_id: identities.run_id,
        claim_fence_token: claimFenceToken,
      },
      capability,
      conversation_id: identities.conversationId,
      files: [],
      idempotency_key: identities.idempotencyKey,
      principal_id: scope.principalId,
      question: testCase.question,
      rollout_bootstrap_mode: environment.DATA_AGENT_DISPATCH_BOOTSTRAP_MODE,
      scope: capability.scope,
      workspace_id: scope.workspaceId,
      expected_subagent_profile_refs: preflight.builtinAuthority.snapshot.profile_refs,
    });
    if (submitted.kind !== "CREATED") {
      throw new Error(
        submitted.kind === "ERROR" ? submitted.error.code : "FALCON24_ANALYSIS_RESOLUTION_REQUIRED",
      );
    }
    report({
      terminal: "SUBMITTED",
      campaign_id: campaignId,
      run_ordinal: runOrdinal,
      case_id: testCase.case_id,
      run_variant: variant,
      repetition,
      run_id: identities.run_id,
      projection: submitted.projection,
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
