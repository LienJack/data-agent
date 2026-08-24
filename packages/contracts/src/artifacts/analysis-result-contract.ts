import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  sha256ContentHash,
} from "../common/index.js";

const identifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u);
const fieldNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u);
const physicalFieldSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}\.[A-Za-z_][A-Za-z0-9_]{0,127}$/u);

export const analysisResultValueTypeSchema = z.enum([
  "BOOLEAN",
  "DATE",
  "DECIMAL",
  "INTEGER",
  "JSON",
  "NUMBER",
  "STRING",
  "TIMESTAMP",
]);

export const analysisResultChartIntentSchema = z.enum([
  "TREND",
  "COMPARISON",
  "CONTRIBUTION",
  "DISTRIBUTION",
  "RELATIONSHIP",
  "PRIORITY",
  "RETENTION",
]);

export const analysisResultChartTemplateIdSchema = z.enum([
  "line.multi-series@1",
  "bar.grouped@1",
  "bar.stacked@1",
  "waterfall.contribution@1",
  "scatter.relationship@1",
  "matrix.priority@1",
  "cohort.retention@1",
]);

const resultFieldSchema = z.strictObject({
  field: fieldNameSchema,
  data_type: analysisResultValueTypeSchema,
  nullable: z.boolean(),
  semantic_role: z.enum(["METRIC", "DIMENSION", "DERIVED", "QUALITY", "LIMITATION"]),
});

const metricBindingSchema = z.strictObject({
  semantic_metric_id: identifierSchema,
  field: fieldNameSchema,
  unit: z.string().trim().min(1).max(64).nullable(),
  aggregation: z.enum(["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX", "RATIO", "NONE"]),
  formula_hash: contentHashSchema.nullable(),
});

const dimensionBindingSchema = z.strictObject({
  semantic_dimension_id: identifierSchema,
  field: fieldNameSchema,
});

const lineageBindingSchema = z.strictObject({
  field: fieldNameSchema,
  source_semantic_object_ids: z.array(identifierSchema).min(1).max(32),
  source_physical_fields: z.array(physicalFieldSchema).min(1).max(64),
  transformation: z.enum(["DIRECT", "AGGREGATION", "FORMULA", "STATISTICAL_OPERATOR"]),
});

const tableColumnSchema = z.strictObject({
  key: fieldNameSchema,
  label_zh: z.string().trim().min(1).max(80),
  data_type: analysisResultValueTypeSchema.exclude(["JSON"]),
  nullable: z.boolean(),
  semantic_object_id: identifierSchema,
  semantic_role: z.enum(["METRIC", "DIMENSION", "DERIVED", "QUALITY"]),
});

const tableContractSchema = z.strictObject({
  table_id: identifierSchema,
  title_zh: z.string().trim().min(1).max(160),
  required: z.boolean(),
  columns: z.array(tableColumnSchema).min(1).max(128),
  max_rows: z.number().int().positive().max(5_000),
});

const chartContractSchema = z.strictObject({
  chart_id: identifierSchema,
  title_zh: z.string().trim().min(1).max(160),
  required: z.boolean(),
  intent: analysisResultChartIntentSchema,
  table_id: identifierSchema,
  allowed_template_ids: z.array(analysisResultChartTemplateIdSchema).min(1).max(7),
});

const analysisResultContractMaterialSchema = z
  .strictObject({
    schema_version: z.literal("analysis-result-contract@1.0.0"),
    contract_id: identifierSchema,
    semantic_context_hash: contentHashSchema,
    result_fields: z.array(resultFieldSchema).min(1).max(256),
    metric_bindings: z.array(metricBindingSchema).max(128),
    dimension_bindings: z.array(dimensionBindingSchema).max(128),
    grain: z.strictObject({
      dimension_ids: z.array(identifierSchema).max(32),
      time_dimension_id: identifierSchema.nullable(),
      time_grain: z.enum(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "NONE"]),
    }),
    lineage: z.array(lineageBindingSchema).min(1).max(256),
    tables: z.array(tableContractSchema).min(1).max(32),
    charts: z.array(chartContractSchema).min(1).max(32),
    limits: z.strictObject({
      max_result_bytes: z.number().int().positive().max(16 * 1024 * 1024),
      max_table_rows: z.number().int().positive().max(5_000),
      max_table_columns: z.number().int().positive().max(128),
      max_closure_bytes: z.number().int().positive().max(64 * 1024 * 1024),
    }),
  })
  .superRefine((contract, context) => {
    const unique = (
      values: readonly string[],
      path: readonly (string | number)[],
      message: string,
    ) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", path: [...path], message });
      }
    };
    unique(
      contract.result_fields.map(({ field }) => field),
      ["result_fields"],
      "Result fields must be unique.",
    );
    unique(
      contract.metric_bindings.map(({ semantic_metric_id }) => semantic_metric_id),
      ["metric_bindings"],
      "Metric semantic identities must be unique.",
    );
    unique(
      contract.dimension_bindings.map(({ semantic_dimension_id }) => semantic_dimension_id),
      ["dimension_bindings"],
      "Dimension semantic identities must be unique.",
    );
    unique(
      contract.lineage.map(({ field }) => field),
      ["lineage"],
      "Lineage fields must be unique.",
    );
    unique(
      contract.tables.map(({ table_id }) => table_id),
      ["tables"],
      "Table ids must be unique.",
    );
    unique(
      contract.charts.map(({ chart_id }) => chart_id),
      ["charts"],
      "Chart ids must be unique.",
    );

    const fields = new Map(contract.result_fields.map((field) => [field.field, field]));
    for (const [index, binding] of contract.metric_bindings.entries()) {
      if (!["METRIC", "DERIVED"].includes(fields.get(binding.field)?.semantic_role ?? "")) {
        context.addIssue({
          code: "custom",
          path: ["metric_bindings", index, "field"],
          message: "Metric bindings must reference METRIC or DERIVED result fields.",
        });
      }
    }
    for (const [index, binding] of contract.dimension_bindings.entries()) {
      if (!["DIMENSION", "DERIVED"].includes(fields.get(binding.field)?.semantic_role ?? "")) {
        context.addIssue({
          code: "custom",
          path: ["dimension_bindings", index, "field"],
          message: "Dimension bindings must reference DIMENSION or DERIVED result fields.",
        });
      }
    }
    const semanticDimensionIds = new Set(
      contract.dimension_bindings.map(({ semantic_dimension_id }) => semantic_dimension_id),
    );
    for (const [index, dimensionId] of contract.grain.dimension_ids.entries()) {
      if (!semanticDimensionIds.has(dimensionId)) {
        context.addIssue({
          code: "custom",
          path: ["grain", "dimension_ids", index],
          message: "Grain dimensions must resolve to declared semantic dimensions.",
        });
      }
    }
    if (
      contract.grain.time_dimension_id !== null &&
      !semanticDimensionIds.has(contract.grain.time_dimension_id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["grain", "time_dimension_id"],
        message: "Time dimension must resolve to a declared semantic dimension.",
      });
    }
    if (
      (contract.grain.time_dimension_id === null) !== (contract.grain.time_grain === "NONE")
    ) {
      context.addIssue({
        code: "custom",
        path: ["grain"],
        message: "A time grain requires one semantic time dimension and vice versa.",
      });
    }

    const lineageFields = new Set(contract.lineage.map(({ field }) => field));
    for (const field of contract.result_fields) {
      if (!lineageFields.has(field.field)) {
        context.addIssue({
          code: "custom",
          path: ["lineage"],
          message: `Missing lineage for result field ${field.field}.`,
        });
      }
    }
    for (const [index, lineage] of contract.lineage.entries()) {
      if (!fields.has(lineage.field)) {
        context.addIssue({
          code: "custom",
          path: ["lineage", index, "field"],
          message: "Lineage must reference a declared result field.",
        });
      }
      unique(
        lineage.source_semantic_object_ids,
        ["lineage", index, "source_semantic_object_ids"],
        "Lineage semantic sources must be unique.",
      );
      unique(
        lineage.source_physical_fields,
        ["lineage", index, "source_physical_fields"],
        "Lineage physical sources must be unique.",
      );
    }

    const tables = new Map(contract.tables.map((table) => [table.table_id, table]));
    for (const [index, table] of contract.tables.entries()) {
      unique(
        table.columns.map(({ key }) => key),
        ["tables", index, "columns"],
        "Table column keys must be unique.",
      );
      if (
        table.columns.length > contract.limits.max_table_columns ||
        table.max_rows > contract.limits.max_table_rows
      ) {
        context.addIssue({
          code: "custom",
          path: ["tables", index],
          message: "Table limits must not exceed the contract-wide limits.",
        });
      }
    }
    for (const [index, chart] of contract.charts.entries()) {
      if (!tables.has(chart.table_id)) {
        context.addIssue({
          code: "custom",
          path: ["charts", index, "table_id"],
          message: "Charts must reference a declared table.",
        });
      }
    }
  });

export const analysisResultContractSchema = analysisResultContractMaterialSchema.safeExtend({
  contract_hash: contentHashSchema,
});

export type AnalysisResultValueType = z.infer<typeof analysisResultValueTypeSchema>;
export type AnalysisResultContract = z.infer<typeof analysisResultContractSchema>;
export type AnalysisResultContractMaterial = z.infer<typeof analysisResultContractMaterialSchema>;

export async function computeAnalysisResultContractHash(
  input: AnalysisResultContractMaterial,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    hash_domain: "analysis-result-contract@1.0.0",
    value: analysisResultContractMaterialSchema.parse(input),
  });
}

export async function buildAnalysisResultContract(
  input: AnalysisResultContractMaterial,
): Promise<AnalysisResultContract> {
  const material = analysisResultContractMaterialSchema.parse(input);
  return deepFreeze(
    analysisResultContractSchema.parse({
      ...material,
      contract_hash: await computeAnalysisResultContractHash(material),
    }),
  );
}

export async function verifyAnalysisResultContract(input: unknown): Promise<AnalysisResultContract> {
  const contract = analysisResultContractSchema.parse(input);
  const { contract_hash: observedHash, ...material } = contract;
  if ((await computeAnalysisResultContractHash(material)) !== observedHash) {
    throw new TypeError("ANALYSIS_RESULT_CONTRACT_HASH_MISMATCH");
  }
  return deepFreeze(contract);
}
