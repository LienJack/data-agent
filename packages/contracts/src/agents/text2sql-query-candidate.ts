import { z } from "zod";

import { versionIdentifierSchema } from "../common/index.js";

const queryParameterSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const text2sqlQueryCandidateSchema = z
  .strictObject({
    schema_version: z.literal("text2sql-query-candidate@1.0.0"),
    sql: z.string().trim().min(1).max(100_000),
    parameters: z.array(queryParameterSchema).max(256),
    result_columns: z
      .array(
        z.strictObject({
          name: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u),
          semantic_type: z.enum(["NUMBER", "STRING", "DATE", "DATETIME", "BOOLEAN"]),
          label: z.string().trim().min(1).max(128),
          semantic_binding: z.strictObject({
            object_kind: z.enum([
              "METRIC",
              "FORMULA",
              "DIMENSION",
              "PHYSICAL_COLUMN",
              "REQUEST_DERIVED",
            ]),
            object_id: versionIdentifierSchema,
          }),
        }),
      )
      .min(1)
      .max(128),
    time_window: z
      .strictObject({
        dimension_id: versionIdentifierSchema,
        start_parameter: z.number().int().positive().max(256),
        end_parameter: z.number().int().positive().max(256),
        semantics: z.literal("HALF_OPEN"),
      })
      .nullable(),
    presentation: z.strictObject({
      title: z.string().trim().min(1).max(240),
      summary: z.string().trim().min(1).max(2_000),
      visualization: z.enum(["NONE", "LINE", "BAR", "PIE", "TABLE"]),
      x_key: z.string().min(1).max(128).nullable(),
      y_keys: z.array(z.string().min(1).max(128)).max(16),
    }),
  })
  .superRefine((candidate, ctx) => {
    const names = candidate.result_columns.map(({ name }) => name);
    const selected = [candidate.presentation.x_key, ...candidate.presentation.y_keys].filter(
      (name): name is string => name !== null,
    );
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", message: "Result column names must be unique." });
    }
    if (
      candidate.time_window &&
      (candidate.time_window.start_parameter === candidate.time_window.end_parameter ||
        candidate.time_window.start_parameter > candidate.parameters.length ||
        candidate.time_window.end_parameter > candidate.parameters.length)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Time window must reference two distinct declared parameters.",
        path: ["time_window"],
      });
    }
    if (selected.some((name) => !names.includes(name))) {
      ctx.addIssue({
        code: "custom",
        message: "Presentation keys must reference declared result columns.",
        path: ["presentation"],
      });
    }
    if (
      (candidate.presentation.visualization === "NONE" ||
        candidate.presentation.visualization === "TABLE") &&
      (candidate.presentation.x_key !== null || candidate.presentation.y_keys.length > 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Non-chart presentations cannot declare chart axes.",
        path: ["presentation"],
      });
    }
  });

export type Text2SqlQueryCandidate = z.infer<typeof text2sqlQueryCandidateSchema>;

/** Host-owned repair envelope. It carries the original authority, never replacement bindings. */
export const text2sqlRepairContextSchema = z
  .strictObject({
    schema_version: z.literal("text2sql-repair-context@1.0.0"),
    frozen_query_context: z.record(z.string(), z.json()),
    rejection: z.strictObject({
      attempt: z.number().int().positive(),
      diagnostic_code: z
        .string()
        .max(128)
        .regex(/^[A-Z][A-Z0-9_]*$/u),
      rejected_candidate: text2sqlQueryCandidateSchema,
      observed_result_types: z
        .array(text2sqlQueryCandidateSchema.shape.result_columns.element.shape.semantic_type)
        .min(1)
        .max(128)
        .optional(),
    }),
  })
  .superRefine(({ rejection }, ctx) => {
    if (
      rejection.observed_result_types &&
      rejection.observed_result_types.length !== rejection.rejected_candidate.result_columns.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Observed types must match the rejected candidate column order.",
      });
    }
  });
