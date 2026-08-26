import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  ArtifactReference,
  ResolutionTrace,
  ResolutionTraceDetail,
} from "@data-agent/contracts";
import {
  artifactReferenceIdentity,
  FALCON24_REQUIRED_UI_ARTIFACT_TYPES,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const HARNESS_VERSION = "falcon24-agent-browser-trace-gate@1.0.0" as const;

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
});

const finalBrowserObservationSchema = z.strictObject({
  run_id: z.uuid(),
  trace_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  location: z.string().url(),
  error_banners: z.array(z.string().max(2_000)).max(32),
  chart_render_state: z.literal("READY"),
  source_table_visible: z.literal(true),
  web_build: z.strictObject({
    build_id: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    generation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  }),
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
  readonly trace: ResolutionTrace;
  readonly details: readonly ResolutionTraceDetail[];
}

export async function runFalcon24BrowserTraceGate(input: Falcon24BrowserTraceGateInput) {
  const session = z
    .string()
    .regex(/^[A-Za-z0-9._-]{3,128}$/u)
    .parse(input.session);
  const baseUrl = new URL(input.web_base_url);
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new TypeError("FALCON24_BROWSER_BASE_URL_INVALID");
  }
  const detailsByNode = new Map(input.details.map((detail) => [detail.node_id, detail]));
  if (
    detailsByNode.size !== input.trace.nodes.length ||
    input.trace.nodes.some(
      (node) => detailsByNode.get(node.node_id)?.trace_hash !== input.trace.trace_hash,
    )
  ) {
    throw new Error("FALCON24_BROWSER_DETAIL_CLOSURE_INVALID");
  }
  const firstSequence = input.trace.nodes.find(({ sequence }) => sequence !== null)?.sequence;
  if (!firstSequence) throw new Error("FALCON24_BROWSER_TRACE_EVENT_REQUIRED");
  const url = new URL(`/w/${input.workspace_id}/qa`, baseUrl);
  url.searchParams.set("conversation", input.conversation_id);
  url.searchParams.set("run", input.trace.run_id);
  url.searchParams.set("event", String(firstSequence));
  url.searchParams.set("tab", "trajectory");

  await agentBrowser(session, ["open", url.toString()]);
  const readySelector = `[data-testid="resolution-trace-ready"][data-run-id="${selectorValue(input.trace.run_id)}"][data-trace-hash="${selectorValue(input.trace.trace_hash)}"]`;
  await agentBrowser(session, ["wait", readySelector]);
  const searchSelector = '[data-testid="resolution-trace-search"]';
  await agentBrowser(session, ["wait", searchSelector]);

  const openedNodes: Array<{ node_id: string; detail_hash: string }> = [];
  for (const node of [...input.trace.nodes].sort((left, right) =>
    left.node_id.localeCompare(right.node_id),
  )) {
    const expectedDetail = detailsByNode.get(node.node_id);
    if (!expectedDetail) throw new Error("FALCON24_BROWSER_DETAIL_CLOSURE_INVALID");
    await agentBrowser(session, ["fill", searchSelector, node.node_id]);
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

  await agentBrowser(session, ["fill", searchSelector, ""]);
  await agentBrowser(session, ["click", '[data-testid="resolution-trace-tab-artifacts"]']);
  const requiredArtifacts = exactRequiredFalcon24ArtifactReferences(input.trace);
  const openedArtifacts: ArtifactReference[] = [];
  for (const reference of requiredArtifacts) {
    const triggerSelector = `[data-testid="resolution-trace-artifact"][data-artifact-id="${selectorValue(reference.artifact_id)}"][data-artifact-type="${selectorValue(reference.artifact_type)}"][data-artifact-revision="${reference.revision}"][data-content-hash="${selectorValue(reference.content_hash)}"]`;
    await agentBrowser(session, ["click", triggerSelector]);
    const previewSelector = `[data-testid="artifact-preview-ready"][data-artifact-id="${selectorValue(reference.artifact_id)}"][data-artifact-type="${selectorValue(reference.artifact_type)}"][data-artifact-revision="${reference.revision}"][data-content-hash="${selectorValue(reference.content_hash)}"]`;
    await agentBrowser(session, ["wait", previewSelector]);
    const observed = await browserEval(
      session,
      `(() => { const element=document.querySelector(${JSON.stringify(previewSelector)}); if(!element) return null; return {artifact_id:element.getAttribute('data-artifact-id'),artifact_type:element.getAttribute('data-artifact-type'),revision:Number(element.getAttribute('data-artifact-revision')),content_hash:element.getAttribute('data-content-hash')}; })()`,
      artifactObservationSchema,
    );
    if (
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
    `(async () => { const ready=document.querySelector('[data-testid="resolution-trace-ready"]'); const chart=document.querySelector('[data-testid="governed-chart"]'); const table=document.querySelector('[data-testid="chart-source-table"]'); const response=await fetch('/api/ready',{cache:'no-store'}); const build=await response.json(); return {run_id:ready?.getAttribute('data-run-id'),trace_hash:ready?.getAttribute('data-trace-hash'),location:window.location.href,error_banners:[...document.querySelectorAll('[role="alert"]')].map((element)=>element.textContent?.trim()||''),chart_render_state:chart?.getAttribute('data-chart-render-state'),source_table_visible:Boolean(table && table.getBoundingClientRect().width>0 && table.getBoundingClientRect().height>0),web_build:{build_id:build.build_id,generation_id:build.generation_id}}; })()`,
    finalBrowserObservationSchema,
  );
  if (
    finalObservation.run_id !== input.trace.run_id ||
    finalObservation.trace_hash !== input.trace.trace_hash ||
    finalObservation.error_banners.length > 0
  ) {
    throw new Error("FALCON24_BROWSER_FINAL_OBSERVATION_INVALID");
  }
  await agentBrowser(session, ["screenshot", "--full", input.screenshot_path]);
  const screenshotBytes = await readFile(input.screenshot_path);
  const chartRef = requiredArtifacts.find(
    ({ artifact_type: artifactType }) => artifactType === "ArtifactWorkspaceDocument",
  );
  if (!chartRef) throw new Error("FALCON24_BROWSER_CHART_REFERENCE_MISSING");
  return Object.freeze({
    browser_harness_version: HARNESS_VERSION,
    web_build: finalObservation.web_build,
    opened_nodes: openedNodes,
    opened_artifact_refs: openedArtifacts,
    chart_ref: chartRef,
    chart_renderer_version: "governed-vchart@1.0.0" as const,
    chart_rendered: true as const,
    source_table_visible: true as const,
    error_banner: null,
    dom_snapshot_hash: await sha256ContentHash(finalObservation),
    screenshot_hash: `sha256:${createHash("sha256").update(screenshotBytes).digest("hex")}`,
    observed_at: new Date().toISOString(),
  });
}
