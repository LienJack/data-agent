import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type AnalysisSandboxRuntimeError,
  createOpenSandboxAnalysisRuntime,
  type OpenSandboxSdkFactory,
} from "../../src/runs/opensandbox-analysis-runtime.js";

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function testConfig() {
  return {
    domain: "127.0.0.1:18080",
    protocol: "http" as const,
    api_key: "local-opensandbox-test-key",
    request_timeout_seconds: 5,
    ready_timeout_seconds: 5,
    sandbox_timeout_seconds: 60,
    agent_images: {
      CORE_ANALYSIS:
        "agent-core@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ML_DIAGNOSTIC:
        "agent-ml@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      CAUSAL_L5:
        "agent-causal@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    operator_image:
      "operator@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    agent_resource: { cpu: "1", memory: "1Gi" },
    operator_resource: { cpu: "1", memory: "1Gi" },
    max_file_bytes: 1024 * 1024,
    stdout_bytes: 32,
    stderr_bytes: 32,
  };
}

function fakeFactory(options: { readonly hang_agent?: boolean } = {}) {
  const created: Array<{
    readonly id: string;
    readonly image: string;
    readonly files: Map<string, Uint8Array>;
    killed: boolean;
    closed: boolean;
    deleted_contexts: string[];
  }> = [];
  const factory: OpenSandboxSdkFactory = {
    async createSandbox(input) {
      const image = typeof input.image === "string" ? input.image : (input.image?.uri ?? "");
      const state = {
        id: `sandbox-${created.length + 1}`,
        image,
        files: new Map<string, Uint8Array>(),
        killed: false,
        closed: false,
        deleted_contexts: [] as string[],
      };
      created.push(state);
      return {
        id: state.id,
        files: {
          async createDirectories() {},
          async writeFiles(entries) {
            for (const entry of entries) state.files.set(entry.path, entry.data);
          },
          async readBytes(path) {
            const value = state.files.get(path);
            if (!value) throw new Error("missing");
            return value;
          },
          async getFileInfo(paths) {
            return Object.fromEntries(
              paths.map((path) => [path, { size: state.files.get(path)?.byteLength ?? 0 }]),
            );
          },
        },
        async kill() {
          state.killed = true;
        },
        async close() {
          state.closed = true;
        },
      };
    },
    async createInterpreter(sandbox) {
      const state = created.find(({ id }) => id === sandbox.id);
      if (!state) throw new Error("unknown sandbox");
      const contextId = `${state.id}-context`;
      return {
        codes: {
          async createContext() {
            return { id: contextId, language: "python" };
          },
          async deleteContext(id) {
            state.deleted_contexts.push(id);
          },
          async run(code, runOptions) {
            if (options.hang_agent && state.id === "sandbox-1") {
              await new Promise<void>((_resolve, reject) => {
                runOptions.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
                  once: true,
                });
              });
            }
            const match = code.match(/execute_call_file\("([^"]+)", "([^"]+)"\)/u);
            if (match) {
              const request = state.files.get(match[1] as string);
              if (!request) throw new Error("operator request missing");
              state.files.set(
                match[2] as string,
                Buffer.from(JSON.stringify({ status: "PASS", request_hash: digest(request) })),
              );
            }
            return {
              id: `${state.id}-execution`,
              executionCount: 1,
              logs: {
                stdout: [{ text: "abcdefghijklmnopqrstuvwxyz0123456789", timestamp: 1 }],
                stderr: [],
              },
              result: [{ text: "ok", timestamp: 2 }],
              complete: { timestamp: 3, executionTimeMs: 1 },
              exitCode: 0,
            };
          },
          async interrupt() {},
        },
      };
    },
  };
  return { factory, created };
}

describe("OpenSandbox analysis runtime", () => {
  it("uses separate agent/operator sandboxes and transfers content-addressed files", async () => {
    const fake = fakeFactory();
    const runtime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: fake.factory,
    });
    const session = await runtime.createSession({
      run_id: "run-1",
      node_id: "node-1",
      profile: "CORE_ANALYSIS",
    });

    expect(session.agent_sandbox_id).not.toBe(session.operator_sandbox_id);
    expect(fake.created.map(({ image }) => image)).toEqual([
      testConfig().agent_images.CORE_ANALYSIS,
      testConfig().operator_image,
    ]);

    const input = Buffer.from("parquet-bytes");
    await session.uploadAgentFile({
      path: "/workspace/inputs/orders.parquet",
      content: input,
      content_sha256: digest(input),
    });
    await expect(
      session.readAgentFile({
        path: "/workspace/inputs/orders.parquet",
        expected_sha256: digest(input),
      }),
    ).resolves.toEqual(input);

    const cell = await session.runAgentCell({
      cell_id: "cell-1",
      source: "value = 1\nvalue",
      timeout_ms: 100,
    });
    expect(cell).toMatchObject({ status: "SUCCEEDED", result_text: "ok" });
    expect(Buffer.byteLength(cell.stdout)).toBeLessThanOrEqual(testConfig().stdout_bytes);

    const request = Buffer.from(JSON.stringify({ operator_id: "multiple-testing.bh-fdr@1" }));
    const operator = await session.runOperator({
      call_id: "call-1",
      request,
      request_sha256: digest(request),
      timeout_ms: 100,
    });
    expect(operator.status).toBe("SUCCEEDED");
    expect(operator.output_sha256).toBe(digest(operator.output as Uint8Array));
    expect(fake.created[0]?.files.has("/workspace/operator-inputs/call-1.json")).toBe(false);
    expect(fake.created[1]?.files.has("/workspace/operator-inputs/call-1.json")).toBe(true);

    await session.close();
    expect(fake.created.every(({ killed, closed }) => killed && closed)).toBe(true);
    expect(fake.created.every(({ deleted_contexts: contexts }) => contexts.length === 1)).toBe(
      true,
    );
  });

  it("fails closed on a content hash mismatch", async () => {
    const fake = fakeFactory();
    const runtime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: fake.factory,
    });
    const session = await runtime.createSession({
      run_id: "run-2",
      node_id: "node-2",
      profile: "CORE_ANALYSIS",
    });
    const content = Buffer.from("bytes");
    await expect(
      session.uploadAgentFile({
        path: "/workspace/inputs/orders.parquet",
        content,
        content_sha256: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toMatchObject({
      code: "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
      stage: "ARTIFACT",
      retryable: false,
    });
    await session.close();
  });

  it("interrupts a timed-out cell with a structured error", async () => {
    const fake = fakeFactory({ hang_agent: true });
    const runtime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: fake.factory,
    });
    const session = await runtime.createSession({
      run_id: "run-3",
      node_id: "node-3",
      profile: "CORE_ANALYSIS",
    });
    await expect(
      session.runAgentCell({ cell_id: "cell-timeout", source: "while True: pass", timeout_ms: 5 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AnalysisSandboxRuntimeError>>({
        code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
        stage: "CELL",
        retryable: true,
      }),
    );
    await session.close();
  });
});
