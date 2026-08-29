import { canonicalizeJson } from "@data-agent/contracts/common";
import {
  STATISTICAL_OPERATOR_MANIFEST,
  type StatisticalOperatorObligation,
} from "@data-agent/contracts/statistical-operators";
import { DateDay, TimestampMillisecond, tableFromIPC } from "apache-arrow";
import type { GovernedAnalysisInput } from "./governed-analysis-input.js";
import type { StatisticalOperatorInputIssue } from "./statistical-operator-input-preflight.js";
import { recomputeStatisticalOperatorServerTransform } from "./statistical-operator-server-transforms.js";

type JsonObject = Readonly<Record<string, unknown>>;

function issue(
  code:
    | "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID"
    | "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_MISMATCH",
  inputName: string | null,
  fieldName: string | null,
  expectedFields: readonly string[] = [],
): StatisticalOperatorInputIssue {
  return Object.freeze({
    code,
    input_name: inputName,
    field_name: fieldName,
    expected_kind: "GOVERNED_COLUMN_LINEAGE",
    expected_fields: Object.freeze([...expectedFields]),
  });
}

function dateKey(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  return null;
}

function normalizeGovernedValue(kind: string, value: unknown): unknown {
  if (kind === "DATE_KEY") return dateKey(value);
  if (
    kind === "FINITE_NUMBER" ||
    kind === "NON_NEGATIVE_FINITE_NUMBER" ||
    kind === "UNIT_INTERVAL_NUMBER" ||
    kind === "NULLABLE_NON_NEGATIVE_FINITE_NUMBER" ||
    kind === "NULLABLE_RATING_1_TO_5"
  ) {
    if (value === null) return null;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (kind === "BOOLEAN") return typeof value === "boolean" ? value : null;
  return typeof value === "string" ? value : null;
}

function sameFieldSet(actual: readonly string[], expected: readonly string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function governedRows(governed: GovernedAnalysisInput): readonly JsonObject[] {
  const table = tableFromIPC(governed.content);
  const fields = table.schema.fields;
  const temporalTypes = new Set([String(new DateDay()), String(new TimestampMillisecond())]);
  return Object.freeze(
    Array.from({ length: table.numRows }, (_, rowIndex) =>
      Object.freeze(
        Object.fromEntries(
          fields.map((field) => {
            const observed = table.getChild(field.name)?.get(rowIndex);
            return [
              field.name,
              temporalTypes.has(String(field.type)) ? (dateKey(observed) ?? observed) : observed,
            ];
          }),
        ),
      ),
    ),
  );
}

function resolveJsonPointer(value: unknown, pointer: string): unknown {
  let current = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function canonicalExact(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeJson(left) === canonicalizeJson(right);
  } catch {
    return false;
  }
}

/**
 * SERVER_TRANSFORM_EXACT means the Host owns the transformed operator rows,
 * not merely their validation. Replace model-prepared copies before preflight
 * and durable operator intent so representation drift cannot become authority.
 */
export function bindStatisticalOperatorServerTransformInputs(input: {
  readonly obligation: StatisticalOperatorObligation;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly governed_inputs: readonly GovernedAnalysisInput[];
}):
  | { readonly ok: true; readonly inputs: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly issue: StatisticalOperatorInputIssue } {
  const operator = STATISTICAL_OPERATOR_MANIFEST.operators.find(
    ({ operator_id: operatorId }) => operatorId === input.obligation.operator_id,
  );
  if (!operator) {
    return {
      ok: false,
      issue: issue("ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID", null, null),
    };
  }
  const boundInputs: Record<string, unknown> = { ...input.inputs };
  for (const binding of input.obligation.input_lineage_bindings) {
    if (binding.lineage_kind !== "SERVER_TRANSFORM_EXACT") continue;
    const operatorInput = operator.inputs.find(({ name }) => name === binding.operator_input_name);
    const expectedFields = operatorInput ? Object.keys(operatorInput.record_shape) : [];
    const governed = input.governed_inputs.find(({ name }) => name === binding.governed_input_name);
    if (!operatorInput || governed?.format !== "ARROW") {
      return {
        ok: false,
        issue: issue(
          "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
          binding.operator_input_name,
          null,
          expectedFields,
        ),
      };
    }
    try {
      boundInputs[binding.operator_input_name] = recomputeStatisticalOperatorServerTransform({
        transform_id: binding.transform_id,
        governed_rows: governedRows(governed),
      });
    } catch {
      return {
        ok: false,
        issue: issue(
          "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
          binding.operator_input_name,
          null,
          expectedFields,
        ),
      };
    }
  }
  return { ok: true, inputs: Object.freeze(boundInputs) };
}

/**
 * Verifies direct, all-row operator inputs against the authoritative governed
 * Arrow materialization. This closes semantic column identity before an
 * operator intent can become durable; equal runtime types are not sufficient.
 */
export function verifyStatisticalOperatorInputLineage(input: {
  readonly obligation: StatisticalOperatorObligation;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly governed_inputs: readonly GovernedAnalysisInput[];
  readonly protected_operator_outputs?: ReadonlyMap<string, unknown>;
}): StatisticalOperatorInputIssue | null {
  const operator = STATISTICAL_OPERATOR_MANIFEST.operators.find(
    ({ operator_id: operatorId }) => operatorId === input.obligation.operator_id,
  );
  if (!operator) {
    return issue("ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID", null, null);
  }
  const expectedInputNames = operator.inputs.map(({ name }) => name);
  const boundInputNames = input.obligation.input_lineage_bindings.map(
    ({ operator_input_name: operatorInputName }) => operatorInputName,
  );
  if (
    input.obligation.input_lineage_bindings.length === 0 ||
    !sameFieldSet(boundInputNames, expectedInputNames) ||
    new Set(boundInputNames).size !== boundInputNames.length
  ) {
    return issue(
      "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
      null,
      null,
      expectedInputNames,
    );
  }
  for (const binding of input.obligation.input_lineage_bindings) {
    const operatorInput = operator.inputs.find(({ name }) => name === binding.operator_input_name);
    const collection = input.inputs[binding.operator_input_name];
    const expectedFields = operatorInput ? Object.keys(operatorInput.record_shape) : [];
    if (!operatorInput || !Array.isArray(collection)) {
      return issue(
        "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
        binding.operator_input_name,
        null,
        expectedFields,
      );
    }
    if (binding.lineage_kind === "SERVER_TRANSFORM_EXACT") {
      const governed = input.governed_inputs.find(
        ({ name }) => name === binding.governed_input_name,
      );
      if (governed?.format !== "ARROW") {
        return issue(
          "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
          binding.operator_input_name,
          null,
          expectedFields,
        );
      }
      let expected: readonly JsonObject[];
      try {
        expected = recomputeStatisticalOperatorServerTransform({
          transform_id: binding.transform_id,
          governed_rows: governedRows(governed),
        });
      } catch {
        return issue(
          "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
          binding.operator_input_name,
          null,
          expectedFields,
        );
      }
      if (!canonicalExact(collection, expected)) {
        return issue(
          "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_MISMATCH",
          binding.operator_input_name,
          null,
          expectedFields,
        );
      }
      continue;
    }
    if (binding.lineage_kind === "OPERATOR_RESULT_EXACT") {
      const protectedOutput = input.protected_operator_outputs?.get(binding.source_call_id);
      const sourceCollection = resolveJsonPointer(protectedOutput, binding.source_collection_path);
      const boundFields = binding.field_sources.map(({ operator_field }) => operator_field);
      if (
        !Array.isArray(sourceCollection) ||
        binding.row_mode !== "ALL_ROWS_EXACT" ||
        !sameFieldSet(boundFields, expectedFields) ||
        sourceCollection.some((row) => !isObject(row))
      ) {
        return issue(
          "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
          binding.operator_input_name,
          null,
          expectedFields,
        );
      }
      if (
        sourceCollection.some((row) =>
          binding.field_sources.some(({ source_field: sourceField }) => !(sourceField in row)),
        )
      ) {
        return issue(
          "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
          binding.operator_input_name,
          null,
          expectedFields,
        );
      }
      const expected = sourceCollection.map((row) =>
        Object.fromEntries(
          binding.field_sources.map(
            ({ operator_field: operatorField, source_field: sourceField }) => [
              operatorField,
              row[sourceField],
            ],
          ),
        ),
      );
      if (!canonicalExact(collection, expected)) {
        return issue(
          "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_MISMATCH",
          binding.operator_input_name,
          null,
          expectedFields,
        );
      }
      continue;
    }
    const governed = input.governed_inputs.find(({ name }) => name === binding.governed_input_name);
    const boundFields = binding.field_sources.map(({ operator_field }) => operator_field);
    if (
      governed?.format !== "ARROW" ||
      binding.row_mode !== "ALL_ROWS_EXACT" ||
      !sameFieldSet(boundFields, expectedFields)
    ) {
      return issue(
        "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
        binding.operator_input_name,
        null,
        expectedFields,
      );
    }
    const table = tableFromIPC(governed.content);
    const governedColumns = new Set(table.schema.fields.map(({ name }) => name));
    if (
      binding.field_sources.some(({ governed_column }) => !governedColumns.has(governed_column))
    ) {
      return issue(
        "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
        binding.operator_input_name,
        null,
        expectedFields,
      );
    }
    if (collection.length !== table.numRows) {
      return issue(
        "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_MISMATCH",
        binding.operator_input_name,
        null,
        expectedFields,
      );
    }
    for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
      const actual = collection[rowIndex];
      if (!isObject(actual) || !sameFieldSet(Object.keys(actual), expectedFields)) {
        return issue(
          "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_MISMATCH",
          binding.operator_input_name,
          null,
          expectedFields,
        );
      }
      const recordShape = operatorInput.record_shape as Readonly<Record<string, string>>;
      for (const {
        operator_field: operatorField,
        governed_column: governedColumn,
      } of binding.field_sources) {
        const kind = recordShape[operatorField];
        const governedValue = table.getChild(governedColumn)?.get(rowIndex);
        if (!kind || governedValue === undefined) {
          return issue(
            "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID",
            binding.operator_input_name,
            operatorField,
            expectedFields,
          );
        }
        if (!Object.is(actual[operatorField], normalizeGovernedValue(kind, governedValue))) {
          return issue(
            "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_MISMATCH",
            binding.operator_input_name,
            operatorField,
            expectedFields,
          );
        }
      }
    }
  }
  return null;
}

export const statisticalOperatorInputLineageInternals = Object.freeze({
  dateKey,
  normalizeGovernedValue,
  governedRows,
  resolveJsonPointer,
  canonicalExact,
});
