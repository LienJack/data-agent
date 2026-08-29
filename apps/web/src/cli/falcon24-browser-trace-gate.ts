import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { type ArtifactReference, artifactReferenceIdentity } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  authorityEpochForFalcon24Gate,
  FALCON24_REQUIRED_UI_ARTIFACT_TYPES,
  falcon24AcceptanceCampaignIdSchema,
  falcon24GateIdSchema,
  falcon24QualificationGateIdSchema,
} from "@data-agent/contracts/evals";
import {
  falcon24AuthorityEpochOrdinal,
  falcon24AuthorityEpochSchema,
  falcon24QaE2eReceiptV2Schema,
  falcon24TraceUiReceiptV2Schema,
  type ResolutionTrace,
  type ResolutionTraceDetail,
} from "@data-agent/contracts/runs";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const HARNESS_VERSION = "falcon24-agent-browser-trace-gate@2.0.0" as const;
const LEGACY_TRACE_RECEIPT_HARNESS_VERSION = "falcon24-agent-browser-trace-gate@1.0.0" as const;
const QA_REQUIRED_VISIBLE_ARTIFACT_TYPES = Object.freeze([
  "QueryEvidence",
  "ArtifactWorkspaceDocument",
  "AnalysisReport",
] as const);
const GATE_CLAIM_KEY = "falcon24-browser-submit-claim";
const GATE_CONSUMED_KEY = "falcon24-browser-submit-consumed";
const COMPOSER_READY_SELECTOR = '[data-testid="qa-submit-question"][data-composer-ready="true"]';
const CLAIMED_READY_SELECTOR =
  '[data-testid="qa-submit-question"][data-composer-ready="true"][data-falcon24-claim-ready="true"]';

const browserGateFenceSchema = z
  .discriminatedUnion("authority_kind", [
    z.strictObject({
      authority_kind: z.literal("QUALIFICATION"),
      authority_epoch: falcon24AuthorityEpochSchema,
      qualification_id: falcon24QualificationGateIdSchema,
      attempt_id: z.uuid(),
      run_id: z.uuid(),
      claim_fence_token: z.uuid(),
    }),
    z.strictObject({
      authority_kind: z.literal("FINAL_CAMPAIGN"),
      authority_epoch: falcon24AuthorityEpochSchema,
      campaign_id: falcon24AcceptanceCampaignIdSchema,
      attempt_id: z.uuid(),
      run_id: z.uuid(),
      claim_fence_token: z.uuid(),
    }),
  ])
  .superRefine((fence, context) => {
    const gateId =
      fence.authority_kind === "QUALIFICATION" ? fence.qualification_id : fence.campaign_id;
    if (authorityEpochForFalcon24Gate(gateId) !== fence.authority_epoch) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 browser fence authority epoch 与 gate ID 不一致。",
      });
    }
  });

const browserGateClaimSchema = z.strictObject({
  schema_version: z.literal("falcon24-browser-submit-claim@2.0.0"),
  question: z.string().trim().min(1).max(4_000),
  conversation_id: z.uuid(),
  idempotency_key: z.string().min(1).max(512),
  acceptance_fence: browserGateFenceSchema,
});

const browserDiagnosticClaimSchema = z.strictObject({
  schema_version: z.literal("falcon24-browser-diagnostic-submit-claim@1.0.0"),
  question: z.string().trim().min(1).max(4_000),
  conversation_id: z.uuid(),
  idempotency_key: z.string().min(1).max(512),
  diagnostic_attempt_id: z.uuid(),
  run_id: z.uuid(),
});

const browserFourLayerFenceSchema = z.strictObject({
  gate_id: z.string().regex(/^E[1-9][0-9]*-FL1$/u),
  attempt_id: z.uuid(),
  manifest_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  turn_ordinal: z.number().int().min(0).max(14),
  turn_id: z.string().regex(/^L[1-4](?:-[AB])?-0[1-5]$/u),
  conversation_resource_version: z.number().int().positive().safe(),
  run_id: z.uuid(),
});

const browserFourLayerClaimSchema = z.strictObject({
  schema_version: z.literal("falcon24-browser-four-layer-submit-claim@1.0.0"),
  question: z.string().trim().min(1).max(8_000),
  conversation_id: z.uuid(),
  idempotency_key: z.string().min(1).max(256),
  four_layer_fence: browserFourLayerFenceSchema,
});

const browserSubmissionClaimSchema = z.union([
  browserGateClaimSchema,
  browserDiagnosticClaimSchema,
  browserFourLayerClaimSchema,
]);

const browserGateConsumedSchema = z.strictObject({
  schema_version: z.literal("falcon24-browser-submit-consumed@2.0.0"),
  run_id: z.uuid(),
  attempt_id: z.uuid(),
  conversation_id: z.uuid(),
  acceptance_fence: browserGateFenceSchema,
});

const browserDiagnosticConsumedSchema = z.strictObject({
  schema_version: z.literal("falcon24-browser-diagnostic-submit-consumed@1.0.0"),
  run_id: z.uuid(),
  attempt_id: z.uuid(),
  conversation_id: z.uuid(),
  submission_kind: z.literal("DIAGNOSTIC"),
});

const browserFourLayerConsumedSchema = z.strictObject({
  schema_version: z.literal("falcon24-browser-four-layer-submit-consumed@1.0.0"),
  run_id: z.uuid(),
  attempt_id: z.uuid(),
  conversation_id: z.uuid(),
  four_layer_fence: browserFourLayerFenceSchema,
});

const browserSubmissionConsumedSchema = z.union([
  browserGateConsumedSchema,
  browserDiagnosticConsumedSchema,
  browserFourLayerConsumedSchema,
]);

const agentBrowserOutputSchema = z.strictObject({
  success: z.literal(true),
  data: z.record(z.string(), z.unknown()),
  error: z.null(),
});

const currentDetailObservationSchema = z.strictObject({
  node_id: z.string().min(1).max(320),
  trace_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  detail_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});

const artifactObservationSchema = z.strictObject({
  artifact_id: z.uuid(),
  artifact_type: z.string().min(1).max(128),
  revision: z.number().int().positive().safe(),
  content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  run_id: z.uuid(),
});

const webBuildSchema = z.strictObject({
  build_id: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  generation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});

const qaBrowserObservationSchema = z.strictObject({
  run_id: z.uuid(),
  terminal_status: z.literal("COMPLETED"),
  location: z.string().url(),
  answer_visible: z.literal(true),
  table_visible: z.literal(true),
  chart_rendered: z.literal(true),
  report_visible: z.literal(true),
  visible_artifact_types: z.array(z.string().min(1).max(128)).max(128),
  error_banners: z.array(z.string().max(2_000)).max(32),
  web_build: webBuildSchema,
});

const finalBrowserObservationSchema = z.strictObject({
  run_id: z.uuid(),
  trace_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  location: z.string().url(),
  error_banners: z.array(z.string().max(2_000)).max(32),
  chart_render_state: z.literal("READY"),
  source_table_visible: z.literal(true),
  horizontal_overflow: z.literal(false),
  web_build: webBuildSchema,
});

const browserPreflightObservationSchema = z.strictObject({
  location: z.string().url(),
  ready: z.literal(true),
  question_input_visible: z.literal(true),
  submit_visible: z.literal(true),
  composer_ready: z.literal(true),
  gate_claim_absent: z.literal(true),
  expected_run_absent: z.literal(true),
  error_banners: z.array(z.string().max(2_000)).max(32),
  web_build: webBuildSchema,
});

function selectorValue(value: string): string {
  if (!/^[A-Za-z0-9:._-]+$/u.test(value)) {
    throw new TypeError("FALCON24_BROWSER_SELECTOR_IDENTITY_INVALID");
  }
  return value;
}

function encodedScript(source: string): string {
  return Buffer.from(source, "utf8").toString("base64");
}

async function agentBrowser(
  session: string,
  command: readonly string[],
): Promise<z.infer<typeof agentBrowserOutputSchema>> {
  const { stdout } = await execFileAsync(
    "agent-browser",
    ["--session", session, "--json", ...command],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return agentBrowserOutputSchema.parse(JSON.parse(stdout));
}

async function browserEval<T>(session: string, source: string, schema: z.ZodType<T>): Promise<T> {
  const output = await agentBrowser(session, ["eval", "-b", encodedScript(source)]);
  return schema.parse(output.data.result);
}

function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function falcon24QaStartUrl(input: {
  readonly web_base_url: string;
  readonly workspace_id: string;
  readonly conversation_id: string;
}): URL {
  const baseUrl = new URL(input.web_base_url);
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new TypeError("FALCON24_BROWSER_BASE_URL_INVALID");
  }
  const url = new URL(`/w/${input.workspace_id}/qa`, baseUrl);
  url.searchParams.set("conversation", input.conversation_id);
  url.searchParams.set("tab", "conversation");
  if (url.searchParams.has("run") || url.searchParams.has("event")) {
    throw new TypeError("FALCON24_BROWSER_PREBUILT_TRACE_URL_FORBIDDEN");
  }
  return url;
}

export function exactRequiredFalcon24ArtifactReferences(
  trace: ResolutionTrace,
): readonly ArtifactReference[] {
  return FALCON24_REQUIRED_UI_ARTIFACT_TYPES.map((artifactType) => {
    const references = trace.nodes.flatMap((node) =>
      node.artifact_refs.filter((reference) => reference.artifact_type === artifactType),
    );
    const byIdentity = new Map(
      references.map((reference) => [artifactReferenceIdentity(reference), reference]),
    );
    if (byIdentity.size !== 1) {
      throw new Error("FALCON24_BROWSER_REQUIRED_ARTIFACT_CARDINALITY_INVALID");
    }
    const reference = [...byIdentity.values()][0];
    if (!reference) throw new Error("FALCON24_BROWSER_REQUIRED_ARTIFACT_MISSING");
    return reference;
  }).sort((left, right) =>
    artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
  );
}

export interface Falcon24BrowserTraceGateInput {
  readonly session: string;
  readonly web_base_url: string;
  readonly screenshot_path: string;
  readonly workspace_id: string;
  readonly conversation_id: string;
  readonly question: string;
  readonly attempt_id: string;
  readonly authority_epoch: string;
  readonly gate_id?: string;
  readonly submission_kind?: "GATE" | "DIAGNOSTIC";
  readonly viewport: Readonly<{ width: 1440 | 390; height: number }>;
  readonly trace: ResolutionTrace;
  readonly details: readonly ResolutionTraceDetail[];
}

export type Falcon24BrowserGateClaim = Readonly<z.infer<typeof browserGateClaimSchema>>;
export type Falcon24BrowserDiagnosticClaim = Readonly<z.infer<typeof browserDiagnosticClaimSchema>>;
export type Falcon24BrowserFourLayerClaim = Readonly<z.infer<typeof browserFourLayerClaimSchema>>;
export type Falcon24BrowserSubmissionClaim = Readonly<z.infer<typeof browserSubmissionClaimSchema>>;

export function verifyFalcon24UiReceiptPair(input: {
  readonly qa_e2e: unknown;
  readonly trace_ui: unknown;
}) {
  const qa = falcon24QaE2eReceiptV2Schema.parse(input.qa_e2e);
  const trace = falcon24TraceUiReceiptV2Schema.parse(input.trace_ui);
  if (
    qa.run_id !== trace.run_id ||
    qa.conversation_id !== trace.conversation_id ||
    qa.authority.authority_epoch !== trace.authority.authority_epoch ||
    qa.authority.baseline_id !== trace.authority.baseline_id ||
    qa.authority.baseline_hash !== trace.authority.baseline_hash ||
    qa.authority.activation_attempt_id !== trace.authority.activation_attempt_id ||
    qa.web_build.build_id !== trace.web_build.build_id ||
    qa.web_build.generation_id !== trace.web_build.generation_id ||
    qa.viewport.width !== trace.viewport.width ||
    qa.viewport.height !== trace.viewport.height ||
    qa.browser_harness_version !== trace.browser_harness_version
  ) {
    throw new TypeError("FALCON24_UI_RECEIPT_PAIR_IDENTITY_MISMATCH");
  }
  return Object.freeze({ qa_e2e: qa, trace_ui: trace });
}

export async function preflightFalcon24BrowserSubmission(input: {
  readonly session: string;
  readonly web_base_url: string;
  readonly workspace_id: string;
  readonly conversation_id: string;
  readonly expected_run_id: string;
  readonly expected_web_build: Readonly<{ build_id: string; generation_id: string }>;
  readonly viewport: Readonly<{ width: 1440 | 390; height: number }>;
}) {
  const session = z
    .string()
    .regex(/^[A-Za-z0-9._-]{3,128}$/u)
    .parse(input.session);
  const expectedRunId = z.uuid().parse(input.expected_run_id);
  const expectedWebBuild = webBuildSchema.parse({
    build_id: input.expected_web_build.build_id,
    generation_id: input.expected_web_build.generation_id,
  });
  const startUrl = falcon24QaStartUrl(input);
  await agentBrowser(session, [
    "set",
    "viewport",
    String(input.viewport.width),
    String(input.viewport.height),
  ]);
  await agentBrowser(session, ["errors", "--clear"]);
  await agentBrowser(session, ["console", "--clear"]);
  await agentBrowser(session, ["open", startUrl.toString()]);
  await agentBrowser(session, ["wait", '[data-testid="qa-question-input"]']);
  await agentBrowser(session, ["wait", COMPOSER_READY_SELECTOR]);
  const expectedRunSelector = `[data-testid="qa-result-trace-entry"][data-run-id="${selectorValue(expectedRunId)}"]`;
  const observation = await browserEval(
    session,
    `(async () => { const visible=(element)=>Boolean(element && element.getBoundingClientRect().width>0 && element.getBoundingClientRect().height>0); const response=await fetch('/api/ready?workspace_id=${encodeURIComponent(input.workspace_id)}',{cache:'no-store'}); const build=await response.json(); const submit=document.querySelector('[data-testid="qa-submit-question"]'); return {location:window.location.href,ready:response.ok&&build.ready===true,question_input_visible:visible(document.querySelector('[data-testid="qa-question-input"]')),submit_visible:visible(submit),composer_ready:submit?.getAttribute('data-composer-ready')==='true',gate_claim_absent:sessionStorage.getItem(${JSON.stringify(GATE_CLAIM_KEY)})===null&&sessionStorage.getItem(${JSON.stringify(GATE_CONSUMED_KEY)})===null,expected_run_absent:!document.querySelector(${JSON.stringify(expectedRunSelector)}),error_banners:[...document.querySelectorAll('[role="alert"]')].map((element)=>element.textContent?.trim()||''),web_build:{build_id:build.build_id,generation_id:build.generation_id}}; })()`,
    browserPreflightObservationSchema,
  );
  if (
    observation.error_banners.length > 0 ||
    observation.web_build.build_id !== expectedWebBuild.build_id ||
    observation.web_build.generation_id !== expectedWebBuild.generation_id
  ) {
    throw new Error("FALCON24_BROWSER_PREFLIGHT_FAILED");
  }
  return Object.freeze(observation);
}

export async function submitFalcon24QuestionFromBrowser(input: {
  readonly session: string;
  readonly web_base_url: string;
  readonly workspace_id: string;
  readonly conversation_id: string;
  readonly expected_run_id: string;
  readonly question: string;
  readonly viewport: Readonly<{ width: 1440 | 390; height: number }>;
  readonly claim: Falcon24BrowserSubmissionClaim;
}) {
  const session = z
    .string()
    .regex(/^[A-Za-z0-9._-]{3,128}$/u)
    .parse(input.session);
  const expectedRunId = z.uuid().parse(input.expected_run_id);
  const claim = browserSubmissionClaimSchema.parse(input.claim);
  const claimRunId =
    claim.schema_version === "falcon24-browser-submit-claim@2.0.0"
      ? claim.acceptance_fence.run_id
      : claim.schema_version === "falcon24-browser-four-layer-submit-claim@1.0.0"
        ? claim.four_layer_fence.run_id
        : claim.run_id;
  const claimAttemptId =
    claim.schema_version === "falcon24-browser-submit-claim@2.0.0"
      ? claim.acceptance_fence.attempt_id
      : claim.schema_version === "falcon24-browser-four-layer-submit-claim@1.0.0"
        ? claim.four_layer_fence.attempt_id
        : claim.diagnostic_attempt_id;
  const startUrl = falcon24QaStartUrl(input);
  if (
    claim.question !== input.question ||
    claim.conversation_id !== input.conversation_id ||
    claimRunId !== expectedRunId
  ) {
    throw new Error("FALCON24_BROWSER_GATE_CLAIM_IDENTITY_INVALID");
  }
  await agentBrowser(session, [
    "set",
    "viewport",
    String(input.viewport.width),
    String(input.viewport.height),
  ]);
  await agentBrowser(session, ["errors", "--clear"]);
  await agentBrowser(session, ["console", "--clear"]);
  await agentBrowser(session, ["open", startUrl.toString()]);
  await agentBrowser(session, ["wait", '[data-testid="qa-question-input"]']);
  await agentBrowser(session, ["wait", COMPOSER_READY_SELECTOR]);
  const resultTraceSelector = `[data-testid="qa-result-trace-entry"][data-run-id="${selectorValue(expectedRunId)}"]`;
  if (
    await browserEval(
      session,
      `Boolean(document.querySelector(${JSON.stringify(resultTraceSelector)}))`,
      z.boolean(),
    )
  ) {
    throw new Error("FALCON24_BROWSER_PREEXISTING_TARGET_RUN_FORBIDDEN");
  }
  await browserEval(
    session,
    `(() => { sessionStorage.removeItem(${JSON.stringify(GATE_CONSUMED_KEY)}); sessionStorage.setItem(${JSON.stringify(GATE_CLAIM_KEY)},${JSON.stringify(JSON.stringify(claim))}); const submit=document.querySelector('[data-testid="qa-submit-question"]'); if(!submit||submit.getAttribute('data-composer-ready')!=='true') return false; submit.setAttribute('data-falcon24-claim-ready','true'); return true; })()`,
    z.literal(true),
  );
  await agentBrowser(session, ["wait", CLAIMED_READY_SELECTOR]);
  await agentBrowser(session, ["fill", '[data-testid="qa-question-input"]', input.question]);
  await agentBrowser(session, ["click", '[data-testid="qa-submit-question"]']);
  await agentBrowser(session, ["wait", `#chat-run-${selectorValue(expectedRunId)}`]);
  const consumed = await browserEval(
    session,
    `(() => { const raw=sessionStorage.getItem(${JSON.stringify(GATE_CONSUMED_KEY)}); return raw ? JSON.parse(raw) : null; })()`,
    browserSubmissionConsumedSchema,
  );
  if (
    consumed.run_id !== expectedRunId ||
    consumed.attempt_id !== claimAttemptId ||
    consumed.conversation_id !== input.conversation_id ||
    (claim.schema_version === "falcon24-browser-submit-claim@2.0.0"
      ? consumed.schema_version !== "falcon24-browser-submit-consumed@2.0.0" ||
        JSON.stringify(consumed.acceptance_fence) !== JSON.stringify(claim.acceptance_fence)
      : claim.schema_version === "falcon24-browser-four-layer-submit-claim@1.0.0"
        ? consumed.schema_version !== "falcon24-browser-four-layer-submit-consumed@1.0.0" ||
          JSON.stringify(consumed.four_layer_fence) !== JSON.stringify(claim.four_layer_fence)
        : consumed.schema_version !== "falcon24-browser-diagnostic-submit-consumed@1.0.0" ||
          consumed.submission_kind !== "DIAGNOSTIC")
  ) {
    throw new Error("FALCON24_BROWSER_GATE_CONSUMPTION_INVALID");
  }
  return Object.freeze({ run_id: consumed.run_id, attempt_id: consumed.attempt_id });
}

export async function runFalcon24BrowserTraceGate(input: Falcon24BrowserTraceGateInput) {
  const session = z
    .string()
    .regex(/^[A-Za-z0-9._-]{3,128}$/u)
    .parse(input.session);
  const question = z.string().trim().min(1).max(4_000).parse(input.question);
  const attemptId = z.uuid().parse(input.attempt_id);
  const authorityEpoch = falcon24AuthorityEpochSchema.parse(input.authority_epoch);
  const diagnostic = input.submission_kind === "DIAGNOSTIC";
  const gateId = diagnostic ? null : falcon24GateIdSchema.parse(input.gate_id);
  if (
    (diagnostic && falcon24AuthorityEpochOrdinal(authorityEpoch) < 4n) ||
    (!diagnostic && gateId && authorityEpochForFalcon24Gate(gateId) !== authorityEpoch)
  ) {
    throw new Error("FALCON24_BROWSER_GATE_AUTHORITY_MISMATCH");
  }
  const viewport = z
    .strictObject({
      width: z.union([z.literal(1440), z.literal(390)]),
      height: z.number().int().min(640).max(2_400),
    })
    .parse(input.viewport);
  const startUrl = falcon24QaStartUrl(input);
  const detailsByNode = new Map(input.details.map((detail) => [detail.node_id, detail]));
  if (
    input.trace.conversation_id !== input.conversation_id ||
    detailsByNode.size !== input.trace.nodes.length ||
    input.trace.nodes.some(
      (node) => detailsByNode.get(node.node_id)?.trace_hash !== input.trace.trace_hash,
    )
  ) {
    throw new Error("FALCON24_BROWSER_DETAIL_CLOSURE_INVALID");
  }
  const terminal = input.trace.nodes.find(
    ({ kind, status }) => kind === "TERMINAL" && status === "COMPLETED",
  );
  if (!terminal || terminal.sequence === null) {
    throw new Error("FALCON24_BROWSER_COMPLETED_TERMINAL_REQUIRED");
  }

  await agentBrowser(session, ["set", "viewport", String(viewport.width), String(viewport.height)]);
  await agentBrowser(session, ["errors", "--clear"]);
  await agentBrowser(session, ["console", "--clear"]);
  await agentBrowser(session, ["open", startUrl.toString()]);
  await agentBrowser(session, ["wait", '[data-testid="qa-question-input"]']);
  const resultTraceSelector = `[data-testid="qa-result-trace-entry"][data-run-id="${selectorValue(input.trace.run_id)}"][data-terminal-status="COMPLETED"]`;
  const preexistingTarget = await browserEval(
    session,
    `Boolean(document.querySelector(${JSON.stringify(resultTraceSelector)}))`,
    z.boolean(),
  );
  if (!preexistingTarget) {
    throw new Error("FALCON24_BROWSER_SUBMITTED_TARGET_RUN_REQUIRED");
  }
  const consumed = await browserEval(
    session,
    `(() => { const raw=sessionStorage.getItem(${JSON.stringify(GATE_CONSUMED_KEY)}); return raw ? JSON.parse(raw) : null; })()`,
    browserSubmissionConsumedSchema,
  );
  const consumedGateId =
    consumed.schema_version === "falcon24-browser-submit-consumed@2.0.0"
      ? consumed.acceptance_fence.authority_kind === "QUALIFICATION"
        ? consumed.acceptance_fence.qualification_id
        : consumed.acceptance_fence.campaign_id
      : null;
  if (
    consumed.run_id !== input.trace.run_id ||
    consumed.attempt_id !== attemptId ||
    consumed.conversation_id !== input.conversation_id ||
    (diagnostic
      ? consumed.schema_version !== "falcon24-browser-diagnostic-submit-consumed@1.0.0"
      : consumed.schema_version !== "falcon24-browser-submit-consumed@2.0.0" ||
        consumed.acceptance_fence.authority_epoch !== authorityEpoch ||
        consumedGateId !== gateId)
  ) {
    throw new Error("FALCON24_BROWSER_GATE_CONSUMPTION_INVALID");
  }
  const requiredArtifacts = exactRequiredFalcon24ArtifactReferences(input.trace);
  const qaObservation = await browserEval(
    session,
    `(async () => { const entry=document.querySelector(${JSON.stringify(resultTraceSelector)}); const run=document.getElementById(${JSON.stringify(`chat-run-${input.trace.run_id}`)}); const response=await fetch('/api/ready',{cache:'no-store'}); const build=await response.json(); const artifactPreviews=[...(run?.querySelectorAll('[data-testid="artifact-preview-ready"]')??[])]; const artifactTypes=artifactPreviews.map((element)=>element.getAttribute('data-artifact-type')).filter(Boolean); const visible=(element)=>Boolean(element && element.getBoundingClientRect().width>0 && element.getBoundingClientRect().height>0); const chart=run?.querySelector('[data-testid="governed-chart"]'); const table=run?.querySelector('[data-testid="chart-source-table"]'); const report=artifactPreviews.find((element)=>element.getAttribute('data-artifact-type')==='AnalysisReport'); return {run_id:entry?.getAttribute('data-run-id'),terminal_status:entry?.getAttribute('data-terminal-status'),location:window.location.href,answer_visible:Boolean(run && (run.textContent?.trim().length??0)>0),table_visible:visible(table),chart_rendered:visible(chart)&&chart?.getAttribute('data-chart-render-state')==='READY',report_visible:visible(report),visible_artifact_types:artifactTypes,error_banners:[...document.querySelectorAll('[role="alert"]')].map((element)=>element.textContent?.trim()||''),web_build:{build_id:build.build_id,generation_id:build.generation_id}}; })()`,
    qaBrowserObservationSchema,
  );
  if (
    qaObservation.run_id !== input.trace.run_id ||
    qaObservation.error_banners.length > 0 ||
    !QA_REQUIRED_VISIBLE_ARTIFACT_TYPES.every((artifactType) =>
      qaObservation.visible_artifact_types.includes(artifactType),
    )
  ) {
    throw new Error("FALCON24_BROWSER_QA_OBSERVATION_INVALID");
  }
  const qaScreenshotPath = `${input.screenshot_path}.${viewport.width}.qa.png`;
  await agentBrowser(session, ["screenshot", "--full", qaScreenshotPath]);
  const qaScreenshotHash = sha256Bytes(await readFile(qaScreenshotPath));

  await agentBrowser(session, ["click", resultTraceSelector]);
  const readySelector = `[data-testid="resolution-trace-ready"][data-run-id="${selectorValue(input.trace.run_id)}"][data-trace-hash="${selectorValue(input.trace.trace_hash)}"]`;
  await agentBrowser(session, ["wait", readySelector]);
  await agentBrowser(session, ["wait", '[data-testid="resolution-trace-search"]']);

  const openedNodes: Array<{ node_id: string; detail_hash: string }> = [];
  for (const node of [...input.trace.nodes].sort((left, right) =>
    left.node_id.localeCompare(right.node_id),
  )) {
    const expectedDetail = detailsByNode.get(node.node_id);
    if (!expectedDetail) throw new Error("FALCON24_BROWSER_DETAIL_CLOSURE_INVALID");
    await agentBrowser(session, ["fill", '[data-testid="resolution-trace-search"]', node.node_id]);
    const nodeSelector = `[data-testid="resolution-trace-node"][data-run-id="${selectorValue(input.trace.run_id)}"][data-node-id="${selectorValue(node.node_id)}"]`;
    await agentBrowser(session, ["wait", nodeSelector]);
    await agentBrowser(session, ["click", nodeSelector]);
    const detailSelector = `[data-testid="resolution-trace-detail"][data-node-id="${selectorValue(node.node_id)}"][data-trace-hash="${selectorValue(input.trace.trace_hash)}"][data-detail-hash="${selectorValue(expectedDetail.detail_hash)}"]`;
    await agentBrowser(session, ["wait", detailSelector]);
    const observed = await browserEval(
      session,
      `(() => { const element=document.querySelector(${JSON.stringify(detailSelector)}); if(!element) return null; return {node_id:element.getAttribute('data-node-id'),trace_hash:element.getAttribute('data-trace-hash'),detail_hash:element.getAttribute('data-detail-hash')}; })()`,
      currentDetailObservationSchema,
    );
    if (
      observed.node_id !== node.node_id ||
      observed.trace_hash !== input.trace.trace_hash ||
      observed.detail_hash !== expectedDetail.detail_hash
    ) {
      throw new Error("FALCON24_BROWSER_DETAIL_OBSERVATION_DRIFT");
    }
    openedNodes.push({ node_id: observed.node_id, detail_hash: observed.detail_hash });
  }

  await agentBrowser(session, ["fill", '[data-testid="resolution-trace-search"]', ""]);
  await agentBrowser(session, ["click", '[data-testid="resolution-trace-tab-artifacts"]']);
  const openedArtifacts: ArtifactReference[] = [];
  for (const reference of requiredArtifacts) {
    const triggerSelector = `[data-testid="resolution-trace-artifact"][data-artifact-id="${selectorValue(reference.artifact_id)}"][data-artifact-type="${selectorValue(reference.artifact_type)}"][data-artifact-revision="${reference.revision}"][data-content-hash="${selectorValue(reference.content_hash)}"]`;
    await agentBrowser(session, ["click", triggerSelector]);
    const previewSelector = `[data-testid="artifact-preview-ready"][data-run-id="${selectorValue(reference.run_id)}"][data-artifact-id="${selectorValue(reference.artifact_id)}"][data-artifact-type="${selectorValue(reference.artifact_type)}"][data-artifact-revision="${reference.revision}"][data-content-hash="${selectorValue(reference.content_hash)}"]`;
    await agentBrowser(session, ["wait", previewSelector]);
    const observed = await browserEval(
      session,
      `(() => { const element=document.querySelector(${JSON.stringify(previewSelector)}); if(!element) return null; return {artifact_id:element.getAttribute('data-artifact-id'),artifact_type:element.getAttribute('data-artifact-type'),revision:Number(element.getAttribute('data-artifact-revision')),content_hash:element.getAttribute('data-content-hash'),run_id:element.getAttribute('data-run-id')}; })()`,
      artifactObservationSchema,
    );
    if (
      observed.run_id !== input.trace.run_id ||
      observed.artifact_id !== reference.artifact_id ||
      observed.artifact_type !== reference.artifact_type ||
      observed.revision !== reference.revision ||
      observed.content_hash !== reference.content_hash
    ) {
      throw new Error("FALCON24_BROWSER_ARTIFACT_OBSERVATION_DRIFT");
    }
    openedArtifacts.push(reference);
  }

  const finalObservation = await browserEval(
    session,
    `(async () => { const ready=document.querySelector(${JSON.stringify(readySelector)}); const chart=document.querySelector('[data-testid="governed-chart"]'); const table=document.querySelector('[data-testid="chart-source-table"]'); const response=await fetch('/api/ready',{cache:'no-store'}); const build=await response.json(); return {run_id:ready?.getAttribute('data-run-id'),trace_hash:ready?.getAttribute('data-trace-hash'),location:window.location.href,error_banners:[...document.querySelectorAll('[role="alert"]')].map((element)=>element.textContent?.trim()||''),chart_render_state:chart?.getAttribute('data-chart-render-state'),source_table_visible:Boolean(table && table.getBoundingClientRect().width>0 && table.getBoundingClientRect().height>0),horizontal_overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,web_build:{build_id:build.build_id,generation_id:build.generation_id}}; })()`,
    finalBrowserObservationSchema,
  );
  if (
    finalObservation.run_id !== input.trace.run_id ||
    finalObservation.trace_hash !== input.trace.trace_hash ||
    finalObservation.error_banners.length > 0 ||
    new URL(finalObservation.location).searchParams.get("run") !== input.trace.run_id
  ) {
    throw new Error("FALCON24_BROWSER_FINAL_OBSERVATION_INVALID");
  }
  await agentBrowser(session, ["reload"]);
  await agentBrowser(session, ["wait", readySelector]);
  const traceScreenshotPath = `${input.screenshot_path}.${viewport.width}.trace.png`;
  await agentBrowser(session, ["screenshot", "--full", traceScreenshotPath]);
  const traceScreenshotHash = sha256Bytes(await readFile(traceScreenshotPath));
  await agentBrowser(session, ["click", '[data-testid="resolution-trace-return-to-result"]']);
  await agentBrowser(session, ["wait", resultTraceSelector]);

  const pageErrors = await agentBrowser(session, ["errors"]);
  const consoleMessages = await agentBrowser(session, ["console"]);
  const errors = z.array(z.unknown()).parse(pageErrors.data.errors ?? []);
  const consoleErrors = z
    .array(z.record(z.string(), z.unknown()))
    .parse(consoleMessages.data.messages ?? [])
    .filter((message) => message.type === "error");
  if (errors.length > 0 || consoleErrors.length > 0) {
    throw new Error("FALCON24_BROWSER_CONSOLE_ERROR");
  }

  const chartRef = requiredArtifacts.find(
    ({ artifact_type: artifactType }) => artifactType === "ArtifactWorkspaceDocument",
  );
  if (!chartRef) throw new Error("FALCON24_BROWSER_CHART_REFERENCE_MISSING");
  const observedAt = new Date().toISOString();
  return Object.freeze({
    qa_e2e: Object.freeze({
      schema_version: "falcon24-qa-e2e-observation@1.0.0" as const,
      browser_harness_version: HARNESS_VERSION,
      viewport,
      question_hash: await sha256ContentHash(question),
      web_build: qaObservation.web_build,
      terminal_status: qaObservation.terminal_status,
      answer_visible: qaObservation.answer_visible,
      table_visible: qaObservation.table_visible,
      chart_rendered: qaObservation.chart_rendered,
      report_visible: qaObservation.report_visible,
      opened_artifact_refs: requiredArtifacts,
      error_banner: null,
      dom_snapshot_hash: await sha256ContentHash(qaObservation),
      screenshot_hash: qaScreenshotHash,
      observed_at: observedAt,
    }),
    trace_ui: Object.freeze({
      browser_harness_version: LEGACY_TRACE_RECEIPT_HARNESS_VERSION,
      web_build: finalObservation.web_build,
      opened_nodes: openedNodes,
      opened_artifact_refs: openedArtifacts,
      chart_ref: chartRef,
      chart_renderer_version: "governed-vchart@1.0.0" as const,
      chart_rendered: true as const,
      source_table_visible: true as const,
      error_banner: null,
      dom_snapshot_hash: await sha256ContentHash(finalObservation),
      screenshot_hash: traceScreenshotHash,
      observed_at: observedAt,
    }),
  });
}

export {
  agentBrowser as executeFalcon24AgentBrowser,
  browserEval as evaluateFalcon24Browser,
  selectorValue as falcon24BrowserSelectorValue,
  sha256Bytes as sha256Falcon24BrowserBytes,
};
