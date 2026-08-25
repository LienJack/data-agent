import {
  STATISTICAL_OPERATOR_MANIFEST,
  type StatisticalOperatorId,
} from "@data-agent/contracts/statistical-operators";

export type StatisticalOperatorInputIssue = Readonly<{
  code:
    | "ANALYSIS_OPERATOR_ARGUMENT_INPUT_SET_INVALID"
    | "ANALYSIS_OPERATOR_ARGUMENT_PARAMETER_SET_INVALID"
    | "ANALYSIS_OPERATOR_ARGUMENT_COLLECTION_BOUNDS_INVALID"
    | "ANALYSIS_OPERATOR_ARGUMENT_RECORD_FIELDS_INVALID"
    | "ANALYSIS_OPERATOR_ARGUMENT_FIELD_TYPE_INVALID"
    | "ANALYSIS_OPERATOR_ARGUMENT_PARAMETER_VALUE_INVALID"
    | "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_BINDING_INVALID"
    | "ANALYSIS_OPERATOR_ARGUMENT_LINEAGE_MISMATCH";
  input_name: string | null;
  field_name: string | null;
  expected_kind: string | null;
  expected_fields: readonly string[];
}>;

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameKeys(value: JsonObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function dateKey(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function monthKey(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value)) return false;
  return Number(value.slice(0, 4)) >= 1;
}

function finiteNumberArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every(finiteNumber);
}

function namedFiniteNumberMap(value: unknown): boolean {
  return (
    isObject(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(([key, item]) => key.length > 0 && finiteNumberArray(item))
  );
}

function fieldMatches(kind: string, value: unknown): boolean {
  switch (kind) {
    case "NON_EMPTY_STRING":
      return typeof value === "string" && value.length > 0 && value.length <= 128;
    case "DATE_KEY":
      return dateKey(value);
    case "MONTH_KEY":
      return monthKey(value);
    case "FINITE_NUMBER":
      return finiteNumber(value);
    case "NON_NEGATIVE_FINITE_NUMBER":
      return finiteNumber(value) && value >= 0;
    case "UNIT_INTERVAL_NUMBER":
      return finiteNumber(value) && value >= 0 && value <= 1;
    case "NULLABLE_NON_NEGATIVE_FINITE_NUMBER":
      return value === null || (finiteNumber(value) && value >= 0);
    case "NULLABLE_RATING_1_TO_5":
      return value === null || (finiteNumber(value) && value >= 1 && value <= 5);
    case "BOOLEAN":
      return typeof value === "boolean";
    case "FINITE_NUMBER_ARRAY":
      return finiteNumberArray(value);
    case "BINARY_NUMBER_ARRAY":
      return finiteNumberArray(value) && value.every((item) => item === 0 || item === 1);
    case "STRICT_ORDER_ARRAY":
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => (typeof item === "string" && item.length > 0) || finiteNumber(item))
      );
    case "NAMED_FINITE_NUMBER_ARRAY_MAP":
      return namedFiniteNumberMap(value);
    case "NAMED_FINITE_NUMBER_MAP":
      return (
        isObject(value) &&
        Object.keys(value).length > 0 &&
        Object.entries(value).every(([key, item]) => key.length > 0 && finiteNumber(item))
      );
    default:
      return false;
  }
}

function issue(
  code: StatisticalOperatorInputIssue["code"],
  inputName: string | null,
  fieldName: string | null,
  expectedKind: string | null,
  expectedFields: readonly string[] = [],
): StatisticalOperatorInputIssue {
  return Object.freeze({
    code,
    input_name: inputName,
    field_name: fieldName,
    expected_kind: expectedKind,
    expected_fields: Object.freeze([...expectedFields]),
  });
}

function parameterMatches(
  parameter: {
    readonly kind: string;
    readonly allowed_values?: readonly (string | number)[];
    readonly minimum_exclusive?: number;
    readonly minimum_inclusive?: number;
    readonly maximum_inclusive?: number;
  },
  value: unknown,
): boolean {
  if (parameter.allowed_values && !parameter.allowed_values.includes(value as never)) return false;
  if (parameter.kind === "BOOLEAN") return typeof value === "boolean";
  if (parameter.kind === "ENUM") return typeof value === "string";
  if (parameter.kind === "ENUM_INTEGER") return Number.isSafeInteger(value);
  if (parameter.kind === "NON_NEGATIVE_INTEGER") {
    if (!Number.isSafeInteger(value) || (value as number) < 0) return false;
  } else if (parameter.kind === "POSITIVE_INTEGER") {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) return false;
  } else if (parameter.kind === "FINITE_NUMBER") {
    if (!finiteNumber(value)) return false;
  } else if (!parameter.allowed_values) {
    return false;
  }
  if (typeof value !== "number") return true;
  if (parameter.minimum_exclusive !== undefined && value <= parameter.minimum_exclusive) {
    return false;
  }
  if (parameter.minimum_inclusive !== undefined && value < parameter.minimum_inclusive) {
    return false;
  }
  if (parameter.maximum_inclusive !== undefined && value > parameter.maximum_inclusive) {
    return false;
  }
  return true;
}

/**
 * Performs the manifest-declared, data-free shape checks before an operator
 * intent becomes durable. Statistical and applicability checks remain owned by
 * the frozen operator implementation.
 */
export function preflightStatisticalOperatorArguments(input: {
  readonly operator_id: StatisticalOperatorId;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly parameters: Readonly<Record<string, unknown>>;
}): StatisticalOperatorInputIssue | null {
  const operator = STATISTICAL_OPERATOR_MANIFEST.operators.find(
    ({ operator_id: operatorId }) => operatorId === input.operator_id,
  );
  if (!operator) return issue("ANALYSIS_OPERATOR_ARGUMENT_INPUT_SET_INVALID", null, null, null);
  if (
    !sameKeys(
      input.inputs,
      operator.inputs.map(({ name }) => name),
    )
  ) {
    return issue("ANALYSIS_OPERATOR_ARGUMENT_INPUT_SET_INVALID", null, null, null);
  }
  for (const contract of operator.inputs) {
    const collection = input.inputs[contract.name];
    if (
      !Array.isArray(collection) ||
      collection.length < contract.min_items ||
      collection.length > contract.max_items
    ) {
      return issue(
        "ANALYSIS_OPERATOR_ARGUMENT_COLLECTION_BOUNDS_INVALID",
        contract.name,
        null,
        contract.container,
      );
    }
    const expectedFields = Object.keys(contract.record_shape);
    for (const row of collection) {
      if (!isObject(row) || !sameKeys(row, expectedFields)) {
        return issue(
          "ANALYSIS_OPERATOR_ARGUMENT_RECORD_FIELDS_INVALID",
          contract.name,
          null,
          "RECORD",
          expectedFields,
        );
      }
      for (const [fieldName, expectedKind] of Object.entries(contract.record_shape)) {
        if (!fieldMatches(expectedKind, row[fieldName])) {
          return issue(
            "ANALYSIS_OPERATOR_ARGUMENT_FIELD_TYPE_INVALID",
            contract.name,
            fieldName,
            expectedKind,
          );
        }
      }
    }
  }
  const allowedParameterNames: readonly string[] = operator.parameters.map(({ name }) => name);
  if (Object.keys(input.parameters).some((name) => !allowedParameterNames.includes(name))) {
    return issue("ANALYSIS_OPERATOR_ARGUMENT_PARAMETER_SET_INVALID", null, null, null);
  }
  for (const parameter of operator.parameters) {
    const present = Object.hasOwn(input.parameters, parameter.name);
    if (!present) {
      if (parameter.required && !("default" in parameter)) {
        return issue(
          "ANALYSIS_OPERATOR_ARGUMENT_PARAMETER_SET_INVALID",
          null,
          parameter.name,
          parameter.kind,
        );
      }
      continue;
    }
    if (!parameterMatches(parameter, input.parameters[parameter.name])) {
      return issue(
        "ANALYSIS_OPERATOR_ARGUMENT_PARAMETER_VALUE_INVALID",
        null,
        parameter.name,
        parameter.kind,
      );
    }
  }
  return null;
}
