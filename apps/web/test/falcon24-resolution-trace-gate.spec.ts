import {
  buildResolutionTrace,
  type ResolutionTrace,
  type ResolutionTraceDetail,
  verifyResolutionTraceDetail,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { verifyFalcon24ResolutionTraceGate } from "@/cli/falcon24-resolution-trace-gate";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const occurredAt = "2026-08-25T10:00:00.000Z";

function reference(
  artifactType: "SqlArtifact" | "QueryEvidence" | "ArtifactWorkspaceDocument" | "AnalysisReport",
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
const chartRef = reference("ArtifactWorkspaceDocument", 12);
const reportRef = reference("AnalysisReport", 13);

const nodeId = (ref: typeof sqlRef | typeof evidenceRef | typeof chartRef | typeof reportRef) =>
  `artifact:${ref.artifact_id}:${ref.revision}`;

async function traceFixture(sqlKind: "SQL" | "ARTIFACT" = "SQL") {
  return buildResolutionTrace({
    schema_version: "resolution-trace@1.0.0",
    scope,
    run_id: runId,
    conversation_id: id(4),
    config_ref: null,
    nodes: [
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
    ],
    edges: [
      {
        from_node_id: nodeId(sqlRef),
        to_node_id: nodeId(evidenceRef),
        kind: "EVIDENCE",
      },
      {
        from_node_id: nodeId(evidenceRef),
        to_node_id: nodeId(chartRef),
        kind: "EVIDENCE",
      },
      {
        from_node_id: nodeId(chartRef),
        to_node_id: nodeId(reportRef),
        kind: "EVIDENCE",
      },
    ],
  });
}

function detail(
  trace: ResolutionTrace,
  ref: typeof sqlRef | typeof evidenceRef | typeof chartRef | typeof reportRef,
  schemaName: string,
  schemaVersion: string,
): ResolutionTraceDetail {
  const node = trace.nodes.find(({ node_id: current }) => current === nodeId(ref));
  if (!node) throw new Error("missing fixture node");
  const section = { state: "AVAILABLE", format: "TEXT", text: "公开内容", fields: [] } as const;
  return verifyResolutionTraceDetail({
    schema_version: "resolution-trace-detail@2.0.0",
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
    identity: [],
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

function detailsFixture(trace: ResolutionTrace): ResolutionTraceDetail[] {
  return [
    detail(trace, sqlRef, "product-team-artifact", "product-team-artifact@2.0.0"),
    detail(trace, evidenceRef, "product-team-artifact", "product-team-artifact@2.0.0"),
    detail(
      trace,
      chartRef,
      "artifact-workspace-chart-document",
      "artifact-workspace-chart-document@3.0.0",
    ),
    detail(trace, reportRef, "product-team-artifact", "product-team-artifact@2.0.0"),
  ];
}

describe("Falcon24 Resolution Trace acceptance gate", () => {
  it("accepts the real SQL-kind and complete SQL to evidence to chart to report chain", async () => {
    const trace = await traceFixture();
    expect(verifyFalcon24ResolutionTraceGate(trace, detailsFixture(trace))).toEqual({
      node_count: 4,
      edge_count: 3,
      detail_count: 4,
      sql_node_count: 1,
      query_evidence_node_count: 1,
      chart_node_count: 1,
      report_node_count: 1,
    });
  });

  it("rejects the former ARTIFACT-kind SqlArtifact lookup", async () => {
    const trace = await traceFixture("ARTIFACT");
    expect(() => verifyFalcon24ResolutionTraceGate(trace, detailsFixture(trace))).toThrow(
      "FALCON24_RESOLUTION_TRACE_SQL_REQUIRED",
    );
  });

  it("rejects a missing detail instead of treating the graph as readable", async () => {
    const trace = await traceFixture();
    expect(() =>
      verifyFalcon24ResolutionTraceGate(trace, detailsFixture(trace).slice(0, -1)),
    ).toThrow("FALCON24_RESOLUTION_TRACE_DETAIL_INVALID");
  });

  it("rejects a chart without a QueryEvidence evidence edge", async () => {
    const complete = await traceFixture();
    const { trace_hash: _traceHash, ...material } = complete;
    const trace = await buildResolutionTrace({
      ...material,
      edges: complete.edges.filter(
        ({ from_node_id: fromNodeId, to_node_id: toNodeId }) =>
          fromNodeId !== nodeId(evidenceRef) || toNodeId !== nodeId(chartRef),
      ),
    });
    expect(() => verifyFalcon24ResolutionTraceGate(trace, detailsFixture(trace))).toThrow(
      "FALCON24_RESOLUTION_TRACE_CHART_LINEAGE_REQUIRED",
    );
  });

  it("does not accept a Research QueryEvidence as the Product Team table authority", async () => {
    const trace = await traceFixture();
    const details = detailsFixture(trace).map((candidate) =>
      candidate.node_id === nodeId(evidenceRef)
        ? verifyResolutionTraceDetail({
            ...candidate,
            schema: {
              state: "AVAILABLE",
              schema_name: "artifact-reference",
              schema_version: "artifact-reference@1.0.0",
              fields: [],
            },
          })
        : candidate,
    );
    expect(() => verifyFalcon24ResolutionTraceGate(trace, details)).toThrow(
      "FALCON24_RESOLUTION_TRACE_PRODUCT_QUERY_EVIDENCE_REQUIRED",
    );
  });
});
