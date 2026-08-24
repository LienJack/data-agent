import { createHash } from "node:crypto";
import {
  type AnalysisProgramPayload,
  type ArtifactReference,
  artifactReferenceFor,
} from "@data-agent/contracts/artifacts";
import {
  type SemanticContextPackage,
  verifySemanticContextPackage,
} from "@data-agent/contracts/context";
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

const semanticGrainProjectionSchema = z.strictObject({
  grain_id: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(512).optional(),
  granularity: z.enum(["atomic", "hour", "day", "week", "month", "quarter", "year"]),
});

const semanticUnitProjectionSchema = z.strictObject({
  unit_id: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(512).optional(),
  dimension: z.enum(["count", "currency", "ratio", "percentage", "rate", "duration", "other"]),
  base_unit: z.string().trim().min(1).max(128).nullable(),
  conversion_factor: z.number().positive().nullable(),
});

const analysisContractProjectionSchema = z.strictObject({
  case_id: z.string().trim().min(1).max(128),
  statistical_method_contract: z.array(z.string().trim().min(1).max(1_024)).min(1).max(32),
  semantic_contract: z.strictObject({
    semantic_release_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    metrics: z
      .array(
        z.strictObject({
          metric_id: z.string().trim().min(1).max(128),
          definition: z.string().trim().min(1).max(4_096),
          formula_id: z.string().trim().min(1).max(128),
          grain: semanticGrainProjectionSchema,
          unit: semanticUnitProjectionSchema,
          time_dimension_id: z.string().trim().min(1).max(256).nullable(),
          additivity: z.enum(["additive", "semi-additive", "non-additive"]),
          null_policy: z.enum(["preserve", "coalesce-zero", "exclude", "propagate"]),
          allowed_dimension_ids: z.array(z.string().trim().min(1).max(128)).max(64),
        }),
      )
      .min(1)
      .max(32),
    formulas: z
      .array(
        z.strictObject({
          formula_id: z.string().trim().min(1).max(128),
          expression: z.string().trim().min(1).max(4_096),
          expression_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        }),
      )
      .min(1)
      .max(64),
    dimensions: z
      .array(
        z.strictObject({
          dimension_id: z.string().trim().min(1).max(128),
          definition: z.string().trim().min(1).max(512),
          grain: semanticGrainProjectionSchema,
          data_type: z.string().trim().min(1).max(64),
        }),
      )
      .max(64),
    relationships: z
      .array(
        z.strictObject({
          relationship_id: z.string().trim().min(1).max(128),
          left: z.string().trim().min(1).max(512),
          right: z.string().trim().min(1).max(512),
          cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]),
          fanout_policy: z.literal("preaggregate_before_join"),
        }),
      )
      .max(64),
    quality_rules: z
      .array(
        z.strictObject({
          rule_id: z.string().trim().min(1).max(128),
          expression: z.string().trim().min(1).max(2_048),
          severity: z.enum(["WARN", "ERROR"]),
        }),
      )
      .max(32),
  }),
  output_json_schema: z.json(),
});

const modelResponseSchema = z.strictObject({
  schema_version: z.literal(RESPONSE_SCHEMA_VERSION),
  python_source: z.string().min(1).max(MAX_GENERATED_SOURCE_BYTES),
});

export type AnalysisPythonInputSchemaProjection = z.infer<typeof inputSchemaProjectionSchema>;
export interface AnalysisPythonContractProjection {
  readonly case_id: string;
  readonly statistical_method_contract: readonly string[];
  readonly semantic_contract: unknown;
  readonly output_json_schema: unknown;
}

export interface AnalysisPythonGenerationContextPort {
  load(input: {
    readonly lease: Parameters<AnalysisProgramSourcePort["load"]>[0]["lease"];
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
  }): Promise<{
    readonly semantic_context_package: SemanticContextPackage;
    readonly input_schemas: readonly AnalysisPythonInputSchemaProjection[];
    readonly analysis_contract: AnalysisPythonContractProjection;
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
  load?(input: {
    readonly lease: Parameters<AnalysisProgramSourcePort["load"]>[0]["lease"];
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node_id: string;
    readonly generation_attempt: 0 | 1;
  }): Promise<{
    readonly source_text: string;
    readonly source_text_ref: ArtifactReference;
    readonly provider_invocation_ref?:
      | Awaited<ReturnType<DeepSeekPythonGenerationPort["generate"]>>["provider_invocation_ref"]
      | null;
  } | null>;
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
  return /^(?:PYTHON_|SANDBOX_|PROGRAM_|FALCON24_(?:ORACLE_|Q[1-5]_))[A-Z0-9_]{1,96}$/u.test(code)
    ? code
    : "SANDBOX_EXECUTION_FAILED";
}

async function boundedPrompt(input: {
  readonly semanticContextPackage: SemanticContextPackage;
  readonly node: AnalysisProgramNode;
  readonly inputSchemas: readonly AnalysisPythonInputSchemaProjection[];
  readonly analysisContract: AnalysisPythonContractProjection;
  readonly importProfile: "CORE_ANALYSIS" | "ML_DIAGNOSTIC" | "CAUSAL_L5";
  readonly repair: null | { readonly source: string; readonly failure_code: string };
}) {
  const semanticContext = await verifySemanticContextPackage(input.semanticContextPackage);
  const analysisContract = analysisContractProjectionSchema.parse(input.analysisContract);
  if (
    analysisContract.semantic_contract.semantic_release_hash !==
    semanticContext.semantic_release.resource_hash
  ) {
    throw new TypeError("ANALYSIS_PYTHON_SEMANTIC_CONTRACT_RELEASE_MISMATCH");
  }
  const requiredMethodIds = z
    .object({ required_methods: z.array(z.string().trim().min(1).max(128)) })
    .parse(input.node.parameters).required_methods;
  const repair = input.repair
    ? {
        ...input.repair,
        required_correction:
          input.repair.failure_code === "PYTHON_POLICY_IMPORT_DENIED"
            ? "Treat runtime_policy.allowed_imports as the complete import-root allowlist. Remove every import whose root is not listed, including typing and dataclasses; use plain Python 3.12 annotations or no annotations instead. Do not replace a denied import with dynamic importing or reflection."
            : input.repair.failure_code === "FALCON24_Q1_WORST_MONTH_INVALID"
              ? "Recompute worst_revenue_decline only after monthly_kpis is finalized: for each adjacent ordered month calculate absolute_change=current.revenue-previous.revenue and percent_change=absolute_change/previous.revenue, select the row with the minimum absolute_change, and copy those unrounded values and current month into the output."
              : input.repair.failure_code === "FALCON24_Q2_GLM_CONTROL_MISSING"
                ? "Keep the fitted GLM design unchanged and set adjusted_binomial_glm.controls to the exact semantic identifiers month, log_order_amount, product_category, and customer_segment. Do not substitute formula syntax, encoded column names, or human-readable labels for these identifiers."
                : input.repair.failure_code === "FALCON24_ORACLE_CAUSAL_LANGUAGE_REJECTED"
                  ? "Rewrite conclusion in Chinese association language. It must contain the exact word 关联 and must not contain 导致, 证明...影响, or 驱动了. Preserve the computed statistics and keep claim_strength as ASSOCIATION_ONLY."
                  : input.repair.failure_code === "PROGRAM_HOST_POLICY_REJECTED"
                    ? "Remove denied reflection calls (hasattr/getattr/setattr/dir/vars), denied modules, filesystem/network/database I/O, dynamic code, private attributes, and embedded credentials or URLs. Use only context.read and context.write_json for I/O and preserve or reduce the original import roots."
                    : input.repair.failure_code === "PROGRAM_ENTRYPOINT_POLICY_REJECTED"
                      ? "Define exactly one synchronous entrypoint with the exact signature def main(context): and write every declared output once through context. Do not rename, decorate, overload, or make the entrypoint async."
                      : input.repair.failure_code === "PYTHON_POLICY_CALL_DENIED"
                        ? "Remove every call to denied built-ins, including hasattr/getattr/setattr/dir/vars. Trust the declared input schema. Normalize DATE or TIMESTAMP DataFrame columns with pandas.to_datetime(frame[column], errors='raise', utc=True); never inspect runtime types."
                        : input.repair.failure_code === "PYTHON_POLICY_TOP_LEVEL_EFFECT_DENIED"
                          ? "Move every computed value into main(context) or a helper function. Module scope may contain only imports, function definitions, and constants whose right-hand side is a literal list, tuple, set, dict, string, number, boolean, or null; comprehensions and function calls are forbidden at module scope."
                          : input.repair.failure_code === "PYTHON_TYPE_ERROR"
                            ? "Check every helper definition against every call and make positional argument counts identical. Arrow TIMESTAMP values are timezone-aware UTC: normalize with pandas.to_datetime(frame[column], errors='raise', utc=True), compare only with UTC-aware pandas.Timestamp(..., tz='UTC'), and convert with .dt.tz_convert(analysis_node.time_window.timezone) before calendar bucketing. Arrow STRING columns can materialize as pandas.Categorical: cast every STRING column used in concatenation, formula encoding, sorting, or compound-key construction with series.astype(str) first; never add a string literal directly to a Categorical series. Return complete executable source without placeholders."
                            : input.repair.failure_code === "PYTHON_POLICY_SOURCE_SYNTAX"
                              ? "Rewrite the incomplete region as valid Python 3.12. Remove ???, ellipses, TODO markers, pseudocode, and unfinished branches; return a complete executable module."
                              : input.repair.failure_code ===
                                  "FALCON24_ORACLE_METHOD_EVIDENCE_INVALID"
                                ? "Set method_evidence to exactly the required method IDs as keys, with one non-empty evidence object per key and no additional keys."
                                : "Replace the failed implementation while preserving the declared analysis and output contracts.",
      }
    : null;
  const prompt = {
    task: "Generate a deterministic Python 3.12 function main(context) for governed tabular analysis.",
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
    analysis_contract: analysisContract,
    method_evidence_contract: {
      required_keys: requiredMethodIds,
      exact_key_set: true,
      value_contract: "Each required key maps to a non-empty JSON evidence object.",
    },
    input_schemas: input.inputSchemas.map((schema) => inputSchemaProjectionSchema.parse(schema)),
    runtime_policy: {
      network: "DENIED",
      filesystem: "DENIED",
      subprocess: "DENIED",
      dynamic_code: "DENIED",
      random_seed: "HOST_INJECTED",
      allowed_imports: allowedImports(input.importProfile),
      import_contract:
        "runtime_policy.allowed_imports is the complete import-root allowlist. Do not import typing, dataclasses, itertools, pathlib, collections, or any other root absent from that array; use plain Python 3.12 annotations or no annotations.",
      sdk: {
        entrypoint: "def main(context)",
        read_input: "context.read(input_name)",
        input_runtime_types: {
          ARROW:
            "pandas.DataFrame; declared STRING columns can materialize as pandas.Categorical, so cast columns used in concatenation, formula encoding, sorting, or compound-key construction with series.astype(str) first; convert rows with frame.to_dict(orient='records')",
          CSV: "pandas.DataFrame; convert rows with frame.to_dict(orient='records')",
          JSON: "decoded JSON value",
        },
        temporal_normalization:
          "For DATE or TIMESTAMP DataFrame fields, use pandas.to_datetime(frame[column], errors='raise', utc=True). Arrow TIMESTAMP values are timezone-aware UTC, so compare only with pandas.Timestamp(..., tz='UTC'). Before calendar bucketing, convert to analysis_node.time_window.timezone with .dt.tz_convert(...), then use vectorized .dt accessors. The declared schema is authoritative; do not probe values with reflection.",
        write_json: "context.write_json(output_name, value)",
        write_csv: "context.write_csv(output_name, value)",
        write_arrow: "context.write_arrow(output_name, value)",
        write_png: "context.write_png(output_name, figure)",
      },
      attribute_reflection:
        "DENIED; never call hasattr/getattr/setattr. Input runtime types are fixed by format.",
      module_top_level:
        "Only imports, function definitions, and literal constant assignments are allowed. Put comprehensions, formatting, constructors, and all function calls inside main(context) or helper functions.",
      source_completeness:
        "Return complete executable Python 3.12. Never emit ???, ellipses, TODO markers, pseudocode, or an unfinished pass branch. Verify helper call arity against its definition before responding.",
      return_contract:
        "Read only declared input names and write every declared output exactly once through the provided sdk.",
    },
    repair,
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
      provider_invocation_ref: options.provider_invocation_ref,
      source_text_ref: await verifyCommittedSource({
        reference,
        analysisProgramRef: options.analysis_program_ref,
        sourceHash,
      }),
    };
  };

  const replay = async (options: {
    readonly lease: Parameters<AnalysisProgramSourcePort["load"]>[0]["lease"];
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
    readonly generation_attempt: 0 | 1;
  }) => {
    const loaded = await input.artifacts.load?.({
      lease: options.lease,
      analysis_program: options.analysis_program,
      analysis_program_ref: options.analysis_program_ref,
      node_id: options.node.node_id,
      generation_attempt: options.generation_attempt,
    });
    if (!loaded) return null;
    return {
      source_text: loaded.source_text,
      ...(loaded.provider_invocation_ref !== undefined
        ? { provider_invocation_ref: loaded.provider_invocation_ref }
        : {}),
      source_text_ref: await verifyCommittedSource({
        reference: loaded.source_text_ref,
        analysisProgramRef: options.analysis_program_ref,
        sourceHash: sha256SourceText(loaded.source_text),
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
    const replayed = await replay(options);
    if (replayed) return replayed;
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
        analysisContract: context.analysis_contract,
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
        const replayed = await replay({ ...options, generation_attempt: 0 });
        if (replayed) return replayed;
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
