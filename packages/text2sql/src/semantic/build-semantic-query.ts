import { deepFreeze, queryContractSchema } from "@data-agent/contracts";
import { z } from "zod";
import { groundingPackageDraftSchema } from "../grounding/types.js";
import {
  type BoundParameter,
  type SemanticQueryDraft,
  semanticQueryDraftSchema,
  type TypedPredicate,
} from "./types.js";

const inputSchema = z.strictObject({
  query_contract: queryContractSchema,
  grounding: groundingPackageDraftSchema,
});

function tableForColumn(columnId: string): string {
  return columnId.slice(0, columnId.indexOf("."));
}

function parameterBase(columnId: string): string {
  const base = columnId.split(".").at(-1) ?? "value";
  return base.replace(/[^A-Za-z0-9_]/g, "_");
}

function uniqueParameterKey(base: string, parameters: Readonly<Record<string, unknown>>): string {
  if (!(base in parameters)) return base;
  let suffix = 2;
  while (`${base}_${suffix}` in parameters) suffix += 1;
  return `${base}_${suffix}`;
}

export function buildSemanticQuery(input: unknown): SemanticQueryDraft {
  const parsed = inputSchema.parse(input);
  if (parsed.query_contract.metric !== parsed.grounding.metric.metric_id) {
    throw new TypeError("SEMANTIC_QUERY_METRIC_BINDING_MISMATCH");
  }
  const groundedDimensions = new Set(
    parsed.grounding.dimensions.map(({ dimension_id }) => dimension_id),
  );
  if (parsed.query_contract.dimensions.some((dimension) => !groundedDimensions.has(dimension))) {
    throw new TypeError("SEMANTIC_QUERY_DIMENSION_BINDING_MISMATCH");
  }
  const parameters: Record<string, BoundParameter> = {};
  const predicates: TypedPredicate[] = [];
  for (const filter of parsed.query_contract.filters) {
    if (filter.operator === "is_null" || filter.operator === "is_not_null") {
      predicates.push({
        kind: "null-check",
        field: { table_id: tableForColumn(filter.field), column_id: filter.field },
        operator: filter.operator,
        authority: "query-contract",
      });
      continue;
    }
    if (filter.operator === "in") {
      const parameterBaseName = `literal.${parameterBase(filter.field)}`;
      const values = filter.value.map((value, index) => {
        const parameterKey = uniqueParameterKey(`${parameterBaseName}.${index + 1}`, parameters);
        parameters[parameterKey] = { source: "literal", value };
        return { parameter_key: parameterKey };
      });
      predicates.push({
        kind: "membership",
        field: { table_id: tableForColumn(filter.field), column_id: filter.field },
        operator: "in",
        values,
        authority: "query-contract",
      });
      continue;
    }
    if (filter.value === null) {
      throw new TypeError("E_NULL_COMPARISON");
    }
    const parameterKey = uniqueParameterKey(`literal.${parameterBase(filter.field)}`, parameters);
    parameters[parameterKey] = { source: "literal", value: filter.value };
    predicates.push({
      kind: "comparison",
      left: { table_id: tableForColumn(filter.field), column_id: filter.field },
      operator: filter.operator,
      right: { parameter_key: parameterKey },
      authority: "query-contract",
    });
  }
  for (const predicate of parsed.grounding.mandatory_predicates) {
    const parameterKey = `policy.${predicate.parameter_key}`;
    if (predicate.operator === "is_null" || predicate.operator === "is_not_null") {
      predicates.push({
        kind: "null-check",
        field: { table_id: predicate.table_id, column_id: predicate.column_id },
        operator: predicate.operator,
        authority: "policy",
      });
      continue;
    }
    parameters[parameterKey] = {
      source: "policy",
      policy_key: predicate.parameter_key,
    };
    predicates.push({
      kind: "comparison",
      left: { table_id: predicate.table_id, column_id: predicate.column_id },
      operator: predicate.operator,
      right: { parameter_key: parameterKey },
      authority: "policy",
    });
  }
  const timeColumnId = parsed.grounding.metric.time_column_id;
  if (!timeColumnId) throw new TypeError("SEMANTIC_QUERY_TIME_COLUMN_MISSING");
  parameters["time.start"] = {
    source: "time",
    value: parsed.query_contract.time_range.start,
  };
  parameters["time.end"] = {
    source: "time",
    value: parsed.query_contract.time_range.end,
  };
  return deepFreeze(
    semanticQueryDraftSchema.parse({
      metric: parsed.grounding.metric,
      dimensions: parsed.grounding.dimensions,
      predicates,
      time_predicate: {
        field: {
          table_id: tableForColumn(timeColumnId),
          column_id: timeColumnId,
        },
        lower: { parameter_key: "time.start", inclusive: true },
        upper: { parameter_key: "time.end", inclusive: false },
        timezone: parsed.query_contract.time_range.timezone,
      },
      parameters,
      grounding_hash: parsed.grounding.grounding_hash,
      result_contract: parsed.query_contract.result_contract,
    }),
  );
}
