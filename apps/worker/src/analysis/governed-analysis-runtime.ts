import {
  type AnalysisProgramPayload,
  type ArtifactReference,
  type ArtifactWorkspaceChartDocumentV3,
  type ArtifactWorkspaceChartProjectionV3,
  analysisResultTableSemanticRoleSchema,
  artifactReferenceIdentity,
  artifactWorkspaceChartProjectionV3Schema,
  buildArtifactWorkspaceChartDocumentV3,
  buildProductTeamArtifactDocument,
  computeArtifactWorkspaceChartDatasetV3Hash,
  DERIVED_ANALYSIS_CHART_FACET_TRANSFORM_VERSION,
  DERIVED_ANALYSIS_CHART_NULLABLE_TRANSFORM_VERSION,
  type ProductTeamArtifactDocument,
  type QueryEvidenceSemanticBinding,
  type ResearchBriefV3Payload,
  researchBriefV3PayloadSchema,
  verifyProductTeamArtifactDocument,
  verifyQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import type { AnalysisContext } from "@data-agent/contracts/context";
import {
  type AnalysisAuthorityCommit,
  type AnalysisContextJournalAppendCommand,
  type AnalysisOracleReceipt,
  analysisChartFacetFieldSchema,
  buildAnalysisPublicationV2Command,
  refineAnalysisPublishedChartFacet,
} from "@data-agent/contracts/ports";
import type { Falcon24AuthorityBindingV2, RunWorkLease } from "@data-agent/contracts/runs";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts/statistical-operators";
import { compilePublishedAnalysisContext } from "@data-agent/semantic/runtime-context";
import { z } from "zod";
import type { RunModelProviderResult } from "../runs/run-execution-context.js";
import type { FrozenSemanticReleaseReadPort } from "../semantic/semantic-release-read-port.js";
import { resolveAnalysisEvidenceTimeWindow as evidenceTimeWindow } from "./analysis-evidence-time-window.js";
import {
  type AnalysisMethodRegistryEntry,
  compileAnalysisProgramCandidate,
} from "./analysis-program-compiler.js";
import { deterministicAnalysisUuid } from "./deterministic-id.js";
import type {
  AnalysisArtifactCommitPort,
  AnalysisExecutionResult,
  ProviderInvocationResourceRef,
} from "./executor.js";
import type { GovernedAgentAnalysisPort } from "./governed-agent-analysis-port.js";
import type { ProductTeamAnalysisArtifactAuthority } from "./product-team-query-port.js";
import type { buildAnalysisResearchArtifactCommit } from "./research-artifact-port.js";
import type { AnalysisResultClosureArtifact } from "./result-publisher.js";
import { DEFAULT_ANALYSIS_SKILL_CATALOG } from "./skill-catalog.js";

type GovernedAnalysisCommand = Parameters<GovernedAgentAnalysisPort["analyze"]>[0];

export interface GovernedAnalysisMethodRegistryPort {
  resolve(input: {
    readonly lease: GovernedAnalysisCommand["lease"];
    readonly task_id: string;
    readonly question: string;
    readonly context: AnalysisContext;
    readonly query_evidence_ref: ArtifactReference & { readonly artifact_type: "QueryEvidence" };
    readonly query_evidence_document: ProductTeamArtifactDocument;
    readonly query_evidence_binding: QueryEvidenceSemanticBinding;
  }): Promise<readonly AnalysisMethodRegistryEntry[]>;
}

export interface GovernedAnalysisProgramExecutor {
  execute(input: {
    readonly lease: GovernedAnalysisCommand["lease"];
    readonly authority: GovernedAnalysisCommand["authority"];
    readonly task_id: string;
    readonly principal_id: string;
    readonly brief: ResearchBriefV3Payload;
    readonly brief_ref: ArtifactReference;
    readonly context: AnalysisContext;
    readonly program: AnalysisProgramPayload;
  }): Promise<AnalysisExecutionResult>;
}

function portValue<T>(result: import("@data-agent/contracts/ports").PortResult<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function exactReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function dependencyIdentity(tableId: string, columnId: string): string {
  const relation = tableId.split(".").at(-1);
  const column = columnId
    .replace(/^column\./u, "")
    .split(".")
    .at(-1);
  if (!relation || !column) throw new TypeError("GOVERNED_ANALYSIS_METRIC_DEPENDENCY_INVALID");
  return `${relation}\0${column}`;
}

/**
 * Resolve only the Published Metrics that authorize analysis of the accepted result columns.
 * FORMULA columns remain data-only FORMULA columns; their exact published formula/dependency
 * closure merely identifies the existing Metric capabilities that may analyze those values.
 */
function requestedAnalysisMetricIds(input: {
  readonly binding: QueryEvidenceSemanticBinding;
  readonly semantic_context: GovernedAnalysisCommand["semantic_context"];
  readonly catalog: {
    readonly executable: {
      readonly metrics: readonly {
        readonly metric_id: string;
        readonly table_id: string;
        readonly dependency_column_ids: readonly string[];
        readonly formula: { readonly formula_id: string } | null;
      }[];
    };
  };
}): readonly string[] {
  const requested = new Set(
    input.binding.columns
      .filter(({ semantic_role: role }) => role === "METRIC")
      .map(({ semantic_object_id: id }) => id),
  );
  // A direct Metric binding is already the narrowest capability authority. FORMULA and
  // REQUEST_DERIVED siblings remain data-only and cannot enlarge that set.
  if (requested.size > 0) return [...requested].sort();
  const packageDocument = input.semantic_context.package;
  const selected = new Set([
    ...packageDocument.retrieval_receipt.selected_object_ids,
    ...packageDocument.mandatory_closure.object_ids,
    ...(packageDocument.route_decision.selected_metric_id
      ? [packageDocument.route_decision.selected_metric_id]
      : []),
  ]);
  const formulaIds = new Set(
    input.binding.columns
      .filter(({ semantic_role: role }) => role === "FORMULA")
      .map(({ semantic_object_id: id }) => id),
  );
  for (const column of input.binding.columns) {
    if (column.semantic_role !== "REQUEST_DERIVED") continue;
    const derivation = column.request_derivation;
    if (!derivation) throw new TypeError("GOVERNED_ANALYSIS_REQUEST_DERIVATION_INVALID");
    for (const objectId of derivation.interpretation.source_object_ids) {
      if (selected.has(objectId)) requested.add(objectId);
    }
  }
  const formulaSources = new Set(
    input.binding.columns
      .filter(({ semantic_role: role }) => role === "FORMULA")
      .flatMap(({ physical_sources: sources }) =>
        sources.map(({ relation_name: relation, column_name: column }) => `${relation}\0${column}`),
      ),
  );
  for (const metric of input.catalog.executable.metrics) {
    if (!selected.has(metric.metric_id)) continue;
    const canonicalFormulaSelected =
      metric.formula !== null && formulaIds.has(metric.formula.formula_id);
    const dependencies = metric.dependency_column_ids.map((columnId) =>
      dependencyIdentity(metric.table_id, columnId),
    );
    const allDependenciesBound =
      dependencies.length > 0 && dependencies.every((identity) => formulaSources.has(identity));
    if (canonicalFormulaSelected || allDependenciesBound) requested.add(metric.metric_id);
  }
  return [...requested].sort();
}

async function resolveQueryEvidence(input: {
  readonly authority: ProductTeamAnalysisArtifactAuthority;
  readonly capability: unknown;
  readonly reference: GovernedAnalysisCommand["accepted_query_evidence_ref"];
}) {
  const document = portValue(
    await input.authority.resolveCommitted(input.capability, input.reference),
  );
  if (!document) throw new TypeError("GOVERNED_ANALYSIS_QUERY_EVIDENCE_REQUIRED");
  const verified = await verifyProductTeamArtifactDocument(document);
  if (
    verified.artifact_ref.artifact_type !== "QueryEvidence" ||
    !exactReference(verified.artifact_ref, input.reference) ||
    verified.provenance?.kind !== "GOVERNED_QUERY_RESULT" ||
    verified.projection.kind !== "TABLE"
  ) {
    throw new TypeError("GOVERNED_ANALYSIS_QUERY_EVIDENCE_INVALID");
  }
  return Object.freeze({
    document: verified,
    binding: await verifyQueryEvidenceSemanticBinding(verified.provenance.semantic_binding),
  });
}

async function buildGenericBrief(input: {
  readonly command: GovernedAnalysisCommand;
  readonly context: AnalysisContext;
  readonly binding: QueryEvidenceSemanticBinding;
  readonly methods: readonly AnalysisMethodRegistryEntry[];
}): Promise<ResearchBriefV3Payload> {
  const metricIds = new Set(
    input.binding.columns
      .filter(({ semantic_role: role }) => role === "METRIC")
      .map(({ semantic_object_id: objectId }) => objectId),
  );
  const dimensionIds = new Set(
    input.binding.columns
      .filter(({ semantic_role: role }) => role === "DIMENSION")
      .map(({ semantic_object_id: objectId }) => objectId),
  );
  const primaryMetricRefs = input.context.metrics
    .filter(({ metric_ref: reference }) => metricIds.has(reference.node_id))
    .map(({ metric_ref: reference }) => reference);
  const authorizedDimensions = new Set(
    input.context.metrics.flatMap(({ allowed_dimensions: dimensions }) =>
      dimensions.filter(({ groupable }) => groupable).map(({ dimension_id: id }) => id),
    ),
  );
  const approvedDimensionRefs = [...dimensionIds]
    .filter((id) => authorizedDimensions.has(id))
    .sort();
  if (
    primaryMetricRefs.length !== metricIds.size ||
    approvedDimensionRefs.length !== dimensionIds.size
  ) {
    throw new TypeError("GOVERNED_ANALYSIS_SEMANTIC_BINDING_INVALID");
  }
  const questionFrameMaterial = {
    artifact_type: "QuestionFrame" as const,
    raw_question: input.command.question,
    normalized_question: input.command.question.normalize("NFKC").trim(),
    authorized_datasource_ids: [input.binding.datasource_ref.resource_id],
    expected_output: "Governed analysis with evidence, chart, and report",
  };
  const material = {
    artifact_type: "ResearchBrief" as const,
    protocol_version: "research-brief@3.0.0" as const,
    question_frame_ref: {
      artifact_id: deterministicAnalysisUuid(
        `governed-analysis-question-frame\0${input.command.lease.run_id}\0${input.command.task_id}`,
      ),
      artifact_type: "QuestionFrame" as const,
      ...input.command.lease.scope,
      run_id: input.command.lease.run_id,
      revision: 1,
      content_hash: await sha256ContentHash(questionFrameMaterial),
    },
    research_mode: "EXPLORATORY_DETERMINISTIC" as const,
    question: input.command.question,
    semantic_release_ref: input.context.semantic_release_ref,
    schema_snapshot_ref: input.context.schema_snapshot_ref,
    policy_receipt_ref: input.context.policy_receipt_ref,
    primary_metric_refs: primaryMetricRefs,
    approved_dimension_refs: approvedDimensionRefs,
    requested_time_window: evidenceTimeWindow(input.binding, input.context),
    analysis_mode: "AUTO" as const,
    root_cause_mode: "TRY_WHEN_SUPPORTED" as const,
    code_generation: "ALLOW_SANDBOXED" as const,
    success_criteria: input.methods.map(
      ({ method_id: methodId }) => `Host 必须按发布方法 ${methodId} 及其 ResultContract 验证输出。`,
    ),
    required_disclosures: [] as const,
    budget: {
      max_steps: 16,
      max_model_calls: 32,
      max_sql_executions: 16,
      max_sandbox_executions: 16,
      max_elapsed_ms: 300_000,
    },
  };
  return researchBriefV3PayloadSchema.parse({
    ...material,
    brief_hash: await sha256ContentHash({
      hash_domain: "governed-analysis-brief@1.0.0",
      value: material,
    }),
  });
}

function acceptedRefs(input: {
  readonly brief_ref: ArtifactReference;
  readonly execution: AnalysisExecutionResult;
}) {
  const references = [
    input.brief_ref,
    input.execution.analysis_program_ref,
    ...input.execution.evidence_refs,
    ...input.execution.published_outputs.map(({ output }) => output.reference),
    ...input.execution.chart_refs,
    input.execution.completion_ref,
    input.execution.report_ref,
  ];
  const seen = new Set<string>();
  return references.filter((reference) => {
    const identity = artifactReferenceIdentity(reference);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function artifactHref(reference: ArtifactReference): string {
  const parameters = new URLSearchParams({
    revision: String(reference.revision),
    hash: reference.content_hash,
  });
  return `artifact://${reference.artifact_id}?${parameters.toString()}`;
}

/**
 * The only production orchestration entrypoint for model-authored governed analysis.
 * It derives authority from the accepted QueryEvidence and Published Semantic Release;
 * only frozen semantic bindings and published method contracts enter planning.
 */
export function createGovernedAnalysisRuntime(input: {
  readonly artifacts: AnalysisArtifactCommitPort;
  readonly artifact_authority: ProductTeamAnalysisArtifactAuthority;
  readonly artifact_capability: unknown;
  readonly semantic_release: FrozenSemanticReleaseReadPort;
  readonly compile_context?: typeof compilePublishedAnalysisContext;
  readonly method_registry: GovernedAnalysisMethodRegistryPort;
  readonly create_executor: (context: {
    readonly command: GovernedAnalysisCommand;
    readonly analysis_context: AnalysisContext;
    readonly query_evidence_binding: QueryEvidenceSemanticBinding;
    readonly method_registry: readonly AnalysisMethodRegistryEntry[];
  }) => GovernedAnalysisProgramExecutor;
  readonly diagnostics?: (event: {
    readonly event_name: "governed_analysis_orchestration_rejected";
    readonly run_id: string;
    readonly stage: string;
    readonly failure_code: string;
  }) => void;
}): GovernedAgentAnalysisPort {
  return Object.freeze({
    async analyze(command: GovernedAnalysisCommand) {
      let stage = "QUERY_EVIDENCE";
      try {
        const evidence = await resolveQueryEvidence({
          authority: input.artifact_authority,
          capability: input.artifact_capability,
          reference: command.accepted_query_evidence_ref,
        });
        if (
          evidence.binding.semantic_context_ref.package_id !==
            command.semantic_context.package.package_id ||
          evidence.binding.semantic_context_ref.package_hash !==
            command.semantic_context.package.package_hash ||
          evidence.binding.semantic_context_ref.receipt_id !==
            command.semantic_context.receipt.receipt_id ||
          evidence.binding.semantic_context_ref.receipt_hash !==
            command.semantic_context.receipt.receipt_hash
        ) {
          throw new TypeError("GOVERNED_ANALYSIS_QUERY_EVIDENCE_CONTEXT_MISMATCH");
        }
        stage = "SEMANTIC_CONTEXT";
        const catalog = portValue(
          await input.semantic_release.read({
            capability: input.artifact_capability,
            package: command.semantic_context.package,
          }),
        );
        const requestedMetricIds = requestedAnalysisMetricIds({
          binding: evidence.binding,
          semantic_context: command.semantic_context,
          catalog,
        });
        if (requestedMetricIds.length === 0) {
          throw new TypeError("GOVERNED_ANALYSIS_METRIC_AUTHORITY_UNRESOLVED");
        }
        const context = await (input.compile_context ?? compilePublishedAnalysisContext)({
          run_id: command.lease.run_id,
          semantic_context: command.semantic_context,
          catalog,
          requested_metric_ids: requestedMetricIds,
        });
        stage = "METHOD_REGISTRY";
        const methods = await input.method_registry.resolve({
          lease: command.lease,
          task_id: command.task_id,
          question: command.question,
          context,
          query_evidence_ref: command.accepted_query_evidence_ref,
          query_evidence_document: evidence.document,
          query_evidence_binding: evidence.binding,
        });
        if (
          methods.length === 0 ||
          methods.length > 32 ||
          new Set(methods.map(({ method_id: id }) => id)).size !== methods.length
        ) {
          throw new TypeError("GOVERNED_ANALYSIS_METHOD_REGISTRY_INVALID");
        }
        const brief = await buildGenericBrief({
          command,
          context,
          binding: evidence.binding,
          methods,
        });
        stage = "COMMIT_BRIEF";
        const briefRef = await input.artifacts.commitL2({
          lease: command.lease,
          principal_id: command.lease.principal_id,
          idempotency_key: `governed-analysis-brief:${command.task_id}`,
          payload: brief,
        });
        if (briefRef.artifact_type !== "ResearchBrief") {
          throw new TypeError("GOVERNED_ANALYSIS_BRIEF_COMMIT_INVALID");
        }
        stage = "ANALYSIS_PROGRAM";
        const objectiveHash = await sha256ContentHash({
          hash_domain: "analysis-program-objective@1.0.0",
          question: brief.question,
        });
        const methodRegistryHash = await sha256ContentHash({
          hash_domain: "analysis-method-registry@1.0.0",
          entries: methods,
        });
        const providerResult = portValue<RunModelProviderResult>(
          await command.provider_dispatch.invoke({
            logical_call_id: deterministicAnalysisUuid(
              `governed-analysis-program\0${command.lease.run_id}\0${command.task_id}`,
            ),
            turn: {
              kind: "SPECIALIST",
              stage: "ANALYSIS_PROGRAM",
              profile_id: "governed-analysis-agent",
              objective: command.question,
              context_text: canonicalizeJson({
                schema_version: "governed-analysis-planning-authority@1.0.0",
                objective_hash: objectiveHash,
                approved_time_window: brief.requested_time_window,
                analysis_context: {
                  context_hash: context.context_hash,
                  semantic_context_package_hash: context.semantic_context_binding.package_hash,
                  metrics: context.metrics.map((metric) => ({
                    metric_id: metric.metric_ref.node_id,
                    formula_hash: metric.formula_hash,
                    unit: metric.unit,
                    grain: metric.grain,
                    time_domain: metric.time_domain,
                    time_dimension_ref: metric.time_dimension_ref,
                    allowed_dimensions: metric.allowed_dimensions,
                    analysis_capabilities: metric.analysis_capabilities,
                  })),
                },
                accepted_input: {
                  query_evidence_ref: command.accepted_query_evidence_ref,
                  binding_hash: evidence.binding.binding_hash,
                  columns: evidence.binding.columns.map((column) => ({
                    output_name: column.output_name,
                    logical_type: column.logical_type,
                    nullable: column.nullable,
                    semantic_role: column.semantic_role,
                    semantic_object_id: column.semantic_object_id,
                    formula_hash: column.formula_hash,
                    aggregate: column.aggregate,
                    grain: column.grain,
                  })),
                  time_window: evidence.binding.time_window,
                },
                method_registry: {
                  registry_hash: methodRegistryHash,
                  operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
                  entries: methods.map((method) => ({
                    method_id: method.method_id,
                    skill_id: method.skill_id,
                    parameter_schema: DEFAULT_ANALYSIS_SKILL_CATALOG.projectPlanningParameterSchema(
                      method.skill_id,
                    ),
                    result_contract_hash: method.result_contract.contract_hash,
                    required_metric_ids: [
                      ...new Set(
                        method.result_contract.metric_bindings.map(
                          (binding) => binding.semantic_metric_id,
                        ),
                      ),
                    ],
                    required_dimension_ids: [
                      ...new Set([
                        ...method.result_contract.grain.dimension_ids,
                        ...(method.result_contract.grain.time_dimension_id === null
                          ? []
                          : [method.result_contract.grain.time_dimension_id]),
                        ...method.result_contract.dimension_bindings.map(
                          (binding) => binding.semantic_dimension_id,
                        ),
                      ]),
                    ],
                    required_operator_obligations: method.required_operator_obligations,
                  })),
                },
              }),
            },
          }),
        );
        let candidate: unknown;
        try {
          candidate = JSON.parse(providerResult.output_text);
        } catch {
          throw new TypeError("GOVERNED_ANALYSIS_PROGRAM_RESPONSE_INVALID");
        }
        const program = await compileAnalysisProgramCandidate({
          candidate,
          brief,
          brief_ref: briefRef,
          context,
          method_registry: methods,
          query_evidence: {
            reference: command.accepted_query_evidence_ref,
            document: evidence.document,
          },
        });
        stage = "EXECUTE";
        const execution = await input
          .create_executor({
            command,
            analysis_context: context,
            query_evidence_binding: evidence.binding,
            method_registry: methods,
          })
          .execute({
            lease: command.lease,
            authority: command.authority,
            task_id: command.task_id,
            principal_id: command.lease.principal_id,
            brief,
            brief_ref: briefRef,
            context,
            program,
          });
        if (
          execution.completion.terminal !== "READY" ||
          execution.evidence_refs.length !== program.nodes.length ||
          execution.oracle_receipts.length !== program.nodes.length ||
          execution.chart_refs.length === 0 ||
          execution.report_ref.artifact_type !== "AnalysisReport" ||
          !execution.query_evidence_refs.some((reference) =>
            exactReference(reference, command.accepted_query_evidence_ref),
          )
        ) {
          throw new TypeError("GOVERNED_ANALYSIS_PUBLICATION_CLOSURE_INVALID");
        }
        const summaries = execution.explanations.map(({ explanation }) => explanation.summary_zh);
        if (summaries.length === 0) {
          throw new TypeError("GOVERNED_ANALYSIS_EXPLANATION_REQUIRED");
        }
        const links = [
          ...execution.chart_refs.map(
            (reference, index) => `[查看图表 ${index + 1}](${artifactHref(reference)})`,
          ),
          `[查看分析报告](${artifactHref(execution.report_ref)})`,
        ];
        return Object.freeze({
          answer: `${summaries.join("\n\n")}\n\n${links.join(" · ")}`,
          public_artifact_refs: Object.freeze([...execution.chart_refs, execution.report_ref]),
          accepted_artifact_refs: Object.freeze(acceptedRefs({ brief_ref: briefRef, execution })),
        });
      } catch (error) {
        const message = error instanceof Error ? (error.message.split(":", 1)[0] ?? "") : "";
        const failureCode = /^[A-Z][A-Z0-9_]{2,127}$/u.test(message)
          ? message
          : error instanceof z.ZodError
            ? "GOVERNED_ANALYSIS_CONTRACT_INVALID"
            : "GOVERNED_ANALYSIS_ORCHESTRATION_FAILED";
        input.diagnostics?.({
          event_name: "governed_analysis_orchestration_rejected",
          run_id: command.lease.run_id,
          stage,
          failure_code: failureCode,
        });
        throw new TypeError(failureCode);
      }
    },
  });
}

const publishedChartSchema = z
  .strictObject({
    schema_version: z.enum(["analysis-published-chart@1.0.0", "analysis-published-chart@1.1.0"]),
    chart_id: z.string().min(1).max(256),
    title_zh: z.string().min(1).max(160),
    intent: z.enum([
      "TREND",
      "COMPARISON",
      "CONTRIBUTION",
      "DISTRIBUTION",
      "RELATIONSHIP",
      "PRIORITY",
      "RETENTION",
    ]),
    template_id: z.string().min(1).max(128),
    bindings: z.strictObject({
      x_field: z.string().min(1).max(128),
      y_fields: z.array(z.string().min(1).max(128)).min(1).max(4),
      series_field: z.string().min(1).max(128).nullable(),
      facet_field: analysisChartFacetFieldSchema,
      lower_bound_field: z.string().min(1).max(128).nullable(),
      upper_bound_field: z.string().min(1).max(128).nullable(),
    }),
    dataset: z.strictObject({
      table_id: z.string().min(1).max(256),
      columns: z
        .array(
          z.strictObject({
            key: z.string().min(1).max(128),
            label_zh: z.string().min(1).max(160),
            data_type: z.enum([
              "BOOLEAN",
              "DATE",
              "DECIMAL",
              "INTEGER",
              "JSON",
              "NUMBER",
              "STRING",
              "TIMESTAMP",
            ]),
            nullable: z.boolean(),
            semantic_object_id: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u),
            semantic_role: analysisResultTableSemanticRoleSchema,
          }),
        )
        .min(1)
        .max(128),
      rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5_000),
      total_rows: z.number().int().positive().max(5_000),
    }),
  })
  .superRefine(refineAnalysisPublishedChartFacet);

function chartType(
  chart: z.infer<typeof publishedChartSchema>,
): ArtifactWorkspaceChartProjectionV3["chart_type"] {
  if (chart.bindings.lower_bound_field && chart.bindings.upper_bound_field) return "AREA_RANGE";
  if (chart.intent === "TREND") return "LINE";
  if (chart.intent === "CONTRIBUTION") return "SIGNED_CONTRIBUTION";
  if (chart.intent === "DISTRIBUTION") return "DISTRIBUTION";
  if (chart.intent === "RELATIONSHIP") return "RELATIONSHIP";
  if (chart.intent === "PRIORITY") return "PRIORITY_MATRIX";
  return "BAR";
}

export function projectStagedAnalysisChart(input: AnalysisResultClosureArtifact) {
  if (input.artifact_kind !== "CHART") {
    throw new TypeError("FALCON24_ANALYSIS_PUBLICATION_CHART_ARTIFACT_REQUIRED");
  }
  const chart = publishedChartSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.content)),
  );
  if (chart.dataset.total_rows !== chart.dataset.rows.length) {
    throw new TypeError("FALCON24_ANALYSIS_PUBLICATION_CHART_DATASET_INVALID");
  }
  const projection = artifactWorkspaceChartProjectionV3Schema.parse({
    kind: "CHART",
    chart_type: chartType(chart),
    title: chart.title_zh,
    description: "由独立 Oracle 验证的受治理分析结果确定性投影。",
    unit: null,
    x_key: chart.bindings.x_field,
    y_keys: chart.bindings.y_fields,
    lower_bound_key: chart.bindings.lower_bound_field,
    upper_bound_key: chart.bindings.upper_bound_field,
    series_key: chart.bindings.series_field,
    ...(chart.bindings.facet_field !== undefined ? { facet_key: chart.bindings.facet_field } : {}),
    legend: { visible: chart.bindings.series_field !== null || chart.bindings.y_fields.length > 1 },
    evidence_level: "L2_OBSERVATION",
    table: {
      kind: "TABLE",
      columns: chart.dataset.columns.map((column) => ({
        key: column.key,
        label: column.label_zh,
        data_type:
          column.data_type === "BOOLEAN"
            ? "BOOLEAN"
            : ["INTEGER", "NUMBER"].includes(column.data_type)
              ? "NUMBER"
              : "STRING",
      })),
      rows: chart.dataset.rows,
      total_rows: chart.dataset.total_rows,
    },
  });
  return Object.freeze({ chart_id: chart.chart_id, projection });
}

type PreparedL2 = Awaited<ReturnType<typeof buildAnalysisResearchArtifactCommit>>;

export interface PreparedAnalysisPublicationNode {
  readonly node_id: string;
  readonly authority_commit: AnalysisAuthorityCommit;
  readonly journal_command: AnalysisContextJournalAppendCommand;
  readonly oracle_receipt: AnalysisOracleReceipt;
  readonly evidence: PreparedL2;
  readonly query_evidence_refs: readonly ArtifactReference[];
  readonly charts: readonly ReturnType<typeof projectStagedAnalysisChart>[];
  readonly runtime: {
    readonly runtime_profile: "CORE_ANALYSIS" | "ML_DIAGNOSTIC" | "CAUSAL_L5";
    readonly agent_image: string;
    readonly operator_image: string;
    readonly algorithm_version: string;
    readonly parameter_hash: `sha256:${string}`;
    readonly input_closure_hash: `sha256:${string}`;
  };
  readonly explanation: string;
  readonly provider_invocation_ref: ProviderInvocationResourceRef;
}

export async function assembleAnalysisPublication(input: {
  readonly lease: RunWorkLease;
  readonly authority: Falcon24AuthorityBindingV2;
  readonly task_id: string;
  readonly principal_id: string;
  readonly program: AnalysisProgramPayload;
  readonly analysis_program_ref: ArtifactReference & { readonly artifact_type: "AnalysisProgram" };
  readonly context: AnalysisContext;
  readonly completion: PreparedL2;
  readonly nodes: readonly PreparedAnalysisPublicationNode[];
  readonly question: string;
  readonly committed_at: string;
}) {
  const nodeById = new Map(input.nodes.map((node) => [node.node_id, node]));
  const orderedNodes = input.program.nodes.map((node) => {
    const prepared = nodeById.get(node.node_id);
    if (!prepared) throw new TypeError("FALCON24_ANALYSIS_PUBLICATION_NODE_MISSING");
    return prepared;
  });
  const chartDocuments: ArtifactWorkspaceChartDocumentV3[] = [];
  for (const node of orderedNodes) {
    for (const chart of node.charts) {
      const document = await buildArtifactWorkspaceChartDocumentV3({
        schema_version: "artifact-workspace-chart-document@3.0.0",
        document_ref: {
          artifact_id: deterministicAnalysisUuid(
            `falcon24-analysis-chart\0${input.lease.run_id}\0${node.node_id}\0${chart.chart_id}`,
          ),
          artifact_type: "ArtifactWorkspaceDocument",
          ...input.lease.scope,
          run_id: input.lease.run_id,
          revision: 1,
          content_hash: `sha256:${"0".repeat(64)}`,
        },
        source_refs: {
          query_evidence_refs: node.query_evidence_refs,
          derived_evidence_ref: node.evidence.reference,
        },
        provenance: {
          transform_version:
            chart.projection.facet_key === undefined
              ? DERIVED_ANALYSIS_CHART_NULLABLE_TRANSFORM_VERSION
              : DERIVED_ANALYSIS_CHART_FACET_TRANSFORM_VERSION,
          dataset_hash: `sha256:${"0".repeat(64)}`,
          semantic_context: input.context.semantic_context_binding,
          algorithm_version: node.runtime.algorithm_version,
          parameter_hash: node.runtime.parameter_hash,
          input_closure_hash: node.runtime.input_closure_hash,
          runtime_profile: node.runtime.runtime_profile,
          agent_image: node.runtime.agent_image,
          operator_image: node.runtime.operator_image,
        },
        projection: chart.projection,
      });
      chartDocuments.push(document);
    }
  }
  if (chartDocuments.length === 0 || orderedNodes.length + chartDocuments.length + 1 > 16) {
    throw new TypeError("FALCON24_ANALYSIS_PUBLICATION_REPORT_SOURCE_BOUND_EXCEEDED");
  }
  for (const node of orderedNodes) {
    const expected = await Promise.all(
      node.charts.map(({ projection }) => computeArtifactWorkspaceChartDatasetV3Hash(projection)),
    );
    if (
      expected.length !== node.oracle_receipt.input_binding.chart_dataset_hashes.length ||
      expected.some(
        (hash, index) => hash !== node.oracle_receipt.input_binding.chart_dataset_hashes[index],
      )
    ) {
      throw new TypeError("FALCON24_ANALYSIS_PUBLICATION_CHART_ORACLE_MISMATCH");
    }
  }
  const sourceRefs = [
    ...orderedNodes.map(({ evidence }) => evidence.reference),
    input.completion.reference,
    ...chartDocuments.map(({ document_ref: reference }) => reference),
  ];
  const reportDocument: ProductTeamArtifactDocument = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: deterministicAnalysisUuid(`falcon24-analysis-report\0${input.lease.run_id}`),
      artifact_type: "AnalysisReport",
      ...input.lease.scope,
      run_id: input.lease.run_id,
      revision: 1,
      content_hash: `sha256:${"0".repeat(64)}`,
    },
    profile_id: "governed-analysis-agent",
    task_id: input.task_id,
    source_refs: sourceRefs,
    provenance: null,
    projection: {
      kind: "REPORT",
      title: "受治理数据分析",
      sections: [
        {
          heading: "分析任务",
          body_text: input.question,
          source_refs: [],
        },
        ...orderedNodes.map((node) => ({
          heading: node.node_id,
          body_text: node.explanation,
          source_refs: [
            node.evidence.reference,
            ...chartDocuments
              .filter(
                ({ source_refs: sources }) =>
                  sources.derived_evidence_ref.artifact_id === node.evidence.reference.artifact_id,
              )
              .map(({ document_ref: reference }) => reference),
          ],
        })),
      ],
    },
    committed_at: input.committed_at,
  });
  const command = await buildAnalysisPublicationV2Command({
    schema_version: "falcon24-analysis-publication@2.0.0",
    scope: input.lease.scope,
    run_id: input.lease.run_id,
    principal_id: input.principal_id,
    attempt_id: input.lease.attempt_id,
    worker_fence: input.lease.worker_fence,
    idempotency_key: `falcon24-analysis-publication:${input.program.program_hash}`,
    analysis_program_ref: input.analysis_program_ref,
    nodes: orderedNodes.map((node) => ({
      authority_commit: node.authority_commit,
      journal_command: node.journal_command,
      oracle_receipt: node.oracle_receipt,
    })),
    l2_artifact_commands: [
      ...orderedNodes.map(({ evidence }) => evidence.command),
      input.completion.command,
    ],
    chart_documents: chartDocuments,
    report_document: reportDocument,
    authority: input.authority,
    public_event_id: deterministicAnalysisUuid(
      `falcon24-analysis-publication-event\0${input.lease.run_id}\0${input.program.program_hash}`,
    ),
  });
  return Object.freeze({
    command,
    chart_documents: Object.freeze(chartDocuments),
    report_document: reportDocument,
    report_ref: reportDocument.artifact_ref,
  });
}

export const governedAnalysisRuntimeInternals = Object.freeze({
  publishedChartSchema,
  projectStagedAnalysisChart,
  requestedAnalysisMetricIds,
});
