import { createHash } from "node:crypto";
import {
  buildSemanticAssertionCandidate,
  type SemanticAssertionCandidate,
  type SemanticAssertionTargetKind,
  type SemanticChangeSet,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24AgentAnalysisAcceptanceSuite,
  FALCON24_SEMANTIC_RELEASE_BLUEPRINT,
} from "@data-agent/evals";
import {
  compileSemanticChangeSet,
  freezeSemanticChangeSetForReview,
} from "@data-agent/semantic/production";
import {
  FALCON24_DIMENSIONS,
  FALCON24_FORMULA_ALIASES,
  FALCON24_METRICS,
  FALCON24_QUALITY_CONSTRAINTS,
  FALCON24_RELATIONSHIPS,
  falcon24FormulaExpression,
} from "./falcon24-semantic-catalog.js";

type Falcon24Scope = SemanticAssertionCandidate["scope"];

const commonNode = {
  node_version: 1,
  aliases: [],
  owner_ref: "falcon24-semantic-owner",
  lifecycle: "ACTIVE" as const,
  evidence_refs: [],
  tags: ["falcon24"],
};

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function targetKindFor(key: string): SemanticAssertionTargetKind {
  if (key.startsWith("dimension.")) return "DIMENSION";
  if (key.startsWith("formula.")) return "FORMULA";
  if (key.startsWith("metric.")) return "METRIC";
  if (key.startsWith("quality.")) return "QUALITY_CONSTRAINT";
  if (key.startsWith("relationship.")) return "RELATIONSHIP";
  throw new TypeError(`FALCON24_SEMANTIC_KEY_UNKNOWN:${key}`);
}

export async function buildFalcon24SemanticChangeSet(input: {
  readonly scope: Falcon24Scope;
  readonly base_release: SemanticChangeSet["base_release"];
  readonly revision?: number;
}) {
  if (input.scope.semantic_domain !== "falcon24") {
    throw new TypeError("FALCON24_SEMANTIC_DOMAIN_INVALID");
  }
  const blueprintHash = await sha256ContentHash(FALCON24_SEMANTIC_RELEASE_BLUEPRINT);
  const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
  const datasourceId = stableUuid("falcon24:datasource");
  const assertions: SemanticAssertionCandidate[] = [];
  const add = async (
    targetKind: SemanticAssertionTargetKind,
    canonicalKey: string,
    assertionPayload: Record<string, unknown>,
    sourceKind: "CURRENT_SEMANTIC_FACT" | "SCHEMA_FACT" = "CURRENT_SEMANTIC_FACT",
  ) => {
    assertions.push(
      await buildSemanticAssertionCandidate({
        schema_version: "semantic-assertion-candidate@1.0.0",
        assertion_id: stableUuid(`falcon24:assertion:${canonicalKey}`),
        scope: input.scope,
        target_kind: targetKind,
        canonical_key: canonicalKey,
        applicability_scope: { datasource: "falcon_db_24" },
        assertion_payload: assertionPayload,
        source_kind: sourceKind,
        evidence: [
          {
            evidence_id: `falcon24-blueprint:${canonicalKey}`,
            source_kind: sourceKind,
            source_ref: {
              resource_id: "falcon24-semantic-blueprint",
              resource_revision: 1,
              resource_hash: blueprintHash,
            },
            locator: {
              locator_kind: sourceKind === "SCHEMA_FACT" ? "SCHEMA_OBJECT" : "SEMANTIC_OBJECT",
              locator_value: canonicalKey,
            },
            observation: "Verified Falcon24 schema and semantic acceptance requirement.",
          },
        ],
        premise_assertion_ids: [],
        inference_rule_id: null,
        confidence: 1,
      }),
    );
  };

  for (const table of FALCON24_SEMANTIC_RELEASE_BLUEPRINT.tables) {
    await add(
      "PHYSICAL_BINDING",
      `binding.table.${table.table_id}`,
      {
        binding: {
          logical_object_id: `table.${table.table_id}`,
          logical_object_type: "table",
          datasource_id: datasourceId,
          schema_name: "falcon_db_24",
          table_name: table.table_id,
          column_name: null,
          binding_lifecycle: "active",
          valid_from: "2023-05-01",
          valid_until: null,
        },
      },
      "SCHEMA_FACT",
    );
    for (const column of table.columns) {
      await add(
        "PHYSICAL_BINDING",
        `binding.column.${table.table_id}.${column}`,
        {
          binding: {
            logical_object_id: `column.${table.table_id}.${column}`,
            logical_object_type: "column",
            datasource_id: datasourceId,
            schema_name: "falcon_db_24",
            table_name: table.table_id,
            column_name: column,
            binding_lifecycle: "active",
            valid_from: "2023-05-01",
            valid_until: null,
          },
        },
        "SCHEMA_FACT",
      );
    }
  }

  for (const [dimensionId, spec] of Object.entries(FALCON24_DIMENSIONS)) {
    const { table_id: tableId, column_id: columnId } = spec;
    await add("DIMENSION", `dimension.${dimensionId}`, {
      dimension: {
        dimension_id: `dimension.${dimensionId}`,
        name: dimensionId,
        aliases: [dimensionId.replaceAll("_", " "), ...spec.aliases].sort(),
        table_id: tableId,
        column_id: `${tableId}.${columnId}`,
        grain: spec.grain,
        data_type: spec.data_type,
        sensitivity: "INTERNAL",
        hierarchical: false,
        parent_dimension_id: null,
        tags: ["falcon24"],
        analysis: { groupable: true, pivotable: true, causal_role: "CANDIDATE_CONFOUNDER" },
      },
    });
  }

  for (const [metricId, spec] of Object.entries(FALCON24_METRICS)) {
    const { aliases, formula_id: formulaId, ...metricDefinition } = spec;
    await add("METRIC", `metric.${metricId}`, {
      metric: {
        metric_id: `metric.${metricId}`,
        name: metricId,
        aliases: [metricId.replaceAll("_", " "), ...aliases].sort(),
        ...metricDefinition,
        formula: {
          formula_id: `formula.${formulaId}`,
          expression: FALCON24_SEMANTIC_RELEASE_BLUEPRINT.formulas[formulaId],
          dialect: "text2sql",
          description: `Published Falcon24 formula formula.${formulaId}.`,
        },
      },
    });
  }

  for (const formulaId of Object.keys(FALCON24_SEMANTIC_RELEASE_BLUEPRINT.formulas)) {
    const ratioFormula = [
      "average_order_value",
      "buyer_frequency",
      "click_through_rate",
      "cohort_retention",
      "conversion_rate",
      "inventory_damage_rate",
      "low_rating_rate",
      "marketing_roas",
      "on_time_rate",
      "repeat_purchase_rate",
    ].includes(formulaId);
    await add("FORMULA", `formula.${formulaId}`, {
      formula: {
        ...commonNode,
        node_id: `formula.${formulaId}`,
        node_type: "FORMULA",
        name: formulaId,
        aliases: [
          ...FALCON24_FORMULA_ALIASES[formulaId as keyof typeof FALCON24_FORMULA_ALIASES],
        ].sort(),
        formula_type: ratioFormula
          ? "ratio"
          : formulaId === "cohort_month_index"
            ? "other"
            : formulaId === "buyer_frequency_aov"
              ? "compound"
              : formulaId === "delivery_minutes"
                ? "non_additive_aggregate"
                : "additive_aggregate",
        return_type: formulaId === "cohort_month_index" ? "integer" : "numeric",
        language: "semantic-ast",
        language_version: "semantic-formula-ast@1",
        expression: falcon24FormulaExpression(formulaId),
      },
    });
  }

  for (const [relationshipId, spec] of Object.entries(FALCON24_RELATIONSHIPS)) {
    const [leftTable, leftColumn, rightTable, rightColumn, cardinality] = spec;
    await add(
      "RELATIONSHIP",
      `relationship.${relationshipId}`,
      {
        relationship: {
          relationship_id: `relationship.${relationshipId}`,
          name: relationshipId,
          kind: "physical",
          left_table_id: leftTable,
          left_column_ids: [`${leftTable}.${leftColumn}`],
          right_table_id: rightTable,
          right_column_ids: [`${rightTable}.${rightColumn}`],
          cardinality,
          left_row_preservation: "required",
          right_row_preservation: "optional",
          proof_kind: "SNAPSHOT_CERTIFIED",
          proof_detail: "Falcon24 fixed-snapshot join audit.",
          tags: ["falcon24"],
          analysis: {
            join_allowed: true,
            fanout_closed: true,
            ontology_path: [`entity.${leftTable}`, `entity.${rightTable}`].sort(),
          },
        },
      },
      "SCHEMA_FACT",
    );
  }

  await add("TIME_SEMANTICS", "time.complete_month_frontier", {
    time_domain: {
      time_domain_id: "time.complete_month_frontier",
      calendar: "gregorian",
      timezone: "Asia/Shanghai",
      min_time: "2023-05-01",
      max_time: "2024-10-31",
      description: "Last complete month is 2024-10; all windows are half-open.",
    },
  });
  for (const [constraintId, [expression, severity]] of Object.entries(
    FALCON24_QUALITY_CONSTRAINTS,
  )) {
    await add(
      "QUALITY_CONSTRAINT",
      constraintId,
      { constraint_id: constraintId, expression, severity, sensitivity: "INTERNAL" },
      "SCHEMA_FACT",
    );
  }

  for (const testCase of suite.cases) {
    await add("BUSINESS_ENTITY_TYPE", `case.${testCase.case_id}`, {
      entity: {
        entity_id: `case.${testCase.case_id}`,
        name: testCase.question,
        description: `Falcon 24 验收问题 ${testCase.case_id} 的强制语义闭包入口。`,
        aliases: [],
        domain: "falcon24",
        owner: "falcon24-semantic-owner",
        lifecycle: "active",
        business_relationship_types: testCase.required_semantic_keys.map((targetKey) => ({
          relationship_type: "LINEAGE_REQUIREMENT",
          target_entity_id: targetKey,
          description: `该分析问题必须消费 ${targetKey}。`,
        })),
      },
    });
  }

  const byKey = new Map(assertions.map((assertion) => [assertion.canonical_key, assertion]));
  const competencyCases = suite.cases.map((testCase) => ({
    schema_version: "semantic-competency-case@1.0.0" as const,
    case_id: testCase.case_id,
    question: testCase.question,
    required_assertion_keys: [...testCase.required_semantic_keys],
    required_target_kinds: [...new Set(testCase.required_semantic_keys.map(targetKindFor))],
    required_relationship_paths: testCase.required_semantic_keys
      .filter((key) => key.startsWith("relationship."))
      .map((key) => [key]),
    expected_analysis_capabilities: ["open-python-analysis@1"],
  }));
  for (const testCase of competencyCases) {
    if (testCase.required_assertion_keys.some((key) => !byKey.has(key))) {
      throw new TypeError(`FALCON24_SEMANTIC_COMPETENCY_ASSET_MISSING:${testCase.case_id}`);
    }
  }
  const compiled = await compileSemanticChangeSet({
    change_set_id: stableUuid(`falcon24:semantic-change-set:${input.base_release.release_hash}`),
    scope: input.scope,
    base_release: input.base_release,
    revision: input.revision ?? 1,
    assertions,
    competency_cases: competencyCases,
  });
  const changeSet = await freezeSemanticChangeSetForReview(compiled);
  return Object.freeze({
    blueprint_hash: blueprintHash,
    datasource_id: datasourceId,
    assertion_count: assertions.length,
    competency_case_count: competencyCases.length,
    change_set: changeSet,
  });
}
