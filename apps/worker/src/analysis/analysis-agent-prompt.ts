import type { AnalysisProgramPayload, ArtifactReference } from "@data-agent/contracts/artifacts";
import {
  type SemanticContextPackage,
  verifySemanticContextPackage,
} from "@data-agent/contracts/context";
import type { ModelProviderRequest } from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import {
  STATISTICAL_OPERATOR_MANIFEST,
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
} from "@data-agent/contracts/statistical-operators";
import { z } from "zod";
import { analysisOperatorArgumentSymbols } from "./analysis-operator-symbols.js";

type AnalysisProgramNode = AnalysisProgramPayload["nodes"][number];

const inputSchemaProjectionSchema = z.strictObject({
  input_name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u),
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
const inputBindingProjectionSchema = z.strictObject({
  input_name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u),
  input_symbol: z.string().regex(/^__da_input_[a-f0-9]{24}$/u),
  content_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  materialization_receipt_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});
const governedAnalysisContractSchema = z.strictObject({
  schema_version: z.literal("governed-analysis-contract@2.0.0"),
  case_id: z.string().trim().min(1).max(128),
  statistical_method_contract: z.array(z.string().trim().min(1).max(4_096)).max(64),
  required_method_evidence_keys: z
    .array(z.string().trim().min(1).max(128))
    .min(1)
    .max(32)
    .superRefine((keys, context) => {
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: "custom", message: "Method evidence keys must be unique." });
      }
    }),
  semantic_contract: z.json(),
  output_json_schema: z.json(),
});

export type AnalysisAgentInputSchemaProjection = z.infer<typeof inputSchemaProjectionSchema>;
export type AnalysisAgentInputBindingProjection = z.infer<typeof inputBindingProjectionSchema>;

export interface AnalysisAgentContextPort {
  load(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
  }): Promise<{
    readonly semantic_context_package: SemanticContextPackage;
    readonly analysis_contract: unknown;
    readonly input_schemas: readonly AnalysisAgentInputSchemaProjection[];
  }>;
}

function operatorCards(node: AnalysisProgramNode) {
  if (
    (node.generated_source_policy === "GOVERNED_OPERATOR_ORCHESTRATION") !==
    node.operator_obligations.length > 0
  ) {
    throw new TypeError("ANALYSIS_AGENT_OPERATOR_POLICY_MISMATCH");
  }
  return node.operator_obligations.map((obligation) => {
    const operator = STATISTICAL_OPERATOR_MANIFEST.operators.find(
      ({ operator_id }) => operator_id === obligation.operator_id,
    );
    if (!operator) throw new TypeError("ANALYSIS_AGENT_OPERATOR_NOT_REGISTERED");
    const inputKeys = operator.inputs.map(({ name }) => name);
    const parameterKeys = operator.parameters.map(({ name }) => name);
    const symbols = analysisOperatorArgumentSymbols(obligation.call_id);
    return {
      call_id: obligation.call_id,
      operator_id: obligation.operator_id,
      tool_call_contract: {
        arguments_exact: {
          call_id: obligation.call_id,
          operator_id: obligation.operator_id,
        },
        allowed_argument_fields: ["call_id", "operator_id"],
        forbidden_server_bound_fields: ["schema_version", "inputs_symbol", "parameters_symbol"],
      },
      purpose_zh: operator.description_zh,
      inputs: operator.inputs,
      parameters: operator.parameters,
      outputs: operator.outputs,
      applicability_checks: operator.applicability_checks,
      limitations: operator.limitations,
      result_binding: obligation.result_binding,
      python_preparation_contract: {
        inputs_symbol: symbols.inputs_symbol,
        inputs_symbol_python_type: "dict",
        nested_value_contract:
          "Recursively JSON-native values only: dict, list, str, bool, built-in int, finite built-in float, or None. Convert pandas Series and numpy ndarray with .tolist(), and numpy scalar values with int(), float(), or bool().",
        inputs_mapping_required_keys: inputKeys,
        inputs_mapping_example: Object.fromEntries(
          inputKeys.map((name) => [name, `<prepared_${name}_value>`]),
        ),
        parameters_symbol: symbols.parameters_symbol,
        parameters_symbol_python_type: "dict",
        parameters_mapping_allowed_keys: parameterKeys,
        parameters_mapping_example: Object.fromEntries(
          parameterKeys.map((name) => [name, `<parameter_${name}_value>`]),
        ),
        server_bound_inputs_symbol: symbols.inputs_symbol,
        server_bound_parameters_symbol: symbols.parameters_symbol,
        result_symbol: {
          python_type: "dict",
          top_level_keys: [operator.outputs.collection],
          collection_access: `result_symbol[${JSON.stringify(operator.outputs.collection)}]`,
          collection_python_type: "list[dict]",
          row_required_fields: [
            ...operator.outputs.label_fields,
            ...operator.outputs.value_fields,
            ...operator.outputs.evidence_fields,
          ],
        },
      },
    };
  });
}

export async function buildAnalysisAgentInitialMessages(input: {
  readonly analysis_program: AnalysisProgramPayload;
  readonly node: AnalysisProgramNode;
  readonly context: Awaited<ReturnType<AnalysisAgentContextPort["load"]>>;
  readonly input_bindings: readonly AnalysisAgentInputBindingProjection[];
}): Promise<ModelProviderRequest["messages"]> {
  const semantic = await verifySemanticContextPackage(input.context.semantic_context_package);
  const governedAnalysisContract = governedAnalysisContractSchema.parse(
    input.context.analysis_contract,
  );
  if (
    semantic.package_hash !== input.analysis_program.semantic_context_package_hash ||
    input.analysis_program.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST ||
    input.node.execution_mode !== "MODEL_GENERATED" ||
    input.node.generated_source_policy === "NO_GENERATED_SOURCE"
  ) {
    throw new TypeError("ANALYSIS_AGENT_CONTEXT_BINDING_INVALID");
  }
  const schemas = input.context.input_schemas.map((schema) =>
    inputSchemaProjectionSchema.parse(schema),
  );
  const bindings = new Map(
    input.input_bindings.map((binding) => {
      const parsed = inputBindingProjectionSchema.parse(binding);
      return [parsed.input_name, parsed] as const;
    }),
  );
  if (
    bindings.size !== schemas.length ||
    schemas.some(({ input_name: inputName }) => !bindings.has(inputName))
  ) {
    throw new TypeError("ANALYSIS_AGENT_INPUT_BINDING_INVALID");
  }
  const document = {
    task: "Use server-owned tools to complete the governed tabular analysis.",
    rules: [
      "Use exactly one tool call per turn. Use python_cell only for loading, transformations, checks, and creating named in-memory result/table symbols.",
      "python_cell arguments are exactly source and timeout_ms. Never send schema_version or cell_id; both are injected and validated by the server.",
      "Do not define a wrapper entrypoint. Each python_cell source is a directly executed stateful Python Cell.",
      "Do not reimplement any governed statistical formula. Invoke every statistical_operator obligation exactly once and in the declared order.",
      "Before each statistical_operator call, create the exact server-declared inputs_symbol and parameters_symbol in its python_preparation_contract. Their mapping keys must exactly follow the operator manifest. The statistical_operator arguments must equal its tool_call_contract.arguments_exact object: only call_id and operator_id. Never echo schema_version, inputs_symbol, or parameters_symbol into tool arguments.",
      "Each declared inputs_symbol and parameters_symbol must contain a Python dict, never a raw list, DataFrame, Series, ndarray, scalar, or one individual input value. Follow each obligation's python_preparation_contract names and mapping examples literally.",
      "Every nested operator input and parameter value must be recursively JSON-native: dict, list, str, bool, built-in int, finite built-in float, or None. Convert pandas Series and numpy ndarray with .tolist(), and numpy scalar values with int(), float(), or bool(); never leave pandas or numpy containers nested inside the dict.",
      "After each statistical_operator call, the server returns a protected result symbol plus hash, shape, and receipt reference. Use that exact symbol in later Python and publish_analysis_result; never copy or overwrite it.",
      "At every required result_binding path, retain the protected operator collection itself. Never round-trip governed rows through pandas before publishing: pandas converts exact null values to NaN and breaks hash/equality closure. A separate DataFrame may be used only for derived selection while the bound collection remains untouched.",
      "A protected operator result symbol exactly follows its obligation's result_symbol contract. Read the declared collection path directly; never spend a Cell printing or probing its type, keys, contents, shape, or attributes.",
      "Use each declared server-bound input symbol directly; do not open input paths or parse Arrow, CSV, or JSON yourself. Network, subprocess, package installation, credentials, database access, arbitrary paths, pickle, eval, and final artifact serialization are forbidden.",
      "Every declared server-bound input symbol is already a pandas.DataFrame. Do not call to_pandas(), read it again, or wrap it in a parser; start transformations from the bound symbol directly (a shallow copy is allowed).",
      "Use only Python stdlib plus the libraries declared by the runtime profile. CORE_ANALYSIS provides pandas, numpy, pyarrow, scipy, and matplotlib; do not probe or import optional packages such as seaborn, plotly, statsmodels, or scikit-learn.",
      "The Cell policy forbids reflection and authority-probing names including dir, globals, locals, vars, getattr, hasattr, builtins, os, pathlib, sys, and subprocess. Never use them, including while repairing a failed Cell.",
      "Treat the declared input schema as authoritative. Do not spend a Cell only printing head(), dtypes, shape, or descriptive previews; prefer one cohesive material preparation Cell per governed operator, with assertions embedded in that Cell.",
      "Every Python assertion must include a data-free uppercase identifier as its message, for example assert condition, 'MONTH_COUNT_INVALID'. Never include values, rows, paths, or other data in an assertion message.",
      "If a Cell reports KeyError, correct the code using only the exact names in inputs[].fields from this context. Do not probe the interpreter or reread the governed input file.",
      "For rates, deltas, ratios, shares, and percentage changes, handle zero or missing denominators explicitly and preserve an undefined result as null/NaN rather than raising or inventing a numeric value.",
      "Set result.method_evidence to an object containing exactly governed_analysis_contract.required_method_evidence_keys. Preserve each governed operator collection at its declared result_binding path; for every other method key, record the concrete window, grain, selection, tie-break, or quality rule actually applied. Do not omit non-operator methods and do not add undeclared method keys.",
      "Do not write result JSON, tables, PNG, SVG, or chart files. The only completion action is publish_analysis_result. Supply result/table symbol names plus chart id and field selections only; the server injects chart intent, template, and data-symbol binding from the result contract.",
      "Preserve governed numeric values without rounding. Build every required table symbol with exactly the declared columns, then publish once. Explain only after the server verifies and stages the entire result closure.",
      "For every table, use contract.tables[].columns[].key as the sole column authority. A similarly named result-object field does not authorize a table column; when a method contract declares a projection mapping, copy the value into the exact table key before publishing.",
      "Treat result_contract.collection_constraints as executable result invariants: append an item to the declared collection only when every all_items predicate is true. Do not append a failed item under a fallback status.",
      "When a table projection mode is RESULT_COLLECTION, build the table from exactly that result collection using every declared column mapping. The table and collection must have the same row multiset; do not add, omit, or independently filter rows.",
    ],
    semantic_context: {
      package_hash: semantic.package_hash,
      semantic_domain: semantic.semantic_domain,
      question_hash: semantic.question_hash,
      release_hash: semantic.semantic_release.resource_hash,
      route: semantic.route_decision.route,
      selected_metric_id: semantic.route_decision.selected_metric_id,
      selected_ontology_ids: semantic.route_decision.selected_ontology_ids,
      mandatory_object_ids: semantic.mandatory_closure.object_ids,
      mandatory_relationship_ids: semantic.mandatory_closure.relationship_ids,
      analysis_capabilities: semantic.analysis_capabilities,
      evidence_summaries: semantic.evidence.map((evidence) => ({
        evidence_kind: evidence.evidence_kind,
        evidence_id: evidence.evidence_id,
        evidence_hash: evidence.evidence_hash,
        summary: evidence.summary,
      })),
    },
    analysis_node: {
      node_id: input.node.node_id,
      skill_id: input.node.skill_id,
      metric_ids: input.node.metric_refs.map(({ node_id }) => node_id),
      dimension_ids: input.node.dimension_refs,
      time_window: input.node.time_window,
      comparison_window: input.node.comparison_window,
      parameters: input.node.parameters,
      result_contract: input.node.result_contract,
    },
    governed_analysis_contract: governedAnalysisContract,
    inputs: schemas.map((schema) => {
      const binding = bindings.get(schema.input_name);
      if (!binding) throw new TypeError("ANALYSIS_AGENT_INPUT_BINDING_INVALID");
      return {
        ...schema,
        binding: {
          symbol: binding.input_symbol,
          content_sha256: binding.content_sha256,
          materialization_receipt_hash: binding.materialization_receipt_hash,
          shape: {
            rows_upper_bound: schema.row_count_upper_bound,
            columns: schema.fields.length,
          },
          python_value_type: "pandas.DataFrame",
        },
      };
    }),
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    operator_obligations: operatorCards(input.node),
  } as const;
  const prompt = JSON.stringify(document);
  if (Buffer.byteLength(prompt, "utf8") > 200_000) {
    throw new TypeError("ANALYSIS_AGENT_CONTEXT_TOO_LARGE");
  }
  return [
    {
      role: "system",
      content:
        "You are the governed Python analysis agent. You may create bounded in-memory Python values, but server statistical operators and the server-owned Result Publisher are the only formula and artifact authorities. Never request extra authority or write final artifacts.",
    },
    { role: "user", content: prompt },
  ];
}

export const analysisAgentPromptInternals = Object.freeze({ operatorCards });
