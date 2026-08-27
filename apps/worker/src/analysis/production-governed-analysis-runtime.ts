import {
  type AnalysisProgramPayload,
  type ArtifactReference,
  artifactReferenceSchema,
  type QueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { AnalysisContext } from "@data-agent/contracts/context";
import type { ResearchArtifactAuthorityPort } from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { createEnvironmentOpenSandboxAnalysisRuntime } from "../runs/opensandbox-analysis-runtime.js";
import type { ResearchAuthorityCapabilityResolver } from "../runs/research-authority-capabilities.js";
import type { FrozenSemanticReleaseReadPort } from "../semantic/semantic-release-read-port.js";
import {
  type AnalysisLifecyclePersistenceAuthority,
  createResearchAnalysisLifecycleAuthorityPort,
} from "./analysis-lifecycle-authority.js";
import { createRunBoundDeepSeekAnalysisAgentModel } from "./deepseek-analysis-agent.js";
import { deterministicAnalysisUuid } from "./deterministic-id.js";
import { type AnalysisArtifactCommitPort, createAnalysisProgramExecutor } from "./executor.js";
import type { GovernedAgentAnalysisPort } from "./governed-agent-analysis-port.js";
import {
  createGovernedAnalysisRuntime,
  type GovernedAnalysisMethodRegistryPort,
} from "./governed-analysis-runtime.js";
import {
  type AnalysisInputSensitiveArtifactAuthority,
  createAnalysisInputMaterializer,
  resolveAnalysisInputEncryption,
} from "./input-materializer.js";
import {
  createProductTeamGovernedAnalysisQueryPort,
  type ProductTeamAnalysisArtifactAuthority,
} from "./product-team-query-port.js";
import {
  type AnalysisPythonSourceAuthorityPort,
  createAnalysisPythonSourceArtifactPort,
  resolveAnalysisPythonSourceEncryption,
} from "./python-source-artifact.js";
import {
  type AnalysisGovernedResultPersistenceAuthority,
  createResearchAnalysisArtifactPort,
  createResearchGovernedResultAuthorityPort,
} from "./research-artifact-port.js";
import { createSingleSeriesAnalysisOracle } from "./single-series-analysis-oracle.js";
import { compileSingleSeriesAnalysisPlan } from "./single-series-analysis-planning.js";

interface AnalysisSystemArtifactAuthority {
  commitAnalysisSystem(
    capabilityInput: unknown,
    command: unknown,
    content: Uint8Array | null,
  ): Promise<
    | { readonly ok: true; readonly created: boolean; readonly reference: ArtifactReference }
    | { readonly ok: false; readonly error_code: string }
  >;
}

type ProductionAnalysisResearchAuthority = ResearchArtifactAuthorityPort &
  AnalysisSystemArtifactAuthority &
  AnalysisGovernedResultPersistenceAuthority &
  AnalysisLifecyclePersistenceAuthority &
  AnalysisPythonSourceAuthorityPort;

export const FALCON24_SINGLE_SERIES_TREND_METHOD_ID = "published-single-series-trend@1" as const;

function referenceFactory() {
  return Object.freeze({
    createSystem(input: {
      readonly artifact_type: "SandboxExecutionReceipt";
      readonly label: string;
      readonly content_hash: `sha256:${string}`;
      readonly lease: RunWorkLease;
    }) {
      return artifactReferenceSchema.parse({
        artifact_id: deterministicAnalysisUuid(
          `falcon24-analysis-system\0${input.lease.run_id}\0${input.artifact_type}\0${input.label}`,
        ),
        artifact_type: input.artifact_type,
        ...input.lease.scope,
        run_id: input.lease.run_id,
        revision: 1,
        content_hash: input.content_hash,
      });
    },
    createOutput(input: {
      readonly lease: RunWorkLease;
      readonly analysis_program_ref: ArtifactReference;
      readonly node_id: string;
      readonly artifact_name: string;
      readonly artifact_kind: "RESULT" | "TABLE" | "CHART";
      readonly content_hash: `sha256:${string}`;
    }) {
      return artifactReferenceSchema.parse({
        artifact_id: deterministicAnalysisUuid(
          `falcon24-analysis-output\0${input.lease.run_id}\0${input.analysis_program_ref.artifact_id}\0${input.node_id}\0${input.artifact_kind}\0${input.artifact_name}`,
        ),
        artifact_type: "SandboxResult",
        ...input.lease.scope,
        run_id: input.lease.run_id,
        revision: 1,
        content_hash: input.content_hash,
      });
    },
  });
}

function inputFieldType(
  logicalType: QueryEvidenceSemanticBinding["columns"][number]["logical_type"],
) {
  if (logicalType === "NUMBER") return "NUMBER" as const;
  if (logicalType === "BOOLEAN") return "BOOLEAN" as const;
  if (logicalType === "DATE") return "DATE" as const;
  if (logicalType === "DATETIME") return "TIMESTAMP" as const;
  return "STRING" as const;
}

async function questionFrameRef(input: {
  readonly lease: RunWorkLease;
  readonly task_id: string;
  readonly question: string;
}) {
  const artifactId = deterministicAnalysisUuid(
    `falcon24-analysis-question-frame\0${input.lease.run_id}\0${input.task_id}`,
  );
  return artifactReferenceSchema.parse({
    artifact_id: artifactId,
    artifact_type: "QuestionFrame",
    ...input.lease.scope,
    run_id: input.lease.run_id,
    revision: 1,
    content_hash: await sha256ContentHash({
      artifact_type: "QuestionFrame",
      question: input.question.normalize("NFKC").trim(),
    }),
  }) as ArtifactReference & { readonly artifact_type: "QuestionFrame" };
}

function methodRegistry(): GovernedAnalysisMethodRegistryPort {
  return Object.freeze({
    async resolve(methodInput: Parameters<GovernedAnalysisMethodRegistryPort["resolve"]>[0]) {
      const plan = await compileSingleSeriesAnalysisPlan({
        question: methodInput.question,
        question_frame_ref: await questionFrameRef({
          lease: methodInput.lease,
          task_id: methodInput.task_id,
          question: methodInput.question,
        }),
        context: methodInput.context,
        query_evidence_ref: methodInput.query_evidence_ref,
        query_evidence_document: methodInput.query_evidence_document,
      });
      return Object.freeze([
        Object.freeze({
          method_id: FALCON24_SINGLE_SERIES_TREND_METHOD_ID,
          skill_id: "trend-change@1" as const,
          result_contract: plan.result_contract,
          required_operator_obligations: plan.required_operator_obligations,
        }),
      ]);
    },
  });
}

function analysisContextPort(input: {
  readonly question: string;
  readonly semantic_context_package: Parameters<
    GovernedAgentAnalysisPort["analyze"]
  >[0]["semantic_context"]["package"];
  readonly context: AnalysisContext;
  readonly binding: QueryEvidenceSemanticBinding;
}) {
  return Object.freeze({
    async load(command: { readonly node: AnalysisProgramPayload["nodes"][number] }) {
      return {
        semantic_context_package: input.semantic_context_package,
        analysis_contract: {
          schema_version: "governed-analysis-contract@3.0.0" as const,
          objective: input.question,
          result_contract_hash: command.node.result_contract.contract_hash,
          required_operator_ids: [
            ...new Set(
              command.node.operator_obligations.map(({ operator_id: operatorId }) => operatorId),
            ),
          ],
          semantic_contract: {
            context_hash: input.context.context_hash,
            semantic_context_package_hash: input.context.semantic_context_binding.package_hash,
            metric_refs: command.node.metric_refs,
            dimension_refs: command.node.dimension_refs,
            formula_hashes: input.context.metrics
              .filter(({ metric_ref: reference }) =>
                command.node.metric_refs.some(
                  ({ node_id: nodeId }) => nodeId === reference.node_id,
                ),
              )
              .map(({ metric_ref: reference, formula_hash: formulaHash }) => ({
                metric_id: reference.node_id,
                formula_hash: formulaHash,
              })),
          },
        },
        input_schemas: [
          {
            input_name: "query_evidence",
            format: "ARROW" as const,
            row_count_upper_bound: 5_000,
            fields: input.binding.columns.map((column) => ({
              name: column.output_name,
              data_type: inputFieldType(column.logical_type),
              nullable: column.nullable,
            })),
          },
        ],
      };
    },
  });
}

/**
 * Builds the only production governed-analysis runtime. Missing authority, encryption,
 * or OpenSandbox configuration keeps the Profile unavailable; it never selects a legacy path.
 */
export function createProductionGovernedAnalysisRuntime(input: {
  readonly research_authority: ProductionAnalysisResearchAuthority;
  readonly research_capabilities: ResearchAuthorityCapabilityResolver | null;
  readonly sensitive_artifacts: AnalysisInputSensitiveArtifactAuthority;
  readonly public_artifacts: ProductTeamAnalysisArtifactAuthority;
  readonly public_artifact_capability: unknown;
  readonly semantic_release: FrozenSemanticReleaseReadPort;
  readonly environment: NodeJS.ProcessEnv;
  readonly now?: () => Date;
}): GovernedAgentAnalysisPort | null {
  if (!input.research_capabilities) return null;
  const inputEncryption = resolveAnalysisInputEncryption(input.environment);
  const sourceEncryption = resolveAnalysisPythonSourceEncryption(input.environment);
  if (!inputEncryption || !sourceEncryption) return null;
  if (!createEnvironmentOpenSandboxAnalysisRuntime(input.environment)) return null;

  const now = input.now ?? (() => new Date());
  const artifacts: AnalysisArtifactCommitPort = createResearchAnalysisArtifactPort({
    authority: input.research_authority,
    capabilities: input.research_capabilities,
    now,
  });
  const materializer = createAnalysisInputMaterializer({
    sensitive_artifacts: input.sensitive_artifacts,
    product_artifacts: input.public_artifacts,
    analysis_artifacts: artifacts,
    capability_input: input.public_artifact_capability,
    encryption_key: inputEncryption.key,
    encryption_key_id: inputEncryption.key_id,
  });
  const sourceArtifacts = createAnalysisPythonSourceArtifactPort({
    authority: input.research_authority,
    commit_capability_input: input.research_capabilities.forDomain("PLANNING"),
    replay_capability_input: input.research_capabilities.forDomain("EVIDENCE"),
    encryption_key: sourceEncryption.key,
    encryption_key_id: sourceEncryption.key_id,
    now,
  });
  const governedResults = createResearchGovernedResultAuthorityPort({
    authority: input.research_authority,
    capabilities: input.research_capabilities,
    source_artifacts: sourceArtifacts,
  });
  const lifecycle = createResearchAnalysisLifecycleAuthorityPort({
    authority: input.research_authority,
    capabilities: input.research_capabilities,
    now,
  });

  return createGovernedAnalysisRuntime({
    artifacts,
    artifact_authority: input.public_artifacts,
    artifact_capability: input.public_artifact_capability,
    semantic_release: input.semantic_release,
    method_registry: methodRegistry(),
    create_executor(runtime) {
      const sandbox = createEnvironmentOpenSandboxAnalysisRuntime(input.environment, {
        max_file_transfer_attempts:
          runtime.command.lease.execution_policy.max_file_transfer_attempts,
      });
      if (!sandbox) throw new TypeError("ANALYSIS_OPENSANDBOX_RUNTIME_REQUIRED");
      const authority = {
        semantic_release_ref: runtime.query_evidence_binding.semantic_release_ref,
        semantic_context_ref: runtime.query_evidence_binding.semantic_context_ref,
        schema_snapshot_ref: runtime.query_evidence_binding.schema_snapshot_ref,
        datasource_ref: runtime.query_evidence_binding.datasource_ref,
        target_binding_hash: runtime.query_evidence_binding.target_binding_hash,
      };
      return createAnalysisProgramExecutor({
        artifacts,
        governed_results: governedResults,
        lifecycle,
        queries: createProductTeamGovernedAnalysisQueryPort({
          query_evidence_ref: runtime.command.accepted_query_evidence_ref,
          artifact_authority: input.public_artifacts,
          artifact_capability: input.public_artifact_capability,
          materializer,
          expected_authority: authority,
        }),
        contexts: analysisContextPort({
          question: runtime.command.question,
          semantic_context_package: runtime.command.semantic_context.package,
          context: runtime.analysis_context,
          binding: runtime.query_evidence_binding,
        }),
        model: createRunBoundDeepSeekAnalysisAgentModel(runtime.command.provider_dispatch),
        oracle: createSingleSeriesAnalysisOracle(),
        sandbox,
        fence_guard: runtime.command.fence_guard,
        references: referenceFactory(),
        diagnostics(event) {
          console.error(JSON.stringify(event));
        },
        progress(event) {
          console.info(JSON.stringify(event));
        },
        repair_budget_per_category:
          runtime.command.lease.execution_policy.analysis_repair_budget_per_category,
        allow_stage_recovery: runtime.command.lease.execution_policy.allow_stage_recovery,
        now,
      });
    },
    diagnostics(event) {
      console.error(JSON.stringify(event));
    },
  });
}

export const productionGovernedAnalysisRuntimeInternals = Object.freeze({
  analysisContextPort,
  inputFieldType,
  methodRegistry,
  questionFrameRef,
  referenceFactory,
});
