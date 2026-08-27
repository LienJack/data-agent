import {
  buildResolutionTrace,
  buildResolutionTraceDetail,
  type ResolutionTrace,
  type ResolutionTraceDetail,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { exactRequiredFalcon24ArtifactReferences } from "@/cli/falcon24-browser-trace-gate";
import { verifyFalcon24ResolutionTraceGate } from "@/cli/falcon24-resolution-trace-gate";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const occurredAt = "2026-08-25T10:00:00.000Z";

function reference(
  artifactType:
    | "SqlArtifact"
    | "QueryEvidence"
    | "AnalysisProgram"
    | "DerivedAnalysisEvidence"
    | "AnalysisCompletionReceipt"
    | "ArtifactWorkspaceDocument"
    | "AnalysisReport",
  suffix: number,
) {
  return {
    artifact_id: id(suffix),
    artifact_type: artifactType,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  } as const;
}

const sqlRef = reference("SqlArtifact", 10);
const evidenceRef = reference("QueryEvidence", 11);
const derivedEvidenceRef = reference("DerivedAnalysisEvidence", 12);
const chartRef = reference("ArtifactWorkspaceDocument", 13);
const reportRef = reference("AnalysisReport", 14);
const secondChartRef = reference("ArtifactWorkspaceDocument", 15);
const programRef = reference("AnalysisProgram", 16);
const completionRef = reference("AnalysisCompletionReceipt", 17);

const nodeId = (
  ref:
    | typeof sqlRef
    | typeof evidenceRef
    | typeof programRef
    | typeof derivedEvidenceRef
    | typeof completionRef
    | typeof programRef
    | typeof completionRef
    | typeof chartRef
    | typeof secondChartRef
    | typeof reportRef,
) => `artifact:${ref.artifact_id}:${ref.revision}`;

const rootEventId = id(18);
const subagentEventId = id(19);
const terminalEventId = id(20);
const oracleId = id(21);
const publisherEventId = id(22);
const rootNodeId = `event:${rootEventId}`;
const subagentNodeId = `event:${subagentEventId}`;
const terminalNodeId = `event:${terminalEventId}`;
const oracleNodeId = `context:oracle:${oracleId}`;
const publisherNodeId = `context:publisher:${publisherEventId}`;

async function traceFixture(sqlKind: "SQL" | "ARTIFACT" = "SQL") {
  return buildResolutionTrace({
    schema_version: "resolution-trace@1.0.0",
    scope,
    run_id: runId,
    conversation_id: id(4),
    config_ref: null,
    nodes: [
      {
        node_id: rootNodeId,
        kind: "AGENT",
        source_event_id: rootEventId,
        sequence: 1,
        occurred_at: occurredAt,
        status: "COMPLETED",
        title: "Root Agent",
        summary: "已完成任务编排",
        duration_ms: 10,
        artifact_refs: [],
      },
      {
        node_id: subagentNodeId,
        kind: "AGENT",
        source_event_id: subagentEventId,
        sequence: 2,
        occurred_at: occurredAt,
        status: "COMPLETED",
        title: "Text2SQL Agent",
        summary: "已完成受治理查询",
        duration_ms: 20,
        artifact_refs: [],
      },
      {
        node_id: terminalNodeId,
        kind: "TERMINAL",
        source_event_id: terminalEventId,
        sequence: 3,
        occurred_at: occurredAt,
        status: "COMPLETED",
        title: "Run terminal",
        summary: "分析已完成",
        duration_ms: null,
        artifact_refs: [],
      },
      {
        node_id: nodeId(programRef),
        kind: "ARTIFACT",
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE",
        title: "AnalysisProgram",
        summary: "通用分析程序",
        duration_ms: null,
        artifact_refs: [programRef],
      },
      {
        node_id: nodeId(sqlRef),
        kind: sqlKind,
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE",
        title: "SqlArtifact",
        summary: "受治理 SQL candidate",
        duration_ms: null,
        artifact_refs: [sqlRef],
      },
      {
        node_id: nodeId(completionRef),
        kind: "ARTIFACT",
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE",
        title: "AnalysisCompletionReceipt",
        summary: "READY 分析闭包",
        duration_ms: null,
        artifact_refs: [completionRef],
      },
      {
        node_id: nodeId(evidenceRef),
        kind: "ARTIFACT",
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE",
        title: "QueryEvidence",
        summary: "18 行受治理查询结果",
        duration_ms: null,
        artifact_refs: [evidenceRef],
      },
      {
        node_id: nodeId(derivedEvidenceRef),
        kind: "ARTIFACT",
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE",
        title: "DerivedAnalysisEvidence",
        summary: "治理统计算子证据",
        duration_ms: null,
        artifact_refs: [derivedEvidenceRef],
      },
      {
        node_id: nodeId(chartRef),
        kind: "ARTIFACT",
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE",
        title: "ArtifactWorkspaceDocument",
        summary: "经营趋势图",
        duration_ms: null,
        artifact_refs: [chartRef],
      },
      {
        node_id: nodeId(reportRef),
        kind: "ARTIFACT",
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE",
        title: "AnalysisReport",
        summary: "经营分析报告",
        duration_ms: null,
        artifact_refs: [reportRef],
      },
      {
        node_id: oracleNodeId,
        kind: "CONTEXT",
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE",
        title: "Oracle · trend",
        summary: "PASS · governed-oracle@1 · coverage 1",
        duration_ms: null,
        artifact_refs: [],
      },
      {
        node_id: publisherNodeId,
        kind: "CONTEXT",
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE",
        title: "E1 Publisher",
        summary: "Atomic publication · 4 exact artifacts",
        duration_ms: null,
        artifact_refs: [],
      },
    ],
    edges: [
      { from_node_id: rootNodeId, to_node_id: subagentNodeId, kind: "SEQUENCE" },
      { from_node_id: subagentNodeId, to_node_id: terminalNodeId, kind: "SEQUENCE" },
      {
        from_node_id: nodeId(sqlRef),
        to_node_id: nodeId(evidenceRef),
        kind: "EVIDENCE",
      },
      {
        from_node_id: nodeId(evidenceRef),
        to_node_id: nodeId(derivedEvidenceRef),
        kind: "EVIDENCE",
      },
      {
        from_node_id: nodeId(programRef),
        to_node_id: nodeId(derivedEvidenceRef),
        kind: "EVIDENCE",
      },
      {
        from_node_id: nodeId(programRef),
        to_node_id: nodeId(completionRef),
        kind: "EVIDENCE",
      },
      {
        from_node_id: nodeId(derivedEvidenceRef),
        to_node_id: nodeId(completionRef),
        kind: "EVIDENCE",
      },
      {
        from_node_id: nodeId(derivedEvidenceRef),
        to_node_id: nodeId(chartRef),
        kind: "EVIDENCE",
      },
      {
        from_node_id: nodeId(derivedEvidenceRef),
        to_node_id: nodeId(reportRef),
        kind: "EVIDENCE",
      },
      {
        from_node_id: nodeId(chartRef),
        to_node_id: nodeId(reportRef),
        kind: "EVIDENCE",
      },
      { from_node_id: nodeId(evidenceRef), to_node_id: oracleNodeId, kind: "EVIDENCE" },
      { from_node_id: nodeId(programRef), to_node_id: oracleNodeId, kind: "EVIDENCE" },
      { from_node_id: nodeId(derivedEvidenceRef), to_node_id: oracleNodeId, kind: "EVIDENCE" },
      { from_node_id: oracleNodeId, to_node_id: publisherNodeId, kind: "EVIDENCE" },
      { from_node_id: publisherNodeId, to_node_id: nodeId(derivedEvidenceRef), kind: "EVIDENCE" },
      { from_node_id: publisherNodeId, to_node_id: nodeId(completionRef), kind: "EVIDENCE" },
      { from_node_id: publisherNodeId, to_node_id: nodeId(chartRef), kind: "EVIDENCE" },
      { from_node_id: publisherNodeId, to_node_id: nodeId(reportRef), kind: "EVIDENCE" },
    ],
  });
}

async function detail(
  trace: ResolutionTrace,
  ref:
    | typeof sqlRef
    | typeof evidenceRef
    | typeof derivedEvidenceRef
    | typeof chartRef
    | typeof secondChartRef
    | typeof reportRef,
  schemaName: string,
  schemaVersion: string,
): Promise<ResolutionTraceDetail> {
  const node = trace.nodes.find(({ node_id: current }) => current === nodeId(ref));
  if (!node) throw new Error("missing fixture node");
  const section = {
    state: "AVAILABLE" as const,
    format: "TEXT" as const,
    text: "公开内容",
    fields: [],
  };
  return buildResolutionTraceDetail({
    schema_version: "resolution-trace-detail@3.0.0",
    trace_hash: trace.trace_hash,
    scope,
    run_id: runId,
    node_id: node.node_id,
    kind: node.kind,
    sequence: node.sequence,
    source_event_ids: [],
    title: node.title,
    status: node.status,
    summary: node.summary,
    hierarchy: { parent_node_ids: [], child_node_ids: [] },
    run_context: section,
    identity:
      ref.artifact_type === "DerivedAnalysisEvidence"
        ? [{ label: "Analysis node", value: "trend", value_kind: "NAME" as const }]
        : [],
    payload: section,
    result: { ...section, format: "ARTIFACTS" },
    schema: {
      state: "AVAILABLE",
      schema_name: schemaName,
      schema_version: schemaVersion,
      fields: [],
    },
    timing: {
      occurred_at: occurredAt,
      started_at: null,
      completed_at: null,
      duration_ms: null,
      source: "ARTIFACT_TIMESTAMP",
    },
    relations: [],
    artifact_refs: [ref],
  });
}

async function publicNodeDetail(
  trace: ResolutionTrace,
  targetNodeId: string,
  schemaName: string,
  schemaVersion: string,
  identity: ResolutionTraceDetail["identity"] = [],
): Promise<ResolutionTraceDetail> {
  const node = trace.nodes.find(({ node_id: current }) => current === targetNodeId);
  if (!node) throw new Error("missing public node fixture");
  const section = {
    state: "AVAILABLE" as const,
    format: "TEXT" as const,
    text: "分析已完成",
    fields: [],
  };
  return buildResolutionTraceDetail({
    schema_version: "resolution-trace-detail@3.0.0",
    trace_hash: trace.trace_hash,
    scope,
    run_id: runId,
    node_id: node.node_id,
    kind: node.kind,
    sequence: node.sequence,
    source_event_ids: node.source_event_id ? [node.source_event_id] : [],
    title: node.title,
    status: node.status,
    summary: node.summary,
    hierarchy: { parent_node_ids: [], child_node_ids: [] },
    run_context: section,
    identity,
    payload: section,
    result: section,
    schema: {
      state: "AVAILABLE",
      schema_name: schemaName,
      schema_version: schemaVersion,
      fields: [],
    },
    timing: {
      occurred_at: occurredAt,
      started_at: null,
      completed_at: node.source_event_id ? occurredAt : null,
      duration_ms: node.duration_ms,
      source: node.source_event_id ? "EVENT_TIMESTAMP" : "ARTIFACT_TIMESTAMP",
    },
    relations: [],
    artifact_refs: [],
  });
}

async function detailsFixture(trace: ResolutionTrace): Promise<ResolutionTraceDetail[]> {
  return Promise.all([
    publicNodeDetail(trace, rootNodeId, "public-run-event", "public-run-event@2.0.0", [
      { label: "Agent Profile", value: "data-agent-orchestrator", value_kind: "NAME" },
      { label: "Task ID", value: id(30), value_kind: "ID" },
    ]),
    publicNodeDetail(trace, subagentNodeId, "public-run-event", "public-run-event@2.0.0", [
      { label: "Agent Profile", value: "governed-text2sql-agent", value_kind: "NAME" },
      { label: "Task ID", value: id(31), value_kind: "ID" },
    ]),
    publicNodeDetail(trace, terminalNodeId, "run-terminal", "run-terminal@1.0.0"),
    detail(trace, sqlRef, "product-team-artifact", "product-team-artifact@2.0.0"),
    detail(trace, evidenceRef, "product-team-artifact", "product-team-artifact@2.0.0"),
    detail(trace, programRef, "artifact-reference", "artifact-reference@1.0.0"),
    detail(trace, derivedEvidenceRef, "artifact-reference", "artifact-reference@1.0.0"),
    detail(trace, completionRef, "artifact-reference", "artifact-reference@1.0.0"),
    detail(
      trace,
      chartRef,
      "artifact-workspace-chart-document",
      "artifact-workspace-chart-document@3.0.0",
    ),
    detail(trace, reportRef, "product-team-artifact", "product-team-artifact@2.0.0"),
    publicNodeDetail(
      trace,
      oracleNodeId,
      "analysis-oracle-receipt",
      "analysis-oracle-receipt@1.0.0",
      [{ label: "Analysis node", value: "trend", value_kind: "NAME" }],
    ),
    publicNodeDetail(
      trace,
      publisherNodeId,
      "e1-analysis-publication",
      "e1-analysis-publication@1.0.0",
    ),
  ]);
}

async function rebuildDetail(
  detail: ResolutionTraceDetail,
  changes: Partial<Omit<ResolutionTraceDetail, "detail_hash">>,
): Promise<ResolutionTraceDetail> {
  const { detail_hash: _detailHash, ...material } = detail;
  return buildResolutionTraceDetail({ ...material, ...changes });
}

describe("Falcon24 Resolution Trace acceptance gate", () => {
  it("accepts a Publisher bound to the E2 Run authority", async () => {
    const historical = await traceFixture();
    const { trace_hash: _traceHash, ...material } = historical;
    const trace = await buildResolutionTrace({
      ...material,
      nodes: material.nodes.map((node) =>
        node.node_id === publisherNodeId ? { ...node, title: "E2 Publisher" } : node,
      ),
    });
    const details = await Promise.all(
      (await detailsFixture(trace)).map((candidate) =>
        candidate.node_id === publisherNodeId
          ? rebuildDetail(candidate, {
              schema: {
                state: "AVAILABLE",
                schema_name: "falcon24-analysis-publication",
                schema_version: "falcon24-analysis-publication@2.0.0",
                fields: [],
              },
            })
          : candidate,
      ),
    );

    expect(verifyFalcon24ResolutionTraceGate(trace, details)).toMatchObject({
      report_node_count: 1,
      chart_node_count: 1,
    });
  });
  it("accepts the completed SQL to query evidence to derived evidence to chart and report chain", async () => {
    const trace = await traceFixture();
    const details = await detailsFixture(trace);
    expect(verifyFalcon24ResolutionTraceGate(trace, details)).toEqual({
      node_count: 12,
      edge_count: 18,
      detail_count: 12,
      sql_node_count: 1,
      query_evidence_node_count: 1,
      analysis_evidence_node_count: 1,
      chart_node_count: 1,
      report_node_count: 1,
      detail_closure: details
        .map(({ node_id: nodeId, detail_hash: detailHash }) => ({
          node_id: nodeId,
          detail_hash: detailHash,
        }))
        .sort((left, right) => left.node_id.localeCompare(right.node_id)),
    });
    expect(
      exactRequiredFalcon24ArtifactReferences(trace).map(
        ({ artifact_type: artifactType }) => artifactType,
      ),
    ).toEqual([
      "SqlArtifact",
      "QueryEvidence",
      "DerivedAnalysisEvidence",
      "ArtifactWorkspaceDocument",
      "AnalysisReport",
    ]);
  });

  it("rejects a browser gate trace without exactly one required Artifact of each type", async () => {
    const trace = await traceFixture();
    const missingChart = {
      ...trace,
      nodes: trace.nodes.map((node) =>
        node.node_id === nodeId(chartRef) ? { ...node, artifact_refs: [] } : node,
      ),
    } as ResolutionTrace;
    expect(() => exactRequiredFalcon24ArtifactReferences(missingChart)).toThrow(
      "FALCON24_BROWSER_REQUIRED_ARTIFACT_CARDINALITY_INVALID",
    );
  });

  it("rejects a trace without the exact completed Run terminal", async () => {
    const complete = await traceFixture();
    const { trace_hash: _traceHash, ...material } = complete;
    const trace = await buildResolutionTrace({
      ...material,
      nodes: complete.nodes.filter(({ kind }) => kind !== "TERMINAL"),
      edges: complete.edges.filter(
        ({ from_node_id: fromNodeId, to_node_id: toNodeId }) =>
          fromNodeId !== terminalNodeId && toNodeId !== terminalNodeId,
      ),
    });
    const details = (await detailsFixture(complete)).filter(({ kind }) => kind !== "TERMINAL");
    expect(() => verifyFalcon24ResolutionTraceGate(trace, details)).toThrow(
      "FALCON24_RESOLUTION_TRACE_COMPLETED_TERMINAL_REQUIRED",
    );
  });

  it("rejects a running terminal before sandbox reclamation", async () => {
    const complete = await traceFixture();
    const { trace_hash: _traceHash, ...material } = complete;
    const trace = await buildResolutionTrace({
      ...material,
      nodes: complete.nodes.map((node) =>
        node.kind === "TERMINAL" ? { ...node, status: "RUNNING" as const } : node,
      ),
    });
    expect(() => verifyFalcon24ResolutionTraceGate(trace, [])).toThrow(
      "FALCON24_RESOLUTION_TRACE_COMPLETED_TERMINAL_REQUIRED",
    );
  });

  it("rejects the former ARTIFACT-kind SqlArtifact lookup", async () => {
    const trace = await traceFixture("ARTIFACT");
    const details = await detailsFixture(trace);
    expect(() => verifyFalcon24ResolutionTraceGate(trace, details)).toThrow(
      "FALCON24_RESOLUTION_TRACE_SQL_CARDINALITY_INVALID",
    );
  });

  it("rejects a missing detail instead of treating the graph as readable", async () => {
    const trace = await traceFixture();
    const details = (await detailsFixture(trace)).slice(0, -1);
    expect(() => verifyFalcon24ResolutionTraceGate(trace, details)).toThrow(
      "FALCON24_RESOLUTION_TRACE_DETAIL_INVALID",
    );
  });

  it("rejects an Oracle without its exact QueryEvidence evidence edge", async () => {
    const complete = await traceFixture();
    const { trace_hash: _traceHash, ...material } = complete;
    const trace = await buildResolutionTrace({
      ...material,
      edges: complete.edges.filter(
        ({ from_node_id: fromNodeId, to_node_id: toNodeId }) =>
          fromNodeId !== nodeId(evidenceRef) || toNodeId !== oracleNodeId,
      ),
    });
    const details = await detailsFixture(trace);
    expect(() => verifyFalcon24ResolutionTraceGate(trace, details)).toThrow(
      "FALCON24_RESOLUTION_TRACE_ORACLE_QUERY_EVIDENCE_REQUIRED",
    );
  });

  it("rejects a legacy chart schema even when its evidence edges are present", async () => {
    const trace = await traceFixture();
    const details = await Promise.all(
      (await detailsFixture(trace)).map(async (candidate) =>
        candidate.node_id === nodeId(chartRef)
          ? rebuildDetail(candidate, {
              schema: {
                ...candidate.schema,
                state: "AVAILABLE" as const,
                schema_name: "artifact-workspace-chart-document",
                schema_version: "artifact-workspace-chart-document@2.0.0",
                fields: [],
              },
            })
          : candidate,
      ),
    );
    expect(() => verifyFalcon24ResolutionTraceGate(trace, details)).toThrow(
      "FALCON24_RESOLUTION_TRACE_CHART_CARDINALITY_INVALID",
    );
  });

  it("does not accept a Research QueryEvidence as the Product Team table authority", async () => {
    const trace = await traceFixture();
    const details = await Promise.all(
      (await detailsFixture(trace)).map(async (candidate) =>
        candidate.node_id === nodeId(evidenceRef)
          ? rebuildDetail(candidate, {
              schema: {
                state: "AVAILABLE",
                schema_name: "artifact-reference",
                schema_version: "artifact-reference@1.0.0",
                fields: [],
              },
            })
          : candidate,
      ),
    );
    expect(() => verifyFalcon24ResolutionTraceGate(trace, details)).toThrow(
      "FALCON24_RESOLUTION_TRACE_PRODUCT_QUERY_EVIDENCE_CARDINALITY_INVALID",
    );
  });

  it("rejects multiple Publisher authority nodes", async () => {
    const complete = await traceFixture();
    const { trace_hash: _traceHash, ...material } = complete;
    const extraPublisherId = `context:publisher:${id(32)}`;
    const extraNode = {
      node_id: extraPublisherId,
      kind: "CONTEXT" as const,
      source_event_id: null,
      sequence: null,
      occurred_at: occurredAt,
      status: "AVAILABLE" as const,
      title: "E1 Publisher",
      summary: "另一个发布者",
      duration_ms: null,
      artifact_refs: [],
    };
    const trace = await buildResolutionTrace({
      ...material,
      nodes: [...complete.nodes, extraNode],
    });
    const extraDetail = await publicNodeDetail(
      trace,
      extraPublisherId,
      "e1-analysis-publication",
      "e1-analysis-publication@1.0.0",
    );
    const details = [...(await detailsFixture(trace)), extraDetail];
    expect(() => verifyFalcon24ResolutionTraceGate(trace, details)).toThrow(
      "FALCON24_RESOLUTION_TRACE_PUBLISHER_CARDINALITY_INVALID",
    );
  });

  it("rejects a Publisher missing an exact READY completion edge", async () => {
    const complete = await traceFixture();
    const { trace_hash: _traceHash, ...material } = complete;
    const trace = await buildResolutionTrace({
      ...material,
      edges: complete.edges.filter(
        ({ from_node_id: fromNodeId, to_node_id: toNodeId }) =>
          fromNodeId !== publisherNodeId || toNodeId !== nodeId(completionRef),
      ),
    });
    const details = await detailsFixture(trace);
    expect(() => verifyFalcon24ResolutionTraceGate(trace, details)).toThrow(
      "FALCON24_RESOLUTION_TRACE_PUBLISHER_ARTIFACT_CLOSURE_REQUIRED",
    );
  });
});
