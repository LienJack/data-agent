import { z } from "zod";

export const pythonOutputTypeSchema = z.enum([
  "ARROW",
  "PARQUET",
  "CSV",
  "JSON",
  "MARKDOWN",
  "VEGA_LITE",
  "PNG",
  "SVG",
]);

export const pythonOutputSpecSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u),
  type: pythonOutputTypeSchema,
  required: z.boolean(),
  max_bytes: z.number().int().positive().max(67_108_864),
});

export const pythonOutputContractSchema = z
  .strictObject({
    schema_version: z.literal("python-output-contract@1.0.0"),
    outputs: z.array(pythonOutputSpecSchema).min(1).max(32),
  })
  .superRefine((contract, context) => {
    const names = new Set<string>();
    for (const [index, output] of contract.outputs.entries()) {
      if (names.has(output.name)) {
        context.addIssue({
          code: "custom",
          path: ["outputs", index, "name"],
          message: "output names must be unique",
        });
      }
      names.add(output.name);
    }
  });

export type PythonOutputContractV1 = z.infer<typeof pythonOutputContractSchema>;
