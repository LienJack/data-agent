import { readFile } from "node:fs/promises";
import { type ArtifactReference, artifactReferenceIdentity } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24FourLayerQaUiReceipt,
  buildFalcon24FourLayerTraceUiReceipt,
  type Falcon24FourLayerBusinessReceipt,
  type Falcon24FourLayerManifestTurn,
  type Falcon24FourLayerQaUiReceipt,
  type Falcon24FourLayerTraceUiReceipt,
  falcon24FourLayerSubmitFenceSchema,
} from "@data-agent/contracts/evals";
import type { ResolutionTrace, ResolutionTraceDetail } from "@data-agent/contracts/runs";
import { z } from "zod";
import {
  evaluateFalcon24Browser,
  executeFalcon24AgentBrowser,
  type Falcon24BrowserFourLayerClaim,
  falcon24BrowserSelectorValue,
  falcon24QaStartUrl,
  sha256Falcon24BrowserBytes,
} from "./falcon24-browser-trace-gate";

const GATE_CLAIM_KEY = "falcon24-browser-submit-claim";
const GATE_CONSUMED_KEY = "falcon24-browser-submit-consumed";
const QA_FAILURE_CODE = "FALCON24_QA_UI_OBSERVATION_FAILED";
const TRACE_FAILURE_CODE = "FALCON24_TRACE_UI_OBSERVATION_FAILED";

const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const webBuildSchema = z.strictObject({
  build_id: contentHashSchema,
  generation_id: contentHashSchema,
});
const runCountSchema = z.strictObject({ run_id: z.uuid(), count: z.number().int().nonnegative() });
const fourLayerConsumedSchema = z.strictObject({
  schema_version: z.literal("falcon24-browser-four-layer-submit-consumed@1.0.0"),
  run_id: z.uuid(),
  attempt_id: z.uuid(),
  conversation_id: z.uuid(),
  four_layer_fence: falcon24FourLayerSubmitFenceSchema,
});
const fourLayerPreflightObservationSchema = z.strictObject({
  ready: z.boolean(),
  composer_ready: z.boolean(),
  claim_absent: z.boolean(),
  consumed: z.unknown().nullable(),
  expected_run_absent: z.boolean(),
  prior_run_counts: z.array(runCountSchema),
  error_banners: z.array(z.string().max(2_000)).max(32),
  web_build: webBuildSchema,
});
const fourLayerQaObservationSchema = z.strictObject({
  run_id: z.uuid().nullable(),
  terminal_status: z.string().nullable(),
  answer_visible: z.boolean(),
  table_visible: z.boolean(),
  chart_rendered: z.boolean(),
  loading_visible: z.boolean(),
  horizontal_overflow: z.boolean(),
  conversation_run_counts: z.array(runCountSchema),
  error_banners: z.array(z.string().max(2_000)).max(32),
  web_build: webBuildSchema,
});
const detailObservationSchema = z.strictObject({
  node_id: z.string().min(1).max(320),
  trace_hash: contentHashSchema,
  detail_hash: contentHashSchema,
});
const artifactObservationSchema = z.strictObject({
  artifact_id: z.uuid(),
  artifact_type: z.string().min(1).max(128),
  revision: z.number().int().positive().safe(),
  content_hash: contentHashSchema,
  run_id: z.uuid(),
});
const traceObservationSchema = z.strictObject({
  run_id: z.uuid().nullable(),
  trace_hash: contentHashSchema.nullable(),
  location: z.string().url(),
  horizontal_overflow: z.boolean(),
  error_banners: z.array(z.string().max(2_000)).max(32),
  web_build: webBuildSchema,
});
const narrowSmokeObservationSchema = z.strictObject({
  run_id: z.uuid().nullable(),
  answer_visible: z.boolean(),
  horizontal_overflow: z.boolean(),
  error_banners: z.array(z.string().max(2_000)).max(32),
});

export interface Falcon24FourLayerWebBuild {
  readonly build_id: string;
  readonly generation_id: string;
}

export interface Falcon24FourLayerConversationTrace {
  readonly run_id: string;
  readonly trace_hash: string;
}

function exactReceiptIdentity(receipt: Falcon24FourLayerBusinessReceipt) {
  return {
    gate_id: receipt.gate_id,
    attempt_id: receipt.attempt_id,
    manifest_hash: receipt.manifest_hash,
    turn_ordinal: receipt.turn_ordinal,
    turn_id: receipt.turn_id,
    layer: receipt.layer,
    scenario_id: receipt.scenario_id,
    scenario_turn_index: receipt.scenario_turn_index,
    conversation_id: receipt.conversation_id,
    conversation_resource_version: receipt.conversation_resource_version,
    run_id: receipt.run_id,
    question_hash: receipt.question_hash,
    worker_build_hash: receipt.worker_build_hash,
    worker_generation_hash: receipt.worker_generation_hash,
    semantic_release_hash: receipt.semantic_release_hash,
  } as const;
}

function exactRunSelector(runId: string): string {
  return `[data-testid="qa-result-trace-entry"][data-run-id="${falcon24BrowserSelectorValue(runId)}"][data-terminal-status="COMPLETED"]`;
}

function exactTraceSelector(binding: Falcon24FourLayerConversationTrace): string {
  return `[data-testid="resolution-trace-ready"][data-run-id="${falcon24BrowserSelectorValue(binding.run_id)}"][data-trace-hash="${falcon24BrowserSelectorValue(binding.trace_hash)}"]`;
}

function sameBuild(
  observed: z.infer<typeof webBuildSchema>,
  expected: Falcon24FourLayerWebBuild,
): boolean {
  return (
    observed.build_id === expected.build_id && observed.generation_id === expected.generation_id
  );
}

function exactRunCounts(
  counts: readonly z.infer<typeof runCountSchema>[],
  expectedRunIds: readonly string[],
): boolean {
  return (
    counts.length === expectedRunIds.length &&
    counts.every(
      ({ run_id: runId, count }, index) => runId === expectedRunIds[index] && count === 1,
    )
  );
}

function firstBanner(
  ...observations: readonly Readonly<{ readonly error_banners: readonly string[] }>[]
): string | null {
  return observations.flatMap(({ error_banners: banners }) => banners).find(Boolean) ?? null;
}

export async function preflightFalcon24FourLayerBrowserSubmission(input: {
  readonly session: string;
  readonly web_base_url: string;
  readonly workspace_id: string;
  readonly claim: Falcon24BrowserFourLayerClaim;
  readonly expected_web_build: Falcon24FourLayerWebBuild;
  readonly previous_run_ids: readonly string[];
  readonly viewport: Readonly<{ width: 1440; height: number }>;
}) {
  const startUrl = falcon24QaStartUrl({
    web_base_url: input.web_base_url,
    workspace_id: input.workspace_id,
    conversation_id: input.claim.conversation_id,
  });
  const runIds = input.previous_run_ids.map((runId) => z.uuid().parse(runId));
  const expectedRunId = z.uuid().parse(input.claim.four_layer_fence.run_id);
  await executeFalcon24AgentBrowser(input.session, [
    "set",
    "viewport",
    String(input.viewport.width),
    String(input.viewport.height),
  ]);
  await executeFalcon24AgentBrowser(input.session, ["errors", "--clear"]);
  await executeFalcon24AgentBrowser(input.session, ["console", "--clear"]);
  await executeFalcon24AgentBrowser(input.session, ["open", startUrl.toString()]);
  await executeFalcon24AgentBrowser(input.session, ["wait", '[data-testid="qa-question-input"]']);
  await executeFalcon24AgentBrowser(input.session, [
    "wait",
    '[data-testid="qa-submit-question"][data-composer-ready="true"]',
  ]);
  const observation = await evaluateFalcon24Browser(
    input.session,
    `(async () => { const runIds=${JSON.stringify(runIds)}; const response=await fetch('/api/ready?workspace_id=${encodeURIComponent(input.workspace_id)}',{cache:'no-store'}); const build=await response.json(); const raw=sessionStorage.getItem(${JSON.stringify(GATE_CONSUMED_KEY)}); return {ready:response.ok&&build.ready===true,composer_ready:document.querySelector('[data-testid="qa-submit-question"]')?.getAttribute('data-composer-ready')==='true',claim_absent:sessionStorage.getItem(${JSON.stringify(GATE_CLAIM_KEY)})===null,consumed:raw?JSON.parse(raw):null,expected_run_absent:!document.querySelector(${JSON.stringify(exactRunSelector(expectedRunId))}),prior_run_counts:runIds.map((run_id)=>({run_id,count:document.querySelectorAll('[data-testid="qa-result-trace-entry"][data-run-id="'+run_id+'"]').length})),error_banners:[...document.querySelectorAll('[role="alert"]')].map((element)=>element.textContent?.trim()||''),web_build:{build_id:build.build_id,generation_id:build.generation_id}}; })()`,
    fourLayerPreflightObservationSchema,
  );
  const consumed =
    observation.consumed === null ? null : fourLayerConsumedSchema.parse(observation.consumed);
  const previousConsumptionValid =
    runIds.length === 0
      ? consumed === null
      : consumed !== null &&
        consumed.attempt_id === input.claim.four_layer_fence.attempt_id &&
        consumed.conversation_id === input.claim.conversation_id &&
        consumed.four_layer_fence.gate_id === input.claim.four_layer_fence.gate_id &&
        consumed.four_layer_fence.manifest_hash === input.claim.four_layer_fence.manifest_hash &&
        consumed.run_id === runIds.at(-1);
  if (
    !observation.ready ||
    !observation.composer_ready ||
    !observation.claim_absent ||
    !observation.expected_run_absent ||
    !previousConsumptionValid ||
    !exactRunCounts(observation.prior_run_counts, runIds) ||
    observation.error_banners.length > 0 ||
    !sameBuild(observation.web_build, input.expected_web_build)
  ) {
    throw new Error("FALCON24_FOUR_LAYER_BROWSER_PREFLIGHT_FAILED");
  }
  return Object.freeze(observation);
}

async function assertCurrentConsumption(
  session: string,
  business: Falcon24FourLayerBusinessReceipt,
): Promise<void> {
  const consumed = await evaluateFalcon24Browser(
    session,
    `(() => { const raw=sessionStorage.getItem(${JSON.stringify(GATE_CONSUMED_KEY)}); return raw?JSON.parse(raw):null; })()`,
    fourLayerConsumedSchema.nullable(),
  );
  if (
    !consumed ||
    consumed.run_id !== business.run_id ||
    consumed.attempt_id !== business.attempt_id ||
    consumed.conversation_id !== business.conversation_id ||
    consumed.four_layer_fence.gate_id !== business.gate_id ||
    consumed.four_layer_fence.manifest_hash !== business.manifest_hash ||
    consumed.four_layer_fence.turn_ordinal !== business.turn_ordinal ||
    consumed.four_layer_fence.turn_id !== business.turn_id ||
    consumed.four_layer_fence.conversation_resource_version !==
      business.conversation_resource_version
  ) {
    throw new Error("FALCON24_FOUR_LAYER_BROWSER_CONSUMPTION_INVALID");
  }
}

async function observeQaPage(input: {
  readonly session: string;
  readonly run_id: string;
  readonly conversation_run_ids: readonly string[];
}) {
  const selector = exactRunSelector(input.run_id);
  return evaluateFalcon24Browser(
    input.session,
    `(async () => { const runIds=${JSON.stringify(input.conversation_run_ids)}; const entry=document.querySelector(${JSON.stringify(selector)}); const run=document.getElementById(${JSON.stringify(`chat-run-${input.run_id}`)}); const response=await fetch('/api/ready',{cache:'no-store'}); const build=await response.json(); const visible=(element)=>Boolean(element&&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0); const answer=run?.querySelector('.agent-answer'); const table=run?.querySelector('[data-testid="chart-source-table"]'); const chart=run?.querySelector('[data-testid="governed-chart"]'); return {run_id:entry?.getAttribute('data-run-id')??null,terminal_status:entry?.getAttribute('data-terminal-status')??null,answer_visible:visible(answer)&&Boolean(answer?.textContent?.trim()),table_visible:visible(table),chart_rendered:visible(chart)&&chart?.getAttribute('data-chart-render-state')==='READY',loading_visible:Boolean(run?.querySelector('[aria-busy="true"],[data-streaming="true"]')),horizontal_overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,conversation_run_counts:runIds.map((run_id)=>({run_id,count:document.querySelectorAll('[data-testid="qa-result-trace-entry"][data-run-id="'+run_id+'"]').length})),error_banners:[...document.querySelectorAll('[role="alert"]')].map((element)=>element.textContent?.trim()||''),web_build:{build_id:build.build_id,generation_id:build.generation_id}}; })()`,
    fourLayerQaObservationSchema,
  );
}

function qaObservationPasses(input: {
  readonly observation: z.infer<typeof fourLayerQaObservationSchema>;
  readonly run_id: string;
  readonly conversation_run_ids: readonly string[];
  readonly turn: Falcon24FourLayerManifestTurn;
  readonly expected_web_build: Falcon24FourLayerWebBuild;
}): boolean {
  const observation = input.observation;
  return (
    observation.run_id === input.run_id &&
    observation.terminal_status === "COMPLETED" &&
    observation.answer_visible &&
    (!input.turn.rubric.table_required || observation.table_visible) &&
    (!input.turn.rubric.chart_required || observation.chart_rendered) &&
    !observation.loading_visible &&
    !observation.horizontal_overflow &&
    exactRunCounts(observation.conversation_run_counts, input.conversation_run_ids) &&
    observation.error_banners.length === 0 &&
    sameBuild(observation.web_build, input.expected_web_build)
  );
}

export async function observeFalcon24FourLayerQaUi(input: {
  readonly session: string;
  readonly web_base_url: string;
  readonly screenshot_path: string;
  readonly workspace_id: string;
  readonly turn: Falcon24FourLayerManifestTurn;
  readonly business: Falcon24FourLayerBusinessReceipt;
  readonly expected_web_build: Falcon24FourLayerWebBuild;
  readonly conversation_run_ids: readonly string[];
  readonly viewport: Readonly<{ width: 1440; height: number }>;
  readonly now?: () => Date;
}): Promise<Falcon24FourLayerQaUiReceipt> {
  const startUrl = falcon24QaStartUrl({
    web_base_url: input.web_base_url,
    workspace_id: input.workspace_id,
    conversation_id: input.business.conversation_id,
  });
  const runIds = input.conversation_run_ids.map((runId) => z.uuid().parse(runId));
  if (runIds.at(-1) !== input.business.run_id) {
    throw new Error("FALCON24_FOUR_LAYER_CONVERSATION_RUN_ORDER_INVALID");
  }
  await executeFalcon24AgentBrowser(input.session, [
    "set",
    "viewport",
    String(input.viewport.width),
    String(input.viewport.height),
  ]);
  await executeFalcon24AgentBrowser(input.session, ["errors", "--clear"]);
  await executeFalcon24AgentBrowser(input.session, ["console", "--clear"]);
  await executeFalcon24AgentBrowser(input.session, ["open", startUrl.toString()]);
  await executeFalcon24AgentBrowser(input.session, [
    "wait",
    exactRunSelector(input.business.run_id),
  ]);
  await assertCurrentConsumption(input.session, input.business);
  const initial = await observeQaPage({
    session: input.session,
    run_id: input.business.run_id,
    conversation_run_ids: runIds,
  });
  await executeFalcon24AgentBrowser(input.session, ["reload"]);
  await executeFalcon24AgentBrowser(input.session, [
    "wait",
    exactRunSelector(input.business.run_id),
  ]);
  const refreshed = await observeQaPage({
    session: input.session,
    run_id: input.business.run_id,
    conversation_run_ids: runIds,
  });
  const screenshotPath = `${input.screenshot_path}.1440.qa.png`;
  await executeFalcon24AgentBrowser(input.session, ["screenshot", "--full", screenshotPath]);
  const screenshotHash = sha256Falcon24BrowserBytes(await readFile(screenshotPath));
  const passed = [initial, refreshed].every((observation) =>
    qaObservationPasses({
      observation,
      run_id: input.business.run_id,
      conversation_run_ids: runIds,
      turn: input.turn,
      expected_web_build: input.expected_web_build,
    }),
  );
  return buildFalcon24FourLayerQaUiReceipt({
    schema_version: "falcon24-four-layer-qa-ui-receipt@1.0.0",
    ...exactReceiptIdentity(input.business),
    answer_hash: input.business.answer_hash,
    web_build_hash: input.expected_web_build.build_id,
    web_generation_hash: input.expected_web_build.generation_id,
    composer_submission_count: 1,
    terminal_answer_visible: initial.answer_visible && refreshed.answer_visible,
    error_banner: firstBanner(initial, refreshed),
    dom_snapshot_hash: await sha256ContentHash({ initial, refreshed }),
    screenshot_hash: screenshotHash,
    status: passed ? "PASS" : "FAIL",
    failure_code: passed ? null : QA_FAILURE_CODE,
    observed_at: (input.now?.() ?? new Date()).toISOString(),
  });
}

function identityValue(detail: ResolutionTraceDetail, label: string): string | null {
  return detail.identity.find((candidate) => candidate.label === label)?.value ?? null;
}

export function verifyFalcon24FourLayerTraceEvidence(input: {
  readonly trace: ResolutionTrace;
  readonly details: readonly ResolutionTraceDetail[];
  readonly business: Falcon24FourLayerBusinessReceipt;
}): readonly ArtifactReference[] {
  const { trace, business } = input;
  if (
    trace.run_id !== business.run_id ||
    trace.conversation_id !== business.conversation_id ||
    !trace.nodes.some(({ kind, status }) => kind === "TERMINAL" && status === "COMPLETED") ||
    !trace.nodes.some(({ kind, status }) => kind === "TOOL" && status === "COMPLETED")
  ) {
    throw new Error("FALCON24_FOUR_LAYER_TRACE_RUNTIME_CLOSURE_INVALID");
  }
  const detailsByNode = new Map(input.details.map((detail) => [detail.node_id, detail]));
  if (detailsByNode.size !== input.details.length || detailsByNode.size !== trace.nodes.length) {
    throw new Error("FALCON24_FOUR_LAYER_TRACE_DETAIL_CLOSURE_INVALID");
  }
  for (const node of trace.nodes) {
    const detail = detailsByNode.get(node.node_id);
    if (
      !detail ||
      detail.trace_hash !== trace.trace_hash ||
      detail.run_id !== trace.run_id ||
      detail.kind !== node.kind ||
      detail.status !== node.status ||
      detail.sequence !== node.sequence
    ) {
      throw new Error("FALCON24_FOUR_LAYER_TRACE_DETAIL_CLOSURE_INVALID");
    }
  }
  const agentProfiles = trace.nodes
    .filter(({ kind, status }) => kind === "AGENT" && status === "COMPLETED")
    .map(({ node_id: nodeId }) => {
      const detail = detailsByNode.get(nodeId);
      return detail ? identityValue(detail, "Agent Profile") : null;
    })
    .filter((profile): profile is string => profile !== null);
  if (
    !agentProfiles.includes("data-agent-orchestrator") ||
    !business.actual_profile_ids.every((profileId) => agentProfiles.includes(profileId))
  ) {
    throw new Error("FALCON24_FOUR_LAYER_TRACE_AGENT_CLOSURE_INVALID");
  }
  const accepted = [...business.accepted_artifact_refs].sort((left, right) =>
    artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
  );
  for (const reference of accepted) {
    const identity = artifactReferenceIdentity(reference);
    const nodes = trace.nodes.filter(
      (node) =>
        ["ARTIFACT", "SQL"].includes(node.kind) &&
        node.artifact_refs.some((candidate) => artifactReferenceIdentity(candidate) === identity),
    );
    if (
      nodes.length !== 1 ||
      !nodes[0] ||
      !trace.edges.some(
        ({ kind, to_node_id: toNodeId }) =>
          ["PRODUCED", "EVIDENCE"].includes(kind) && toNodeId === nodes[0]?.node_id,
      )
    ) {
      throw new Error("FALCON24_FOUR_LAYER_TRACE_ARTIFACT_LINEAGE_INVALID");
    }
    const detail = detailsByNode.get(nodes[0].node_id);
    if (
      !detail?.artifact_refs.some(
        (candidate) =>
          artifactReferenceIdentity(candidate) === artifactReferenceIdentity(reference),
      )
    ) {
      throw new Error("FALCON24_FOUR_LAYER_TRACE_ARTIFACT_LINEAGE_INVALID");
    }
  }
  return Object.freeze(accepted);
}

export async function observeFalcon24FourLayerTraceUi(input: {
  readonly session: string;
  readonly web_base_url: string;
  readonly screenshot_path: string;
  readonly workspace_id: string;
  readonly business: Falcon24FourLayerBusinessReceipt;
  readonly qa: Falcon24FourLayerQaUiReceipt;
  readonly trace: ResolutionTrace;
  readonly details: readonly ResolutionTraceDetail[];
  readonly expected_web_build: Falcon24FourLayerWebBuild;
  readonly conversation_traces: readonly Falcon24FourLayerConversationTrace[];
  readonly viewport: Readonly<{ width: 1440; height: number }>;
  readonly now?: () => Date;
}): Promise<Falcon24FourLayerTraceUiReceipt> {
  if (input.qa.status !== "PASS") throw new Error("FALCON24_FOUR_LAYER_TRACE_BEFORE_QA_PASS");
  const accepted = verifyFalcon24FourLayerTraceEvidence(input);
  const currentBinding = input.conversation_traces.at(-1);
  if (
    !currentBinding ||
    currentBinding.run_id !== input.business.run_id ||
    currentBinding.trace_hash !== input.trace.trace_hash
  ) {
    throw new Error("FALCON24_FOUR_LAYER_CONVERSATION_TRACE_ORDER_INVALID");
  }
  const startUrl = falcon24QaStartUrl({
    web_base_url: input.web_base_url,
    workspace_id: input.workspace_id,
    conversation_id: input.business.conversation_id,
  });
  await executeFalcon24AgentBrowser(input.session, [
    "set",
    "viewport",
    String(input.viewport.width),
    String(input.viewport.height),
  ]);
  await executeFalcon24AgentBrowser(input.session, ["errors", "--clear"]);
  await executeFalcon24AgentBrowser(input.session, ["console", "--clear"]);
  await executeFalcon24AgentBrowser(input.session, ["open", startUrl.toString()]);
  const resultSelector = exactRunSelector(input.business.run_id);
  await executeFalcon24AgentBrowser(input.session, ["wait", resultSelector]);
  await executeFalcon24AgentBrowser(input.session, ["click", resultSelector]);
  const readySelector = exactTraceSelector(currentBinding);
  await executeFalcon24AgentBrowser(input.session, ["wait", readySelector]);
  await executeFalcon24AgentBrowser(input.session, [
    "wait",
    '[data-testid="resolution-trace-search"]',
  ]);
  const detailsByNode = new Map(input.details.map((detail) => [detail.node_id, detail]));
  const openedNodes: Array<{ readonly node_id: string; readonly detail_hash: string }> = [];
  for (const node of [...input.trace.nodes].sort((left, right) =>
    left.node_id.localeCompare(right.node_id),
  )) {
    const detail = detailsByNode.get(node.node_id);
    if (!detail) throw new Error("FALCON24_FOUR_LAYER_TRACE_DETAIL_CLOSURE_INVALID");
    await executeFalcon24AgentBrowser(input.session, [
      "fill",
      '[data-testid="resolution-trace-search"]',
      node.node_id,
    ]);
    const nodeSelector = `[data-testid="resolution-trace-node"][data-run-id="${falcon24BrowserSelectorValue(input.trace.run_id)}"][data-node-id="${falcon24BrowserSelectorValue(node.node_id)}"]`;
    await executeFalcon24AgentBrowser(input.session, ["wait", nodeSelector]);
    await executeFalcon24AgentBrowser(input.session, ["click", nodeSelector]);
    const detailSelector = `[data-testid="resolution-trace-detail"][data-node-id="${falcon24BrowserSelectorValue(node.node_id)}"][data-trace-hash="${falcon24BrowserSelectorValue(input.trace.trace_hash)}"][data-detail-hash="${falcon24BrowserSelectorValue(detail.detail_hash)}"]`;
    await executeFalcon24AgentBrowser(input.session, ["wait", detailSelector]);
    const observed = await evaluateFalcon24Browser(
      input.session,
      `(() => { const element=document.querySelector(${JSON.stringify(detailSelector)}); return element?{node_id:element.getAttribute('data-node-id'),trace_hash:element.getAttribute('data-trace-hash'),detail_hash:element.getAttribute('data-detail-hash')}:null; })()`,
      detailObservationSchema,
    );
    if (
      observed.node_id !== node.node_id ||
      observed.trace_hash !== input.trace.trace_hash ||
      observed.detail_hash !== detail.detail_hash
    ) {
      throw new Error("FALCON24_FOUR_LAYER_TRACE_DETAIL_OBSERVATION_DRIFT");
    }
    openedNodes.push({ node_id: observed.node_id, detail_hash: observed.detail_hash });
  }
  const openedArtifacts: ArtifactReference[] = [];
  if (accepted.length > 0) {
    await executeFalcon24AgentBrowser(input.session, [
      "fill",
      '[data-testid="resolution-trace-search"]',
      "",
    ]);
    await executeFalcon24AgentBrowser(input.session, [
      "click",
      '[data-testid="resolution-trace-tab-artifacts"]',
    ]);
  }
  for (const reference of accepted) {
    const triggerSelector = `[data-testid="resolution-trace-artifact"][data-artifact-id="${falcon24BrowserSelectorValue(reference.artifact_id)}"][data-artifact-type="${falcon24BrowserSelectorValue(reference.artifact_type)}"][data-artifact-revision="${reference.revision}"][data-content-hash="${falcon24BrowserSelectorValue(reference.content_hash)}"]`;
    await executeFalcon24AgentBrowser(input.session, ["click", triggerSelector]);
    const previewSelector = `[data-testid="artifact-preview-ready"][data-run-id="${falcon24BrowserSelectorValue(reference.run_id)}"][data-artifact-id="${falcon24BrowserSelectorValue(reference.artifact_id)}"][data-artifact-type="${falcon24BrowserSelectorValue(reference.artifact_type)}"][data-artifact-revision="${reference.revision}"][data-content-hash="${falcon24BrowserSelectorValue(reference.content_hash)}"]`;
    await executeFalcon24AgentBrowser(input.session, ["wait", previewSelector]);
    const observed = await evaluateFalcon24Browser(
      input.session,
      `(() => { const element=document.querySelector(${JSON.stringify(previewSelector)}); return element?{artifact_id:element.getAttribute('data-artifact-id'),artifact_type:element.getAttribute('data-artifact-type'),revision:Number(element.getAttribute('data-artifact-revision')),content_hash:element.getAttribute('data-content-hash'),run_id:element.getAttribute('data-run-id')}:null; })()`,
      artifactObservationSchema,
    );
    if (
      observed.run_id !== reference.run_id ||
      observed.artifact_id !== reference.artifact_id ||
      observed.artifact_type !== reference.artifact_type ||
      observed.revision !== reference.revision ||
      observed.content_hash !== reference.content_hash
    ) {
      throw new Error("FALCON24_FOUR_LAYER_TRACE_ARTIFACT_OBSERVATION_DRIFT");
    }
    openedArtifacts.push(reference);
  }
  const observation = await evaluateFalcon24Browser(
    input.session,
    `(async () => { const ready=document.querySelector(${JSON.stringify(readySelector)}); const response=await fetch('/api/ready',{cache:'no-store'}); const build=await response.json(); return {run_id:ready?.getAttribute('data-run-id')??null,trace_hash:ready?.getAttribute('data-trace-hash')??null,location:window.location.href,horizontal_overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,error_banners:[...document.querySelectorAll('[role="alert"]')].map((element)=>element.textContent?.trim()||''),web_build:{build_id:build.build_id,generation_id:build.generation_id}}; })()`,
    traceObservationSchema,
  );
  await executeFalcon24AgentBrowser(input.session, ["reload"]);
  await executeFalcon24AgentBrowser(input.session, ["wait", readySelector]);
  const screenshotPath = `${input.screenshot_path}.1440.trace.png`;
  await executeFalcon24AgentBrowser(input.session, ["screenshot", "--full", screenshotPath]);
  const screenshotHash = sha256Falcon24BrowserBytes(await readFile(screenshotPath));
  await executeFalcon24AgentBrowser(input.session, [
    "click",
    '[data-testid="resolution-trace-return-to-result"]',
  ]);
  await executeFalcon24AgentBrowser(input.session, ["wait", resultSelector]);
  const switchedRuns: string[] = [];
  for (const binding of input.conversation_traces) {
    await executeFalcon24AgentBrowser(input.session, ["click", exactRunSelector(binding.run_id)]);
    await executeFalcon24AgentBrowser(input.session, ["wait", exactTraceSelector(binding)]);
    switchedRuns.push(binding.run_id);
    await executeFalcon24AgentBrowser(input.session, [
      "click",
      '[data-testid="resolution-trace-return-to-result"]',
    ]);
    await executeFalcon24AgentBrowser(input.session, ["wait", exactRunSelector(binding.run_id)]);
  }
  const pageErrors = await executeFalcon24AgentBrowser(input.session, ["errors"]);
  const consoleMessages = await executeFalcon24AgentBrowser(input.session, ["console"]);
  const errors = z.array(z.unknown()).parse(pageErrors.data.errors ?? []);
  const consoleErrors = z
    .array(z.record(z.string(), z.unknown()))
    .parse(consoleMessages.data.messages ?? [])
    .filter((message) => message.type === "error");
  const passed =
    observation.run_id === input.trace.run_id &&
    observation.trace_hash === input.trace.trace_hash &&
    new URL(observation.location).searchParams.get("run") === input.trace.run_id &&
    !observation.horizontal_overflow &&
    observation.error_banners.length === 0 &&
    sameBuild(observation.web_build, input.expected_web_build) &&
    errors.length === 0 &&
    consoleErrors.length === 0 &&
    switchedRuns.length === input.conversation_traces.length;
  return buildFalcon24FourLayerTraceUiReceipt({
    schema_version: "falcon24-four-layer-trace-ui-receipt@1.0.0",
    ...exactReceiptIdentity(input.business),
    web_build_hash: input.expected_web_build.build_id,
    web_generation_hash: input.expected_web_build.generation_id,
    answer_entry_clicked: true,
    exact_run_focused:
      observation.run_id === input.trace.run_id &&
      observation.trace_hash === input.trace.trace_hash,
    public_event_hash: input.business.public_event_hash,
    accepted_artifact_refs_hash: await sha256ContentHash(accepted),
    dom_snapshot_hash: await sha256ContentHash({
      observation,
      opened_nodes: openedNodes,
      opened_artifact_refs: openedArtifacts,
      switched_runs: switchedRuns,
    }),
    screenshot_hash: screenshotHash,
    status: passed ? "PASS" : "FAIL",
    failure_code: passed ? null : TRACE_FAILURE_CODE,
    observed_at: (input.now?.() ?? new Date()).toISOString(),
  });
}

export async function smokeFalcon24FourLayerConversationAt390(input: {
  readonly session: string;
  readonly web_base_url: string;
  readonly workspace_id: string;
  readonly conversation_id: string;
  readonly binding: Falcon24FourLayerConversationTrace;
  readonly viewport: Readonly<{ width: 390; height: number }>;
}) {
  const startUrl = falcon24QaStartUrl(input);
  await executeFalcon24AgentBrowser(input.session, [
    "set",
    "viewport",
    String(input.viewport.width),
    String(input.viewport.height),
  ]);
  await executeFalcon24AgentBrowser(input.session, ["errors", "--clear"]);
  await executeFalcon24AgentBrowser(input.session, ["console", "--clear"]);
  await executeFalcon24AgentBrowser(input.session, ["open", startUrl.toString()]);
  const resultSelector = exactRunSelector(input.binding.run_id);
  await executeFalcon24AgentBrowser(input.session, ["wait", resultSelector]);
  const qa = await evaluateFalcon24Browser(
    input.session,
    `(() => { const entry=document.querySelector(${JSON.stringify(resultSelector)}); const run=document.getElementById(${JSON.stringify(`chat-run-${input.binding.run_id}`)}); const answer=run?.querySelector('.agent-answer'); const visible=(element)=>Boolean(element&&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0); return {run_id:entry?.getAttribute('data-run-id')??null,answer_visible:visible(answer)&&Boolean(answer?.textContent?.trim()),horizontal_overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,error_banners:[...document.querySelectorAll('[role="alert"]')].map((element)=>element.textContent?.trim()||'')}; })()`,
    narrowSmokeObservationSchema,
  );
  await executeFalcon24AgentBrowser(input.session, ["click", resultSelector]);
  await executeFalcon24AgentBrowser(input.session, ["wait", exactTraceSelector(input.binding)]);
  const trace = await evaluateFalcon24Browser(
    input.session,
    `(() => { const ready=document.querySelector(${JSON.stringify(exactTraceSelector(input.binding))}); return {run_id:ready?.getAttribute('data-run-id')??null,answer_visible:true,horizontal_overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,error_banners:[...document.querySelectorAll('[role="alert"]')].map((element)=>element.textContent?.trim()||'')}; })()`,
    narrowSmokeObservationSchema,
  );
  await executeFalcon24AgentBrowser(input.session, [
    "click",
    '[data-testid="resolution-trace-return-to-result"]',
  ]);
  if (
    qa.run_id !== input.binding.run_id ||
    !qa.answer_visible ||
    qa.horizontal_overflow ||
    qa.error_banners.length > 0 ||
    trace.run_id !== input.binding.run_id ||
    trace.horizontal_overflow ||
    trace.error_banners.length > 0
  ) {
    throw new Error("FALCON24_FOUR_LAYER_390_SMOKE_FAILED");
  }
  return Object.freeze({ qa, trace, submitted: false as const });
}
