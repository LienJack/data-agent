import { z } from "zod";

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
        }),
      )
      .min(1)
      .max(128),
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
