import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import {
  buildFalcon24FourLayerBusinessReceipt,
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
  buildFalcon24FourLayerQaUiReceipt,
  type Falcon24FourLayerBusinessReceipt,
  type Falcon24FourLayerManifestTurn,
} from "@data-agent/contracts/evals";
import type { ResolutionTrace, ResolutionTraceDetail } from "@data-agent/contracts/runs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  observeFalcon24FourLayerQaUi,
  observeFalcon24FourLayerTraceUi,
  preflightFalcon24FourLayerBrowserSubmission,
  smokeFalcon24FourLayerConversationAt390,
  verifyFalcon24FourLayerTraceEvidence,
} from "../src/cli/falcon24-four-layer-browser-gate";

const execFileAsyncMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn(async () => Buffer.from("falcon24-browser-proof")));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: execFileAsyncMock,
  });
  return { ...actual, execFile };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: readFileMock };
});

const id = (suffix: number) => `98200000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const now = "2026-08-30T00:00:00.000Z";
const workspaceId = id(20);
const conversationId = id(21);
const runId = id(22);
const previousRunId = id(23);
const previousTraceHash = hash("7");
const webBuild = { build_id: hash("a"), generation_id: hash("b") };
const agentStates = [
  "VALID",
  "WRONG_LABEL",
  "WRONG_ROLE_LABEL",
  "STILL_RUNNING",
  "MISSING_COMPLETION",
] as const;

async function fixture() {
  const turns = await buildFalcon24FourLayerManifestTurns();
  const manifest = await buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@1.0.0",
    gate_id: "E11-FL1",
    attempt_id: id(1),
    authority_epoch: "E11",
    authority_baseline_id: id(2),
    authority_baseline_hash: hash("1"),
    authority_activation_attempt_id: id(3),
    source_commit: "1".repeat(40),
    worker_build_hash: hash("2"),
    worker_generation_hash: hash("3"),
    web_build_hash: webBuild.build_id,
    web_generation_hash: webBuild.generation_id,
    semantic_release_hash: hash("4"),
    datasource_binding_hash: hash("5"),
    model_config_hash: hash("6"),
    runtime_attestation_hash: hash("8"),
    turns,
  });
  const turn = manifest.turns[0];
  if (!turn) throw new Error("four-layer turn fixture required");
  const reference: ArtifactReference = {
    artifact_id: id(30),
    artifact_type: "QueryEvidence",
    app_id: id(31),
    tenant_id: workspaceId,
    environment: "test",
    run_id: runId,
    revision: 1,
    content_hash: hash("9"),
  };
  const business = await buildFalcon24FourLayerBusinessReceipt({
    schema_version: "falcon24-four-layer-business-receipt@1.0.0",
    gate_id: manifest.gate_id,
    attempt_id: manifest.attempt_id,
    manifest_hash: manifest.manifest_hash,
    turn_ordinal: turn.ordinal,
    turn_id: turn.turn_id,
    layer: turn.layer,
    scenario_id: turn.scenario_id,
    scenario_turn_index: turn.scenario_turn_index,
    conversation_id: conversationId,
    conversation_resource_version: 2,
    run_id: runId,
    question_hash: turn.question_hash,
    worker_build_hash: manifest.worker_build_hash,
    worker_generation_hash: manifest.worker_generation_hash,
    semantic_release_hash: manifest.semantic_release_hash,
    answer_hash: hash("c"),
    public_event_hash: hash("d"),
    actual_profile_ids: ["semantic-management-agent"],
    accepted_artifact_refs: [reference],
    rubric_results: turn.rubric.required_checks.map((checkId) => ({
      check_id: checkId,
      status: "PASS",
      evidence_hash: hash("e"),
    })),
    status: "PASS",
    failure_code: null,
    evaluated_at: now,
  });
  return { manifest, turn, business, reference };
}

function receiptIdentity(business: Falcon24FourLayerBusinessReceipt) {
  return {
    gate_id: business.gate_id,
    attempt_id: business.attempt_id,
    manifest_hash: business.manifest_hash,
    turn_ordinal: business.turn_ordinal,
    turn_id: business.turn_id,
    layer: business.layer,
    scenario_id: business.scenario_id,
    scenario_turn_index: business.scenario_turn_index,
    conversation_id: business.conversation_id,
    conversation_resource_version: business.conversation_resource_version,
    run_id: business.run_id,
    question_hash: business.question_hash,
    worker_build_hash: business.worker_build_hash,
    worker_generation_hash: business.worker_generation_hash,
    semantic_release_hash: business.semantic_release_hash,
  } as const;
}

async function qaReceipt(business: Falcon24FourLayerBusinessReceipt) {
  return buildFalcon24FourLayerQaUiReceipt({
    schema_version: "falcon24-four-layer-qa-ui-receipt@1.0.0",
    ...receiptIdentity(business),
    answer_hash: business.answer_hash,
    web_build_hash: webBuild.build_id,
    web_generation_hash: webBuild.generation_id,
    composer_submission_count: 1,
    terminal_answer_visible: true,
    error_banner: null,
    dom_snapshot_hash: hash("f"),
    screenshot_hash: hash("0"),
    status: "PASS",
    failure_code: null,
    observed_at: now,
  });
}

function detail(input: {
  readonly node_id: string;
  readonly kind: ResolutionTraceDetail["kind"];
  readonly status: ResolutionTraceDetail["status"];
  readonly sequence: number;
  readonly profile?: string;
  readonly artifact_refs?: readonly ArtifactReference[];
}): ResolutionTraceDetail {
  return {
    node_id: input.node_id,
    kind: input.kind,
    status: input.status,
    sequence: input.sequence,
    trace_hash: hash("4"),
    run_id: runId,
    identity: input.profile ? [{ label: "Agent Profile", value: input.profile }] : [],
    artifact_refs: [...(input.artifact_refs ?? [])],
    detail_hash: hash(String(input.sequence)),
  } as ResolutionTraceDetail;
}

function traceFixture(reference: ArtifactReference) {
  const nodes = [
    {
      node_id: `event:${id(40)}`,
      kind: "AGENT",
      status: "COMPLETED",
      sequence: 1,
      artifact_refs: [],
    },
    {
      node_id: `event:${id(41)}`,
      kind: "AGENT",
      status: "COMPLETED",
      sequence: 2,
      artifact_refs: [],
    },
    {
      node_id: `event:${id(42)}`,
      kind: "TOOL",
      status: "COMPLETED",
      sequence: 3,
      artifact_refs: [],
    },
    {
      node_id: `artifact:${reference.artifact_id}:1`,
      kind: "ARTIFACT",
      status: "AVAILABLE",
      sequence: 4,
      artifact_refs: [reference],
    },
    {
      node_id: `event:${id(43)}`,
      kind: "TERMINAL",
      status: "COMPLETED",
      sequence: 5,
      artifact_refs: [],
    },
  ] as const;
  const trace = {
    run_id: runId,
    conversation_id: conversationId,
    trace_hash: hash("4"),
    nodes,
    edges: [
      {
        from_node_id: nodes[2].node_id,
        to_node_id: nodes[3].node_id,
        kind: "PRODUCED",
      },
    ],
  } as unknown as ResolutionTrace;
  const details = [
    detail({ ...nodes[0], profile: "data-agent-orchestrator" }),
    detail({ ...nodes[1], profile: "semantic-management-agent" }),
    detail(nodes[2]),
    detail({ ...nodes[3], artifact_refs: [reference] }),
    detail(nodes[4]),
  ];
  return { trace, details };
}

function commandResult(data: Record<string, unknown> = {}) {
  return { stdout: JSON.stringify({ success: true, data, error: null }), stderr: "" };
}

function decodedScript(args: readonly string[]): string {
  const encoded = args.at(-1);
  return args.includes("eval") && encoded ? Buffer.from(encoded, "base64").toString() : "";
}

function consumed(business: Falcon24FourLayerBusinessReceipt, consumedRunId = runId) {
  return {
    schema_version: "falcon24-browser-four-layer-submit-consumed@1.0.0",
    run_id: consumedRunId,
    attempt_id: business.attempt_id,
    conversation_id: business.conversation_id,
    four_layer_fence: {
      gate_id: business.gate_id,
      attempt_id: business.attempt_id,
      manifest_hash: business.manifest_hash,
      turn_ordinal: business.turn_ordinal,
      turn_id: business.turn_id,
      conversation_resource_version: business.conversation_resource_version,
      run_id: consumedRunId,
    },
  } as const;
}

beforeEach(() => {
  execFileAsyncMock.mockReset();
  readFileMock.mockClear();
});

describe("Falcon24 four-layer browser gate", () => {
  it("allows the retained L4 session only when its previous consumed Run is exact", async () => {
    const { business } = await fixture();
    execFileAsyncMock.mockImplementation(async (_file: string, args: readonly string[]) => {
      const script = decodedScript(args);
      if (script.includes("prior_run_counts")) {
        return commandResult({
          result: {
            ready: true,
            composer_ready: true,
            claim_absent: true,
            consumed: consumed(business, previousRunId),
            expected_run_absent: true,
            prior_run_counts: [{ run_id: previousRunId, count: 1 }],
            error_banners: [],
            web_build: webBuild,
          },
        });
      }
      return commandResult();
    });

    await expect(
      preflightFalcon24FourLayerBrowserSubmission({
        session: "falcon24-e11-l4-a",
        web_base_url: "https://data-agent.example",
        workspace_id: workspaceId,
        claim: {
          schema_version: "falcon24-browser-four-layer-submit-claim@1.0.0",
          question: "继续分析",
          conversation_id: conversationId,
          idempotency_key: "l4-a-turn-2",
          four_layer_fence: {
            ...consumed(business).four_layer_fence,
            run_id: runId,
          },
        },
        expected_web_build: webBuild,
        previous_run_ids: [previousRunId],
        viewport: { width: 1440, height: 900 },
      }),
    ).resolves.toMatchObject({ expected_run_absent: true });
  });

  it.each(agentStates)("checks %s agents and exact Run refresh", async (agentState) => {
    const { turn, business } = await fixture();
    execFileAsyncMock.mockImplementation(async (_file: string, args: readonly string[]) => {
      const script = decodedScript(args);
      if (
        script.includes("sessionStorage.getItem") &&
        !script.includes("conversation_run_counts")
      ) {
        return commandResult({ result: consumed(business) });
      }
      if (script.includes("conversation_run_counts")) {
        return commandResult({
          result: {
            run_id: runId,
            terminal_status: "COMPLETED",
            answer_visible: true,
            table_visible: false,
            chart_rendered: false,
            loading_visible: false,
            agent_activity: [
              {
                profile_id: "data-agent-orchestrator",
                role: "ROOT",
                label:
                  agentState === "WRONG_LABEL"
                    ? "子代理 · Report"
                    : agentState === "WRONG_ROLE_LABEL"
                      ? "子代理 · Root"
                      : "主代理 · Root",
                status: "COMPLETED",
              },
              {
                profile_id: "semantic-management-agent",
                role: "SPECIALIST",
                label: "子代理 · Semantic",
                status:
                  agentState === "STILL_RUNNING"
                    ? "RUNNING"
                    : agentState === "MISSING_COMPLETION"
                      ? "INTERRUPTED"
                      : "COMPLETED",
              },
            ],
            horizontal_overflow: false,
            conversation_run_counts: [{ run_id: runId, count: 1 }],
            error_banners: [],
            web_build: webBuild,
          },
        });
      }
      return commandResult();
    });

    const pass = await observeFalcon24FourLayerQaUi({
      session: "falcon24-e11-l1-01",
      web_base_url: "https://data-agent.example",
      screenshot_path: "/tmp/falcon24-l1-01",
      workspace_id: workspaceId,
      turn,
      business,
      expected_web_build: webBuild,
      conversation_run_ids: [runId],
      viewport: { width: 1440, height: 900 },
      now: () => new Date(now),
    });
    expect(pass.status).toBe(agentState === "VALID" ? "PASS" : "FAIL");
    const chartRequired = {
      ...turn,
      rubric: { ...turn.rubric, chart_required: true },
    } satisfies Falcon24FourLayerManifestTurn;
    const fail = await observeFalcon24FourLayerQaUi({
      session: "falcon24-e11-chart-required",
      web_base_url: "https://data-agent.example",
      screenshot_path: "/tmp/falcon24-chart-required",
      workspace_id: workspaceId,
      turn: chartRequired,
      business,
      expected_web_build: webBuild,
      conversation_run_ids: [runId],
      viewport: { width: 1440, height: 900 },
      now: () => new Date(now),
    });
    expect(fail).toMatchObject({
      status: "FAIL",
      failure_code: "FALCON24_QA_UI_OBSERVATION_FAILED",
    });
    expect(
      execFileAsyncMock.mock.calls.filter(([, args]) =>
        (args as readonly string[]).includes("reload"),
      ),
    ).toHaveLength(2);
  });

  it("opens Root, Subagent, Tool and accepted Artifact evidence, then switches exact Runs", async () => {
    const { business, reference } = await fixture();
    const qa = await qaReceipt(business);
    const { trace, details } = traceFixture(reference);
    execFileAsyncMock.mockImplementation(async (_file: string, args: readonly string[]) => {
      const script = decodedScript(args);
      const matchingDetail = details.find(({ node_id: nodeId }) => script.includes(nodeId));
      if (script.includes("node_id:element.getAttribute") && matchingDetail) {
        return commandResult({
          result: {
            node_id: matchingDetail.node_id,
            trace_hash: matchingDetail.trace_hash,
            detail_hash: matchingDetail.detail_hash,
          },
        });
      }
      if (script.includes("artifact_id:element.getAttribute")) {
        return commandResult({
          result: {
            artifact_id: reference.artifact_id,
            artifact_type: reference.artifact_type,
            revision: reference.revision,
            content_hash: reference.content_hash,
            run_id: reference.run_id,
          },
        });
      }
      if (script.includes("const ready=document.querySelector") && script.includes("/api/ready")) {
        return commandResult({
          result: {
            run_id: runId,
            trace_hash: trace.trace_hash,
            location: `https://data-agent.example/w/${workspaceId}/qa?conversation=${conversationId}&tab=trace&run=${runId}`,
            horizontal_overflow: false,
            error_banners: [],
            web_build: webBuild,
          },
        });
      }
      if (args.includes("errors") && !args.includes("--clear")) {
        return commandResult({ errors: [] });
      }
      if (args.includes("console") && !args.includes("--clear")) {
        return commandResult({ messages: [] });
      }
      return commandResult();
    });
    const conversationTraces = [
      { run_id: previousRunId, trace_hash: previousTraceHash },
      { run_id: runId, trace_hash: trace.trace_hash },
    ];

    await expect(
      observeFalcon24FourLayerTraceUi({
        session: "falcon24-e11-l4-trace",
        web_base_url: "https://data-agent.example",
        screenshot_path: "/tmp/falcon24-l4",
        workspace_id: workspaceId,
        business,
        qa,
        trace,
        details,
        expected_web_build: webBuild,
        conversation_traces: conversationTraces,
        viewport: { width: 1440, height: 900 },
        now: () => new Date(now),
      }),
    ).resolves.toMatchObject({ status: "PASS", exact_run_focused: true });
    const commands = execFileAsyncMock.mock.calls.map(([, args]) =>
      (args as readonly string[]).join(" "),
    );
    expect(commands.some((command) => command.includes("resolution-trace-artifact"))).toBe(true);
    expect(commands.some((command) => command.includes(previousRunId))).toBe(true);
    expect(commands.filter((command) => command.includes("resolution-trace-node"))).toHaveLength(
      details.length * 2,
    );
    const exactRunClicks = commands.filter(
      (command) => command.includes("click") && command.includes("qa-result-trace-entry"),
    );
    const exactRunScrolls = commands.filter(
      (command) => command.includes("scrollintoview") && command.includes("qa-result-trace-entry"),
    );
    expect(exactRunScrolls).toHaveLength(exactRunClicks.length);
    expect(commands.filter((command) => command.includes("elementFromPoint"))).toHaveLength(
      exactRunClicks.length,
    );
  });

  it("fails closed when public Trace lacks a completed Tool node", async () => {
    const { business, reference } = await fixture();
    const { trace, details } = traceFixture(reference);
    const traceWithoutTool = {
      ...trace,
      nodes: trace.nodes.filter(({ kind }) => kind !== "TOOL"),
    } as ResolutionTrace;
    expect(() =>
      verifyFalcon24FourLayerTraceEvidence({
        trace: traceWithoutTool,
        details: details.filter(({ kind }) => kind !== "TOOL"),
        business,
      }),
    ).toThrow("FALCON24_FOUR_LAYER_TRACE_RUNTIME_CLOSURE_INVALID");
  });

  it("does not click a Trace entry that remains covered after scrolling", async () => {
    const { business, reference } = await fixture();
    const qa = await qaReceipt(business);
    const { trace, details } = traceFixture(reference);
    execFileAsyncMock.mockImplementation(async (_file: string, args: readonly string[]) => {
      if (args.includes("wait") && args.includes("--fn")) {
        throw new Error("The composer still covers the entry");
      }
      return commandResult();
    });
    await expect(
      observeFalcon24FourLayerTraceUi({
        session: "falcon24-covered-entry",
        web_base_url: "https://data-agent.example",
        screenshot_path: "/tmp/falcon24-covered-entry",
        workspace_id: workspaceId,
        business,
        qa,
        trace,
        details,
        expected_web_build: webBuild,
        conversation_traces: [{ run_id: runId, trace_hash: trace.trace_hash }],
        viewport: { width: 1440, height: 900 },
      }),
    ).rejects.toThrow("FALCON24_TRACE_ENTRY_NOT_ACTIONABLE");
    expect(
      execFileAsyncMock.mock.calls.some(([, args]) =>
        (args as readonly string[]).includes("click"),
      ),
    ).toBe(false);
  });

  it("runs the 390 smoke against retained results without a composer submission", async () => {
    execFileAsyncMock.mockImplementation(async (_file: string, args: readonly string[]) => {
      const script = decodedScript(args);
      if (script.includes("const entry=document.querySelector")) {
        return commandResult({
          result: {
            run_id: runId,
            answer_visible: true,
            horizontal_overflow: false,
            error_banners: [],
          },
        });
      }
      if (script.includes("const ready=document.querySelector")) {
        return commandResult({
          result: {
            run_id: runId,
            answer_visible: true,
            horizontal_overflow: false,
            error_banners: [],
          },
        });
      }
      return commandResult();
    });

    await expect(
      smokeFalcon24FourLayerConversationAt390({
        session: "falcon24-e11-390",
        web_base_url: "https://data-agent.example",
        workspace_id: workspaceId,
        conversation_id: conversationId,
        binding: { run_id: runId, trace_hash: hash("4") },
        viewport: { width: 390, height: 844 },
      }),
    ).resolves.toMatchObject({ submitted: false });
    const commands = execFileAsyncMock.mock.calls.map(([, args]) => args as readonly string[]);
    expect(
      commands.some(
        (args) => args.includes("fill") && args.includes('[data-testid="qa-question-input"]'),
      ),
    ).toBe(false);
    expect(
      commands.some(
        (args) => args.includes("click") && args.includes('[data-testid="qa-submit-question"]'),
      ),
    ).toBe(false);
  });
});
