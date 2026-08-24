import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ServerOwnedExecutableToolRegistry,
  ServerOwnedToolRegistry,
  type ToolRegistryError,
} from "../src/tools/registry.js";

const semanticTool = {
  tool_name: "semantic-query@1",
  description: "Compile an authorized semantic query.",
  input_schema: z.strictObject({
    metric: z.string(),
  }),
} as const;

const evidenceTool = {
  tool_name: "evidence-read@1",
  description: "Read an authorized evidence reference.",
  input_schema: z.strictObject({
    reference: z.string(),
  }),
} as const;

describe("ServerOwnedToolRegistry", () => {
  it("projects only registered descriptors in request order", () => {
    const registry = new ServerOwnedToolRegistry([semanticTool, evidenceTool]);

    const resolved = registry.resolveAllowlist(["evidence-read@1", "semantic-query@1"]);

    expect(resolved.map((descriptor) => descriptor.tool_name)).toEqual([
      "evidence-read@1",
      "semantic-query@1",
    ]);
    expect(resolved.every(({ network_access }) => network_access.mode === "DENY")).toBe(true);
    expect(resolved.every(({ strict }) => strict === false)).toBe(true);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it("keeps provider strictness server-owned", () => {
    const registry = new ServerOwnedToolRegistry([{ ...semanticTool, strict: true }]);

    expect(registry.resolve("semantic-query@1").strict).toBe(true);
  });

  it("keeps HTTPS capability server-owned and rejects a non-schema descriptor", () => {
    const registry = new ServerOwnedToolRegistry([
      {
        ...semanticTool,
        network_access: { mode: "HTTPS" },
      },
    ]);

    expect(registry.resolve("semantic-query@1").network_access).toEqual({
      mode: "HTTPS",
    });
    expect(
      () =>
        new ServerOwnedToolRegistry([
          {
            ...semanticTool,
            input_schema: {} as never,
          },
        ]),
    ).toThrow("Zod Input Schema");
  });

  it("rejects a request-selected tool that is not server registered", () => {
    const registry = new ServerOwnedToolRegistry([semanticTool]);

    expect(() => registry.resolveAllowlist(["network-fetch@1"])).toThrowError(
      expect.objectContaining({
        code: "MODEL_TOOL_NOT_REGISTERED",
      }) as ToolRegistryError,
    );
  });

  it("rejects duplicate server descriptors", () => {
    expect(() => new ServerOwnedToolRegistry([semanticTool, semanticTool])).toThrowError(
      expect.objectContaining({
        code: "MODEL_TOOL_REGISTRY_CONFLICT",
      }) as ToolRegistryError,
    );
  });

  it("rejects duplicate names in an invocation allowlist", () => {
    const registry = new ServerOwnedToolRegistry([semanticTool]);

    expect(() => registry.resolveAllowlist(["semantic-query@1", "semantic-query@1"])).toThrowError(
      expect.objectContaining({
        code: "MODEL_TOOL_REGISTRY_CONFLICT",
      }) as ToolRegistryError,
    );
  });

  it("binds the server executor and parses input before invocation", async () => {
    const seen: unknown[] = [];
    const registry = new ServerOwnedExecutableToolRegistry([
      {
        ...semanticTool,
        executor: {
          async execute(input) {
            seen.push(input);
            return { accepted: true };
          },
        },
      },
    ]);

    const resolved = registry.resolve("semantic-query@1");
    await expect(resolved.execute({ metric: "gross_revenue" }, null)).resolves.toEqual({
      accepted: true,
    });
    expect(seen).toEqual([{ metric: "gross_revenue" }]);
    await expect(
      resolved.execute({ metric: "gross_revenue", executor: "caller-owned" }, null),
    ).rejects.toThrow();
  });
});
