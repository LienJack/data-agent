import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24DiagnosticAttempt,
  buildFalcon24DiagnosticAttemptV2,
  FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH,
  FALCON24_E4_DIAGNOSTIC_QUESTION,
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  falcon24DiagnosticFailureClassSchema,
} from "@data-agent/contracts/evals";
import {
  buildFalcon24QaE2eReceiptV2,
  buildFalcon24TraceUiReceiptV2,
  falcon24AuthorityEpochOrdinal,
  falcon24AuthorityEpochSchema,
} from "@data-agent/contracts/runs";
import { loadRuntimeBuildIdentity } from "@data-agent/contracts/server";
import { createPostgresRepository } from "@data-agent/platform/persistence";
import {
  createPostgresFalcon24AuthorityEpoch,
  createPostgresFalcon24DiagnosticAuthority,
  createPostgresFalcon24SemanticClosureReader,
} from "@data-agent/platform/runs";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import { z } from "zod";
import { deriveRunCommandIdentities } from "@/lib/run-command-identity";
import { getWebRuntimeBuildIdentity } from "@/lib/runtime-build-identity";
import {
  closeWorkspaceIdentityRuntime,
  getEffectiveConfigResolver,
  getResolutionTraceProjector,
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import {
  committedSourceFingerprint,
  requireSucceededFalcon24Run,
  stableErrorCode,
} from "./falcon24-agent-acceptance";
import {
  preflightFalcon24BrowserSubmission,
  runFalcon24BrowserTraceGate,
  submitFalcon24QuestionFromBrowser,
  verifyFalcon24UiReceiptPair,
} from "./falcon24-browser-trace-gate";
import { verifyFalcon24ResolutionTraceGate } from "./falcon24-resolution-trace-gate";

const execFileAsync = promisify(execFile);
const SEMANTIC_DOMAIN = "falcon24" as const;
const scopeSchema = z.strictObject({
  deploymentId: z.uuid(),
  workspaceId: z.uuid(),
  principalId: z.uuid(),
});

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

function diagnosticRunIdentity(input: {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly attemptId: string;
  readonly authorityEpoch: string;
}) {
  const idempotencyKey = stableUuid(
    `falcon24:${input.authorityEpoch}:diagnostic:${input.attemptId}`,
  );
  return Object.freeze({
    ...deriveRunCommandIdentities({
      workspace_id: input.workspaceId,
      principal_id: input.principalId,
      idempotency_key: idempotencyKey,
    }),
    idempotencyKey,
    conversationId: stableUuid(
      `falcon24:${input.authorityEpoch}:diagnostic:conversation:${input.attemptId}`,
    ),
  });
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
  if (!["manifest", "submit", "status", "trace", "complete", "fail"].includes(command ?? "")) {
    throw new Error("FALCON24_DIAGNOSTIC_COMMAND_INVALID");
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
  const attemptId = z.uuid().parse(argument("attempt-id"));
  const authorityEpoch = falcon24AuthorityEpochSchema.parse(
    argument("authority-epoch") ?? environment.FALCON24_AUTHORITY_EPOCH ?? "E4",
  );
  if (falcon24AuthorityEpochOrdinal(authorityEpoch) < 4n) {
    throw new Error("FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH");
  }
  const identities = diagnosticRunIdentity({
    workspaceId: scope.workspaceId,
    principalId: scope.principalId,
    attemptId,
    authorityEpoch,
  });
  const workspaceAuthority = getWorkspaceAuthority();
  const capability = requireValue(
    await workspaceAuthority.resolveForServerContext({
      deployment_id: scope.deploymentId,
      workspace_id: scope.workspaceId,
      principal_id: scope.principalId,
      access: command === "status" ? "READ" : "WRITE",
    }),
  );
  const sqlPool = getWorkspaceSqlPool();
  const diagnosticAuthority = createPostgresFalcon24DiagnosticAuthority({
    pool: sqlPool,
    authorizer: workspaceAuthority.authorizer,
  });
  const epochAuthority = createPostgresFalcon24AuthorityEpoch({
    pool: sqlPool,
    authorizer: workspaceAuthority.authorizer,
  });
  const runRepository = createPostgresRepository(sqlPool, workspaceAuthority.authorizer);

  const loadAttempt = async () => {
    const attempt = requireValue(await diagnosticAuthority.load(capability, attemptId));
    if (
      !attempt ||
      attempt.run_id !== identities.run_id ||
      attempt.authority_epoch !== authorityEpoch ||
      attempt.semantic_release_generation !== 2
    ) {
      throw new Error("FALCON24_DIAGNOSTIC_ATTEMPT_IDENTITY_MISMATCH");
    }
    return attempt;
  };

  if (command === "manifest") {
    requireStrictPolicy(environment);
    const [currentAuthority, closure, source_commit, source_fingerprint, runtimeAttestation] =
      await Promise.all([
        epochAuthority.loadCurrent(capability).then(requireValue),
        createPostgresFalcon24SemanticClosureReader({
          pool: sqlPool,
          authorizer: workspaceAuthority.authorizer,
        })
          .load(capability, { semantic_domain: SEMANTIC_DOMAIN })
          .then(requireValue),
        sourceCommit(root),
        committedSourceFingerprint(root),
        readFile(resolve(root, "infra/docker/opensandbox-analysis-attestation.json"), "utf8").then(
          (raw) => JSON.parse(raw) as unknown,
        ),
      ]);
    if (
      currentAuthority?.authority_epoch !== authorityEpoch ||
      closure.authority.authority_epoch !== authorityEpoch ||
      closure.authority.baseline_id !== currentAuthority.baseline_id ||
      closure.authority.baseline_hash !== currentAuthority.baseline_hash ||
      closure.semantic_pointer.release.generation !== 2 ||
      closure.semantic_pointer.release.release_id !== closure.semantic_runtime.release.release_id ||
      closure.semantic_pointer.release.release_digest !==
        closure.semantic_runtime.release.release_digest
    ) {
      throw new Error("FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH");
    }
    const webBuild = getWebRuntimeBuildIdentity();
    const workerBuildIdentityFile = z
      .string()
      .min(1)
      .parse(
        environment.FALCON24_WORKER_BUILD_IDENTITY_FILE ??
          (environment.DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE
            ? resolve(dirname(environment.DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE), "worker.json")
            : undefined),
      );
    const workerBuild = loadRuntimeBuildIdentity({
      expectedRole: "worker",
      environment: {
        ...environment,
        DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE: workerBuildIdentityFile,
      },
    });
    const manifestMaterial = {
      attempt_id: attemptId,
      run_id: identities.run_id,
      authority: {
        schema_version: "falcon24-authority-binding@2.0.0",
        authority_epoch: authorityEpoch,
        baseline_id: currentAuthority.baseline_id,
        baseline_hash: currentAuthority.baseline_hash,
        activation_attempt_id: currentAuthority.activation_attempt_id,
      },
      semantic_release: closure.semantic_pointer.release,
      source_commit,
      source_fingerprint,
      web_build: { build_id: webBuild.build_id, generation_id: webBuild.generation_id },
      worker_build: {
        build_id: workerBuild.build_id,
        generation_id: workerBuild.generation_id,
      },
      runtime_attestation_hash: await sha256ContentHash(runtimeAttestation),
      question: FALCON24_E4_DIAGNOSTIC_QUESTION,
      question_hash: await sha256ContentHash(FALCON24_E4_DIAGNOSTIC_QUESTION),
    } as const;
    const manifest =
      authorityEpoch === "E4"
        ? await buildFalcon24DiagnosticAttempt({
            ...manifestMaterial,
            schema_version: "falcon24-diagnostic-attempt@1.0.0",
          })
        : await buildFalcon24DiagnosticAttemptV2({
            ...manifestMaterial,
            schema_version: "falcon24-diagnostic-attempt@2.0.0",
          });
    const attempt = requireValue(await diagnosticAuthority.begin(capability, manifest));
    const defaults = requireValue(
      await getEffectiveConfigResolver().getWorkspaceDefaults(capability),
    )?.revision.defaults;
    if (!defaults?.datasource || !defaults.model) {
      throw new Error("FALCON24_DIAGNOSTIC_DEFAULTS_REQUIRED");
    }
    const conversations = getWorkspaceDataRepository();
    const existing = requireValue(
      await conversations.getConversation(capability, identities.conversationId),
    );
    if (!existing) {
      requireValue(
        await conversations.createConversation(capability, {
          schema_version: "workspace-conversation-create@1.0.0",
          conversation_id: identities.conversationId,
          title: `Falcon24 ${authorityEpoch} non-scoring diagnostic`,
          datasource_id: defaults.datasource.resource_id,
          model_id: null,
          model_profile_id: defaults.model.resource_id,
        }),
      );
    }
    report({
      terminal: "READY",
      attempt_id: attempt.attempt_id,
      run_id: attempt.run_id,
      conversation_id: identities.conversationId,
      manifest_hash: attempt.manifest_hash,
      question: FALCON24_E4_DIAGNOSTIC_QUESTION,
    });
    return;
  }

  if (command === "status") {
    const attempt = await loadAttempt();
    const [run, binding] = await Promise.all([
      runRepository.getRun(capability, { run_id: attempt.run_id }).then(requireValue),
      getWorkspaceDataRepository().getRunBinding(capability, attempt.run_id).then(requireValue),
    ]);
    report({ terminal: "STATUS", attempt, run, binding });
    return;
  }

  const attempt = await loadAttempt();
  if (command === "fail") {
    const receipt = requireValue(
      await diagnosticAuthority.complete(capability, {
        attempt_id: attemptId,
        outcome: "FAIL",
        failure_class: falcon24DiagnosticFailureClassSchema.parse(argument("failure-class")),
        failure_code: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{2,127}$/u)
          .parse(argument("failure-code")),
      }),
    );
    report({ terminal: "FAILED", receipt });
    return;
  }
  if (attempt.status !== "ACTIVE") {
    throw new Error("FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE");
  }
  requireStrictPolicy(environment);

  if (command === "submit") {
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
    const submitted = await submitFalcon24QuestionFromBrowser({
      session: z.string().min(1).parse(argument("browser-session")),
      web_base_url: z.string().url().parse(argument("web-base-url")),
      workspace_id: scope.workspaceId,
      conversation_id: identities.conversationId,
      expected_run_id: identities.run_id,
      question: FALCON24_E4_DIAGNOSTIC_QUESTION,
      viewport: { width: browserWidth, height: browserWidth === 390 ? 844 : 900 },
      claim: {
        schema_version: "falcon24-browser-diagnostic-submit-claim@1.0.0",
        question: FALCON24_E4_DIAGNOSTIC_QUESTION,
        conversation_id: identities.conversationId,
        idempotency_key: identities.idempotencyKey,
        diagnostic_attempt_id: attemptId,
        run_id: identities.run_id,
      },
    });
    report({ terminal: "SUBMITTED", ...submitted });
    return;
  }

  if (command === "trace") {
    const persistedRun = requireValue(
      await runRepository.getRun(capability, { run_id: attempt.run_id }),
    );
    requireSucceededFalcon24Run(persistedRun, attempt.run_id);
    const projector = getResolutionTraceProjector();
    const trace = requireValue(
      await projector.loadTrace(capability, { scope: capability.scope, run_id: attempt.run_id }),
    );
    if (!trace) throw new Error("FALCON24_RESOLUTION_TRACE_EMPTY");
    const details = [];
    for (const { node_id: nodeId } of trace.nodes) {
      const detail = requireValue(
        await projector.loadDetail(capability, {
          scope: capability.scope,
          run_id: attempt.run_id,
          node_id: nodeId,
          expected_trace_hash: trace.trace_hash,
        }),
      );
      if (!detail || detail.node_id !== nodeId) {
        throw new Error("FALCON24_RESOLUTION_TRACE_DETAIL_INVALID");
      }
      details.push(detail);
    }
    verifyFalcon24ResolutionTraceGate(trace, details);
    const browserWidth = argument("browser-width") === "390" ? 390 : 1440;
    const screenshotPath = resolve(
      root,
      argument("browser-screenshot") ??
        `artifacts/falcon24-agent-analysis/browser/${authorityEpoch}-DIAGNOSTIC/${attempt.run_id}.png`,
    );
    await mkdir(dirname(screenshotPath), { recursive: true });
    const observation = await runFalcon24BrowserTraceGate({
      session: z.string().min(1).parse(argument("browser-session")),
      web_base_url: z.string().url().parse(argument("web-base-url")),
      screenshot_path: screenshotPath,
      workspace_id: scope.workspaceId,
      conversation_id: identities.conversationId,
      question: FALCON24_E4_DIAGNOSTIC_QUESTION,
      attempt_id: attemptId,
      authority_epoch: authorityEpoch,
      submission_kind: "DIAGNOSTIC",
      viewport: { width: browserWidth, height: browserWidth === 390 ? 844 : 900 },
      trace,
      details,
    });
    const runAuthority = requireValue(
      await epochAuthority.loadRunBinding(capability, { run_id: attempt.run_id }),
    );
    if (
      runAuthority.schema_version !== "falcon24-authority-binding@2.0.0" ||
      runAuthority.authority_epoch !== authorityEpoch ||
      runAuthority.baseline_id !== attempt.authority_baseline_id ||
      runAuthority.baseline_hash !== attempt.authority_baseline_hash
    ) {
      throw new Error("FALCON24_DIAGNOSTIC_RUN_AUTHORITY_MISMATCH");
    }
    const qaE2eReceipt = await buildFalcon24QaE2eReceiptV2({
      schema_version: "falcon24-qa-e2e-receipt@2.0.0",
      run_id: attempt.run_id,
      conversation_id: identities.conversationId,
      authority: runAuthority,
      web_build: observation.qa_e2e.web_build,
      browser_harness_version: observation.qa_e2e.browser_harness_version,
      viewport: observation.qa_e2e.viewport,
      entry_path: "QUESTION_COMPOSER_SUBMIT_TO_RESULT",
      question_hash: observation.qa_e2e.question_hash,
      terminal_status: observation.qa_e2e.terminal_status,
      answer_visible: observation.qa_e2e.answer_visible,
      table_visible: observation.qa_e2e.table_visible,
      chart_rendered: observation.qa_e2e.chart_rendered,
      report_visible: observation.qa_e2e.report_visible,
      error_banner: null,
      dom_snapshot_hash: observation.qa_e2e.dom_snapshot_hash,
      screenshot_hash: observation.qa_e2e.screenshot_hash,
      observed_at: observation.qa_e2e.observed_at,
    });
    const traceUiReceipt = await buildFalcon24TraceUiReceiptV2({
      schema_version: "falcon24-trace-ui-receipt@2.0.0",
      run_id: attempt.run_id,
      conversation_id: identities.conversationId,
      trace_hash: trace.trace_hash,
      authority: runAuthority,
      web_build: observation.trace_ui.web_build,
      browser_harness_version: "falcon24-agent-browser-trace-gate@2.0.0",
      viewport: { width: browserWidth, height: browserWidth === 390 ? 844 : 900 },
      entry_path: "RESULT_TRACE_ENTRY_TO_EXACT_RUN",
      opened_nodes: observation.trace_ui.opened_nodes,
      opened_artifact_refs: observation.trace_ui.opened_artifact_refs,
      chart_ref: observation.trace_ui.chart_ref,
      chart_rendered: true,
      source_table_visible: true,
      returned_to_result: true,
      error_banner: null,
      dom_snapshot_hash: observation.trace_ui.dom_snapshot_hash,
      screenshot_hash: observation.trace_ui.screenshot_hash,
      observed_at: observation.trace_ui.observed_at,
    });
    verifyFalcon24UiReceiptPair({ qa_e2e: qaE2eReceipt, trace_ui: traceUiReceipt });
    requireValue(await epochAuthority.commitUiReceipt(capability, qaE2eReceipt));
    requireValue(await epochAuthority.commitUiReceipt(capability, traceUiReceipt));
    report({
      terminal: "TRACE_UI_VERIFIED",
      attempt_id: attemptId,
      run_id: attempt.run_id,
      trace_hash: trace.trace_hash,
      qa_e2e_receipt_hash: qaE2eReceipt.receipt_hash,
      trace_ui_receipt_hash: traceUiReceipt.receipt_hash,
    });
    return;
  }

  const reclamationPath = z.string().min(1).parse(argument("reclamation-receipt"));
  const reclamationReceipt = JSON.parse(await readFile(resolve(root, reclamationPath), "utf8"));
  const receipt = requireValue(
    await diagnosticAuthority.complete(capability, {
      attempt_id: attemptId,
      outcome: "PASS",
      viewport_width: argument("browser-width") === "390" ? 390 : 1440,
      observed_execution_path: FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH,
      sandbox_reclamation_receipt: reclamationReceipt,
    }),
  );
  report({ terminal: "PASSED", receipt });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
    .catch((error: unknown) => {
      report({ terminal: "HOLD", reason_code: stableErrorCode(error) });
      process.exitCode = 2;
    })
    .finally(async () => {
      await closeWorkspaceIdentityRuntime();
    });
}
