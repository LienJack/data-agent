import {
  type AnalysisCompletionReceiptPayload,
  type AnalysisProgramPayload,
  type ArtifactReference,
  type ArtifactWorkspaceChartDocumentV3,
  type ArtifactWorkspaceChartProjectionV3,
  type ArtifactWorkspaceTableProjection,
  analysisCompletionReceiptPayloadSchema,
  analysisProgramPayloadSchema,
  artifactReferenceIdentity,
  buildArtifactWorkspaceChartDocumentV3,
  type DerivedAnalysisEvidencePayload,
  type DeterministicAnalysisRunProjection,
  derivedAnalysisEvidencePayloadSchema,
  deterministicAnalysisRunProjectionSchema,
  type IdentificationCertificatePayload,
  identificationCertificatePayloadSchema,
  sha256ContentHash,
  verifyArtifactWorkspaceChartDocumentV3,
} from "@data-agent/contracts";

export interface DerivedAnalysisProjectionContext {
  readonly package_id: string;
  readonly package_hash: `sha256:${string}`;
  readonly receipt_id: string;
  readonly receipt_hash: `sha256:${string}`;
}

function column(
  key: string,
  label: string,
  data_type: "STRING" | "NUMBER" | "BOOLEAN" | "NULL" | "MIXED",
) {
  return { key, label, data_type } as const;
}

function chartProjection(
  evidence: DerivedAnalysisEvidencePayload,
  unit: string | null,
  forecastTable: ArtifactWorkspaceTableProjection | null,
): ArtifactWorkspaceChartProjectionV3 | null {
  const result = evidence.result;
  if (result.result_kind === "TREND_CHANGE") {
    const rows = result.points.flatMap((point) =>
      point.value === null
        ? []
        : [
            {
              period_start: point.period_start,
              value: point.value,
              absolute_delta: point.absolute_delta ?? 0,
            },
          ],
    );
    if (rows.length === 0 || rows.length > 512) return null;
    return {
      kind: "CHART",
      chart_type: "LINE",
      title: "趋势与变动幅度",
      description: "由已验收的 DerivedAnalysisEvidence 确定性投影",
      unit,
      x_key: "period_start",
      y_keys: ["value"],
      lower_bound_key: null,
      upper_bound_key: null,
      series_key: null,
      legend: { visible: false },
      evidence_level: "L2_OBSERVATION",
      table: {
        kind: "TABLE",
        columns: [
          column("period_start", "时间", "STRING"),
          column("value", "指标值", "NUMBER"),
          column("absolute_delta", "绝对变化", "NUMBER"),
        ],
        rows,
        total_rows: rows.length,
      },
    };
  }
  if (result.result_kind === "CONTRIBUTION_CONCENTRATION") {
    if (result.groups.length === 0 || result.groups.length > 64) return null;
    const rows = result.groups.map((group) => ({
      group_key_hash: group.group_key_hash,
      signed_delta: group.signed_delta,
      baseline: group.baseline,
      current: group.current,
    }));
    return {
      kind: "CHART",
      chart_type: "SIGNED_CONTRIBUTION",
      title: "分组贡献与集中度",
      description: "分组标签只公开不可逆 hash；正负贡献保留符号",
      unit,
      x_key: "group_key_hash",
      y_keys: ["signed_delta"],
      lower_bound_key: null,
      upper_bound_key: null,
      series_key: null,
      legend: { visible: false },
      evidence_level: "L2_OBSERVATION",
      table: {
        kind: "TABLE",
        columns: [
          column("group_key_hash", "分组 Hash", "STRING"),
          column("signed_delta", "贡献变化", "NUMBER"),
          column("baseline", "基线", "NUMBER"),
          column("current", "当前", "NUMBER"),
        ],
        rows,
        total_rows: rows.length,
      },
    };
  }
  if (result.result_kind === "ROBUST_ANOMALY") {
    if (result.anomalies.length === 0 || result.anomalies.length > 2_000) return null;
    const rows = result.anomalies.map((anomaly) => ({
      period_start: anomaly.period_start,
      observed: anomaly.observed,
      expected: anomaly.expected,
      robust_score: anomaly.robust_score,
      direction: anomaly.direction,
    }));
    return {
      kind: "CHART",
      chart_type: "SCATTER",
      title: "稳健异常点",
      description: "异常仅表示偏离稳健基线，不表示因果",
      unit,
      x_key: "period_start",
      y_keys: ["observed", "expected"],
      lower_bound_key: null,
      upper_bound_key: null,
      series_key: "direction",
      legend: { visible: true },
      evidence_level: "L2_OBSERVATION",
      table: {
        kind: "TABLE",
        columns: [
          column("period_start", "时间", "STRING"),
          column("observed", "观测值", "NUMBER"),
          column("expected", "稳健基线", "NUMBER"),
          column("robust_score", "稳健分数", "NUMBER"),
          column("direction", "方向", "STRING"),
        ],
        rows,
        total_rows: rows.length,
      },
    };
  }
  if (
    result.result_kind === "BASELINE_FORECAST_BACKTEST" &&
    result.useful &&
    result.forecast_rows_ref &&
    forecastTable
  ) {
    const keys = new Set(forecastTable.columns.map(({ key }) => key));
    if (!["period_start", "forecast", "lower", "upper"].every((key) => keys.has(key))) {
      return null;
    }
    return {
      kind: "CHART",
      chart_type: "FORECAST_INTERVAL",
      title: "基线预测与回测区间",
      description: "预测只在回测优于基线后显示，且不构成业务承诺",
      unit,
      x_key: "period_start",
      y_keys: ["forecast"],
      lower_bound_key: "lower",
      upper_bound_key: "upper",
      series_key: null,
      legend: { visible: true },
      evidence_level: "L2_OBSERVATION",
      table: forecastTable,
    };
  }
  return null;
}

export async function buildDerivedAnalysisChartDocument(input: {
  readonly document_ref: ArtifactReference;
  readonly evidence_ref: ArtifactReference;
  readonly evidence: DerivedAnalysisEvidencePayload;
  readonly semantic_context: DerivedAnalysisProjectionContext;
  readonly unit?: string | null;
  readonly forecast_table?: ArtifactWorkspaceTableProjection | null;
}): Promise<ArtifactWorkspaceChartDocumentV3 | null> {
  const evidence = derivedAnalysisEvidencePayloadSchema.parse(input.evidence);
  if (
    input.document_ref.artifact_type !== "ArtifactWorkspaceDocument" ||
    input.evidence_ref.artifact_type !== "DerivedAnalysisEvidence" ||
    input.evidence_ref.content_hash !== (await sha256ContentHash(evidence)) ||
    input.evidence_ref.app_id !== input.document_ref.app_id ||
    input.evidence_ref.tenant_id !== input.document_ref.tenant_id ||
    input.evidence_ref.environment !== input.document_ref.environment ||
    input.evidence_ref.run_id !== input.document_ref.run_id ||
    evidence.query_evidence_refs.some((reference) => reference.run_id !== input.document_ref.run_id)
  ) {
    throw new TypeError("DERIVED_ANALYSIS_PROJECTION_INPUT_INVALID");
  }
  const projection = chartProjection(evidence, input.unit ?? null, input.forecast_table ?? null);
  if (!projection) return null;
  return buildArtifactWorkspaceChartDocumentV3({
    schema_version: "artifact-workspace-chart-document@3.0.0",
    document_ref: input.document_ref,
    source_refs: {
      query_evidence_refs: evidence.query_evidence_refs,
      derived_evidence_ref: input.evidence_ref,
    },
    provenance: {
      transform_version: "derived-analysis-chart@1.0.0",
      dataset_hash: `sha256:${"0".repeat(64)}`,
      semantic_context: input.semantic_context,
      algorithm_version: evidence.algorithm_version,
      parameter_hash: evidence.parameter_hash,
      input_closure_hash: evidence.input_closure_hash,
      runtime_digest: evidence.runtime_digest,
      dependency_lock_digest: evidence.dependency_lock_digest,
    },
    projection,
  });
}

export function sameAnalysisEvidenceIdentity(
  chart: ArtifactWorkspaceChartDocumentV3,
  evidenceRef: ArtifactReference,
) {
  return (
    artifactReferenceIdentity(chart.source_refs.derived_evidence_ref) ===
    artifactReferenceIdentity(evidenceRef)
  );
}

function sameScopeAndRun(left: ArtifactReference, right: ArtifactReference) {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id
  );
}

async function requirePayloadReference(
  reference: ArtifactReference,
  payload: unknown,
  artifactType: ArtifactReference["artifact_type"],
) {
  if (
    reference.artifact_type !== artifactType ||
    reference.content_hash !== (await sha256ContentHash(payload))
  ) {
    throw new TypeError("ANALYSIS_RUN_PROJECTION_REFERENCE_INVALID");
  }
}

export interface DeterministicAnalysisProjectionEvidence {
  readonly ref: ArtifactReference;
  readonly payload: DerivedAnalysisEvidencePayload;
}

export interface DeterministicAnalysisRootCauseProjection {
  readonly level: "NONE" | "L4_DISCOVERY" | "L5_CERTIFIED" | "HOLD";
  readonly candidate_ref: ArtifactReference | null;
  readonly estimate_ref: ArtifactReference | null;
  readonly certificate_ref: ArtifactReference | null;
  readonly certificate?: IdentificationCertificatePayload | null;
  readonly disclosures: readonly string[];
}

/**
 * Produces the only public analysis projection. Inputs are committed payloads,
 * never event fragments, so refresh and replay have identical output.
 */
export async function buildDeterministicAnalysisRunProjection(input: {
  readonly analysis_program_ref: ArtifactReference;
  readonly analysis_program: AnalysisProgramPayload;
  readonly completion_ref: ArtifactReference;
  readonly completion: AnalysisCompletionReceiptPayload;
  readonly evidence: readonly DeterministicAnalysisProjectionEvidence[];
  readonly findings: DeterministicAnalysisRunProjection["findings"];
  readonly charts?: readonly ArtifactWorkspaceChartDocumentV3[];
  readonly root_cause?: DeterministicAnalysisRootCauseProjection;
}): Promise<DeterministicAnalysisRunProjection> {
  const analysisProgram = analysisProgramPayloadSchema.parse(input.analysis_program);
  const completion = analysisCompletionReceiptPayloadSchema.parse(input.completion);
  await Promise.all([
    requirePayloadReference(input.analysis_program_ref, analysisProgram, "AnalysisProgram"),
    requirePayloadReference(input.completion_ref, completion, "AnalysisCompletionReceipt"),
  ]);
  if (
    artifactReferenceIdentity(completion.analysis_program_ref) !==
      artifactReferenceIdentity(input.analysis_program_ref) ||
    !sameScopeAndRun(input.completion_ref, input.analysis_program_ref)
  ) {
    throw new TypeError("ANALYSIS_RUN_PROJECTION_CLOSURE_INVALID");
  }

  const programNodes = new Map(analysisProgram.nodes.map((node) => [node.node_id, node]));
  const evidenceByIdentity = new Map<string, DerivedAnalysisEvidencePayload>();
  for (const item of input.evidence) {
    const evidence = derivedAnalysisEvidencePayloadSchema.parse(item.payload);
    await requirePayloadReference(item.ref, evidence, "DerivedAnalysisEvidence");
    const node = programNodes.get(evidence.node_id);
    if (
      !node ||
      node.skill_id !== evidence.skill_id ||
      artifactReferenceIdentity(evidence.analysis_program_ref) !==
        artifactReferenceIdentity(input.analysis_program_ref) ||
      !sameScopeAndRun(input.completion_ref, item.ref)
    ) {
      throw new TypeError("ANALYSIS_RUN_PROJECTION_EVIDENCE_INVALID");
    }
    evidenceByIdentity.set(artifactReferenceIdentity(item.ref), evidence);
  }

  const nodes = completion.node_results.map((result) => {
    const node = programNodes.get(result.node_id);
    if (!node || node.criticality !== result.criticality) {
      throw new TypeError("ANALYSIS_RUN_PROJECTION_NODE_INVALID");
    }
    if (
      result.evidence_ref &&
      !evidenceByIdentity.has(artifactReferenceIdentity(result.evidence_ref))
    ) {
      throw new TypeError("ANALYSIS_RUN_PROJECTION_EVIDENCE_NOT_COMMITTED");
    }
    return {
      ...result,
      skill_id: node.skill_id,
    };
  });
  if (
    nodes.length !== analysisProgram.nodes.length ||
    nodes.some(({ node_id }) => !programNodes.has(node_id))
  ) {
    throw new TypeError("ANALYSIS_RUN_PROJECTION_NODE_CLOSURE_INVALID");
  }

  const successful = new Set(
    nodes.flatMap(({ status, evidence_ref }) =>
      status === "SUCCEEDED" && evidence_ref ? [artifactReferenceIdentity(evidence_ref)] : [],
    ),
  );
  const methods = [...evidenceByIdentity.entries()]
    .filter(([identity]) => successful.has(identity))
    .map(([identity, evidence]) => ({
      evidence_ref: input.evidence.find(({ ref }) => artifactReferenceIdentity(ref) === identity)
        ?.ref as ArtifactReference,
      skill_id: evidence.skill_id,
      algorithm_version: evidence.algorithm_version,
      parameter_hash: evidence.parameter_hash,
      input_closure_hash: evidence.input_closure_hash,
      program_ref: evidence.sandbox_program_ref,
      receipt_ref: evidence.sandbox_execution_receipt_ref,
      runtime_digest: evidence.runtime_digest,
      dependency_lock_digest: evidence.dependency_lock_digest,
      sample_size: evidence.quality.sample_size,
      limitation_codes: evidence.limitation_codes,
    }))
    .sort((left, right) => left.skill_id.localeCompare(right.skill_id));

  const verifiedCharts = await Promise.all(
    (input.charts ?? []).map((chart) => verifyArtifactWorkspaceChartDocumentV3(chart)),
  );
  const charts = verifiedCharts
    .filter(({ source_refs }) =>
      successful.has(artifactReferenceIdentity(source_refs.derived_evidence_ref)),
    )
    .sort((left, right) =>
      artifactReferenceIdentity(left.document_ref).localeCompare(
        artifactReferenceIdentity(right.document_ref),
      ),
    );
  for (const chart of charts) {
    if (!sameScopeAndRun(input.completion_ref, chart.document_ref)) {
      throw new TypeError("ANALYSIS_RUN_PROJECTION_CHART_SCOPE_INVALID");
    }
  }

  let root = input.root_cause ?? {
    level: "NONE" as const,
    candidate_ref: null,
    estimate_ref: null,
    certificate_ref: null,
    disclosures: [],
  };
  if (root.level === "L5_CERTIFIED") {
    const certificate = root.certificate
      ? identificationCertificatePayloadSchema.parse(root.certificate)
      : null;
    const valid =
      certificate !== null &&
      certificate.verdict === "CERTIFIED" &&
      root.candidate_ref !== null &&
      root.estimate_ref !== null &&
      root.certificate_ref !== null &&
      sameScopeAndRun(input.completion_ref, root.candidate_ref) &&
      sameScopeAndRun(input.completion_ref, root.estimate_ref) &&
      sameScopeAndRun(input.completion_ref, root.certificate_ref) &&
      artifactReferenceIdentity(certificate.causal_estimate_ref) ===
        artifactReferenceIdentity(root.estimate_ref) &&
      root.certificate_ref.content_hash === (await sha256ContentHash(certificate));
    if (!valid) {
      root = {
        level: "HOLD",
        candidate_ref: root.candidate_ref,
        estimate_ref: root.estimate_ref,
        certificate_ref: null,
        disclosures: [...root.disclosures, "IDENTIFICATION_CERTIFICATE_INVALID_OR_STALE"],
      };
    }
  }

  const publicRoot = {
    level: root.level,
    candidate_ref: root.candidate_ref,
    estimate_ref: root.estimate_ref,
    certificate_ref: root.level === "L5_CERTIFIED" ? root.certificate_ref : null,
    disclosures: [...new Set(root.disclosures)].sort(),
  };
  return deterministicAnalysisRunProjectionSchema.parse({
    schema_version: "deterministic-analysis-run-projection@1.0.0",
    terminal: completion.terminal,
    completion_ref: input.completion_ref,
    nodes: [...nodes].sort((left, right) => left.node_id.localeCompare(right.node_id)),
    findings: [...input.findings].sort((left, right) =>
      left.finding_id.localeCompare(right.finding_id),
    ),
    charts: charts.map(({ document_ref }) => document_ref),
    methods,
    root_cause: publicRoot,
    limitations: [...new Set(completion.limitation_codes)].sort(),
  });
}
