import {
  analysisPythonCellToolArgumentsSchema,
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
