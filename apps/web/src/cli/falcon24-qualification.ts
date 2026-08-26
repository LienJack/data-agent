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
  buildFalcon24QualificationManifest,
  buildFalcon24ResolutionTraceGateReceipt,
  buildFalcon24ResolutionTraceUiGateReceipt,
  FALCON24_QUALIFICATION_EXPECTED_PATH,
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  type Falcon24AcceptanceFailureLayer,
  falcon24QualificationIdSchema,
} from "@data-agent/contracts/evals";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts/statistical-operators";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "@data-agent/evals";
import { createPostgresRepository } from "@data-agent/platform/persistence";
import { createPostgresFalcon24QualificationAuthority } from "@data-agent/platform/runs";
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
import { startQuestionRun } from "@/server/qa/start-question-run";
import {
  committedSourceFingerprint,
  Falcon24CampaignHoldDiagnosticError,
  failureAt,
  holdCampaignAfterFailure,
  requireSucceededFalcon24Run,
  resolveFalcon24SubmitFailure,
  stableErrorCode,
} from "./falcon24-agent-acceptance";
import {
  exactRequiredFalcon24ArtifactReferences,
  runFalcon24BrowserTraceGate,
} from "./falcon24-browser-trace-gate";
import { verifyFalcon24ResolutionTraceGate } from "./falcon24-resolution-trace-gate";

const execFileAsync = promisify(execFile);
const scopeSchema = z.strictObject({
  deploymentId: z.uuid(),
  workspaceId: z.uuid(),
  principalId: z.uuid(),
});

const G1_PROMPT =
  "最近12个完整月的订单收入有没有持续上升或下降趋势？请说明趋势强度，并提供一张月度折线图。";
const G2_PROMPTS = Object.freeze([
  "最近18个完整月的订单收入按月有什么变化？生成折线图。",
  "最近12个完整月的平均配送时长按月有什么变化？生成折线图。",
  "最近12个完整月各商品的库存损坏率是多少？展示损坏率最高的商品。",
  "过去一年多不同营销渠道的 ROAS 有什么差异？生成渠道对比图。",
  "不同注册月份新客户的第6个月留存率有什么差异？生成 Cohort 趋势图。",
] as const);

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

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function qualificationRunIdentity(input: {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly qualificationId: string;
  readonly slotId: string;
}) {
  const material = `${input.qualificationId}:${input.slotId}`;
  const idempotencyKey = stableUuid(`falcon24:qualification:${material}`);
  return {
    ...deriveRunCommandIdentities({
      workspace_id: input.workspaceId,
      principal_id: input.principalId,
      idempotency_key: idempotencyKey,
    }),
    idempotencyKey,
    conversationId: stableUuid(`falcon24:qualification:conversation:${material}`),
  };
}

async function sourceCommit(root: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
  return z
    .string()
    .regex(/^[0-9a-f]{40}$/u)
    .parse(stdout.trim());
}

async function main(): Promise<void> {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
  Object.assign(process.env, environment);
  const command = process.argv[2];
  if (!["manifest", "submit", "status", "trace", "finalize"].includes(command ?? "")) {
    throw new Error("FALCON24_QUALIFICATION_COMMAND_INVALID");
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
  const qualificationId = falcon24QualificationIdSchema.parse(argument("qualification-id"));
  const workspaceAuthority = getWorkspaceAuthority();
  const capability = requireValue(
    await workspaceAuthority.resolveForServerContext({
      deployment_id: scope.deploymentId,
      workspace_id: scope.workspaceId,
      principal_id: scope.principalId,
      access: "WRITE",
    }),
  );
  const qualificationAuthority = createPostgresFalcon24QualificationAuthority({
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

  const slotMaterials = await (async () => {
    const fullPrompts = suite.cases.map(({ question }) => question);
    const stages = [
      "G1",
      ...Array(5).fill("G2"),
      ...Array(5).fill("G3"),
      ...Array(5).fill("G4"),
    ] as const;
    return Promise.all(
      stages.map(async (stage, ordinal) => {
        const stageStart = stage === "G1" ? 0 : stage === "G2" ? 1 : stage === "G3" ? 6 : 11;
        const position = ordinal - stageStart;
        const testCase = suite.cases[stage === "G1" ? 0 : position];
        if (!testCase) throw new Error("FALCON24_QUALIFICATION_CASE_MISSING");
        const prompt =
          stage === "G1"
            ? G1_PROMPT
            : stage === "G2"
              ? G2_PROMPTS[position]
              : fullPrompts[position];
        if (!prompt) throw new Error("FALCON24_QUALIFICATION_PROMPT_MISSING");
        const slotId = `${stage}-${String(position + 1).padStart(2, "0")}`;
        const identities = qualificationRunIdentity({
          workspaceId: scope.workspaceId,
          principalId: scope.principalId,
          qualificationId,
          slotId,
        });
        return {
          ordinal,
          slot_id: slotId,
          stage,
          run_id: identities.run_id,
          case_id: testCase.case_id,
          prompt,
          prompt_hash: await sha256ContentHash(prompt),
          run_variant: stage === "G4" ? ("COLD" as const) : ("WARM" as const),
          expected_path: [...FALCON24_QUALIFICATION_EXPECTED_PATH],
          identities,
        };
      }),
    );
  })();

  if (command === "manifest") {
    requireStrictPolicy(environment);
    const qualificationVersion = z.coerce
      .number()
      .int()
      .positive()
      .parse(argument("qualification-version"));
    const [source_commit, source_fingerprint, runtimeAttestationHash, builtinAuthority, defaults] =
      await Promise.all([
        sourceCommit(root),
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
        getEffectiveConfigResolver().getWorkspaceDefaults(capability).then(requireValue),
      ]);
    const selected = defaults?.revision.defaults;
    if (
      !selected?.semantic_release ||
      !selected.schema_snapshot ||
      !selected.model ||
      !selected.datasource
    ) {
      throw new Error("FALCON24_QUALIFICATION_DEFAULTS_REQUIRED");
    }
    const webBuildHash = await sha256ContentHash(getWebRuntimeBuildIdentity());
    const manifest = await buildFalcon24QualificationManifest({
      schema_version: "falcon24-qualification-manifest@1.0.0",
      qualification_id: qualificationId,
      qualification_version: qualificationVersion,
      source_commit,
      source_fingerprint,
      frozen_contract_hash: builtinAuthority.frozen_contract_hash,
      semantic_release_hash: selected.semantic_release.resource_hash,
      schema_snapshot_hash: selected.schema_snapshot.resource_hash,
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      model_provider: "deepseek",
      model_id: suite.model_id,
      model_config_hash: selected.model.resource_hash,
      web_build_hash: webBuildHash,
      runtime_attestation_hash: runtimeAttestationHash,
      slots: slotMaterials.map(({ identities: _identities, ...slot }) => slot),
    });
    const qualification = requireValue(await qualificationAuthority.begin(capability, manifest));
    const outputPath = resolve(
      root,
      argument("output") ?? "artifacts/falcon24-agent-analysis/qualification-manifest.json",
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    report({
      terminal: "READY",
      qualification_id: qualificationId,
      qualification_version: qualification.qualification_version,
      slot_count: manifest.slots.length,
      source_commit,
      source_fingerprint,
      frozen_contract_hash: manifest.frozen_contract_hash,
      semantic_release_hash: manifest.semantic_release_hash,
      schema_snapshot_hash: manifest.schema_snapshot_hash,
      operator_registry_digest: manifest.operator_registry_digest,
      model_config_hash: manifest.model_config_hash,
      web_build_hash: manifest.web_build_hash,
      runtime_attestation_hash: manifest.runtime_attestation_hash,
      output_path: outputPath,
    });
    return;
  }

  const ordinal = z.coerce.number().int().min(0).max(15).parse(argument("ordinal"));
  const slot = slotMaterials[ordinal];
  if (!slot) throw new Error("FALCON24_QUALIFICATION_SLOT_MISSING");
  const identity = { qualification_id: qualificationId, run_id: slot.run_id } as const;

  if (command === "status") {
    const [qualification, qualificationSlot, persistedRun, binding] = await Promise.all([
      qualificationAuthority
        .load(capability, { qualification_id: qualificationId })
        .then(requireValue),
      qualificationAuthority.loadSlot(capability, identity).then(requireValue),
      runRepository.getRun(capability, { run_id: slot.run_id }).then(requireValue),
      getWorkspaceDataRepository().getRunBinding(capability, slot.run_id).then(requireValue),
    ]);
    report({
      terminal: "STATUS",
      hard_stopped: qualification?.status === "HOLD" || qualificationSlot?.status === "HOLD",
      qualification,
      slot: qualificationSlot,
      persisted_run: persistedRun,
      binding,
    });
    return;
  }

  const hold = async (layer: Falcon24AcceptanceFailureLayer, error: unknown): Promise<never> =>
    holdCampaignAfterFailure({
      originalError: error,
      hold: () =>
        qualificationAuthority.hold(capability, {
          ...identity,
          ...failureAt(layer, error),
        }),
    });

  const loadAndVerifyTrace = async () => {
    const persistedRun = requireValue(
      await runRepository.getRun(capability, { run_id: slot.run_id }),
    );
    requireSucceededFalcon24Run(persistedRun, slot.run_id);
    const projector = getResolutionTraceProjector();
    const trace = requireValue(
      await projector.loadTrace(capability, { scope: capability.scope, run_id: slot.run_id }),
    );
    if (!trace) throw new Error("FALCON24_RESOLUTION_TRACE_EMPTY");
    const details = [];
    for (const { node_id: nodeId } of trace.nodes) {
      const detail = requireValue(
        await projector.loadDetail(capability, {
          scope: capability.scope,
          run_id: slot.run_id,
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
        campaign_id: qualificationId,
        run_id: slot.run_id,
        trace_hash: trace.trace_hash,
        ...verified,
        verified_at: new Date().toISOString(),
      });
      requireValue(
        await qualificationAuthority.stageTrace(capability, {
          ...identity,
          receipt: traceGateReceipt,
        }),
      );
      if (trace.conversation_id !== slot.identities.conversationId) {
        throw new Error("FALCON24_BROWSER_CONVERSATION_IDENTITY_INVALID");
      }
      const screenshotPath = resolve(
        root,
        argument("browser-screenshot") ??
          `artifacts/falcon24-agent-analysis/browser/${qualificationId}/${slot.run_id}.png`,
      );
      await mkdir(dirname(screenshotPath), { recursive: true });
      const browserWidth = argument("browser-width") === "390" ? 390 : 1440;
      const browserGate = await runFalcon24BrowserTraceGate({
        session: z.string().min(1).parse(argument("browser-session")),
        web_base_url: z.string().url().parse(argument("web-base-url")),
        screenshot_path: screenshotPath,
        workspace_id: scope.workspaceId,
        conversation_id: slot.identities.conversationId,
        question: slot.prompt,
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
        campaign_id: qualificationId,
        run_id: slot.run_id,
        workspace_id: scope.workspaceId,
        conversation_id: slot.identities.conversationId,
        trace_hash: trace.trace_hash,
        ...browserObservation,
      });
      requireValue(
        await qualificationAuthority.stageUiTrace(capability, {
          ...identity,
          receipt: uiTraceGateReceipt,
        }),
      );
      report({
        terminal: "TRACE_UI_VERIFIED",
        qualification_id: qualificationId,
        slot_id: slot.slot_id,
        run_id: slot.run_id,
        trace_hash: trace.trace_hash,
        trace_gate_receipt_hash: traceGateReceipt.receipt_hash,
        ui_trace_gate_receipt_hash: uiTraceGateReceipt.receipt_hash,
        screenshot_hash: uiTraceGateReceipt.screenshot_hash,
        ...verified,
      });
      return;
    } catch (error) {
      await hold("PUBLISHER", error);
    }
  }

  if (command === "finalize") {
    let failureLayer: Falcon24AcceptanceFailureLayer = "PUBLISHER";
    try {
      requireStrictPolicy(environment);
      const current = requireValue(await qualificationAuthority.loadSlot(capability, identity));
      if (
        !current?.result_document ||
        !current.trace_gate_receipt ||
        !current.ui_trace_gate_receipt
      ) {
        throw new Error("FALCON24_QUALIFICATION_PUBLISHER_CLOSURE_REQUIRED");
      }
      const { trace, verified } = await loadAndVerifyTrace();
      const requiredArtifactIdentities =
        exactRequiredFalcon24ArtifactReferences(trace).map(artifactReferenceIdentity);
      const openedArtifactIdentities =
        current.ui_trace_gate_receipt.opened_artifact_refs.map(artifactReferenceIdentity);
      const webBuildIdentity = getWebRuntimeBuildIdentity();
      if (
        current.trace_gate_receipt.trace_hash !== trace.trace_hash ||
        current.ui_trace_gate_receipt.trace_hash !== trace.trace_hash ||
        current.ui_trace_gate_receipt.web_build.build_id !== webBuildIdentity.build_id ||
        current.ui_trace_gate_receipt.web_build.generation_id !== webBuildIdentity.generation_id ||
        JSON.stringify(current.ui_trace_gate_receipt.opened_nodes) !==
          JSON.stringify(verified.detail_closure) ||
        JSON.stringify(openedArtifactIdentities) !== JSON.stringify(requiredArtifactIdentities)
      ) {
        throw new Error("FALCON24_QUALIFICATION_UI_TRACE_REQUIRED");
      }
      failureLayer = "SANDBOX_RECLAMATION";
      if (!current.sandbox_reclamation_receipt || !current.sandbox_reclamation_hash) {
        throw new Error("FALCON24_QUALIFICATION_SANDBOX_RECLAMATION_REQUIRED");
      }
      const qualification = requireValue(
        await qualificationAuthority.complete(capability, {
          ...identity,
          result_document: current.result_document,
          sandbox_reclamation_hash: current.sandbox_reclamation_hash,
        }),
      );
      report({
        terminal: qualification.status === "PASSED" ? "PASSED" : "VERIFIED",
        qualification_id: qualificationId,
        slot_id: slot.slot_id,
        stage: slot.stage,
        run_id: slot.run_id,
        next_slot_ordinal: qualification.next_slot_ordinal,
      });
      return;
    } catch (error) {
      await hold(failureLayer, error);
    }
  }

  const loadBinding = () =>
    getWorkspaceDataRepository().getRunBinding(capability, slot.run_id).then(requireValue);
  const resolveSubmitFailure = (error: unknown) =>
    resolveFalcon24SubmitFailure({
      original_error: error,
      resolve: (failureCode) =>
        qualificationAuthority
          .resolveSubmitOutcome(capability, {
            ...identity,
            observed_failure_code: failureCode,
          })
          .then(requireValue),
      load_binding: loadBinding,
    });
  const reportRecovered = (projection: unknown) =>
    report({
      terminal: "SUBMITTED_RECOVERED",
      qualification_id: qualificationId,
      slot_id: slot.slot_id,
      run_id: slot.run_id,
      projection,
    });

  const currentSlot = requireValue(await qualificationAuthority.loadSlot(capability, identity));
  if (!currentSlot) {
    reportRecovered(await resolveSubmitFailure(new Error("FALCON24_QUALIFICATION_SLOT_NOT_FOUND")));
    return;
  }
  if (currentSlot.status !== "PLANNED") {
    reportRecovered(
      await resolveSubmitFailure(new Error("FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID")),
    );
    return;
  }
  const claimFenceToken = randomUUID();
  try {
    requireValue(
      await qualificationAuthority.claim(capability, {
        qualification_id: qualificationId,
        ordinal: slot.ordinal,
        slot_id: slot.slot_id,
        stage: slot.stage,
        run_id: slot.run_id,
        case_id: slot.case_id,
        run_variant: slot.run_variant,
        claim_fence_token: claimFenceToken,
      }),
    );
  } catch (error) {
    reportRecovered(await resolveSubmitFailure(error));
    return;
  }

  let preflight: {
    readonly builtinAuthority: Awaited<ReturnType<typeof loadBuiltinTeamAuthority>>;
    readonly datasource: { readonly resource_id: string };
    readonly model: { readonly resource_id: string };
  };
  try {
    requireStrictPolicy(environment);
    const [qualification, builtinAuthority, source_fingerprint, defaults] = await Promise.all([
      qualificationAuthority
        .load(capability, { qualification_id: qualificationId })
        .then(requireValue),
      loadBuiltinTeamAuthority(),
      committedSourceFingerprint(root),
      getEffectiveConfigResolver().getWorkspaceDefaults(capability).then(requireValue),
    ]);
    const selected = defaults?.revision.defaults;
    const webBuildHash = await sha256ContentHash(getWebRuntimeBuildIdentity());
    if (
      qualification?.status !== "RUNNING" ||
      qualification.next_slot_ordinal !== ordinal ||
      qualification.source_commit !== (await sourceCommit(root)) ||
      qualification.source_fingerprint !== source_fingerprint ||
      qualification.frozen_contract_hash !== builtinAuthority.frozen_contract_hash ||
      qualification.semantic_release_hash !== selected?.semantic_release?.resource_hash ||
      qualification.schema_snapshot_hash !== selected.schema_snapshot?.resource_hash ||
      qualification.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST ||
      qualification.model_config_hash !== selected.model?.resource_hash ||
      qualification.web_build_hash !== webBuildHash ||
      !selected.datasource ||
      !selected.model
    ) {
      throw new Error("FALCON24_QUALIFICATION_FROZEN_AUTHORITY_MISMATCH");
    }
    preflight = {
      builtinAuthority,
      datasource: selected.datasource,
      model: selected.model,
    };
  } catch (error) {
    reportRecovered(await resolveSubmitFailure(error));
    return;
  }

  try {
    const conversations = getWorkspaceDataRepository();
    const existing = requireValue(
      await conversations.getConversation(capability, slot.identities.conversationId),
    );
    if (!existing) {
      requireValue(
        await conversations.createConversation(capability, {
          schema_version: "workspace-conversation-create@1.0.0",
          conversation_id: slot.identities.conversationId,
          title: `Falcon24 ${qualificationId} ${slot.slot_id}`,
          datasource_id: preflight.datasource.resource_id,
          model_id: null,
          model_profile_id: preflight.model.resource_id,
        }),
      );
    }
    const submitted = await startQuestionRun({
      acceptance_fence: {
        authority_kind: "QUALIFICATION",
        qualification_id: qualificationId,
        run_id: slot.run_id,
        claim_fence_token: claimFenceToken,
      },
      capability,
      conversation_id: slot.identities.conversationId,
      files: [],
      idempotency_key: slot.identities.idempotencyKey,
      principal_id: scope.principalId,
      question: slot.prompt,
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
      qualification_id: qualificationId,
      slot_id: slot.slot_id,
      stage: slot.stage,
      run_id: slot.run_id,
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
        hold_failure_code:
          error instanceof Falcon24CampaignHoldDiagnosticError ? error.hold_failure_code : null,
      });
      process.exitCode = 2;
    })
    .finally(async () => {
      await closeWorkspaceIdentityRuntime();
    });
}
