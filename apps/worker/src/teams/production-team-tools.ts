import {
  type ArtifactReference,
  type ArtifactWorkspaceChartDocumentV2,
  artifactReferenceFor,
  buildProductTeamArtifactDocument,
  canonicalizeJson,
  type PortResult,
  type ProductTeamArtifactDocument,
  type QueryEvidenceSemanticBinding,
  sha256ContentHash,
  type Text2SqlQueryCandidate,
  text2sqlQueryCandidateSchema,
} from "@data-agent/contracts";
import { buildQueryEvidenceChartDocument } from "@data-agent/platform/artifacts";
import { z } from "zod";
import type { GovernedAgentAnalysisPort } from "../analysis/governed-agent-analysis-port.js";
import { hasRunProviderDispatchCapability } from "../runs/run-execution-context.js";
import type { FrozenSemanticReleaseReadPort } from "../semantic/semantic-release-read-port.js";
import type {
  ProductProfileToolPort,
  ProductProfileToolResult,
} from "./mastra-profile-composition.js";
import type {
  PreparedText2SqlContext,
  Text2SqlQueryRuntimePort,
} from "./postgresql-text2sql-query-runtime.js";
import {
  type ProductionTeamToolFactoryInput,
  productionTeamRuntimeInternals,
} from "./production-team-runtime.js";

const reportAnswerSchema = z.strictObject({ answer: z.string().trim().min(1).max(32_000) });

export interface ProductionTeamArtifactPort {
  commit(
    capability: unknown,
    lease: ProductionTeamToolFactoryInput["lease"],
    document: ProductTeamArtifactDocument,
  ): Promise<PortResult<ArtifactReference>>;
  commitWorkspaceChart(
    capability: unknown,
    lease: ProductionTeamToolFactoryInput["lease"],
    document: ArtifactWorkspaceChartDocumentV2,
  ): Promise<PortResult<ArtifactReference>>;
  resolveCommitted(
    capability: unknown,
    reference: ArtifactReference,
  ): Promise<PortResult<ProductTeamArtifactDocument | null>>;
}

export interface ProductionTeamToolsDependencies {
  readonly capability: unknown;
  readonly artifacts: ProductionTeamArtifactPort;
  readonly text2sql: Text2SqlQueryRuntimePort;
  readonly semantic_release: FrozenSemanticReleaseReadPort;
  readonly governed_analysis?: GovernedAgentAnalysisPort | null;
}

class ProductionTeamToolError extends Error {
  override readonly name = "ProductionTeamToolError";

  constructor(readonly code: string) {
    super(code);
  }
}

function portValue<T>(result: PortResult<T>): T {
  if (!result.ok) throw new ProductionTeamToolError(result.error.code);
  return result.value;
}

function toolResult(
  outputRef: ArtifactReference | null,
  publicArtifactRefs: readonly ArtifactReference[] = outputRef ? [outputRef] : [],
): ProductProfileToolResult {
  return Object.freeze({ output_ref: outputRef, public_artifact_refs: publicArtifactRefs });
}

function committedAt(lease: ProductionTeamToolFactoryInput["lease"]): string {
  return new Date(Date.parse(lease.expires_at) - lease.lease_duration_ms).toISOString();
}

function visualizationIntent(
  candidate: Text2SqlQueryCandidate,
): "TREND" | "COMPARISON" | "COMPOSITION" | null {
  if (candidate.presentation.visualization === "LINE") return "TREND";
  if (candidate.presentation.visualization === "BAR") return "COMPARISON";
  if (candidate.presentation.visualization === "PIE") return "COMPOSITION";
  const xColumn = candidate.result_columns.find(({ semantic_type: type }) =>
    ["STRING", "DATE", "DATETIME"].includes(type),
  );
  const hasNumericColumn = candidate.result_columns.some(
    ({ semantic_type: type }) => type === "NUMBER",
  );
  if (xColumn && hasNumericColumn) {
    return ["DATE", "DATETIME"].includes(xColumn.semantic_type) ? "TREND" : "COMPARISON";
  }
  return null;
}

function projectionDataType(
  semanticType: Text2SqlQueryCandidate["result_columns"][number]["semantic_type"],
): "STRING" | "NUMBER" | "BOOLEAN" {
  if (semanticType === "NUMBER") return "NUMBER";
  if (semanticType === "BOOLEAN") return "BOOLEAN";
  return "STRING";
}

function normalizedQueryEvidenceRows(input: {
  readonly candidate: Text2SqlQueryCandidate;
  readonly binding: QueryEvidenceSemanticBinding;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}): Readonly<Record<string, string | number | boolean | null>>[] {
  const candidateNames = input.candidate.result_columns.map(({ name }) => name);
  const bindings = input.binding.columns;
  if (
    bindings.length !== candidateNames.length ||
    bindings.some(
      (binding, index) =>
        binding.output_name !== candidateNames[index] ||
        binding.logical_type !== input.candidate.result_columns[index]?.semantic_type,
    )
  ) {
    throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_BINDING_INVALID");
  }
  const expectedKeys = [...candidateNames].sort();
  return input.rows.map((row) => {
    const observedKeys = Object.keys(row).sort();
    if (
      observedKeys.length !== expectedKeys.length ||
      observedKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_COLUMN_INVALID");
    }
    return Object.fromEntries(
      bindings.map((binding) => {
        const value = row[binding.output_name];
        if (value === null) {
          if (!binding.nullable) {
            throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_NULLABILITY_INVALID");
          }
          return [binding.output_name, null];
        }
        if (binding.logical_type === "NUMBER") {
          const integerString = typeof value === "string" && /^-?(?:0|[1-9]\d*)$/u.test(value);
          const numeric =
            typeof value === "number"
              ? value
              : typeof value === "string" &&
                  /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(value)
                ? Number(value)
                : Number.NaN;
          if (!Number.isFinite(numeric) || (integerString && !Number.isSafeInteger(numeric))) {
            throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_CELL_INVALID");
          }
          return [binding.output_name, numeric];
        }
        if (binding.logical_type === "BOOLEAN") {
          if (typeof value !== "boolean") {
            throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_CELL_INVALID");
          }
          return [binding.output_name, value];
        }
        if (typeof value !== "string") {
          throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_CELL_INVALID");
        }
        if (
          (binding.logical_type === "DATE" &&
            (!/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
              !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)))) ||
          (binding.logical_type === "DATETIME" && !Number.isFinite(Date.parse(value)))
        ) {
          throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_CELL_INVALID");
        }
        return [binding.output_name, value];
      }),
    );
  });
}

async function specialistProviderJson(input: {
  readonly factory: ProductionTeamToolFactoryInput;
  readonly stage: "SEMANTIC" | "TEXT2SQL" | "REPORT";
  readonly context_text: string;
  readonly call_index?: number;
}): Promise<unknown> {
  const expectedProfile = {
    SEMANTIC: "semantic-management-agent",
    TEXT2SQL: "governed-text2sql-agent",
    REPORT: "report-writing-agent",
  } as const;
  const delegation = input.factory.delegation;
  if (!delegation) throw new ProductionTeamToolError("ROOT_AGENT_DELEGATION_REQUIRED");
  if (delegation.profile.revision.profile_id !== expectedProfile[input.stage]) {
    throw new ProductionTeamToolError("TEAM_SPECIALIST_STAGE_PROFILE_MISMATCH");
  }
  const provider = input.factory.execution_context.getProviderDispatchCapability();
  if (!hasRunProviderDispatchCapability(provider)) {
    throw new ProductionTeamToolError("PROVIDER_DISPATCH_AUTHORITY_NOT_CONFIGURED");
  }
  const result = portValue(
    await provider.invoke({
      logical_call_id: productionTeamRuntimeInternals.identity(
        input.factory.lease.run_id,
        input.call_index && input.call_index > 0
          ? `provider:${input.stage.toLowerCase()}:repair:${input.call_index}`
          : `provider:${input.stage.toLowerCase()}`,
      ),
      turn: {
        kind: "SPECIALIST",
        stage: input.stage,
        profile_id: delegation.profile.revision.profile_id,
        objective: delegation.call.objective,
        context_text: input.context_text,
      },
    }),
  );
  try {
    return JSON.parse(result.output_text);
  } catch {
    throw new ProductionTeamToolError("TEAM_PROVIDER_RESPONSE_INVALID");
  }
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]*$/u.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)) {
    return error.message;
  }
  return fallback;
}

function repairableQueryExecutionFailure(code: string): boolean {
  return [
    "DATASOURCE_ADAPTER_EXECUTION_FAILED",
    "DATASOURCE_ADAPTER_SQL_COLUMN_NOT_FOUND",
    "DATASOURCE_ADAPTER_SQL_DATA_ERROR",
    "DATASOURCE_ADAPTER_SQL_RELATION_NOT_FOUND",
    "DATASOURCE_ADAPTER_SQL_REJECTED",
    "DATASOURCE_ADAPTER_SQL_TYPE_ERROR",
    "TEXT2SQL_RESULT_SHAPE_MISMATCH",
  ].includes(code);
}

async function commitArtifact(
  dependencies: ProductionTeamToolsDependencies,
  factoryInput: ProductionTeamToolFactoryInput,
  input: {
    readonly artifact_type: "SqlArtifact" | "QueryEvidence" | "AnalysisReport";
    readonly profile_id:
      | "governed-analysis-agent"
      | "governed-text2sql-agent"
      | "report-writing-agent"
      | "semantic-management-agent";
    readonly task_id: string;
    readonly source_refs: readonly ArtifactReference[];
    readonly provenance: ProductTeamArtifactDocument["provenance"];
    readonly projection: ProductTeamArtifactDocument["projection"];
  },
): Promise<ArtifactReference> {
  const document = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: productionTeamRuntimeInternals.identity(
        factoryInput.lease.run_id,
        `artifact:${input.task_id}:${input.artifact_type}`,
      ),
      artifact_type: input.artifact_type,
      ...factoryInput.lease.scope,
      run_id: factoryInput.lease.run_id,
      revision: 1,
      content_hash: `sha256:${"0".repeat(64)}`,
    },
    profile_id: input.profile_id,
    task_id: input.task_id,
    source_refs: input.source_refs,
    provenance: input.provenance,
    projection: input.projection,
    committed_at: committedAt(factoryInput.lease),
  });
  return portValue(
    await dependencies.artifacts.commit(dependencies.capability, factoryInput.lease, document),
  );
}

export function createProductionTeamTools(
  dependencies: ProductionTeamToolsDependencies,
  factoryInput: ProductionTeamToolFactoryInput,
): ProductProfileToolPort {
  const maxText2SqlCandidateAttempts =
    factoryInput.lease.execution_policy.max_text2sql_candidate_attempts;
  const state: {
    prepared: PreparedText2SqlContext | null;
    candidate: Text2SqlQueryCandidate | null;
    sql_ref: ArtifactReference | null;
    semantic_ref: ArtifactReference | null;
    provider_attempt_count: number;
    rejected_candidate: Text2SqlQueryCandidate | null;
    rejection_code: string | null;
  } = {
    prepared: null,
    candidate: null,
    sql_ref: null,
    semantic_ref: null,
    provider_attempt_count: 0,
    rejected_candidate: null,
    rejection_code: null,
  };

  const generateValidatedText2SqlCandidate = async (): Promise<Text2SqlQueryCandidate> => {
    if (!state.prepared) throw new ProductionTeamToolError("TEAM_TEXT2SQL_CONTEXT_REQUIRED");
    while (state.provider_attempt_count < maxText2SqlCandidateAttempts) {
      const callIndex = state.provider_attempt_count;
      const contextText =
        callIndex === 0
          ? state.prepared.context_text
          : canonicalizeJson({
              schema_version: "text2sql-repair-context@1.0.0",
              frozen_query_context: JSON.parse(state.prepared.context_text) as z.infer<
                ReturnType<typeof z.json>
              >,
              rejection: {
                attempt: callIndex,
                diagnostic_code: state.rejection_code ?? "TEXT2SQL_CANDIDATE_POLICY_REJECTED",
                rejected_candidate: state.rejected_candidate,
              },
            });
      const parsed = text2sqlQueryCandidateSchema.safeParse(
        await specialistProviderJson({
          factory: factoryInput,
          stage: "TEXT2SQL",
          context_text: contextText,
          call_index: callIndex,
        }),
      );
      state.provider_attempt_count += 1;
      if (!parsed.success) {
        throw new ProductionTeamToolError("TEAM_TEXT2SQL_CANDIDATE_INVALID");
      }
      try {
        const compiled = await dependencies.text2sql.compileCandidate({
          prepared: state.prepared,
          candidate: parsed.data,
        });
        state.candidate = compiled;
        state.rejected_candidate = null;
        state.rejection_code = null;
        return compiled;
      } catch (error) {
        state.rejected_candidate = parsed.data;
        state.rejection_code = safeErrorCode(error, "TEXT2SQL_CANDIDATE_POLICY_REJECTED");
        if (state.provider_attempt_count >= maxText2SqlCandidateAttempts) {
          throw new ProductionTeamToolError("TEAM_TEXT2SQL_CANDIDATE_POLICY_REJECTED");
        }
      }
    }
    throw new ProductionTeamToolError("TEAM_TEXT2SQL_CANDIDATE_REPAIR_EXHAUSTED");
  };

  return Object.freeze({
    async invoke(input: Parameters<ProductProfileToolPort["invoke"]>[0]) {
      if (
        input.profile.revision.profile_id !== input.task.profile_id ||
        input.task.run_id !== factoryInput.lease.run_id
      ) {
        throw new ProductionTeamToolError("TEAM_TOOL_TASK_CORRELATION_INVALID");
      }

      if (input.task.profile_id === "semantic-management-agent") {
        if (input.tool_id !== "semantic.catalog.read") {
          throw new ProductionTeamToolError("SEMANTIC_AGENT_TOOL_DENIED");
        }
        const catalog = portValue(
          await dependencies.semantic_release.read({
            capability: dependencies.capability,
            package: factoryInput.semantic_context_package,
          }),
        );
        const packageDocument = factoryInput.semantic_context_package;
        const selectedIds = new Set(packageDocument.retrieval_receipt.selected_object_ids);
        const relationshipLines = catalog.relationships.relationships.map(
          (relationship) =>
            `[${relationship.kind.toUpperCase()}] ${relationship.relationship_id} ${relationship.name}: ` +
            `${relationship.left_table_id}(${relationship.left_column_ids.join(", ")}) -> ` +
            `${relationship.right_table_id}(${relationship.right_column_ids.join(", ")}); ` +
            `cardinality=${relationship.cardinality}; fanout_closed=${String(relationship.analysis.fanout_closed)}; ` +
            `proof=${relationship.proof_kind}${relationship.proof_detail ? ` (${relationship.proof_detail})` : ""}; ` +
            `ontology_path=${relationship.analysis.ontology_path.join(" -> ") || "none"}`,
        );
        const metricLines = catalog.executable.metrics
          .filter((metric) => selectedIds.has(metric.metric_id))
          .map(
            (metric) =>
              `${metric.metric_id} ${metric.name}: aggregation=${metric.aggregation}; table=${metric.table_id}; ` +
              `column=${metric.column_id}; formula=${metric.formula?.expression ?? "none"}`,
          );
        const dimensionLines = catalog.executable.dimensions
          .filter((dimension) => selectedIds.has(dimension.dimension_id))
          .map(
            (dimension) =>
              `${dimension.dimension_id} ${dimension.name}: table=${dimension.table_id}; ` +
              `column=${dimension.column_id}; grain=${dimension.grain.grain_id}`,
          );
        const formulaLines = catalog.executable.formulas
          .filter((formula) => selectedIds.has(formula.node_id))
          .map(
            (formula) =>
              `${formula.node_id} ${formula.name}: ${canonicalizeJson(formula.expression)}`,
          );
        const retrieval = packageDocument.retrieval_receipt;
        const inference = packageDocument.inference_receipt;
        const hitLines = retrieval.hits
          .slice(0, 20)
          .map(
            (hit) =>
              `#${hit.rank} ${hit.route} ${hit.object_id} matched=${hit.matched_text} ` +
              `rrf=${hit.rrf_score.toFixed(6)}`,
          );
        const expansionLines = retrieval.expansions.map(
          (expansion) =>
            `hop=${expansion.hop} ${expansion.direction} ${expansion.source_object_id} ` +
            `-[${expansion.relationship_id}/${expansion.relationship_kind}]-> ` +
            `${expansion.target_object_id}; mandatory=${String(expansion.mandatory)}`,
        );
        const inferenceLines = inference.steps.map(
          (step) =>
            `${step.rule_id}: ${step.premise_object_ids.join(", ")} => ` +
            `${step.conclusion_object_ids.join(", ")}; path=${step.relationship_path_ids.join(" -> ") || "none"}; ` +
            `${step.explanation}`,
        );
        const semanticAnswer = reportAnswerSchema.safeParse(
          await specialistProviderJson({
            factory: factoryInput,
            stage: "SEMANTIC",
            context_text: canonicalizeJson({
              release_identity: catalog.release_identity,
              route_decision: packageDocument.route_decision,
              retrieval: {
                route_states: retrieval.route_states,
                hits: retrieval.hits,
                expansions: retrieval.expansions,
                selected_object_ids: retrieval.selected_object_ids,
                pruned_object_count: retrieval.pruned_object_ids.length,
              },
              inference,
              metrics: catalog.executable.metrics,
              dimensions: catalog.executable.dimensions,
              formulas: catalog.executable.formulas,
              relationships: catalog.relationships.relationships,
              restrictions: catalog.restrictions,
            }),
          }),
        );
        if (!semanticAnswer.success) {
          throw new ProductionTeamToolError("TEAM_SEMANTIC_RESPONSE_INVALID");
        }
        state.semantic_ref = await commitArtifact(dependencies, factoryInput, {
          artifact_type: "AnalysisReport",
          profile_id: "semantic-management-agent",
          task_id: input.task.task_id,
          source_refs: [],
          provenance: null,
          projection: {
            kind: "REPORT",
            title: "冻结语义图关系证据",
            sections: [
              {
                heading: "结论",
                body_text: semanticAnswer.data.answer,
                source_refs: [],
              },
              {
                heading: "冻结版本",
                body_text:
                  `已校验 Semantic Release ${catalog.release_identity.release_id} ` +
                  `（digest ${catalog.release_identity.release_digest}）。当前发布包含 ` +
                  `${catalog.executable.metrics.length} 个指标、${catalog.executable.dimensions.length} 个维度、` +
                  `${catalog.executable.formulas.length} 个公式、${catalog.relationships.relationships.length} 条关系、` +
                  `${catalog.restrictions.quality_constraints.length} 条质量约束。`,
                source_refs: [],
              },
              {
                heading: "召回、融合与截枝",
                body_text:
                  `route=${packageDocument.route_decision.route}; state=${packageDocument.route_decision.state}; ` +
                  `LEXICON=${retrieval.route_states.LEXICON}; SPARSE=${retrieval.route_states.SPARSE}; ` +
                  `VECTOR=${retrieval.route_states.VECTOR}; GRAPH=${retrieval.route_states.GRAPH}; ` +
                  `selected=${retrieval.selected_object_ids.length}; pruned=${retrieval.pruned_object_ids.length}.\n` +
                  (hitLines.length > 0 ? hitLines.join("\n") : "没有返回召回候选。"),
                source_refs: [],
              },
              {
                heading: "图扩展与逻辑闭包",
                body_text:
                  `closure_complete=${String(inference.closure_complete)}; ` +
                  `mandatory_objects=${inference.mandatory_object_ids.join(", ") || "none"}; ` +
                  `mandatory_relationships=${inference.mandatory_relationship_ids.join(", ") || "none"}.\n` +
                  [
                    ...(expansionLines.length > 0 ? expansionLines : ["没有新增图扩展边。"]),
                    ...(inferenceLines.length > 0 ? inferenceLines : ["没有新增逻辑推断步骤。"]),
                  ].join("\n"),
                source_refs: [],
              },
              {
                heading: "发布关系与血缘",
                body_text:
                  relationshipLines.length > 0
                    ? relationshipLines.join("\n")
                    : "该冻结 Release 没有发布关系。",
                source_refs: [],
              },
              {
                heading: "命中的指标、维度与公式",
                body_text:
                  [...metricLines, ...dimensionLines, ...formulaLines].join("\n") ||
                  "本次召回没有选中指标、维度或公式。",
                source_refs: [],
              },
              {
                heading: "时间与质量口径",
                body_text: [
                  ...catalog.restrictions.time_semantics.map(
                    (time) =>
                      `${time.time_domain_id}: ${time.min_time ?? "open"} <= time <= ${time.max_time ?? "open"}; ` +
                      `timezone=${time.timezone}; calendar=${time.calendar}`,
                  ),
                  ...catalog.restrictions.quality_constraints.map(
                    (constraint) =>
                      `${constraint.constraint_id} [${constraint.severity}/${constraint.sensitivity}]: ${constraint.expression}`,
                  ),
                ].join("\n"),
                source_refs: [],
              },
            ],
          },
        });
        return toolResult(state.semantic_ref);
      }

      if (input.task.profile_id === "governed-analysis-agent") {
        if (input.tool_id !== "analysis.program.execute") {
          throw new ProductionTeamToolError("GOVERNED_ANALYSIS_AGENT_TOOL_DENIED");
        }
        const analysis = dependencies.governed_analysis;
        if (!analysis) {
          throw new ProductionTeamToolError("GOVERNED_ANALYSIS_RUNTIME_REQUIRED");
        }
        const evidenceRef = artifactReferenceFor("QueryEvidence").safeParse(
          factoryInput.accepted_evidence_ref,
        );
        if (!evidenceRef.success) {
          throw new ProductionTeamToolError("TEAM_ACCEPTED_QUERY_EVIDENCE_REQUIRED");
        }
        const provider = factoryInput.execution_context.getProviderDispatchCapability();
        if (!hasRunProviderDispatchCapability(provider)) {
          throw new ProductionTeamToolError("PROVIDER_DISPATCH_AUTHORITY_NOT_CONFIGURED");
        }
        const result = await analysis.analyze({
          lease: factoryInput.lease,
          authority: factoryInput.authority,
          task_id: input.task.task_id,
          max_context_bytes: input.task.bounds.max_context_bytes,
          accepted_query_evidence_ref: evidenceRef.data,
          question:
            factoryInput.delegation?.call.objective ?? "Analyze the accepted QueryEvidence.",
          semantic_context: factoryInput.semantic_context,
          effective_config: factoryInput.execution_context.getEffectiveConfig(),
          provider_dispatch: provider,
          fence_guard: {
            async isCurrent(fence) {
              if (
                fence.run_id !== factoryInput.lease.run_id ||
                fence.attempt_id !== factoryInput.lease.attempt_id ||
                fence.worker_fence !== factoryInput.lease.worker_fence ||
                fence.fence_token !==
                  `${factoryInput.lease.attempt_id}:${factoryInput.lease.worker_fence}`
              ) {
                return false;
              }
              return (await factoryInput.execution_context.heartbeat()).ok;
            },
          },
        });
        const derivedEvidence = result.accepted_artifact_refs.find(
          ({ artifact_type: artifactType }) => artifactType === "DerivedAnalysisEvidence",
        );
        const chart = result.public_artifact_refs.find(
          ({ artifact_type: artifactType }) => artifactType === "ArtifactWorkspaceDocument",
        );
        const reportRef = result.accepted_artifact_refs.find(
          ({ artifact_type: artifactType }) => artifactType === "AnalysisReport",
        );
        if (!derivedEvidence || !chart || !reportRef) {
          throw new ProductionTeamToolError("GOVERNED_ANALYSIS_EVIDENCE_CLOSURE_REQUIRED");
        }
        return toolResult(reportRef, [chart, reportRef]);
      }

      if (input.task.profile_id === "governed-text2sql-agent") {
        if (input.tool_id === "semantic.release.read") {
          const semanticCatalog = portValue(
            await dependencies.semantic_release.read({
              capability: dependencies.capability,
              package: factoryInput.semantic_context_package,
            }),
          );
          state.prepared = await dependencies.text2sql.prepare({
            effective_config: factoryInput.execution_context.getEffectiveConfig(),
            semantic_context: factoryInput.semantic_context,
            semantic_catalog: semanticCatalog,
            max_context_bytes: input.task.bounds.max_context_bytes,
          });
          return toolResult(null);
        }
        if (input.tool_id === "sql.compiler.compile") {
          await generateValidatedText2SqlCandidate();
          return toolResult(null);
        }
        if (input.tool_id === "sql.sandbox.execute") {
          if (!state.prepared || !state.candidate) {
            throw new ProductionTeamToolError("TEAM_TEXT2SQL_COMPILE_REQUIRED");
          }
          const executeCandidate = (candidate: Text2SqlQueryCandidate) =>
            dependencies.text2sql.execute({
              effective_config: factoryInput.execution_context.getEffectiveConfig(),
              prepared: state.prepared as PreparedText2SqlContext,
              candidate,
              timeout_ms: Math.max(100, Math.min(30_000, input.task.bounds.timeout_ms)),
              max_rows: 10_000,
              max_bytes: Math.min(10_000_000, input.task.bounds.max_context_bytes * 64),
              ...(input.signal ? { signal: input.signal } : {}),
            });
          let execution: Awaited<ReturnType<typeof executeCandidate>>;
          try {
            execution = await executeCandidate(state.candidate);
          } catch (error) {
            const code = safeErrorCode(error, "TEXT2SQL_QUERY_EXECUTION_FAILED");
            if (
              state.provider_attempt_count >= maxText2SqlCandidateAttempts ||
              !repairableQueryExecutionFailure(code)
            ) {
              throw error;
            }
            state.rejected_candidate = state.candidate;
            state.rejection_code = code;
            state.candidate = await generateValidatedText2SqlCandidate();
            execution = await executeCandidate(state.candidate);
          }
          const result = execution.result;
          const columns = state.candidate.result_columns.map((column) => ({
            key: column.name,
            label: column.label,
            data_type: projectionDataType(column.semantic_type),
          }));
          const rows = normalizedQueryEvidenceRows({
            candidate: state.candidate,
            binding: execution.semantic_binding,
            rows: result.rows,
          });
          const effectiveConfig = factoryInput.execution_context.getEffectiveConfig();
          const [candidateHash, parametersHash] = await Promise.all([
            sha256ContentHash(state.candidate),
            sha256ContentHash(state.candidate.parameters),
          ]);
          state.sql_ref = await commitArtifact(dependencies, factoryInput, {
            artifact_type: "SqlArtifact",
            profile_id: "governed-text2sql-agent",
            task_id: input.task.task_id,
            source_refs: [],
            provenance: {
              kind: "TEXT2SQL_CANDIDATE",
              candidate_hash: candidateHash,
              parameters_hash: parametersHash,
              parameter_count: state.candidate.parameters.length,
              datasource_ref: effectiveConfig.datasource,
              schema_snapshot_ref: {
                resource_id: state.prepared.schema_snapshot_id,
                resource_hash: state.prepared.schema_snapshot_hash,
              },
              semantic_context_ref: {
                package_id: factoryInput.semantic_context_ref.package_id,
                package_hash: factoryInput.semantic_context_ref.package_hash,
              },
              target_binding_hash: state.prepared.target_capability_hash,
            },
            projection: { kind: "SQL", dialect: "postgresql", sql: state.candidate.sql },
          });
          const evidenceRef = await commitArtifact(dependencies, factoryInput, {
            artifact_type: "QueryEvidence",
            profile_id: "governed-text2sql-agent",
            task_id: input.task.task_id,
            source_refs: [state.sql_ref],
            provenance: {
              kind: "GOVERNED_QUERY_RESULT",
              query_id: result.query_id,
              request_hash: result.request_hash,
              result_hash: result.result_hash,
              row_count: result.row_count,
              byte_count: result.byte_count,
              elapsed_ms: result.elapsed_ms,
              truncated: result.truncated,
              semantic_binding: execution.semantic_binding,
            },
            projection: {
              kind: "TABLE",
              columns,
              rows,
              total_rows: result.row_count,
            },
          });
          const intent = visualizationIntent(state.candidate);
          if (!intent) return toolResult(evidenceRef);
          const evidence = portValue(
            await dependencies.artifacts.resolveCommitted(dependencies.capability, evidenceRef),
          );
          if (!evidence) throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_NOT_COMMITTED");
          const chartDocument = await buildQueryEvidenceChartDocument({
            intent,
            document_ref: {
              artifact_id: productionTeamRuntimeInternals.identity(
                factoryInput.lease.run_id,
                "artifact:ArtifactWorkspaceDocument",
              ),
              artifact_type: "ArtifactWorkspaceDocument",
              ...factoryInput.lease.scope,
              run_id: factoryInput.lease.run_id,
              revision: 1,
              content_hash: `sha256:${"0".repeat(64)}`,
            },
            evidence,
            semantic_context: {
              package_id: factoryInput.semantic_context_ref.package_id,
              package_hash: factoryInput.semantic_context_ref.package_hash,
              receipt_id: factoryInput.semantic_context_ref.receipt_id,
              receipt_hash: factoryInput.semantic_context_ref.receipt_hash,
            },
            title: state.candidate.presentation.title,
            description: state.candidate.presentation.summary,
            unit: null,
          });
          if (!chartDocument) return toolResult(evidenceRef);
          const chartRef = portValue(
            await dependencies.artifacts.commitWorkspaceChart(
              dependencies.capability,
              factoryInput.lease,
              chartDocument,
            ),
          );
          return toolResult(evidenceRef, [evidenceRef, chartRef]);
        }
        throw new ProductionTeamToolError("TEXT2SQL_AGENT_TOOL_DENIED");
      }

      if (input.task.profile_id === "report-writing-agent") {
        const evidenceRef = factoryInput.accepted_evidence_ref;
        if (evidenceRef?.artifact_type !== "QueryEvidence") {
          throw new ProductionTeamToolError("TEAM_ACCEPTED_QUERY_EVIDENCE_REQUIRED");
        }
        if (input.tool_id === "evidence.read") return toolResult(evidenceRef);
        if (input.tool_id === "report.project") {
          const evidence = portValue(
            await dependencies.artifacts.resolveCommitted(dependencies.capability, evidenceRef),
          );
          if (evidence?.projection.kind !== "TABLE") {
            throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_NOT_COMMITTED");
          }
          const parsed = reportAnswerSchema.safeParse(
            await specialistProviderJson({
              factory: factoryInput,
              stage: "REPORT",
              context_text: canonicalizeJson({
                evidence_ref: evidence.artifact_ref,
                columns: evidence.projection.columns,
                rows: evidence.projection.rows,
                total_rows: evidence.projection.total_rows,
              }),
            }),
          );
          if (!parsed.success) {
            throw new ProductionTeamToolError("TEAM_REPORT_RESPONSE_INVALID");
          }
          const reportRef = await commitArtifact(dependencies, factoryInput, {
            artifact_type: "AnalysisReport",
            profile_id: "report-writing-agent",
            task_id: input.task.task_id,
            source_refs: [evidenceRef],
            provenance: null,
            projection: {
              kind: "REPORT",
              title: "受治理数据分析报告",
              sections: [
                {
                  heading: "结论",
                  body_text: parsed.data.answer,
                  source_refs: [evidenceRef],
                },
              ],
            },
          });
          return toolResult(reportRef);
        }
        throw new ProductionTeamToolError("REPORT_AGENT_TOOL_DENIED");
      }
      throw new ProductionTeamToolError("TEAM_TOOL_PROFILE_DENIED");
    },
  });
}

export const productionTeamToolsInternals = Object.freeze({
  normalizedQueryEvidenceRows,
  repairableQueryExecutionFailure,
  safeErrorCode,
  visualizationIntent,
});
