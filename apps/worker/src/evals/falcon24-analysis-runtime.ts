import { type ArtifactReference, artifactReferenceSchema } from "@data-agent/contracts/artifacts";
import type { ResearchArtifactAuthorityPort } from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { falcon24AnalysisOutputJsonSchema } from "@data-agent/evals";
import type { SqlPool } from "@data-agent/platform/persistence";
import { z } from "zod";
import {
  type AnalysisLifecyclePersistenceAuthority,
  createResearchAnalysisLifecycleAuthorityPort,
} from "../analysis/analysis-lifecycle-authority.js";
import { createRunBoundDeepSeekAnalysisAgentModel } from "../analysis/deepseek-analysis-agent.js";
import { deterministicAnalysisUuid } from "../analysis/deterministic-id.js";
import {
  type AnalysisArtifactCommitPort,
  createAnalysisProgramExecutor,
} from "../analysis/executor.js";
import type { GovernedAgentAnalysisPort } from "../analysis/governed-agent-analysis-port.js";
import {
  type AnalysisInputSensitiveArtifactAuthority,
  createAnalysisInputMaterializer,
  resolveAnalysisInputEncryption,
} from "../analysis/input-materializer.js";
import {
  type AnalysisPythonSourceAuthorityPort,
  createAnalysisPythonSourceArtifactPort,
  resolveAnalysisPythonSourceEncryption,
} from "../analysis/python-source-artifact.js";
import {
  type AnalysisGovernedResultPersistenceAuthority,
  createResearchAnalysisArtifactPort,
  createResearchGovernedResultAuthorityPort,
} from "../analysis/research-artifact-port.js";
import { createEnvironmentOpenSandboxAnalysisRuntime } from "../runs/opensandbox-analysis-runtime.js";
import type { ResearchAuthorityCapabilityResolver } from "../runs/research-authority-capabilities.js";
import type { Falcon24AnalysisAcceptanceRecorder } from "./falcon24-analysis-acceptance-recorder.js";
import { createFalcon24AnalysisDataOracle } from "./falcon24-analysis-data-oracle.js";
import { falcon24AnalysisProgramInternals } from "./falcon24-analysis-program.js";
import {
  FALCON24_ANALYSIS_QUERY_SPECS,
  type Falcon24AnalysisQueryColumn,
} from "./falcon24-analysis-queries.js";
import { createFalcon24ArrowBackedAnalysisOracle } from "./falcon24-arrow-backed-analysis-oracle.js";
import { createFalcon24ExactQueryEvidenceAuthority } from "./falcon24-exact-query-evidence-authority.js";
import {
  createFalcon24GovernedAgentAnalysisPort,
  type Falcon24PublicArtifactPort,
} from "./falcon24-governed-agent-analysis.js";
import { createFalcon24GovernedAnalysisQueryPort } from "./falcon24-governed-query-port.js";
import { buildFalcon24SemanticConsumptionProjection } from "./falcon24-semantic-catalog.js";

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

type Falcon24ResearchAuthority = ResearchArtifactAuthorityPort &
  AnalysisSystemArtifactAuthority &
  AnalysisGovernedResultPersistenceAuthority &
  AnalysisLifecyclePersistenceAuthority &
  AnalysisPythonSourceAuthorityPort;

function schemaType(column: Falcon24AnalysisQueryColumn) {
  if (column.kind === "FLOAT64") return "NUMBER" as const;
  if (column.kind === "DATE") return "DATE" as const;
  return "STRING" as const;
}

function referenceFactory() {
  const systemReference = (input: {
    readonly artifact_type: "SandboxExecutionReceipt";
    readonly label: string;
    readonly content_hash: `sha256:${string}`;
    readonly lease: RunWorkLease;
  }) =>
    artifactReferenceSchema.parse({
      artifact_id: deterministicAnalysisUuid(
        `falcon24-analysis-system\0${input.lease.run_id}\0${input.artifact_type}\0${input.label}`,
      ),
      artifact_type: input.artifact_type,
      ...input.lease.scope,
      run_id: input.lease.run_id,
      revision: 1,
      content_hash: input.content_hash,
    });
  return Object.freeze({
    createSystem: systemReference,
    createOutput(input: {
      readonly lease: RunWorkLease;
      readonly analysis_program_ref: ArtifactReference;
      readonly node_id: string;
      readonly artifact_name: string;
      readonly artifact_kind: "RESULT" | "TABLE" | "CHART";
      readonly content_hash: `sha256:${string}`;
    }) {
      const programRef = input.analysis_program_ref;
      return {
        artifact_id: deterministicAnalysisUuid(
          `falcon24-analysis-output\0${programRef.run_id}\0${programRef.artifact_id}\0${input.node_id}\0${input.artifact_kind}\0${input.artifact_name}`,
        ),
        artifact_type: "SandboxResult" as const,
        app_id: programRef.app_id,
        tenant_id: programRef.tenant_id,
        environment: programRef.environment,
        run_id: programRef.run_id,
        revision: 1,
        content_hash: input.content_hash,
      };
    },
  });
}

export function createFalcon24AnalysisRuntime(input: {
  readonly pool: SqlPool;
  readonly research_authority: Falcon24ResearchAuthority;
  readonly sensitive_artifacts: AnalysisInputSensitiveArtifactAuthority;
  readonly research_capabilities: ResearchAuthorityCapabilityResolver;
  readonly app_capability_input: unknown;
  readonly public_artifacts: Falcon24PublicArtifactPort;
  readonly environment: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly acceptance_recorder?: Falcon24AnalysisAcceptanceRecorder | null;
}): GovernedAgentAnalysisPort {
  const inputEncryption = resolveAnalysisInputEncryption(input.environment);
  if (!inputEncryption) throw new TypeError("ANALYSIS_INPUT_ENCRYPTION_CONFIG_REQUIRED");
  const sourceEncryption = resolveAnalysisPythonSourceEncryption(input.environment);
  if (!sourceEncryption) throw new TypeError("ANALYSIS_PYTHON_SOURCE_ENCRYPTION_CONFIG_REQUIRED");
  const sandboxRuntime = createEnvironmentOpenSandboxAnalysisRuntime(input.environment);
  if (!sandboxRuntime) throw new TypeError("ANALYSIS_OPENSANDBOX_RUNTIME_REQUIRED");
  const now = input.now ?? (() => new Date());
  const artifacts: AnalysisArtifactCommitPort = createResearchAnalysisArtifactPort({
    authority: input.research_authority,
    capabilities: input.research_capabilities,
    now,
  });
  const materializer = createAnalysisInputMaterializer({
    sensitive_artifacts: input.sensitive_artifacts,
    analysis_artifacts: artifacts,
    capability_input: input.app_capability_input,
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
  const snapshotAuthority = createFalcon24AnalysisDataOracle(input.pool);

  return createFalcon24GovernedAgentAnalysisPort({
    artifacts,
    public_artifacts: input.public_artifacts,
    public_artifact_capability: input.app_capability_input,
    ...(input.acceptance_recorder !== undefined
      ? { acceptance_recorder: input.acceptance_recorder }
      : {}),
    diagnostics(event) {
      console.error(JSON.stringify(event));
    },
    create_executor(runtime) {
      const datasourceId = z
        .uuid()
        .parse(runtime.semantic_context.package.semantic_release.datasource_id);
      const spec = FALCON24_ANALYSIS_QUERY_SPECS[runtime.test_case.case_id];
      const evidenceAuthority = createFalcon24ExactQueryEvidenceAuthority({
        analysis_context: runtime.analysis_context,
        datasource_id: datasourceId,
        research_artifacts: input.research_authority,
        capabilities: input.research_capabilities,
      });
      const queries = createFalcon24GovernedAnalysisQueryPort({
        pool: input.pool,
        snapshot_authority: snapshotAuthority,
        evidence_authority: evidenceAuthority,
        materializer,
        now,
      });
      const contexts = {
        async load(command: { readonly node: { readonly node_id: string } }) {
          if (command.node.node_id !== runtime.test_case.case_id) {
            throw new TypeError("FALCON24_ANALYSIS_GENERATION_CONTEXT_INVALID");
          }
          return {
            semantic_context_package: runtime.semantic_context.package,
            analysis_contract: {
              schema_version: "governed-analysis-contract@2.0.0" as const,
              case_id: runtime.test_case.case_id,
              statistical_method_contract:
                falcon24AnalysisProgramInternals.method_contracts[runtime.test_case.case_id],
              required_method_evidence_keys: runtime.test_case.required_methods,
              semantic_contract: await buildFalcon24SemanticConsumptionProjection({
                test_case: runtime.test_case,
                semantic_release_hash:
                  runtime.semantic_context.package.semantic_release.resource_hash,
              }),
              output_json_schema: falcon24AnalysisOutputJsonSchema(runtime.test_case.case_id),
            },
            input_schemas: [
              {
                input_name: spec.input_name,
                format: "ARROW" as const,
                row_count_upper_bound: spec.expected_rows,
                fields: spec.columns.map((column) => ({
                  name: column.name,
                  data_type: schemaType(column),
                  nullable: column.nullable,
                })),
              },
            ],
          };
        },
      };
      return createAnalysisProgramExecutor({
        artifacts,
        governed_results: governedResults,
        lifecycle,
        queries,
        contexts,
        model: createRunBoundDeepSeekAnalysisAgentModel(runtime.provider_dispatch),
        oracle: createFalcon24ArrowBackedAnalysisOracle(),
        sandbox: sandboxRuntime,
        fence_guard: runtime.fence_guard,
        references: referenceFactory(),
        diagnostics(event) {
          console.error(JSON.stringify(event));
        },
        progress(event) {
          console.info(JSON.stringify(event));
        },
        now,
      });
    },
  });
}

export const falcon24AnalysisRuntimeInternals = Object.freeze({ referenceFactory, schemaType });
