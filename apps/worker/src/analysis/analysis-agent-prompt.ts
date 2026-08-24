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

export type AnalysisAgentInputSchemaProjection = z.infer<typeof inputSchemaProjectionSchema>;

export interface AnalysisAgentContextPort {
  load(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
  }): Promise<{
    readonly semantic_context_package: SemanticContextPackage;
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
    return {
      call_id: obligation.call_id,
      operator_id: obligation.operator_id,
      purpose_zh: operator.description_zh,
      inputs: operator.inputs,
      parameters: operator.parameters,
      outputs: operator.outputs,
      applicability_checks: operator.applicability_checks,
      limitations: operator.limitations,
      result_binding: obligation.result_binding,
    };
  });
}

export async function buildAnalysisAgentInitialMessages(input: {
  readonly analysis_program: AnalysisProgramPayload;
  readonly node: AnalysisProgramNode;
  readonly context: Awaited<ReturnType<AnalysisAgentContextPort["load"]>>;
}): Promise<ModelProviderRequest["messages"]> {
  const semantic = await verifySemanticContextPackage(input.context.semantic_context_package);
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
  const document = {
    task: "Use server-owned tools to complete the governed tabular analysis.",
    rules: [
      "Use exactly one tool call per turn. Use python_cell only for loading, transformations, checks, and creating named in-memory result/table symbols.",
      "Do not define a wrapper entrypoint. Each python_cell source is a directly executed stateful Python Cell.",
      "Do not reimplement any governed statistical formula. Invoke every statistical_operator obligation exactly once and in the declared order.",
      "Before each statistical_operator call, create one inputs mapping symbol whose keys exactly match the operator manifest inputs and one parameters mapping symbol whose keys exactly match its parameters. Pass only those two Python symbol names to the tool; never send arrays, rows, or parameter values through tool arguments.",
      "After each statistical_operator call, the server returns a protected result symbol plus hash, shape, and receipt reference. Use that exact symbol in later Python and publish_analysis_result; never copy or overwrite it.",
      "Read only the declared /workspace/inputs files. Network, subprocess, package installation, credentials, database access, arbitrary paths, pickle, eval, and final artifact serialization are forbidden.",
      "Do not write result JSON, tables, PNG, SVG, or chart files. The only completion action is publish_analysis_result with allowlisted symbol names and contract-declared table/chart bindings.",
      "Preserve governed numeric values without rounding. Build every required table symbol with exactly the declared columns, then publish once. Explain only after the server verifies and stages the entire result closure.",
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
    inputs: schemas.map((schema) => ({
      ...schema,
      path: `/workspace/inputs/${schema.input_name}.${schema.format.toLowerCase()}`,
    })),
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
