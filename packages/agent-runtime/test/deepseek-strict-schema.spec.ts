import {
  analysisPythonCellToolArgumentsSchema,
  analysisResultPublishModelArgumentsSchema,
  analysisResultPublishToolArgumentsSchema,
  analysisStatisticalOperatorToolArgumentsSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DeepSeekStrictSchemaError,
  projectDeepSeekStrictToolInputSchema,
} from "../src/tools/deepseek-strict-schema.js";

const unsupportedProviderKeywords = /"(?:minLength|maxLength|minItems|maxItems)"/u;

describe("DeepSeek Strict tool schema projection", () => {
  it("projects every analysis tool from its authoritative Zod schema", () => {
    for (const schema of [
      analysisPythonCellToolArgumentsSchema,
      analysisStatisticalOperatorToolArgumentsSchema,
      analysisResultPublishToolArgumentsSchema,
      analysisResultPublishModelArgumentsSchema,
    ]) {
      const projection = projectDeepSeekStrictToolInputSchema(schema);
      expect(projection).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(JSON.stringify(projection)).not.toMatch(unsupportedProviderKeywords);
      expect(Object.isFrozen(projection)).toBe(true);
    }
  });

  it.each([analysisResultPublishModelArgumentsSchema, analysisResultPublishToolArgumentsSchema])(
    "represents optional facet presence with two closed, all-required binding shapes",
    (schema) => {
      const projected = projectDeepSeekStrictToolInputSchema(schema);
      const binding = z
        .object({
          properties: z.object({
            chart_bindings: z.object({
              items: z.object({
                anyOf: z.array(
                  z.object({
                    type: z.literal("object"),
                    additionalProperties: z.literal(false),
                    properties: z.record(z.string(), z.unknown()),
                    required: z.array(z.string()),
                  }),
                ),
              }),
            }),
          }),
        })
        .parse(projected).properties.chart_bindings.items.anyOf;
      expect(binding).toHaveLength(2);
      expect(binding.map((branch) => "facet_field" in branch.properties)).toEqual([false, true]);
      for (const branch of binding) {
        expect([...branch.required].sort()).toEqual(Object.keys(branch.properties).sort());
      }
    },
  );

  it("removes provider-unsupported bounds without weakening server validation", () => {
    const schema = z.strictObject({
      name: z.string().min(2).max(4),
      values: z.array(z.number()).min(1).max(2),
    });

    const projection = projectDeepSeekStrictToolInputSchema(schema);
    expect(JSON.stringify(projection)).not.toMatch(unsupportedProviderKeywords);
    expect(schema.safeParse({ name: "x", values: [] }).success).toBe(false);
    expect(schema.safeParse({ name: "valid", values: [1, 2, 3] }).success).toBe(false);
  });

  it("fails closed for dynamic objects, optional fields and null branches", () => {
    for (const schema of [
      z.strictObject({ values: z.record(z.string(), z.string()) }),
      z.strictObject({ optional: z.string().optional() }),
      z.strictObject({ nullable: z.string().nullable() }),
    ]) {
      expect(() => projectDeepSeekStrictToolInputSchema(schema)).toThrowError(
        DeepSeekStrictSchemaError,
      );
    }
  });
});
