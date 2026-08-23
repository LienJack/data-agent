import { artifactReferenceSchema } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { ModelProviderPort } from "@data-agent/contracts/ports";
import { modelProviderSchema } from "@data-agent/contracts/providers";
import { runTerminalSchema } from "@data-agent/contracts/runs";
import { semanticGraphNodeListQuerySchema } from "@data-agent/contracts/semantic";
import { workspaceActionSchema } from "@data-agent/contracts/workspaces";
import { describe, expect, it } from "vitest";

describe("Contracts 领域子路径", () => {
  it("为关键领域暴露稳定运行时 schema", async () => {
    expect(artifactReferenceSchema).toBeDefined();
    expect(runTerminalSchema).toBeDefined();
    expect(modelProviderSchema.options).toContain("openai");
    expect(semanticGraphNodeListQuerySchema).toBeDefined();
    expect(workspaceActionSchema).toBeDefined();
    await expect(sha256ContentHash("contracts-subpath")).resolves.toMatch(/^sha256:/u);
  });

  it("ports 子路径暴露类型而不要求 server 实现", () => {
    const port: ModelProviderPort | undefined = undefined;
    expect(port).toBeUndefined();
  });
});
