import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type AnalysisSandboxRuntimeError,
  createOpenSandboxAnalysisRuntime,
  type OpenSandboxSdkFactory,
  openSandboxAnalysisRuntimeInternals,
} from "../../src/runs/opensandbox-analysis-runtime.js";

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function testConfig() {
  return {
    domain: "127.0.0.1:18080",
    protocol: "http" as const,
    api_key: "local-opensandbox-test-key",
    use_server_proxy: true,
    request_timeout_seconds: 5,
    ready_timeout_seconds: 5,
    sandbox_timeout_seconds: 60,
    secure_access: true,
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

function fakeFactory(
  options: {
    readonly hang_agent?: boolean;
    readonly fail_handle_kill?: boolean;
    readonly fail_manager_list_after?: number;
    readonly symbol_extraction_error?: string;
    readonly write_failures?: number;
  } = {},
) {
  let managerListCalls = 0;
  let writeFailuresRemaining = options.write_failures ?? 0;
  const connectionProxyModes: boolean[] = [];
  const created: Array<{
    readonly id: string;
    readonly image: string;
    readonly metadata: Readonly<Record<string, string>>;
    readonly created_at: Date;
    readonly files: Map<string, Uint8Array>;
    killed: boolean;
    closed: boolean;
    deleted_contexts: string[];
    executed_codes: string[];
    write_attempts: number;
  }> = [];
  const factory: OpenSandboxSdkFactory = {
    async createSandbox(input) {
      const image = typeof input.image === "string" ? input.image : (input.image?.uri ?? "");
      const state = {
        id: `sandbox-${created.length + 1}`,
        image,
        metadata: Object.freeze({ ...(input.metadata ?? {}) }),
        created_at: new Date(),
        files: new Map<string, Uint8Array>(),
        killed: false,
        closed: false,
        deleted_contexts: [] as string[],
        executed_codes: [] as string[],
        write_attempts: 0,
      };
      created.push(state);
      return {
        id: state.id,
        commands: {
          async run(command, _options, handlers) {
            await handlers?.onInit?.({ id: `${state.id}-command` });
            const match = command.match(
              /dispatcher (call|finalize|validate-cell) "([^"]+)" "([^"]+)"/u,
            );
            if (!match) throw new Error("unexpected operator command");
            const request = state.files.get(match[2] as string);
            if (!request) throw new Error("operator command request missing");
            if (match[1] === "call") {
              state.files.set(
                match[3] as string,
                Buffer.from(JSON.stringify({ status: "PASS", request_hash: digest(request) })),
              );
            } else if (match[1] === "finalize") {
              state.files.set(
                match[3] as string,
                Buffer.from(
                  JSON.stringify({
                    operator_receipts: [],
                    operator_receipt_closure_hash: digest(request),
                  }),
                ),
              );
            } else {
              const document = JSON.parse(request.toString()) as { cell_id: string };
              state.files.set(
                match[3] as string,
                Buffer.from(
                  JSON.stringify({
                    schema_version: "analysis-cell-policy-result@1.0.0",
                    cell_id: document.cell_id,
                    status: "ADMITTED",
                    violations: [],
                  }),
                ),
              );
            }
            return {
              id: `${state.id}-command`,
              logs: { stdout: [], stderr: [] },
              result: [],
              complete: { timestamp: 1, executionTimeMs: 1 },
              exitCode: 0,
            };
          },
          async interrupt() {},
        },
        files: {
          async createDirectories() {},
          async writeFiles(entries) {
            state.write_attempts += 1;
            if (writeFailuresRemaining > 0) {
              writeFailuresRemaining -= 1;
              throw new Error("transient file transfer failure");
            }
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
          if (options.fail_handle_kill) throw new Error("handle kill failed");
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
          async run(_code, runOptions) {
            state.executed_codes.push(_code);
            if (options.hang_agent && state.id === "sandbox-1") {
              await new Promise<void>((_resolve, reject) => {
                runOptions.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
                  once: true,
                });
              });
            }
            if (_code.includes("server-owned-analysis-symbol-extractor@2.1.0")) {
              if (options.symbol_extraction_error) {
                return {
                  id: `${state.id}-execution`,
                  executionCount: 1,
                  logs: { stdout: [], stderr: [] },
                  result: [],
                  error: {
                    name: "TypeError",
                    value: options.symbol_extraction_error,
                    traceback: [],
                    timestamp: 2,
                  },
                  complete: { timestamp: 3, executionTimeMs: 1 },
                  exitCode: 1,
                };
              }
              const pathLiteral = _code.match(/_analysis_output_path = ("(?:\\.|[^"])*")/u)?.[1];
              const specsLiteral = _code.match(
                /_analysis_specs = _analysis_json\.loads\(("(?:\\.|[^"])*")\)/u,
              )?.[1];
              if (!pathLiteral || !specsLiteral) throw new Error("invalid extractor source");
              const path = JSON.parse(pathLiteral) as string;
              const specs = JSON.parse(JSON.parse(specsLiteral) as string) as Array<{
                symbol_name: string;
                expected_kind: "MAPPING" | "TABLE";
              }>;
              state.files.set(
                path,
                Buffer.from(
                  JSON.stringify({
                    schema_version: "analysis-extracted-symbols@1.0.0",
                    symbols: specs.map(({ symbol_name, expected_kind }) =>
                      expected_kind === "MAPPING"
                        ? {
                            symbol_name,
                            symbol_kind: "MAPPING",
                            value: {
                              kind: "OBJECT",
                              entries: [
                                {
                                  key: "value",
                                  value: { kind: "INTEGER", value: "1" },
                                },
                              ],
                            },
                          }
                        : {
                            symbol_name,
                            symbol_kind: "TABLE",
                            columns: ["label", "value"],
                            rows: [
                              [
                                { kind: "STRING", value: "A" },
                                { kind: "INTEGER", value: "1" },
                              ],
                            ],
                          },
                    ),
                  }),
                ),
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
    createLifecycleManager(connectionConfig) {
      connectionProxyModes.push(connectionConfig.useServerProxy);
      return {
        async list(input) {
          managerListCalls += 1;
          if (
            options.fail_manager_list_after !== undefined &&
            managerListCalls > options.fail_manager_list_after
          ) {
            throw new Error("manager list failed");
          }
          return created
            .filter(
              ({ killed, metadata }) =>
                !killed &&
                Object.entries(input.metadata).every(([key, value]) => metadata[key] === value),
            )
            .map(({ id, metadata, created_at }) => ({
              id,
              metadata,
              state: "Running",
              created_at,
            }));
        },
        async kill(sandboxId) {
          const state = created.find(({ id }) => id === sandboxId);
          if (!state) throw new Error("unknown sandbox");
          state.killed = true;
        },
        async close() {},
      };
    },
  };
  const seed = (input: {
    readonly id: string;
    readonly metadata: Readonly<Record<string, string>>;
    readonly created_at: Date;
  }) => {
    created.push({
      ...input,
      image: "seeded",
      files: new Map(),
      killed: false,
      closed: false,
      deleted_contexts: [],
      executed_codes: [],
      write_attempts: 0,
    });
  };
  return { factory, created, seed, connectionProxyModes };
}

describe("OpenSandbox analysis runtime", () => {
  it("classifies only allowlisted fixed extractor identifiers as repairable", () => {
    expect(
      openSandboxAnalysisRuntimeInternals.safeAnalysisSymbolExtractionFailureCode(
        "TypeError: ANALYSIS_RESULT_VALUE_TYPE_UNSUPPORTED",
      ),
    ).toBe("ANALYSIS_RESULT_VALUE_TYPE_UNSUPPORTED");
    expect(
      openSandboxAnalysisRuntimeInternals.safeAnalysisSymbolExtractionFailureCode(
        "secret row value: ANALYSIS_RESULT_NOT_ALLOWLISTED",
      ),
    ).toBeNull();
    expect(
      openSandboxAnalysisRuntimeInternals.safeAnalysisOperatorFailureReasonCode(
        "StatisticalOperatorError: PYTHON_OPERATOR_INPUT_INVALID",
      ),
    ).toBe("PYTHON_OPERATOR_INPUT_INVALID");
    expect(
      openSandboxAnalysisRuntimeInternals.safeAnalysisOperatorFailureReasonCode(
        "PYTHON_OPERATOR_INPUT_INVALID PYTHON_OPERATOR_NUMERIC_FAILURE",
      ),
    ).toBeNull();
    expect(
      openSandboxAnalysisRuntimeInternals.safeAnalysisOperatorFailureReasonCode(
        "PYTHON_OPERATOR_SECRET_VALUE",
      ),
    ).toBeNull();

    const bindingSource = openSandboxAnalysisRuntimeInternals.buildGovernedResultBindingSource({
      input_path: "/workspace/intermediate/result.json",
      result_symbol: "__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
      result_sha256: `sha256:${"a".repeat(64)}`,
      max_bytes: 1_024,
    });
    expect(bindingSource).toContain("module = type(value).__module__");
    expect(bindingSource).toContain("name = type(value).__name__");

    const extractionSource = openSandboxAnalysisRuntimeInternals.buildFixedSymbolExtractionSource({
      specs: [{ symbol_name: "result", expected_kind: "MAPPING" }],
      output_path: "/workspace/intermediate/result.json",
      max_rows: 10,
      max_columns: 10,
      max_bytes: 1_024,
    });
    expect(extractionSource).toContain(
      'type(value) is dict or (module == "builtins" and name == "mappingproxy")',
    );
    expect(extractionSource).toContain('return {"kind": "NULL"}');
  });

  it("returns a bounded reason for a fixed extractor contract rejection", async () => {
    const fake = fakeFactory({
      symbol_extraction_error: "secret prefix ANALYSIS_RESULT_VALUE_TYPE_UNSUPPORTED secret suffix",
    });
    const runtime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: fake.factory,
    });
    const session = await runtime.createSession({
      run_id: "run-extractor-repair",
      node_id: "node-extractor-repair",
      profile: "CORE_ANALYSIS",
    });
    await expect(
      session.extractAgentSymbols({
        extraction_id: "repairable",
        symbols: [{ symbol_name: "operator_inputs", expected_kind: "MAPPING" }],
        limits: { max_rows: 10, max_columns: 10, max_bytes: 10_000 },
        timeout_ms: 1_000,
      }),
    ).rejects.toMatchObject({
      code: "ANALYSIS_SANDBOX_SYMBOL_EXTRACTION_REJECTED",
      reason_code: "ANALYSIS_RESULT_VALUE_TYPE_UNSUPPORTED",
      message: "ANALYSIS_SANDBOX_SYMBOL_EXTRACTION_REJECTED",
    });
    await session.close();
  });

  it("passes the explicit server-proxy topology to every lifecycle client", async () => {
    const fake = fakeFactory();
    const runtime = createOpenSandboxAnalysisRuntime({
      config: { ...testConfig(), use_server_proxy: true },
      sdk_factory: fake.factory,
    });

    await expect(
      runtime.cleanupSession({ run_id: "run-proxy", node_id: "node-proxy" }),
    ).resolves.toEqual({ killed: 0, residual: 0 });
    expect(fake.connectionProxyModes).toEqual([true]);
  });

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
    expect(fake.created.map(({ metadata }) => metadata)).toEqual([
      {
        "managed-by": "data-agent-analysis",
        "run-id": "run-1",
        "node-id": "node-1",
        role: "agent",
      },
      {
        "managed-by": "data-agent-analysis",
        "run-id": "run-1",
        "node-id": "node-1",
        role: "operator",
      },
    ]);

    const input = Buffer.from("parquet-bytes");
    await session.uploadAgentFile({
      path: "/workspace/inputs/orders.parquet",
      content: input,
      content_sha256: digest(input),
    });
    expect(fake.created[0]?.files.get("/workspace/inputs/orders.parquet")).toEqual(input);
    const inputBinding = await session.bindGovernedInput({
      input_name: "orders",
      input_path: "/workspace/inputs/orders.parquet",
      format: "ARROW",
      content_sha256: digest(input),
      timeout_ms: 1_000,
    });
    expect(inputBinding).toMatchObject({
      binding_id: expect.stringMatching(/^input-binding-[a-f0-9]{24}$/u),
      input_symbol: expect.stringMatching(/^__da_input_[a-f0-9]{24}$/u),
      content_sha256: digest(input),
    });
    expect(fake.created[0]?.executed_codes.at(-1)).toContain(
      "server-owned-governed-input-binding@1.0.0",
    );

    await expect(
      session.admitAgentCell({
        cell_id: "cell-1",
        source: "value = 1",
        generated_source_policy: "OPEN_ANALYSIS",
        timeout_ms: 100,
      }),
    ).resolves.toMatchObject({ status: "ADMITTED", cell_id: "cell-1" });

    const cell = await session.runAgentCell({
      cell_id: "cell-1",
      source: "value = 1\nvalue",
      timeout_ms: 100,
    });
    expect(cell).toMatchObject({ status: "SUCCEEDED", result_text: "ok" });
    expect(Buffer.byteLength(cell.stdout)).toBeLessThanOrEqual(testConfig().stdout_bytes);

    await session.recoverAgentContext({
      replay: [
        {
          action_type: "MODEL_CELL",
          journal_seq: 1,
          cell_id: "cell-1",
          source: "value = 1\nvalue",
          source_sha256: digest(new TextEncoder().encode("value = 1\nvalue")),
          timeout_ms: 100,
        },
      ],
    });
    expect(fake.created[0]?.deleted_contexts).toHaveLength(1);
    expect(fake.created[0]?.executed_codes).toContain("value = 1\nvalue");
    expect(
      fake.created[0]?.executed_codes.filter((source) =>
        source.includes("server-owned-governed-input-binding@1.0.0"),
      ),
    ).toHaveLength(2);

    await expect(
      session.extractAgentSymbols({
        extraction_id: "publish-1",
        symbols: [
          { symbol_name: "result_document", expected_kind: "MAPPING" },
          { symbol_name: "trend_table", expected_kind: "TABLE" },
        ],
        limits: { max_rows: 100, max_columns: 10, max_bytes: 100_000 },
        timeout_ms: 1_000,
      }),
    ).resolves.toMatchObject({
      schema_version: "analysis-extracted-symbols@1.0.0",
      symbols: [
        { symbol_name: "result_document", symbol_kind: "MAPPING" },
        { symbol_name: "trend_table", symbol_kind: "TABLE" },
      ],
    });
    const extractionSource = fake.created[0]?.executed_codes.at(-1) ?? "";
    expect(extractionSource).toContain("server-owned-analysis-symbol-extractor@2.1.0");
    expect(extractionSource).toContain('module == "numpy" and name == "ndarray"');
    expect(extractionSource).toContain('module.startswith("pandas.") and name == "Series"');
    expect(extractionSource).toContain("/workspace/intermediate/publish-1.symbols.json");
    expect(extractionSource).not.toContain("/workspace/outputs");

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

    const finalizationRequest = Buffer.from(JSON.stringify({ calls: [] }));
    const finalization = await session.finalizeOperators({
      finalization_id: "final-1",
      request: finalizationRequest,
      request_sha256: digest(finalizationRequest),
      timeout_ms: 100,
    });
    expect(finalization.status).toBe("SUCCEEDED");
    expect(finalization.output_sha256).toBe(digest(finalization.output));

    await session.freezeAgentContext();
    expect(() =>
      session.runAgentCell({ cell_id: "after-stage", source: "value = 2", timeout_ms: 100 }),
    ).toThrow("ANALYSIS_SANDBOX_CONTEXT_FAILED");
    await expect(
      session.runOperator({
        call_id: "after-stage",
        request,
        request_sha256: digest(request),
        timeout_ms: 100,
      }),
    ).rejects.toThrow("ANALYSIS_SANDBOX_CONTEXT_FAILED");
    await expect(
      session.finalizeOperators({
        finalization_id: "after-stage",
        request: finalizationRequest,
        request_sha256: digest(finalizationRequest),
        timeout_ms: 100,
      }),
    ).rejects.toThrow("ANALYSIS_SANDBOX_CONTEXT_FAILED");

    await session.close();
    expect(fake.created.every(({ killed, closed }) => killed && closed)).toBe(true);
    expect(fake.created[0]?.deleted_contexts).toHaveLength(2);
    expect(fake.created[1]?.deleted_contexts).toHaveLength(0);
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

  it("retries bounded transient file writes and still fails closed when exhausted", async () => {
    const content = Buffer.from("bytes");
    const recoveredFactory = fakeFactory({ write_failures: 2 });
    const recoveredRuntime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: recoveredFactory.factory,
    });
    const recovered = await recoveredRuntime.createSession({
      run_id: "run-file-retry",
      node_id: "node-file-retry",
      profile: "CORE_ANALYSIS",
    });
    await expect(
      recovered.uploadAgentFile({
        path: "/workspace/inputs/orders.parquet",
        content,
        content_sha256: digest(content),
      }),
    ).resolves.toBeUndefined();
    expect(recoveredFactory.created[0]?.write_attempts).toBe(3);
    await recovered.close();

    const exhaustedFactory = fakeFactory({ write_failures: 3 });
    const exhaustedRuntime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: exhaustedFactory.factory,
    });
    const exhausted = await exhaustedRuntime.createSession({
      run_id: "run-file-exhausted",
      node_id: "node-file-exhausted",
      profile: "CORE_ANALYSIS",
    });
    await expect(
      exhausted.uploadAgentFile({
        path: "/workspace/inputs/orders.parquet",
        content,
        content_sha256: digest(content),
      }),
    ).rejects.toMatchObject({
      code: "ANALYSIS_SANDBOX_FILE_TRANSFER_FAILED",
      stage: "FILE_TRANSFER",
      retryable: true,
    });
    expect(exhaustedFactory.created[0]?.write_attempts).toBe(3);
    await exhausted.close();
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

  it("bounds active session pairs and releases capacity on close", async () => {
    const fake = fakeFactory();
    const runtime = createOpenSandboxAnalysisRuntime({
      config: { ...testConfig(), max_concurrent_sessions: 1 },
      sdk_factory: fake.factory,
    });
    const first = await runtime.createSession({
      run_id: "run-capacity-1",
      node_id: "node-capacity-1",
      profile: "CORE_ANALYSIS",
    });

    await expect(
      runtime.createSession({
        run_id: "run-capacity-2",
        node_id: "node-capacity-2",
        profile: "CORE_ANALYSIS",
      }),
    ).rejects.toMatchObject({
      code: "ANALYSIS_SANDBOX_CAPACITY_EXHAUSTED",
      stage: "SANDBOX_STARTUP",
      retryable: true,
    });
    expect(fake.created).toHaveLength(2);

    await first.close();
    const second = await runtime.createSession({
      run_id: "run-capacity-2",
      node_id: "node-capacity-2",
      profile: "CORE_ANALYSIS",
    });
    expect(fake.created).toHaveLength(4);
    await second.close();
    expect(fake.created.every(({ killed, closed }) => killed && closed)).toBe(true);
  });

  it("recovers failed handle deletion through the lifecycle manager", async () => {
    const fake = fakeFactory({ fail_handle_kill: true });
    const runtime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: fake.factory,
    });
    const session = await runtime.createSession({
      run_id: "run-manager-fallback",
      node_id: "node-manager-fallback",
      profile: "CORE_ANALYSIS",
    });

    await expect(session.close()).resolves.toBeUndefined();
    expect(fake.created.every(({ killed, closed }) => killed && closed)).toBe(true);
  });

  it("fails with the cleanup code when the lifecycle plane cannot confirm zero", async () => {
    const fake = fakeFactory({ fail_handle_kill: true, fail_manager_list_after: 3 });
    const runtime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: fake.factory,
    });
    const session = await runtime.createSession({
      run_id: "run-cleanup-failure",
      node_id: "node-cleanup-failure",
      profile: "CORE_ANALYSIS",
    });

    await expect(session.close()).rejects.toMatchObject({
      code: "ANALYSIS_SANDBOX_CLEANUP_FAILED",
      stage: "CLEANUP",
      retryable: true,
    });
  });

  it("sweeps expired managed sandboxes and preserves fresh or unmanaged instances", async () => {
    const fake = fakeFactory();
    const now = new Date("2026-08-24T12:00:00.000Z");
    fake.seed({
      id: "old-managed",
      metadata: { "managed-by": "data-agent-analysis" },
      created_at: new Date("2026-08-24T11:58:00.000Z"),
    });
    fake.seed({
      id: "fresh-managed",
      metadata: { "managed-by": "data-agent-analysis" },
      created_at: new Date("2026-08-24T11:59:30.000Z"),
    });
    fake.seed({
      id: "old-unmanaged",
      metadata: { "managed-by": "another-worker" },
      created_at: new Date("2026-08-24T11:00:00.000Z"),
    });
    const runtime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: fake.factory,
    });

    await expect(runtime.sweepOrphans({ now, grace_seconds: 30 })).resolves.toEqual({
      examined: 2,
      killed: 1,
      residual: 0,
    });
    expect(fake.created.find(({ id }) => id === "old-managed")?.killed).toBe(true);
    expect(fake.created.find(({ id }) => id === "fresh-managed")?.killed).toBe(false);
    expect(fake.created.find(({ id }) => id === "old-unmanaged")?.killed).toBe(false);
  });

  it("purges both roles for one recovered run and confirms zero residual sandboxes", async () => {
    const fake = fakeFactory();
    for (const role of ["agent", "operator", "egress"] as const) {
      fake.seed({
        id: `stale-${role}`,
        metadata: {
          "managed-by": "data-agent-analysis",
          "run-id": "run-recovery",
          "node-id": "node-recovery",
          role,
        },
        created_at: new Date("2026-08-24T11:00:00.000Z"),
      });
    }
    fake.seed({
      id: "other-run",
      metadata: {
        "managed-by": "data-agent-analysis",
        "run-id": "run-other",
        "node-id": "node-recovery",
        role: "agent",
      },
      created_at: new Date("2026-08-24T11:00:00.000Z"),
    });
    const runtime = createOpenSandboxAnalysisRuntime({
      config: testConfig(),
      sdk_factory: fake.factory,
    });

    await expect(
      runtime.cleanupSession({ run_id: "run-recovery", node_id: "node-recovery" }),
    ).resolves.toEqual({ killed: 3, residual: 0 });
    expect(fake.created.find(({ id }) => id === "other-run")?.killed).toBe(false);
  });
});
