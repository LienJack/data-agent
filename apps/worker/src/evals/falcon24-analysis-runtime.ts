import { type ArtifactReference, artifactReferenceSchema } from "@data-agent/contracts/artifacts";
import { FALCON24_STRICT_ACCEPTANCE_POLICY_ID } from "@data-agent/contracts/evals";
import type { ResearchArtifactAuthorityPort } from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { falcon24AnalysisOutputJsonSchema } from "@data-agent/evals";
import type { SqlPool } from "@data-agent/platform/persistence";
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
import { resolveFalcon24AnalysisCase } from "./falcon24-analysis-case-resolver.js";
import { createFalcon24AnalysisDataOracle } from "./falcon24-analysis-data-oracle.js";
import { falcon24AnalysisProgramInternals } from "./falcon24-analysis-program.js";
import {
  FALCON24_ANALYSIS_QUERY_SPECS,
  type Falcon24AnalysisQueryColumn,
} from "./falcon24-analysis-queries.js";
import { createFalcon24ArrowBackedAnalysisOracle } from "./falcon24-arrow-backed-analysis-oracle.js";
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

export function isFalcon24StrictAnalysisLease(lease: RunWorkLease): boolean {
  const policy = lease.execution_policy;
  return (
    policy.policy_id === FALCON24_STRICT_ACCEPTANCE_POLICY_ID &&
    policy.mode === "FALCON24_STRICT" &&
    policy.campaign_id !== null &&
    policy.case_id !== null &&
    policy.run_variant !== null &&
    policy.repetition !== null &&
    policy.max_run_attempts === 1 &&
    policy.max_provider_attempts_per_call === 1 &&
    policy.max_root_turns === 1 &&
    policy.max_text2sql_candidate_attempts === 1 &&
    policy.analysis_repair_budget_per_category === 0 &&
    policy.max_file_transfer_attempts === 1 &&
    !policy.allow_stage_recovery &&
    policy.hold_on_failure
  );
}

function assertFalcon24AnalysisLeasePolicy(lease: RunWorkLease): string {
  if (!isFalcon24StrictAnalysisLease(lease)) {
    throw new TypeError("FALCON24_ANALYSIS_RUN_EXECUTION_POLICY_MISMATCH");
  }
  const caseId = lease.execution_policy.case_id;
  if (!caseId) throw new TypeError("FALCON24_ANALYSIS_RUN_EXECUTION_POLICY_MISMATCH");
  return caseId;
}

function assertFalcon24ResolvedCase(policyCaseId: string, resolvedCaseId: string): void {
  if (policyCaseId !== resolvedCaseId) {
    throw new TypeError("FALCON24_ANALYSIS_RUN_EXECUTION_POLICY_MISMATCH");
  }
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
  if (!createEnvironmentOpenSandboxAnalysisRuntime(input.environment)) {
    throw new TypeError("ANALYSIS_OPENSANDBOX_RUNTIME_REQUIRED");
  }
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

  const falcon24 = createFalcon24GovernedAgentAnalysisPort({
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
      const sandboxRuntime = createEnvironmentOpenSandboxAnalysisRuntime(input.environment, {
        max_file_transfer_attempts: runtime.lease.execution_policy.max_file_transfer_attempts,
      });
      if (!sandboxRuntime) throw new TypeError("ANALYSIS_OPENSANDBOX_RUNTIME_REQUIRED");
      const spec = FALCON24_ANALYSIS_QUERY_SPECS[runtime.test_case.case_id];
      const queries = createFalcon24GovernedAnalysisQueryPort({
        query_evidence_ref: runtime.accepted_query_evidence_ref,
        artifact_authority: input.public_artifacts,
        artifact_capability: input.app_capability_input,
        snapshot_authority: snapshotAuthority,
        materializer,
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
        repair_budget_per_category:
          runtime.lease.execution_policy.analysis_repair_budget_per_category,
        allow_stage_recovery: runtime.lease.execution_policy.allow_stage_recovery,
        now,
      });
    },
  });
  return Object.freeze({
    analyze(command: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]) {
      const policyCaseId = assertFalcon24AnalysisLeasePolicy(command.lease);
      const testCase = resolveFalcon24AnalysisCase(command.semantic_context.package);
      assertFalcon24ResolvedCase(policyCaseId, testCase.case_id);
      return falcon24.analyze({
        ...command,
        test_case: testCase,
      });
    },
  });
}

export const falcon24AnalysisRuntimeInternals = Object.freeze({
  assertFalcon24AnalysisLeasePolicy,
  assertFalcon24ResolvedCase,
  referenceFactory,
  schemaType,
});
