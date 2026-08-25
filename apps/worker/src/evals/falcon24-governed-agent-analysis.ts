import {
  type ArtifactReference,
  type ArtifactWorkspaceChartDocumentV3,
  artifactReferenceFor,
  artifactReferenceIdentity,
  buildArtifactWorkspaceChartDocumentV3,
  type ProductTeamArtifactDocument,
  type ResearchBriefV3Payload,
  researchBriefV3PayloadSchema,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { AnalysisContext } from "@data-agent/contracts/context";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
import type { PortResult } from "@data-agent/contracts/ports";
import {
  buildFalcon24AnalysisChartProjection,
  FALCON24_ANALYSIS_CHART_VERSION,
  falcon24AnalysisOutputSchema,
} from "@data-agent/evals";
import { z } from "zod";
import { deterministicAnalysisUuid } from "../analysis/deterministic-id.js";
import type { AnalysisArtifactCommitPort, AnalysisExecutionResult } from "../analysis/executor.js";
import type { GovernedAgentAnalysisPort } from "../analysis/governed-agent-analysis-port.js";
import type { Falcon24AnalysisAcceptanceRecorder } from "./falcon24-analysis-acceptance-recorder.js";
import { compileFalcon24AnalysisContext } from "./falcon24-analysis-context.js";
import {
  createFalcon24AnalysisProgram,
  falcon24AnalysisProgramInternals,
} from "./falcon24-analysis-program.js";

interface Falcon24ProgramExecutor {
  execute(input: {
    readonly lease: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["lease"];
    readonly principal_id: string;
    readonly brief: ResearchBriefV3Payload;
    readonly brief_ref: ArtifactReference;
    readonly context: AnalysisContext;
    readonly program: Awaited<ReturnType<typeof createFalcon24AnalysisProgram>>;
  }): Promise<AnalysisExecutionResult>;
}

type Falcon24GovernedAnalysisCommand = Parameters<GovernedAgentAnalysisPort["analyze"]>[0] & {
  readonly test_case: Falcon24AgentAnalysisCase;
};

export interface Falcon24GovernedAnalysisPort {
  analyze(input: Falcon24GovernedAnalysisCommand): ReturnType<GovernedAgentAnalysisPort["analyze"]>;
}

export interface Falcon24PublicArtifactPort {
  commit(
    capability: unknown,
    lease: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["lease"],
    document: ProductTeamArtifactDocument,
  ): Promise<PortResult<ArtifactReference>>;
  commitDerivedAnalysisChart(
    capability: unknown,
    lease: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["lease"],
    document: ArtifactWorkspaceChartDocumentV3,
  ): Promise<PortResult<ArtifactReference>>;
  resolveCommitted(
    capability: unknown,
    reference: ArtifactReference,
  ): Promise<PortResult<ProductTeamArtifactDocument | null>>;
}

function portValue<T>(result: PortResult<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function exactlyOne<T>(values: readonly T[], code: string): T {
  if (values.length !== 1 || values[0] === undefined) throw new TypeError(code);
  return values[0];
}

function artifactMarkdownHref(reference: ArtifactReference): string {
  const parameters = new URLSearchParams({
    revision: String(reference.revision),
    hash: reference.content_hash,
  });
  return `artifact://${reference.artifact_id}?${parameters.toString()}`;
}

type Falcon24AnalysisOutput = z.infer<typeof falcon24AnalysisOutputSchema>;

function decimal(value: number, digits = 2): string {
  return value.toFixed(digits).replace(/\.00$/u, "");
}

function percent(value: number): string {
  return `${decimal(value * 100)}%`;
}

function buildBusinessAnswer(
  output: Extract<Falcon24AnalysisOutput, { case_id: "falcon24-business-review-18m" }>,
): string {
  const lastMonth = output.monthly_kpis.at(-1)?.month;
  if (!lastMonth) throw new TypeError("FALCON24_ANALYSIS_ANSWER_MONTH_MISSING");
  const driver = (dimension: "customer_segment" | "product_category" | "payment_method") =>
    output.segment_drivers
      .filter((candidate) => candidate.dimension === dimension)
      .sort((left, right) => left.revenue_change - right.revenue_change)[0];
  const customer = driver("customer_segment");
  const category = driver("product_category");
  const payment = driver("payment_method");
  if (!customer || !category || !payment) {
    throw new TypeError("FALCON24_ANALYSIS_ANSWER_DRIVER_MISSING");
  }
  return [
    `最近18个完整月（${output.window.start.slice(0, 7)}至${lastMonth}）中，收入下降最明显的是 ${output.worst_revenue_decline.month}：环比减少 ${decimal(Math.abs(output.worst_revenue_decline.absolute_change))}（${percent(output.worst_revenue_decline.percent_change)}）。`,
    `Shapley 恒等式分解为购买人数 ${decimal(output.shapley_decomposition.buyer_contribution)}、购买频次 ${decimal(output.shapley_decomposition.frequency_contribution)}、客单价 ${decimal(output.shapley_decomposition.aov_contribution)}；绝对影响最大的是购买人数。`,
    `主要下拉场景为客户类型 ${customer.member}（${decimal(customer.revenue_change)}）、商品品类 ${category.member}（${decimal(category.revenue_change)}）和支付方式 ${payment.member}（${decimal(payment.revenue_change)}）。`,
  ].join(" ");
}

function buildDeliveryAnswer(
  output: Extract<Falcon24AnalysisOutput, { case_id: "falcon24-delivery-experience-12m" }>,
): string {
  const scenarios = output.low_rating_scenarios
    .slice(0, 3)
    .map(
      (scenario) =>
        `${scenario.product_category}/${scenario.customer_segment}/${scenario.delivery_status}（${scenario.order_count}单，低评分率${percent(scenario.low_rating_rate)}）`,
    )
    .join("、");
  const first = output.six_vs_six.first;
  const second = output.six_vs_six.second;
  const adjusted = output.adjusted_binomial_glm[0];
  if (!adjusted) throw new TypeError("FALCON24_ANALYSIS_ANSWER_GLM_MISSING");
  return [
    `后6个月相对前6个月：配送 P50 ${decimal(first.p50_minutes)}→${decimal(second.p50_minutes)} 分钟，P90 ${decimal(first.p90_minutes)}→${decimal(second.p90_minutes)} 分钟，准时率 ${percent(first.on_time_rate)}→${percent(second.on_time_rate)}，低评分率 ${percent(first.low_rating_rate)}→${percent(second.low_rating_rate)}。`,
    `低评分较集中的前三个场景为 ${scenarios}。`,
    `控制月份、订单金额、商品品类和客户类型后，延迟项系数 ${decimal(adjusted.delayed_coefficient, 4)}，p=${decimal(adjusted.delayed_p_value, 4)}，调整后关联不显著，不能把配送延迟识别为体验下降的主要关联因素。`,
    `数据质量提示：${output.data_quality_precheck.invalid_delivery_orders} 单配送时长无效，仅 ${output.data_quality_precheck.valid_delivery_orders} 单可用于时长分位数。该证据仅支持统计关联，不支持因果判断。`,
  ].join(" ");
}

function buildInventoryAnswer(
  output: Extract<Falcon24AnalysisOutput, { case_id: "falcon24-inventory-damage-12m" }>,
): string {
  const ordered = [...output.products].sort((left, right) => {
    if (left.status !== right.status) return left.status === "PRIORITY" ? -1 : 1;
    const change =
      right.last3_damage_rate -
      right.previous9_damage_rate -
      (left.last3_damage_rate - left.previous9_damage_rate);
    return (
      change ||
      right.theil_sen_slope - left.theil_sen_slope ||
      left.product_id.localeCompare(right.product_id)
    );
  });
  const priorityCount = output.products.filter(({ status }) => status === "PRIORITY").length;
  const categoryCounts = [
    ...output.products.reduce((counts, product) => {
      counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  ]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([category, count]) => `${category}（${count}个）`)
    .join("、");
  const products = ordered
    .slice(0, 3)
    .map(
      (product) =>
        `${product.product_name}[${product.product_id}]（${product.category}，销量${decimal(product.sales_quantity)}，近3月损坏率${percent(product.last3_damage_rate)}，前9月${percent(product.previous9_damage_rate)}，BH q=${decimal(product.bh_q_value, 4)}，${product.status}）`,
    )
    .join("、");
  return [
    `最近12个完整月共筛出 ${output.products.length} 个“品类内销量不低于 P75、Theil–Sen 斜率为正且近3月损坏率高于前9月”的商品。BH-FDR 后 PRIORITY 为 ${priorityCount} 个、WATCHLIST 为 ${output.products.length - priorityCount} 个。`,
    priorityCount === 0
      ? "当前没有商品达到多重检验校正后的统计优先级，下面只能作为运营排查顺序，不能表述为已证实的持续恶化。"
      : "以下先列治理算子判定为 PRIORITY 的商品。",
    `优先查看：${products || "无命中商品"}。候选较集中的品类为 ${categoryCounts || "无"}。`,
  ].join(" ");
}

function marketingGroupLabel(result: {
  readonly channel: string;
  readonly target_audience: string;
  readonly roas: number;
}): string {
  return `${result.channel}/${result.target_audience}（ROAS ${decimal(result.roas, 3)}）`;
}

function buildMarketingAnswer(
  output: Extract<Falcon24AnalysisOutput, { case_id: "falcon24-marketing-lag-effect" }>,
): string {
  const growth = output.channel_audience_results.filter(
    ({ group_finding: finding }) => finding === "GROWTH_ASSOCIATION",
  );
  const stalled = output.channel_audience_results.filter(
    ({ group_finding: finding }) => finding === "SPEND_WITHOUT_IMPROVEMENT",
  );
  const growthDetails = growth
    .map((result) => {
      const outcomes = result.business_outcomes
        .filter(({ finding }) => finding === "GROWTH_ASSOCIATION")
        .map(
          ({ metric, selected_lag_weeks: lag, bh_q_value: q }) =>
            `${metric} 滞后${lag}周、BH q=${decimal(q, 4)}`,
        )
        .join("/");
      return `${marketingGroupLabel(result)}：${outcomes}`;
    })
    .join("；");
  return [
    `投入增长与后续业务增长关联最清晰的组合为 ${growthDetails || "无"}。本次通过 FDR 的增长证据集中在新增客户，并未得到订单收入或订单量增长的校正后显著证据。`,
    `“投入增加但效果未改善”组合为 ${stalled.map(marketingGroupLabel).join("、") || "无"}。`,
    "ROAS 按营销归因收入/投入计算，1 为盈亏平衡线；滞后 0–4 周模型使用 HAC 标准误和 BH-FDR。以上仅为统计关联，不支持因果判断。",
  ].join(" ");
}

function buildCohortAnswer(
  output: Extract<Falcon24AnalysisOutput, { case_id: "falcon24-cohort-retention-m0-m6" }>,
): string {
  const quality = output.cohorts[0];
  if (!quality) throw new TypeError("FALCON24_ANALYSIS_ANSWER_COHORT_MISSING");
  const months = [...new Set(output.cohorts.map(({ registration_month }) => registration_month))];
  const firstMonth = months[0];
  const lastMonth = months.at(-1);
  if (!firstMonth || !lastMonth) {
    throw new TypeError("FALCON24_ANALYSIS_ANSWER_COHORT_WINDOW_MISSING");
  }
  const sensitivity = new Map(
    output.sensitivity_cohorts.map((row) => [
      `${row.registration_month}\0${row.customer_type}\0${row.month_index}`,
      row.retention_rate,
    ]),
  );
  const conclusionChanged = output.cohorts.some((row) => {
    const compared = sensitivity.get(
      `${row.registration_month}\0${row.customer_type}\0${row.month_index}`,
    );
    return compared !== undefined && Math.abs(row.retention_rate - compared) >= 0.05;
  });
  return [
    `主分析必须 HOLD：${quality.pre_registration_event_count} 个订单早于注册，${quality.pre_registration_customer_count} 个客户存在注册前订单，另有 ${quality.invalid_delivery_event_count} 个无效配送时长；仅 ${quality.valid_ordering_customer_count} 个客户时序有效，${quality.no_order_customer_count} 个注册客户没有订单。`,
    `敏感性口径剔除了 ${quality.pre_registration_customer_count} 个注册前下单客户，且结论${conclusionChanged ? "发生" : "未发生"}变化。因此当前不能可靠断言某个 ${firstMonth} 至 ${lastMonth} 注册批次留存明显变差，也不能据此归因；图表只用于观察 M0–M6 留存、复购及客户类型差异。`,
    "应先修复注册时间与客户—订单关系，再重新运行批次劣化和原因分析。",
  ].join(" ");
}

function buildFalcon24AnalysisAnswer(output: Falcon24AnalysisOutput): string {
  switch (output.case_id) {
    case "falcon24-business-review-18m":
      return buildBusinessAnswer(output);
    case "falcon24-delivery-experience-12m":
      return buildDeliveryAnswer(output);
    case "falcon24-inventory-damage-12m":
      return buildInventoryAnswer(output);
    case "falcon24-marketing-lag-effect":
      return buildMarketingAnswer(output);
    case "falcon24-cohort-retention-m0-m6":
      return buildCohortAnswer(output);
  }
}

function questionFrameReference(input: {
  readonly lease: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["lease"];
  readonly content_hash: `sha256:${string}`;
}) {
  return artifactReferenceFor("QuestionFrame").parse({
    artifact_id: deterministicAnalysisUuid(
      `falcon24-question-frame\0${input.lease.run_id}\0${input.content_hash}`,
    ),
    artifact_type: "QuestionFrame",
    ...input.lease.scope,
    run_id: input.lease.run_id,
    revision: 1,
    content_hash: input.content_hash,
  });
}

async function buildBrief(input: {
  readonly lease: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["lease"];
  readonly test_case: Falcon24AgentAnalysisCase;
  readonly question: string;
  readonly context: AnalysisContext;
  readonly datasource_id: string;
  readonly primary_metric_id: string;
}): Promise<ResearchBriefV3Payload> {
  const window = falcon24AnalysisProgramInternals.windows[input.test_case.case_id];
  const metric = input.context.metrics.find(
    ({ metric_ref: metricRef }) => metricRef.node_id === input.primary_metric_id,
  );
  if (!metric) throw new TypeError("FALCON24_ANALYSIS_PRIMARY_METRIC_MISSING");
  const authorizedDimensions = new Set(
    input.context.metrics
      .flatMap(({ allowed_dimensions: allowedDimensions }) => allowedDimensions)
      .filter(({ groupable }) => groupable)
      .map(({ dimension_id }) => dimension_id),
  );
  const approvedDimensions = input.test_case.required_semantic_keys
    .filter((key) => key.startsWith("dimension."))
    .filter((dimensionId) => authorizedDimensions.has(dimensionId))
    .sort()
    .slice(0, 5);
  const questionFrameMaterial = {
    artifact_type: "QuestionFrame" as const,
    raw_question: input.question,
    normalized_question: input.question.normalize("NFKC").trim(),
    authorized_datasource_ids: [input.datasource_id],
    expected_output: "Falcon 24 governed structured analysis",
  };
  const questionFrameRef = questionFrameReference({
    lease: input.lease,
    content_hash: await sha256ContentHash(questionFrameMaterial),
  });
  const material = {
    artifact_type: "ResearchBrief" as const,
    protocol_version: "research-brief@3.0.0" as const,
    question_frame_ref: questionFrameRef,
    research_mode: "EXPLORATORY_DETERMINISTIC" as const,
    question: input.question,
    semantic_release_ref: input.context.semantic_release_ref,
    schema_snapshot_ref: input.context.schema_snapshot_ref,
    policy_receipt_ref: input.context.policy_receipt_ref,
    primary_metric_refs: [metric.metric_ref],
    approved_dimension_refs: approvedDimensions,
    requested_time_window: window,
    analysis_mode: "EXPLICIT" as const,
    root_cause_mode: "DISABLED" as const,
    code_generation: "ALLOW_SANDBOXED" as const,
    success_criteria: input.test_case.required_methods.map(
      (method) => `独立 Oracle 必须验收方法 ${method}`,
    ),
    required_disclosures: [...input.test_case.required_disclosures],
    budget: {
      max_steps: 1,
      max_model_calls: 24,
      max_sql_executions: 1,
      max_sandbox_executions: 2,
      max_elapsed_ms: 300_000,
    },
  };
  return researchBriefV3PayloadSchema.parse({
    ...material,
    brief_hash: await sha256ContentHash({
      hash_domain: "falcon24-analysis-brief@1.0.0",
      value: material,
    }),
  });
}

function decodeValidatedOutput(
  result: AnalysisExecutionResult,
  testCase: Falcon24AgentAnalysisCase,
) {
  if (result.completion.terminal !== "READY" || result.validated_outputs.length !== 1) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_REQUIRED");
  }
  const accepted = result.validated_outputs[0];
  if (
    !accepted ||
    accepted.node_id !== testCase.case_id ||
    accepted.output.artifact_name !== "result" ||
    accepted.output.artifact_kind !== "RESULT" ||
    accepted.output.media_type !== "application/json"
  ) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_CORRELATION_INVALID");
  }
  const published = JSON.parse(Buffer.from(accepted.output.content).toString("utf8")) as unknown;
  if (typeof published !== "object" || published === null || !("data" in published)) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_DOCUMENT_INVALID");
  }
  const output = falcon24AnalysisOutputSchema.parse(published.data);
  if (output.case_id !== testCase.case_id) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_CASE_INVALID");
  }
  return { output, output_ref: accepted.output.reference };
}

export function createFalcon24GovernedAgentAnalysisPort(input: {
  readonly artifacts: AnalysisArtifactCommitPort;
  readonly public_artifacts: Falcon24PublicArtifactPort;
  readonly public_artifact_capability: unknown;
  readonly create_executor: (context: {
    readonly analysis_context: AnalysisContext;
    readonly task_id: string;
    readonly max_context_bytes: number;
    readonly effective_config: Parameters<
      GovernedAgentAnalysisPort["analyze"]
    >[0]["effective_config"];
    readonly semantic_context: Parameters<
      GovernedAgentAnalysisPort["analyze"]
    >[0]["semantic_context"];
    readonly accepted_query_evidence_ref: Parameters<
      GovernedAgentAnalysisPort["analyze"]
    >[0]["accepted_query_evidence_ref"];
    readonly test_case: Falcon24AgentAnalysisCase;
    readonly provider_dispatch: Parameters<
      GovernedAgentAnalysisPort["analyze"]
    >[0]["provider_dispatch"];
    readonly fence_guard: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["fence_guard"];
  }) => Falcon24ProgramExecutor;
  readonly compile_context?: typeof compileFalcon24AnalysisContext;
  readonly acceptance_recorder?: Falcon24AnalysisAcceptanceRecorder | null;
  readonly diagnostics?: (event: {
    readonly event_name: "falcon24_analysis_orchestration_rejected";
    readonly run_id: string;
    readonly case_id: string;
    readonly stage: string;
    readonly failure_code: string;
    readonly error_name: string | null;
    readonly validation_issues: readonly { readonly path: string; readonly code: string }[];
  }) => void;
}): Falcon24GovernedAnalysisPort {
  const compileContext = input.compile_context ?? compileFalcon24AnalysisContext;
  const analyze = async (
    command: Falcon24GovernedAnalysisCommand,
    onStage: (stage: string) => void,
  ) => {
    onStage("COMPILE_CONTEXT");
    const { context, metric_ids: metricIds } = await compileContext({
      lease: command.lease,
      semantic_context: command.semantic_context,
      test_case: command.test_case,
    });
    const brief = await buildBrief({
      lease: command.lease,
      test_case: command.test_case,
      question: command.question,
      context,
      datasource_id: command.semantic_context.package.semantic_release.datasource_id,
      primary_metric_id: metricIds[0],
    });
    onStage("COMMIT_BRIEF");
    const briefRef = await input.artifacts.commitL2({
      lease: command.lease,
      principal_id: command.lease.principal_id,
      idempotency_key: `falcon24-analysis-brief:${command.test_case.case_id}`,
      payload: brief,
    });
    if (briefRef.artifact_type !== "ResearchBrief") {
      throw new TypeError("FALCON24_ANALYSIS_BRIEF_COMMIT_INVALID");
    }
    const program = await createFalcon24AnalysisProgram({
      test_case: command.test_case,
      brief_ref: briefRef,
      context,
      metric_ids: metricIds,
    });
    const executor = input.create_executor({
      analysis_context: context,
      task_id: command.task_id,
      max_context_bytes: command.max_context_bytes,
      effective_config: command.effective_config,
      semantic_context: command.semantic_context,
      accepted_query_evidence_ref: command.accepted_query_evidence_ref,
      test_case: command.test_case,
      provider_dispatch: command.provider_dispatch,
      fence_guard: command.fence_guard,
    });
    onStage("EXECUTE_PROGRAM");
    const execution = await executor.execute({
      lease: command.lease,
      principal_id: command.lease.principal_id,
      brief,
      brief_ref: briefRef,
      context,
      program,
    });
    onStage("VALIDATE_OUTPUT");
    const validated = decodeValidatedOutput(execution, command.test_case);
    const evidenceRef = exactlyOne(
      execution.evidence_refs,
      "FALCON24_ANALYSIS_DERIVED_EVIDENCE_REF_REQUIRED",
    );
    if (evidenceRef.artifact_type !== "DerivedAnalysisEvidence") {
      throw new TypeError("FALCON24_ANALYSIS_DERIVED_EVIDENCE_REF_INVALID");
    }
    if (execution.query_evidence_refs.length === 0) {
      throw new TypeError("FALCON24_ANALYSIS_QUERY_EVIDENCE_REFS_REQUIRED");
    }
    const oracleReceipt = exactlyOne(
      execution.oracle_receipts,
      "FALCON24_ANALYSIS_ORACLE_RECEIPT_REQUIRED",
    ) as { readonly chart_dataset_hash?: string; readonly output_hash?: string };
    const outputHash = await sha256ContentHash(validated.output);
    if (oracleReceipt.output_hash !== outputHash || !oracleReceipt.chart_dataset_hash) {
      throw new TypeError("FALCON24_ANALYSIS_ORACLE_OUTPUT_BINDING_INVALID");
    }
    const sandboxReceipt = exactlyOne(
      execution.sandbox_receipts,
      "FALCON24_ANALYSIS_SANDBOX_RECEIPT_REQUIRED",
    );
    onStage("BUILD_CHART");
    const chartDocument = await buildArtifactWorkspaceChartDocumentV3({
      schema_version: "artifact-workspace-chart-document@3.0.0",
      document_ref: {
        artifact_id: deterministicAnalysisUuid(
          `falcon24-analysis-chart\0${command.lease.run_id}\0${command.test_case.case_id}`,
        ),
        artifact_type: "ArtifactWorkspaceDocument",
        ...command.lease.scope,
        run_id: command.lease.run_id,
        revision: 1,
        content_hash: `sha256:${"0".repeat(64)}`,
      },
      source_refs: {
        query_evidence_refs: execution.query_evidence_refs,
        derived_evidence_ref: evidenceRef,
      },
      provenance: {
        transform_version: "derived-analysis-chart@1.0.0",
        dataset_hash: `sha256:${"0".repeat(64)}`,
        semantic_context: {
          package_id: command.semantic_context.package.package_id,
          package_hash: command.semantic_context.package.package_hash,
          receipt_id: command.semantic_context.receipt.receipt_id,
          receipt_hash: command.semantic_context.receipt.receipt_hash,
        },
        algorithm_version: FALCON24_ANALYSIS_CHART_VERSION,
        parameter_hash: await sha256ContentHash({
          case_id: command.test_case.case_id,
          chart_version: FALCON24_ANALYSIS_CHART_VERSION,
        }),
        input_closure_hash: await sha256ContentHash({
          output_ref: validated.output_ref,
          output_hash: outputHash,
          query_evidence_refs: execution.query_evidence_refs,
          derived_evidence_ref: evidenceRef,
        }),
        runtime_profile: sandboxReceipt.runtime_profile,
        agent_image: sandboxReceipt.runtime.agent_image,
        operator_image: sandboxReceipt.runtime.operator_image,
      },
      projection: buildFalcon24AnalysisChartProjection(validated.output),
    });
    if (chartDocument.provenance.dataset_hash !== oracleReceipt.chart_dataset_hash) {
      throw new TypeError("FALCON24_ANALYSIS_CHART_ORACLE_BINDING_INVALID");
    }
    onStage("COMMIT_CHART");
    const chartRef = portValue(
      await input.public_artifacts.commitDerivedAnalysisChart(
        input.public_artifact_capability,
        command.lease,
        chartDocument,
      ),
    );
    if (
      artifactReferenceIdentity(chartRef) !== artifactReferenceIdentity(chartDocument.document_ref)
    ) {
      throw new TypeError("FALCON24_ANALYSIS_CHART_COMMIT_CORRELATION_INVALID");
    }
    onStage("RECORD_ACCEPTANCE");
    await input.acceptance_recorder?.record({
      test_case: command.test_case,
      semantic_context_ref: {
        package_id: command.semantic_context.package.package_id,
        package_revision: 1,
        package_hash: command.semantic_context.package.package_hash as `sha256:${string}`,
      },
      execution,
      chart_ref: chartRef,
      completed_at: new Date().toISOString(),
    });
    const acceptedArtifactRefs = [
      briefRef,
      execution.analysis_program_ref,
      ...execution.evidence_refs,
      validated.output_ref,
      chartRef,
      execution.completion_ref,
    ];
    const seen = new Set<string>();
    return {
      answer: `${buildFalcon24AnalysisAnswer(validated.output)}\n\n[查看对应图表](${artifactMarkdownHref(chartRef)})`,
      public_artifact_refs: [chartRef],
      accepted_artifact_refs: acceptedArtifactRefs.filter((reference) => {
        const identity = `${reference.artifact_id}:${reference.revision}:${reference.content_hash}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      }),
    };
  };
  return Object.freeze({
    async analyze(command: Falcon24GovernedAnalysisCommand) {
      let stage = "START";
      try {
        return await analyze(command, (nextStage) => {
          stage = nextStage;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const declaredCode =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string" &&
          /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.code)
            ? error.code
            : null;
        const failureCode =
          declaredCode ??
          (error instanceof z.ZodError
            ? "FALCON24_ANALYSIS_CONTRACT_INVALID"
            : /^[A-Z][A-Z0-9_]{2,127}$/u.test(message)
              ? message
              : "FALCON24_ANALYSIS_ORCHESTRATION_FAILED");
        input.diagnostics?.({
          event_name: "falcon24_analysis_orchestration_rejected",
          run_id: command.lease.run_id,
          case_id: command.test_case.case_id,
          stage,
          failure_code: failureCode,
          error_name:
            error instanceof Error && /^[A-Za-z][A-Za-z0-9_.]{0,127}$/u.test(error.name)
              ? error.name
              : null,
          validation_issues: Object.freeze(
            error instanceof z.ZodError
              ? error.issues.slice(0, 16).map((issue) =>
                  Object.freeze({
                    path: issue.path.length === 0 ? "$" : issue.path.map(String).join("."),
                    code: issue.code,
                  }),
                )
              : [],
          ),
        });
        if (declaredCode || /^[A-Z][A-Z0-9_]{2,127}$/u.test(message)) {
          throw new TypeError(failureCode);
        }
        throw new TypeError(failureCode);
      }
    },
  });
}

export const falcon24GovernedAgentAnalysisInternals = Object.freeze({
  artifactMarkdownHref,
  buildFalcon24AnalysisAnswer,
  buildBrief,
  decodeValidatedOutput,
});
