import {
  type ArtifactReference,
  artifactReferenceSchema,
  type ResearchArtifactAuthorityPort,
  type RunWorkLease,
} from "@data-agent/contracts";
import { falcon24AnalysisOutputJsonSchema } from "@data-agent/evals";
import type { SqlPool } from "@data-agent/platform/persistence";
import { z } from "zod";
import { createRunBoundDeepSeekPythonGenerationProvider } from "../analysis/deepseek-generation-provider.js";
import { createDeepSeekAnalysisProgramSource } from "../analysis/deepseek-program-source.js";
import { deterministicAnalysisUuid } from "../analysis/deterministic-id.js";
import {
  type AnalysisArtifactCommitPort,
  createAnalysisProgramExecutor,
} from "../analysis/executor.js";
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
import { createResearchAnalysisArtifactPort } from "../analysis/research-artifact-port.js";
import type { PythonSandboxClient } from "../runs/python-sandbox-client.js";
import type { GovernedAgentAnalysisPort } from "../teams/direct-qa-analysis-executor.js";
import { createFalcon24AnalysisDataOracle } from "./falcon24-analysis-data-oracle.js";
import { falcon24AnalysisProgramInternals } from "./falcon24-analysis-program.js";
import {
  FALCON24_ANALYSIS_QUERY_SPECS,
  type Falcon24AnalysisQueryColumn,
} from "./falcon24-analysis-queries.js";
import { createFalcon24ArrowBackedAnalysisOracle } from "./falcon24-arrow-backed-analysis-oracle.js";
import { createFalcon24ExactQueryEvidenceAuthority } from "./falcon24-exact-query-evidence-authority.js";
import { createFalcon24GovernedAgentAnalysisPort } from "./falcon24-governed-agent-analysis.js";
import { createFalcon24GovernedAnalysisQueryPort } from "./falcon24-governed-query-port.js";

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
  AnalysisPythonSourceAuthorityPort;

function schemaType(column: Falcon24AnalysisQueryColumn) {
  if (column.kind === "FLOAT64") return "NUMBER" as const;
  return /(?:_date|date$|month$)/u.test(column.name) ? ("DATE" as const) : ("STRING" as const);
}

function referenceFactory() {
  const systemReference = (input: {
    readonly artifact_type: "SandboxProgram" | "SandboxExecutionReceipt";
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
    create(input: {
      readonly name: string;
      readonly type: string;
      readonly program: { readonly analysis_program_ref: ArtifactReference };
    }) {
      const programRef = input.program.analysis_program_ref;
      return {
        name: input.name,
        artifact_id: deterministicAnalysisUuid(
          `falcon24-analysis-output\0${programRef.run_id}\0${programRef.artifact_id}\0${input.name}`,
        ),
        artifact_type: "SandboxResult" as const,
        app_id: programRef.app_id,
        tenant_id: programRef.tenant_id,
        environment: programRef.environment,
        run_id: programRef.run_id,
        revision: 1,
      };
    },
  });
}

function required(value: string | undefined, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new TypeError(code);
  return normalized;
}

export function createFalcon24AnalysisRuntime(input: {
  readonly pool: SqlPool;
  readonly research_authority: Falcon24ResearchAuthority;
  readonly sensitive_artifacts: AnalysisInputSensitiveArtifactAuthority;
  readonly research_capability_input: unknown;
  readonly app_capability_input: unknown;
  readonly datasource_id: string;
  readonly sandbox: PythonSandboxClient;
  readonly environment: NodeJS.ProcessEnv;
  readonly now?: () => Date;
}): GovernedAgentAnalysisPort {
  const datasourceId = z.uuid().parse(input.datasource_id);
  const inputEncryption = resolveAnalysisInputEncryption(input.environment);
  if (!inputEncryption) throw new TypeError("ANALYSIS_INPUT_ENCRYPTION_CONFIG_REQUIRED");
  const sourceEncryption = resolveAnalysisPythonSourceEncryption(input.environment);
  if (!sourceEncryption) throw new TypeError("ANALYSIS_PYTHON_SOURCE_ENCRYPTION_CONFIG_REQUIRED");
  const sandboxAuthorization = required(
    input.environment.PYTHON_SANDBOX_AUTH_TOKEN,
    "ANALYSIS_PYTHON_SANDBOX_AUTHORIZATION_REQUIRED",
  );
  if (sandboxAuthorization.length < 32 || sandboxAuthorization.length > 512) {
    throw new TypeError("ANALYSIS_PYTHON_SANDBOX_AUTHORIZATION_INVALID");
  }
  const now = input.now ?? (() => new Date());
  const artifacts: AnalysisArtifactCommitPort = createResearchAnalysisArtifactPort({
    authority: input.research_authority,
    capability_input: input.research_capability_input,
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
    capability_input: input.research_capability_input,
    encryption_key: sourceEncryption.key,
    encryption_key_id: sourceEncryption.key_id,
    now,
  });
  const snapshotAuthority = createFalcon24AnalysisDataOracle(input.pool);

  return createFalcon24GovernedAgentAnalysisPort({
    datasource_id: datasourceId,
    artifacts,
    create_executor(runtime) {
      const spec = FALCON24_ANALYSIS_QUERY_SPECS[runtime.test_case.case_id];
      const evidenceAuthority = createFalcon24ExactQueryEvidenceAuthority({
        analysis_context: runtime.analysis_context,
        datasource_id: datasourceId,
        research_artifacts: input.research_authority,
        capability_input: input.research_capability_input,
      });
      const queries = createFalcon24GovernedAnalysisQueryPort({
        pool: input.pool,
        snapshot_authority: snapshotAuthority,
        evidence_authority: evidenceAuthority,
        materializer,
        now,
      });
      const programs = createDeepSeekAnalysisProgramSource({
        contexts: {
          async load(command) {
            if (command.node.node_id !== runtime.test_case.case_id) {
              throw new TypeError("FALCON24_ANALYSIS_GENERATION_CONTEXT_INVALID");
            }
            return {
              semantic_context_package: runtime.semantic_context.package,
              analysis_contract: {
                case_id: runtime.test_case.case_id,
                statistical_method_contract:
                  falcon24AnalysisProgramInternals.method_contracts[runtime.test_case.case_id],
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
        },
        model: createRunBoundDeepSeekPythonGenerationProvider(runtime.provider_dispatch),
        artifacts: sourceArtifacts,
        standard_programs: {
          async load() {
            throw new TypeError("FALCON24_STANDARD_PROGRAM_FORBIDDEN");
          },
        },
      });
      return createAnalysisProgramExecutor({
        artifacts,
        queries,
        programs,
        oracle: createFalcon24ArrowBackedAnalysisOracle(),
        sandbox: input.sandbox,
        sandbox_authorization: sandboxAuthorization,
        fence_guard: runtime.fence_guard,
        references: referenceFactory(),
        now,
      });
    },
  });
}

export const falcon24AnalysisRuntimeInternals = Object.freeze({ referenceFactory, schemaType });
