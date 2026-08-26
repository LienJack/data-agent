import { artifactReferenceIdentity } from "@data-agent/contracts/artifacts";
import type { ResolutionTrace, ResolutionTraceDetail } from "@data-agent/contracts/runs";

export interface Falcon24ResolutionTraceGateResult {
  readonly node_count: number;
  readonly edge_count: number;
  readonly detail_count: number;
  readonly sql_node_count: number;
  readonly query_evidence_node_count: number;
  readonly analysis_evidence_node_count: number;
  readonly chart_node_count: number;
  readonly report_node_count: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function exactArtifactIdentity(
  node: ResolutionTrace["nodes"][number],
  detail: ResolutionTraceDetail,
  artifactType: string,
): string {
  if (node.artifact_refs.length !== 1 || detail.artifact_refs.length !== 1) {
    fail("FALCON24_RESOLUTION_TRACE_ARTIFACT_REFERENCE_INVALID");
  }
  const nodeReference = node.artifact_refs[0];
  const detailReference = detail.artifact_refs[0];
  if (
    !nodeReference ||
    !detailReference ||
    nodeReference.artifact_type !== artifactType ||
    detailReference.artifact_type !== artifactType ||
    artifactReferenceIdentity(nodeReference) !== artifactReferenceIdentity(detailReference)
  ) {
    fail("FALCON24_RESOLUTION_TRACE_ARTIFACT_REFERENCE_INVALID");
  }
  return artifactReferenceIdentity(nodeReference);
}

function requireAvailableArtifactDetail(detail: ResolutionTraceDetail): void {
  if (
    detail.run_context.state !== "AVAILABLE" ||
    detail.payload.state !== "AVAILABLE" ||
    detail.result.state !== "AVAILABLE" ||
    detail.schema.state !== "AVAILABLE"
  ) {
    fail("FALCON24_RESOLUTION_TRACE_ARTIFACT_DETAIL_UNAVAILABLE");
  }
}

function requireExactlyOne<T>(values: readonly T[], code: string): T {
  if (values.length !== 1 || values[0] === undefined) fail(code);
  return values[0];
}

function requireExactEvidenceEdge(
  trace: ResolutionTrace,
  fromNodeId: string,
  toNodeId: string,
  code: string,
): void {
  if (
    trace.edges.filter(
      (edge) =>
        edge.kind === "EVIDENCE" &&
        edge.from_node_id === fromNodeId &&
        edge.to_node_id === toNodeId,
    ).length !== 1
  ) {
    fail(code);
  }
}

export function verifyFalcon24ResolutionTraceGate(
  trace: ResolutionTrace,
  details: readonly ResolutionTraceDetail[],
): Falcon24ResolutionTraceGateResult {
  if (trace.nodes.length === 0) fail("FALCON24_RESOLUTION_TRACE_EMPTY");
  if (
    trace.nodes.some(({ status }) =>
      ["FAILED", "CANCELLED", "INTERRUPTED", "BLOCKED"].includes(status),
    )
  ) {
    fail("FALCON24_RESOLUTION_TRACE_NON_SUCCESS_NODE");
  }
  const terminalNodes = trace.nodes.filter(({ kind }) => kind === "TERMINAL");
  if (terminalNodes.length !== 1 || terminalNodes[0]?.status !== "COMPLETED") {
    fail("FALCON24_RESOLUTION_TRACE_COMPLETED_TERMINAL_REQUIRED");
  }

  const detailsByNode = new Map(details.map((detail) => [detail.node_id, detail]));
  if (detailsByNode.size !== details.length || detailsByNode.size !== trace.nodes.length) {
    fail("FALCON24_RESOLUTION_TRACE_DETAIL_INVALID");
  }
  for (const node of trace.nodes) {
    const detail = detailsByNode.get(node.node_id);
    const nodeArtifactIdentities = node.artifact_refs.map(artifactReferenceIdentity);
    const detailArtifactIdentities = detail?.artifact_refs.map(artifactReferenceIdentity) ?? [];
    if (
      !detail ||
      detail.run_id !== trace.run_id ||
      detail.scope.app_id !== trace.scope.app_id ||
      detail.scope.tenant_id !== trace.scope.tenant_id ||
      detail.scope.environment !== trace.scope.environment ||
      detail.kind !== node.kind ||
      detail.sequence !== node.sequence ||
      detail.title !== node.title ||
      detail.status !== node.status ||
      detail.summary !== node.summary ||
      nodeArtifactIdentities.length !== detailArtifactIdentities.length ||
      nodeArtifactIdentities.some((identity, index) => identity !== detailArtifactIdentities[index])
    ) {
      fail("FALCON24_RESOLUTION_TRACE_DETAIL_INVALID");
    }
  }

  const sqlNodes = trace.nodes.filter(({ kind, title, node_id: nodeId }) => {
    const detail = detailsByNode.get(nodeId);
    return (
      kind === "SQL" &&
      title === "SqlArtifact" &&
      detail?.schema.state === "AVAILABLE" &&
      detail.schema.schema_name === "product-team-artifact" &&
      detail.schema.schema_version === "product-team-artifact@2.0.0"
    );
  });
  const productQueryEvidenceNodes = trace.nodes.filter(({ kind, title, node_id: nodeId }) => {
    const detail = detailsByNode.get(nodeId);
    return (
      kind === "ARTIFACT" &&
      title === "QueryEvidence" &&
      detail?.schema.state === "AVAILABLE" &&
      detail.schema.schema_name === "product-team-artifact" &&
      detail.schema.schema_version === "product-team-artifact@2.0.0"
    );
  });
  const derivedAnalysisEvidenceNodes = trace.nodes.filter(({ kind, title, node_id: nodeId }) => {
    const detail = detailsByNode.get(nodeId);
    return (
      kind === "ARTIFACT" &&
      title === "DerivedAnalysisEvidence" &&
      detail?.schema.state === "AVAILABLE" &&
      detail.schema.schema_name === "artifact-reference" &&
      detail.schema.schema_version === "artifact-reference@1.0.0"
    );
  });
  const chartNodes = trace.nodes.filter(({ kind, title, node_id: nodeId }) => {
    const detail = detailsByNode.get(nodeId);
    return (
      kind === "ARTIFACT" &&
      title === "ArtifactWorkspaceDocument" &&
      detail?.schema.state === "AVAILABLE" &&
      detail.schema.schema_name === "artifact-workspace-chart-document" &&
      detail.schema.schema_version === "artifact-workspace-chart-document@3.0.0"
    );
  });
  const productReportNodes = trace.nodes.filter(({ kind, title, node_id: nodeId }) => {
    const detail = detailsByNode.get(nodeId);
    return (
      kind === "ARTIFACT" &&
      title === "AnalysisReport" &&
      detail?.schema.state === "AVAILABLE" &&
      detail.schema.schema_name === "product-team-artifact" &&
      detail.schema.schema_version === "product-team-artifact@2.0.0"
    );
  });

  const sqlNode = requireExactlyOne(sqlNodes, "FALCON24_RESOLUTION_TRACE_SQL_CARDINALITY_INVALID");
  const queryEvidenceNode = requireExactlyOne(
    productQueryEvidenceNodes,
    "FALCON24_RESOLUTION_TRACE_PRODUCT_QUERY_EVIDENCE_CARDINALITY_INVALID",
  );
  const analysisEvidenceNode = requireExactlyOne(
    derivedAnalysisEvidenceNodes,
    "FALCON24_RESOLUTION_TRACE_DERIVED_ANALYSIS_EVIDENCE_CARDINALITY_INVALID",
  );
  const chartNode = requireExactlyOne(
    chartNodes,
    "FALCON24_RESOLUTION_TRACE_CHART_CARDINALITY_INVALID",
  );
  const reportNode = requireExactlyOne(
    productReportNodes,
    "FALCON24_RESOLUTION_TRACE_REPORT_CARDINALITY_INVALID",
  );

  for (const [nodes, artifactType] of [
    [sqlNodes, "SqlArtifact"],
    [productQueryEvidenceNodes, "QueryEvidence"],
    [derivedAnalysisEvidenceNodes, "DerivedAnalysisEvidence"],
    [chartNodes, "ArtifactWorkspaceDocument"],
    [productReportNodes, "AnalysisReport"],
  ] as const) {
    const identities = new Set<string>();
    for (const node of nodes) {
      const detail = detailsByNode.get(node.node_id);
      if (!detail) fail("FALCON24_RESOLUTION_TRACE_DETAIL_INVALID");
      requireAvailableArtifactDetail(detail);
      const identity = exactArtifactIdentity(node, detail, artifactType);
      if (identities.has(identity)) {
        fail("FALCON24_RESOLUTION_TRACE_ARTIFACT_REFERENCE_INVALID");
      }
      identities.add(identity);
    }
  }

  const exactChain = [
    [sqlNode.node_id, queryEvidenceNode.node_id, "FALCON24_RESOLUTION_TRACE_SQL_LINEAGE_REQUIRED"],
    [
      queryEvidenceNode.node_id,
      analysisEvidenceNode.node_id,
      "FALCON24_RESOLUTION_TRACE_ANALYSIS_EVIDENCE_LINEAGE_REQUIRED",
    ],
    [
      analysisEvidenceNode.node_id,
      chartNode.node_id,
      "FALCON24_RESOLUTION_TRACE_CHART_ANALYSIS_LINEAGE_REQUIRED",
    ],
    [
      analysisEvidenceNode.node_id,
      reportNode.node_id,
      "FALCON24_RESOLUTION_TRACE_REPORT_ANALYSIS_LINEAGE_REQUIRED",
    ],
    [
      chartNode.node_id,
      reportNode.node_id,
      "FALCON24_RESOLUTION_TRACE_REPORT_CHART_LINEAGE_REQUIRED",
    ],
  ] as const;
  for (const [fromNodeId, toNodeId, code] of exactChain) {
    requireExactEvidenceEdge(trace, fromNodeId, toNodeId, code);
  }
  const requiredNodeIds = new Set([
    sqlNode.node_id,
    queryEvidenceNode.node_id,
    analysisEvidenceNode.node_id,
    chartNode.node_id,
    reportNode.node_id,
  ]);
  const allowedEvidenceEdges = new Set(
    exactChain.map(([fromNodeId, toNodeId]) => `${fromNodeId}\0${toNodeId}`),
  );
  if (
    trace.edges.some(
      (edge) =>
        edge.kind === "EVIDENCE" &&
        requiredNodeIds.has(edge.from_node_id) &&
        requiredNodeIds.has(edge.to_node_id) &&
        !allowedEvidenceEdges.has(`${edge.from_node_id}\0${edge.to_node_id}`),
    )
  ) {
    fail("FALCON24_RESOLUTION_TRACE_EVIDENCE_CLOSURE_INVALID");
  }

  return {
    node_count: trace.nodes.length,
    edge_count: trace.edges.length,
    detail_count: details.length,
    sql_node_count: sqlNodes.length,
    query_evidence_node_count: productQueryEvidenceNodes.length,
    analysis_evidence_node_count: derivedAnalysisEvidenceNodes.length,
    chart_node_count: chartNodes.length,
    report_node_count: productReportNodes.length,
  };
}
