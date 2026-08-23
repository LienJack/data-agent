import { canonicalizeJson } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ServerModelResponseSchemaRegistry } from "../src/mastra/response-schema-registry.js";

describe("ServerModelResponseSchemaRegistry", () => {
  it("resolves only an exact server-registered schema version", () => {
    const schema = z.strictObject({ summary: z.string() });
    const registry = new ServerModelResponseSchemaRegistry([
      {
        response_schema_version: "1.0.0",
        schema,
      },
    ]);

    expect(registry.resolve("1.0.0")).toMatchObject({
      response_schema_version: "1.0.0",
      schema,
      canonical_schema_bytes: Buffer.byteLength(canonicalizeJson(z.toJSONSchema(schema)), "utf8"),
    });
    expect(registry.resolve("1.0.1")).toBeNull();
  });

  it("rejects duplicate response schema versions at server startup", () => {
    const schema = z.strictObject({ summary: z.string() });

    expect(
      () =>
        new ServerModelResponseSchemaRegistry([
          {
            response_schema_version: "1.0.0",
            schema,
          },
          {
            response_schema_version: "1.0.0",
            schema,
          },
        ]),
    ).toThrow(/重复 Schema Version/);
  });

  it("fails closed when a registered schema cannot be deterministically represented as JSON Schema", () => {
    expect(
      () =>
        new ServerModelResponseSchemaRegistry([
          {
            response_schema_version: "1.0.0",
            schema: z.strictObject({ summary: z.string().transform((value) => value.trim()) }),
          },
        ]),
    ).toThrow(/JSON Schema/);
  });
});
