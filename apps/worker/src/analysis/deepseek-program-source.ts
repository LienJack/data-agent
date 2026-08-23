import { createHash } from "node:crypto";
import {
  type AnalysisProgramPayload,
  type ArtifactReference,
  artifactReferenceFor,
  type SemanticContextPackage,
  verifySemanticContextPackage,
} from "@data-agent/contracts";
import { z } from "zod";
import type { AnalysisProgramSourcePort } from "./executor.js";
import { type AnalysisSkillCatalog, DEFAULT_ANALYSIS_SKILL_CATALOG } from "./skill-catalog.js";

const DEEPSEEK_PROVIDER = "deepseek" as const;
const DEEPSEEK_PYTHON_MODEL = "deepseek-v4-flash" as const;
const RESPONSE_SCHEMA_VERSION = "analysis-python-source@1.0.0" as const;
const MAX_GENERATED_SOURCE_BYTES = 100_000;

function sha256SourceText(sourceText: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(sourceText, "utf8").digest("hex")}`;
}

type AnalysisProgramNode = AnalysisProgramPayload["nodes"][number];

const inputSchemaProjectionSchema = z.strictObject({
  input_name: z.string().trim().min(1).max(128),
  format: z.enum(["JSON", "CSV", "ARROW"]),
  row_count_upper_bound: z.number().int().nonnegative().max(5_000),
  fields: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(256),
        data_type: z.enum(["BOOLEAN", "DATE", "INTEGER", "NUMBER", "STRING", "TIMESTAMP"]),
        nullable: z.boolean(),
      }),
    )
    .max(512),
});

const modelResponseSchema = z.strictObject({
  schema_version: z.literal(RESPONSE_SCHEMA_VERSION),
  python_source: z.string().min(1).max(MAX_GENERATED_SOURCE_BYTES),
});

export type AnalysisPythonInputSchemaProjection = z.infer<typeof inputSchemaProjectionSchema>;

export interface AnalysisPythonGenerationContextPort {
  load(input: {
    readonly lease: Parameters<AnalysisProgramSourcePort["load"]>[0]["lease"];
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
  }): Promise<{
    readonly semantic_context_package: SemanticContextPackage;
    readonly input_schemas: readonly AnalysisPythonInputSchemaProjection[];
  }>;
}

export interface DeepSeekPythonGenerationPort {
  generate(input: {
    readonly lease: Parameters<AnalysisProgramSourcePort["load"]>[0]["lease"];
    readonly analysis_program_ref: ArtifactReference;
    readonly node_id: string;
    readonly generation_attempt: 0 | 1;
    readonly provider: typeof DEEPSEEK_PROVIDER;
    readonly model_id: typeof DEEPSEEK_PYTHON_MODEL;
    readonly response_schema_version: typeof RESPONSE_SCHEMA_VERSION;
    readonly system: string;
    readonly prompt: string;
    readonly max_output_tokens: 8_192;
  }): Promise<{
    readonly provider: typeof DEEPSEEK_PROVIDER;
    readonly model_id: typeof DEEPSEEK_PYTHON_MODEL;
    readonly output_text: string;
    readonly provider_invocation_ref: {
      readonly resource_id: string;
      readonly resource_revision: 1;
      readonly resource_hash: `sha256:${string}`;
    };
  }>;
}

export interface AnalysisPythonSourceArtifactPort {
  commit(input: {
    readonly lease: Parameters<AnalysisProgramSourcePort["load"]>[0]["lease"];
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node_id: string;
    readonly generation_attempt: 0 | 1;
    readonly provider_invocation_ref:
      | Awaited<ReturnType<DeepSeekPythonGenerationPort["generate"]>>["provider_invocation_ref"]
      | null;
    readonly source_sha256: `sha256:${string}`;
    readonly source_text: string;
  }): Promise<ArtifactReference>;
}

export interface StandardAnalysisProgramPort {
  load(programName: string): Promise<string>;
}

function modelOutput(outputText: string): z.infer<typeof modelResponseSchema> {
  const trimmed = outputText.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  return modelResponseSchema.parse(JSON.parse(withoutFence));
}

function allowedImports(profile: "CORE_ANALYSIS" | "ML_DIAGNOSTIC" | "CAUSAL_L5") {
  const common = ["json", "math", "statistics", "numpy", "pandas"];
  if (profile === "CORE_ANALYSIS") return common;
  if (profile === "ML_DIAGNOSTIC") {
    return [...common, "scipy", "sklearn", "statsmodels"];
  }
  return [...common, "scipy", "sklearn", "statsmodels", "dowhy", "networkx"];
}

function scrubFailureCode(code: string): string {
  return /^(?:PYTHON_|SANDBOX_|PROGRAM_)[A-Z0-9_]{1,96}$/u.test(code)
    ? code
    : "SANDBOX_EXECUTION_FAILED";
}

async function boundedPrompt(input: {
  readonly semanticContextPackage: SemanticContextPackage;
  readonly node: AnalysisProgramNode;
  readonly inputSchemas: readonly AnalysisPythonInputSchemaProjection[];
  readonly importProfile: "CORE_ANALYSIS" | "ML_DIAGNOSTIC" | "CAUSAL_L5";
  readonly repair: null | { readonly source: string; readonly failure_code: string };
}) {
  const semanticContext = await verifySemanticContextPackage(input.semanticContextPackage);
  const prompt = {
    task: "Generate a deterministic Python 3.12 function main(sdk) for governed tabular analysis.",
    semantic_context: {
      package_hash: semanticContext.package_hash,
      semantic_domain: semanticContext.semantic_domain,
      question_hash: semanticContext.question_hash,
      release_hash: semanticContext.semantic_release.resource_hash,
      route: semanticContext.route_decision.route,
      selected_metric_id: semanticContext.route_decision.selected_metric_id,
      selected_ontology_ids: semanticContext.route_decision.selected_ontology_ids,
      mandatory_object_ids: semanticContext.mandatory_closure.object_ids,
      mandatory_relationship_ids: semanticContext.mandatory_closure.relationship_ids,
      analysis_capabilities: semanticContext.analysis_capabilities,
      evidence_summaries: semanticContext.evidence.map((evidence) => ({
        evidence_kind: evidence.evidence_kind,
        evidence_id: evidence.evidence_id,
        evidence_hash: evidence.evidence_hash,
        summary: evidence.summary,
      })),
    },
    analysis_node: {
      node_id: input.node.node_id,
      skill_id: input.node.skill_id,
      metric_refs: input.node.metric_refs.map(({ node_id: nodeId }) => nodeId),
      dimension_refs: input.node.dimension_refs,
      time_window: input.node.time_window,
      comparison_window: input.node.comparison_window,
      parameters: input.node.parameters,
      output_contract: input.node.output_contract,
    },
    input_schemas: input.inputSchemas.map((schema) => inputSchemaProjectionSchema.parse(schema)),
    runtime_policy: {
      network: "DENIED",
      filesystem: "DENIED",
      subprocess: "DENIED",
      dynamic_code: "DENIED",
      random_seed: "HOST_INJECTED",
      allowed_imports: allowedImports(input.importProfile),
      sdk: {
        entrypoint: "def main(sdk)",
        read_input: "sdk.read(input_name)",
        write_json: "sdk.write_json(output_name, value)",
        write_csv: "sdk.write_csv(output_name, value)",
        write_arrow: "sdk.write_arrow(output_name, value)",
        write_png: "sdk.write_png(output_name, figure)",
      },
      return_contract:
        "Read only declared input names and write every declared output exactly once through the provided sdk.",
    },
    repair: input.repair,
  } as const;
  return JSON.stringify(prompt);
}

async function verifyCommittedSource(input: {
  readonly reference: ArtifactReference;
  readonly analysisProgramRef: ArtifactReference;
  readonly sourceHash: `sha256:${string}`;
}) {
  const reference = artifactReferenceFor("SensitiveExecutionArtifact").parse(input.reference);
  if (
    reference.app_id !== input.analysisProgramRef.app_id ||
    reference.tenant_id !== input.analysisProgramRef.tenant_id ||
    reference.environment !== input.analysisProgramRef.environment ||
    reference.run_id !== input.analysisProgramRef.run_id ||
    reference.content_hash !== input.sourceHash
  ) {
    throw new TypeError("ANALYSIS_PYTHON_SOURCE_ARTIFACT_MISMATCH");
  }
  return reference;
}

export function createDeepSeekAnalysisProgramSource(input: {
  readonly contexts: AnalysisPythonGenerationContextPort;
  readonly model: DeepSeekPythonGenerationPort;
  readonly artifacts: AnalysisPythonSourceArtifactPort;
  readonly standard_programs: StandardAnalysisProgramPort;
  readonly catalog?: AnalysisSkillCatalog;
}): AnalysisProgramSourcePort {
  const catalog = input.catalog ?? DEFAULT_ANALYSIS_SKILL_CATALOG;

  const commit = async (options: {
    readonly lease: Parameters<AnalysisProgramSourcePort["load"]>[0]["lease"];
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
    readonly generation_attempt: 0 | 1;
    readonly provider_invocation_ref:
      | Awaited<ReturnType<DeepSeekPythonGenerationPort["generate"]>>["provider_invocation_ref"]
      | null;
    readonly source_text: string;
  }) => {
    if (Buffer.byteLength(options.source_text, "utf8") > MAX_GENERATED_SOURCE_BYTES) {
      throw new TypeError("ANALYSIS_PYTHON_SOURCE_TOO_LARGE");
    }
    const sourceHash = sha256SourceText(options.source_text);
    const reference = await input.artifacts.commit({
      lease: options.lease,
      analysis_program: options.analysis_program,
      analysis_program_ref: options.analysis_program_ref,
      node_id: options.node.node_id,
      generation_attempt: options.generation_attempt,
      provider_invocation_ref: options.provider_invocation_ref,
      source_sha256: sourceHash,
      source_text: options.source_text,
    });
    return {
      source_text: options.source_text,
      source_text_ref: await verifyCommittedSource({
        reference,
        analysisProgramRef: options.analysis_program_ref,
        sourceHash,
      }),
    };
  };

  const generate = async (options: {
    readonly lease: Parameters<AnalysisProgramSourcePort["load"]>[0]["lease"];
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
    readonly generation_attempt: 0 | 1;
    readonly repair: null | { readonly source: string; readonly failure_code: string };
  }) => {
    const descriptor = catalog.resolve(options.node.skill_id);
    const context = await input.contexts.load({
      lease: options.lease,
      analysis_program: options.analysis_program,
      analysis_program_ref: options.analysis_program_ref,
      node: options.node,
    });
    const semanticContext = await verifySemanticContextPackage(context.semantic_context_package);
    if (semanticContext.package_hash !== options.analysis_program.semantic_context_package_hash) {
      throw new TypeError("ANALYSIS_PYTHON_SEMANTIC_CONTEXT_MISMATCH");
    }
    const response = await input.model.generate({
      lease: options.lease,
      analysis_program_ref: options.analysis_program_ref,
      node_id: options.node.node_id,
      generation_attempt: options.generation_attempt,
      provider: DEEPSEEK_PROVIDER,
      model_id: DEEPSEEK_PYTHON_MODEL,
      response_schema_version: RESPONSE_SCHEMA_VERSION,
      system:
        "You generate governed analytics code only. Return exact JSON. Never request network, files, credentials, raw database access, or additional authority.",
      prompt: await boundedPrompt({
        semanticContextPackage: semanticContext,
        node: options.node,
        inputSchemas: context.input_schemas,
        importProfile: descriptor.python_import_profile,
        repair: options.repair,
      }),
      max_output_tokens: 8_192,
    });
    if (response.provider !== DEEPSEEK_PROVIDER || response.model_id !== DEEPSEEK_PYTHON_MODEL) {
      throw new TypeError("ANALYSIS_PYTHON_MODEL_IDENTITY_MISMATCH");
    }
    return commit({
      ...options,
      provider_invocation_ref: response.provider_invocation_ref,
      source_text: modelOutput(response.output_text).python_source,
    });
  };

  return Object.freeze({
    async load(options: Parameters<AnalysisProgramSourcePort["load"]>[0]) {
      const descriptor = catalog.resolve(options.node.skill_id);
      if (options.node.execution_mode === "FROZEN_TEMPLATE") {
        if (!options.standard_program || descriptor.standard_program !== options.standard_program) {
          throw new TypeError("ANALYSIS_STANDARD_PROGRAM_MISMATCH");
        }
        return commit({
          ...options,
          generation_attempt: 0,
          provider_invocation_ref: null,
          source_text: await input.standard_programs.load(options.standard_program),
        });
      }
      return generate({ ...options, generation_attempt: 0, repair: null });
    },
    async repair(options: Parameters<NonNullable<AnalysisProgramSourcePort["repair"]>>[0]) {
      return generate({
        ...options,
        generation_attempt: 1,
        repair: {
          source: options.previous_source_text,
          failure_code: scrubFailureCode(options.failure_code),
        },
      });
    },
  });
}

export const deepSeekAnalysisProgramSourceInternals = Object.freeze({
  provider: DEEPSEEK_PROVIDER,
  model_id: DEEPSEEK_PYTHON_MODEL,
  response_schema_version: RESPONSE_SCHEMA_VERSION,
  sha256SourceText,
  scrubFailureCode,
});
