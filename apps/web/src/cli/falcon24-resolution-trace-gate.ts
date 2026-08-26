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
  readonly detail_closure: readonly Readonly<{
    node_id: string;
    detail_hash: string;
  }>[];
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

function identityValue(detail: ResolutionTraceDetail, label: string): string | null {
  return detail.identity.find((item) => item.label === label)?.value ?? null;
}

function artifactNodesOfType(
  trace: ResolutionTrace,
  detailsByNode: ReadonlyMap<string, ResolutionTraceDetail>,
  artifactType: string,
  schemaName: string,
  schemaVersion: string,
) {
  return trace.nodes.filter(({ kind, title, node_id: nodeId }) => {
    const detail = detailsByNode.get(nodeId);
    return (
      (artifactType === "SqlArtifact" ? kind === "SQL" : kind === "ARTIFACT") &&
      title === artifactType &&
      detail?.schema.state === "AVAILABLE" &&
      detail.schema.schema_name === schemaName &&
      detail.schema.schema_version === schemaVersion
    );
  });
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
      detail.trace_hash !== trace.trace_hash ||
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

  const completedAgentTasks = new Map<string, string>();
  for (const node of trace.nodes.filter(
    ({ kind, status }) => kind === "AGENT" && status === "COMPLETED",
  )) {
    const detail = detailsByNode.get(node.node_id);
    const profile = detail ? identityValue(detail, "Agent Profile") : null;
    const taskId = detail ? identityValue(detail, "Task ID") : null;
    if (profile && taskId) completedAgentTasks.set(`${profile}\0${taskId}`, profile);
  }
  const rootTasks = [...completedAgentTasks.values()].filter(
    (profile) => profile === "data-agent-orchestrator",
  );
  const subagentTasks = [...completedAgentTasks.values()].filter(
    (profile) => profile !== "data-agent-orchestrator",
  );
  if (rootTasks.length !== 1 || subagentTasks.length < 1) {
    fail("FALCON24_RESOLUTION_TRACE_ROOT_DELEGATION_REQUIRED");
  }

  const sqlNodes = artifactNodesOfType(
    trace,
    detailsByNode,
    "SqlArtifact",
    "product-team-artifact",
    "product-team-artifact@2.0.0",
  );
  const productQueryEvidenceNodes = artifactNodesOfType(
    trace,
    detailsByNode,
    "QueryEvidence",
    "product-team-artifact",
    "product-team-artifact@2.0.0",
  );
  const analysisProgramNodes = artifactNodesOfType(
    trace,
    detailsByNode,
    "AnalysisProgram",
    "artifact-reference",
    "artifact-reference@1.0.0",
  );
  const derivedAnalysisEvidenceNodes = artifactNodesOfType(
    trace,
    detailsByNode,
    "DerivedAnalysisEvidence",
    "artifact-reference",
    "artifact-reference@1.0.0",
  );
  const completionNodes = artifactNodesOfType(
    trace,
    detailsByNode,
    "AnalysisCompletionReceipt",
    "artifact-reference",
    "artifact-reference@1.0.0",
  );
  const chartNodes = artifactNodesOfType(
    trace,
    detailsByNode,
    "ArtifactWorkspaceDocument",
    "artifact-workspace-chart-document",
    "artifact-workspace-chart-document@3.0.0",
  );
  const productReportNodes = artifactNodesOfType(
    trace,
    detailsByNode,
    "AnalysisReport",
    "product-team-artifact",
    "product-team-artifact@2.0.0",
  );
  const oracleNodes = trace.nodes.filter(({ kind, title, node_id: nodeId }) => {
    const detail = detailsByNode.get(nodeId);
    return (
      kind === "CONTEXT" &&
      title.startsWith("Oracle · ") &&
      detail?.schema.state === "AVAILABLE" &&
      detail.schema.schema_name === "analysis-oracle-receipt" &&
      detail.schema.schema_version === "analysis-oracle-receipt@1.0.0" &&
      identityValue(detail, "Analysis node") !== null
    );
  });
  const publisherNodes = trace.nodes.filter(({ kind, title, node_id: nodeId }) => {
    const detail = detailsByNode.get(nodeId);
    return (
      kind === "CONTEXT" &&
      title === "E1 Publisher" &&
      detail?.schema.state === "AVAILABLE" &&
      detail.schema.schema_name === "e1-analysis-publication" &&
      detail.schema.schema_version === "e1-analysis-publication@1.0.0"
    );
  });

  const sqlNode = requireExactlyOne(sqlNodes, "FALCON24_RESOLUTION_TRACE_SQL_CARDINALITY_INVALID");
  const queryEvidenceNode = requireExactlyOne(
    productQueryEvidenceNodes,
    "FALCON24_RESOLUTION_TRACE_PRODUCT_QUERY_EVIDENCE_CARDINALITY_INVALID",
  );
  const analysisProgramNode = requireExactlyOne(
    analysisProgramNodes,
    "FALCON24_RESOLUTION_TRACE_ANALYSIS_PROGRAM_CARDINALITY_INVALID",
  );
  if (
    derivedAnalysisEvidenceNodes.length < 1 ||
    oracleNodes.length !== derivedAnalysisEvidenceNodes.length
  ) {
    fail("FALCON24_RESOLUTION_TRACE_DERIVED_ANALYSIS_EVIDENCE_CARDINALITY_INVALID");
  }
  const completionNode = requireExactlyOne(
    completionNodes,
    "FALCON24_RESOLUTION_TRACE_ANALYSIS_COMPLETION_CARDINALITY_INVALID",
  );
  if (chartNodes.length < 1) fail("FALCON24_RESOLUTION_TRACE_CHART_CARDINALITY_INVALID");
  const reportNode = requireExactlyOne(
    productReportNodes,
    "FALCON24_RESOLUTION_TRACE_REPORT_CARDINALITY_INVALID",
  );
  const publisherNode = requireExactlyOne(
    publisherNodes,
    "FALCON24_RESOLUTION_TRACE_PUBLISHER_CARDINALITY_INVALID",
  );

  for (const [nodes, artifactType] of [
    [sqlNodes, "SqlArtifact"],
    [productQueryEvidenceNodes, "QueryEvidence"],
    [analysisProgramNodes, "AnalysisProgram"],
    [derivedAnalysisEvidenceNodes, "DerivedAnalysisEvidence"],
    [completionNodes, "AnalysisCompletionReceipt"],
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

  requireExactEvidenceEdge(
    trace,
    sqlNode.node_id,
    queryEvidenceNode.node_id,
    "FALCON24_RESOLUTION_TRACE_SQL_LINEAGE_REQUIRED",
  );
  requireExactEvidenceEdge(
    trace,
    analysisProgramNode.node_id,
    completionNode.node_id,
    "FALCON24_RESOLUTION_TRACE_ANALYSIS_COMPLETION_LINEAGE_REQUIRED",
  );
  for (const oracleNode of oracleNodes) {
    const detail = detailsByNode.get(oracleNode.node_id);
    const analysisNodeId = detail ? identityValue(detail, "Analysis node") : null;
    const matchingEvidence = derivedAnalysisEvidenceNodes.filter((node) => {
      const evidenceDetail = detailsByNode.get(node.node_id);
      return evidenceDetail && identityValue(evidenceDetail, "Analysis node") === analysisNodeId;
    });
    const analysisEvidenceNode = requireExactlyOne(
      matchingEvidence,
      "FALCON24_RESOLUTION_TRACE_ORACLE_EVIDENCE_CARDINALITY_INVALID",
    );
    for (const [fromNodeId, code] of [
      [queryEvidenceNode.node_id, "FALCON24_RESOLUTION_TRACE_ORACLE_QUERY_EVIDENCE_REQUIRED"],
      [analysisProgramNode.node_id, "FALCON24_RESOLUTION_TRACE_ORACLE_PROGRAM_REQUIRED"],
      [analysisEvidenceNode.node_id, "FALCON24_RESOLUTION_TRACE_ORACLE_ANALYSIS_EVIDENCE_REQUIRED"],
    ] as const) {
      requireExactEvidenceEdge(trace, fromNodeId, oracleNode.node_id, code);
    }
    requireExactEvidenceEdge(
      trace,
      oracleNode.node_id,
      publisherNode.node_id,
      "FALCON24_RESOLUTION_TRACE_ORACLE_PUBLISHER_REQUIRED",
    );
    requireExactEvidenceEdge(
      trace,
      publisherNode.node_id,
      analysisEvidenceNode.node_id,
      "FALCON24_RESOLUTION_TRACE_PUBLISHER_ANALYSIS_EVIDENCE_REQUIRED",
    );
  }
  for (const target of [completionNode, ...chartNodes, reportNode]) {
    requireExactEvidenceEdge(
      trace,
      publisherNode.node_id,
      target.node_id,
      "FALCON24_RESOLUTION_TRACE_PUBLISHER_ARTIFACT_CLOSURE_REQUIRED",
    );
  }
  for (const chartNode of chartNodes) {
    if (
      !derivedAnalysisEvidenceNodes.some((evidenceNode) =>
        trace.edges.some(
          (edge) =>
            edge.kind === "EVIDENCE" &&
            edge.from_node_id === evidenceNode.node_id &&
            edge.to_node_id === chartNode.node_id,
        ),
      )
    ) {
      fail("FALCON24_RESOLUTION_TRACE_CHART_ANALYSIS_LINEAGE_REQUIRED");
    }
    requireExactEvidenceEdge(
      trace,
      chartNode.node_id,
      reportNode.node_id,
      "FALCON24_RESOLUTION_TRACE_REPORT_CHART_LINEAGE_REQUIRED",
    );
  }
  if (
    !derivedAnalysisEvidenceNodes.some((evidenceNode) =>
      trace.edges.some(
        (edge) =>
          edge.kind === "EVIDENCE" &&
          edge.from_node_id === evidenceNode.node_id &&
          edge.to_node_id === reportNode.node_id,
      ),
    )
  ) {
    fail("FALCON24_RESOLUTION_TRACE_REPORT_ANALYSIS_LINEAGE_REQUIRED");
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
    detail_closure: details
      .map(({ node_id: nodeId, detail_hash: detailHash }) => ({
        node_id: nodeId,
        detail_hash: detailHash,
      }))
      .sort((left, right) => left.node_id.localeCompare(right.node_id)),
  };
}
