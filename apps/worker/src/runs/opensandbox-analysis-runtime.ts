import { createHash } from "node:crypto";
import {
  ConnectionConfig,
  type Execution,
  Sandbox,
  type SandboxCreateOptions,
} from "@alibaba-group/opensandbox";
import {
  type CodeContext,
  CodeInterpreter,
  SupportedLanguages,
} from "@alibaba-group/opensandbox-code-interpreter";
import { z } from "zod";

export const ANALYSIS_AGENT_TOOL_NAME = "python_cell" as const;
export const ANALYSIS_OPERATOR_TOOL_NAME = "statistical_operator" as const;

export type AnalysisSandboxProfile = "CORE_ANALYSIS" | "ML_DIAGNOSTIC" | "CAUSAL_L5";

export type AnalysisSandboxFailureStage =
  | "CONFIGURATION"
  | "SANDBOX_STARTUP"
  | "FILE_TRANSFER"
  | "CONTEXT"
  | "CELL"
  | "OPERATOR"
  | "ARTIFACT"
  | "CLEANUP";

export type AnalysisSandboxRuntimeFailureCode =
  | "ANALYSIS_SANDBOX_CONFIGURATION_INVALID"
  | "ANALYSIS_SANDBOX_STARTUP_FAILED"
  | "ANALYSIS_SANDBOX_FILE_TRANSFER_FAILED"
  | "ANALYSIS_SANDBOX_CONTEXT_FAILED"
  | "ANALYSIS_SANDBOX_CELL_TIMEOUT"
  | "ANALYSIS_SANDBOX_CELL_CANCELLED"
  | "ANALYSIS_SANDBOX_CELL_FAILED"
  | "ANALYSIS_SANDBOX_OPERATOR_TIMEOUT"
  | "ANALYSIS_SANDBOX_OPERATOR_FAILED"
  | "ANALYSIS_SANDBOX_ARTIFACT_INVALID"
  | "ANALYSIS_SANDBOX_CLEANUP_FAILED";

export class AnalysisSandboxRuntimeError extends Error {
  override readonly name = "AnalysisSandboxRuntimeError";

  constructor(
    readonly code: AnalysisSandboxRuntimeFailureCode,
    readonly stage: AnalysisSandboxFailureStage,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export interface AnalysisSandboxCellObservation {
  readonly cell_id: string;
  readonly status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  readonly execution_id: string | null;
  readonly execution_count: number | null;
  readonly elapsed_ms: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly result_text: string | null;
  readonly error: null | {
    readonly name: string;
    readonly value: string;
  };
}

export interface AnalysisOperatorObservation {
  readonly call_id: string;
  readonly status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  readonly elapsed_ms: number;
  readonly request_sha256: `sha256:${string}`;
  readonly output_sha256: `sha256:${string}` | null;
  readonly output: Uint8Array | null;
  readonly cell: AnalysisSandboxCellObservation;
}

export interface OpenSandboxAnalysisRuntimeConfig {
  readonly domain: string;
  readonly protocol: "http" | "https";
  readonly api_key: string;
  readonly request_timeout_seconds: number;
  readonly ready_timeout_seconds: number;
  readonly sandbox_timeout_seconds: number;
  readonly secure_access: boolean;
  readonly agent_images: Readonly<Record<AnalysisSandboxProfile, string>>;
  readonly operator_image: string;
  readonly agent_resource: Readonly<Record<string, string>>;
  readonly operator_resource: Readonly<Record<string, string>>;
  readonly max_file_bytes: number;
  readonly stdout_bytes: number;
  readonly stderr_bytes: number;
}

interface SandboxFilePort {
  createDirectories(
    entries: readonly { readonly path: string; readonly mode: number }[],
  ): Promise<void>;
  writeFiles(
    entries: readonly {
      readonly path: string;
      readonly data: Uint8Array;
      readonly mode: number;
    }[],
  ): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  getFileInfo(paths: string[]): Promise<Record<string, { readonly size?: number }>>;
}

interface AnalysisSandboxHandle {
  readonly id: string;
  readonly files: SandboxFilePort;
  kill(): Promise<void>;
  close(): Promise<void>;
}

interface AnalysisCodePort {
  createContext(language: "python"): Promise<CodeContext>;
  deleteContext(contextId: string): Promise<void>;
  run(
    code: string,
    options: { readonly context: CodeContext; readonly signal?: AbortSignal },
  ): Promise<Execution>;
  interrupt(contextId: string): Promise<void>;
}

interface AnalysisInterpreterHandle {
  readonly codes: AnalysisCodePort;
}

export interface OpenSandboxSdkFactory {
  createSandbox(options: SandboxCreateOptions): Promise<AnalysisSandboxHandle>;
  createInterpreter(sandbox: AnalysisSandboxHandle): Promise<AnalysisInterpreterHandle>;
}

const defaultSdkFactory: OpenSandboxSdkFactory = Object.freeze({
  async createSandbox(options: SandboxCreateOptions) {
    return Sandbox.create(options) as Promise<AnalysisSandboxHandle>;
  },
  async createInterpreter(sandbox: AnalysisSandboxHandle) {
    return CodeInterpreter.create(sandbox as Sandbox) as Promise<AnalysisInterpreterHandle>;
  },
});

export interface OpenSandboxAnalysisSession {
  readonly agent_sandbox_id: string;
  readonly operator_sandbox_id: string;
  uploadAgentFile(input: {
    readonly path: string;
    readonly content: Uint8Array;
    readonly content_sha256: `sha256:${string}`;
  }): Promise<void>;
  runAgentCell(input: {
    readonly cell_id: string;
    readonly source: string;
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  }): Promise<AnalysisSandboxCellObservation>;
  readAgentFile(input: {
    readonly path: string;
    readonly expected_sha256?: `sha256:${string}`;
  }): Promise<Uint8Array>;
  runOperator(input: {
    readonly call_id: string;
    readonly request: Uint8Array;
    readonly request_sha256: `sha256:${string}`;
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  }): Promise<AnalysisOperatorObservation>;
  close(): Promise<void>;
}

export interface OpenSandboxAnalysisRuntime {
  createSession(input: {
    readonly run_id: string;
    readonly node_id: string;
    readonly profile: AnalysisSandboxProfile;
    readonly signal?: AbortSignal;
  }): Promise<OpenSandboxAnalysisSession>;
}

type CreateAnalysisSandboxSessionInput = Parameters<OpenSandboxAnalysisRuntime["createSession"]>[0];

const configSchema = z.strictObject({
  domain: z.string().trim().min(1).max(512),
  protocol: z.enum(["http", "https"]),
  api_key: z.string().min(16).max(1_024),
  request_timeout_seconds: z.number().int().min(1).max(600),
  ready_timeout_seconds: z.number().int().min(1).max(600),
  sandbox_timeout_seconds: z.number().int().min(30).max(3_600),
  secure_access: z.boolean(),
  agent_images: z.strictObject({
    CORE_ANALYSIS: z.string().trim().min(1).max(1_024),
    ML_DIAGNOSTIC: z.string().trim().min(1).max(1_024),
    CAUSAL_L5: z.string().trim().min(1).max(1_024),
  }),
  operator_image: z.string().trim().min(1).max(1_024),
  agent_resource: z.record(z.string(), z.string().min(1)).refine((value) => {
    return Object.keys(value).length > 0;
  }),
  operator_resource: z.record(z.string(), z.string().min(1)).refine((value) => {
    return Object.keys(value).length > 0;
  }),
  max_file_bytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024 * 1024),
  stdout_bytes: z
    .number()
    .int()
    .nonnegative()
    .max(1024 * 1024),
  stderr_bytes: z
    .number()
    .int()
    .nonnegative()
    .max(1024 * 1024),
});

const safeSegmentSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const sandboxPathSchema = z
  .string()
  .regex(
    /^\/workspace\/(?:inputs|sealed|operator-inputs|operator-outputs|intermediate|outputs)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u,
  );

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function boundedText(value: string, maximum: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximum) return value;
  return bytes.subarray(0, maximum).toString("utf8");
}

function executionText(execution: Execution, stream: "stdout" | "stderr", maximum: number) {
  return boundedText(execution.logs[stream].map(({ text }) => text).join(""), maximum);
}

function cellObservation(input: {
  readonly cell_id: string;
  readonly execution: Execution;
  readonly elapsed_ms: number;
  readonly stdout_bytes: number;
  readonly stderr_bytes: number;
}): AnalysisSandboxCellObservation {
  const error = input.execution.error;
  return Object.freeze({
    cell_id: input.cell_id,
    status: error ? "FAILED" : "SUCCEEDED",
    execution_id: input.execution.id ?? null,
    execution_count: input.execution.executionCount ?? null,
    elapsed_ms: input.elapsed_ms,
    stdout: executionText(input.execution, "stdout", input.stdout_bytes),
    stderr: executionText(input.execution, "stderr", input.stderr_bytes),
    result_text: input.execution.result.at(-1)?.text ?? null,
    error: error ? { name: error.name, value: boundedText(error.value, 4_096) } : null,
  });
}

async function runCellWithDeadline(input: {
  readonly codes: AnalysisCodePort;
  readonly context: CodeContext;
  readonly cell_id: string;
  readonly source: string;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal;
  readonly timeout_code: Extract<
    AnalysisSandboxRuntimeFailureCode,
    "ANALYSIS_SANDBOX_CELL_TIMEOUT" | "ANALYSIS_SANDBOX_OPERATOR_TIMEOUT"
  >;
  readonly failure_code: Extract<
    AnalysisSandboxRuntimeFailureCode,
    "ANALYSIS_SANDBOX_CELL_FAILED" | "ANALYSIS_SANDBOX_OPERATOR_FAILED"
  >;
  readonly stdout_bytes: number;
  readonly stderr_bytes: number;
}): Promise<AnalysisSandboxCellObservation> {
  const contextId = input.context.id;
  if (!contextId) {
    throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_CONTEXT_FAILED", "CONTEXT", false);
  }
  if (input.signal?.aborted) {
    throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_CELL_CANCELLED", "CELL", false);
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeout_ms);
  timeout.unref();
  const cancel = () => controller.abort();
  input.signal?.addEventListener("abort", cancel, { once: true });
  const started = Date.now();
  try {
    const execution = await input.codes.run(input.source, {
      context: input.context,
      signal: controller.signal,
    });
    const observation = cellObservation({
      cell_id: input.cell_id,
      execution,
      elapsed_ms: Math.max(0, Date.now() - started),
      stdout_bytes: input.stdout_bytes,
      stderr_bytes: input.stderr_bytes,
    });
    if (observation.status === "FAILED") {
      throw new AnalysisSandboxRuntimeError(
        input.failure_code,
        input.failure_code === "ANALYSIS_SANDBOX_OPERATOR_FAILED" ? "OPERATOR" : "CELL",
        false,
      );
    }
    return observation;
  } catch (error) {
    if (timedOut || input.signal?.aborted || controller.signal.aborted) {
      await input.codes.interrupt(contextId).catch(() => {});
      if (timedOut) {
        throw new AnalysisSandboxRuntimeError(
          input.timeout_code,
          input.timeout_code === "ANALYSIS_SANDBOX_OPERATOR_TIMEOUT" ? "OPERATOR" : "CELL",
          true,
        );
      }
      throw new AnalysisSandboxRuntimeError(
        "ANALYSIS_SANDBOX_CELL_CANCELLED",
        input.failure_code === "ANALYSIS_SANDBOX_OPERATOR_FAILED" ? "OPERATOR" : "CELL",
        false,
      );
    }
    if (error instanceof AnalysisSandboxRuntimeError) throw error;
    throw new AnalysisSandboxRuntimeError(
      input.failure_code,
      input.failure_code === "ANALYSIS_SANDBOX_OPERATOR_FAILED" ? "OPERATOR" : "CELL",
      false,
    );
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", cancel);
  }
}

async function createSandboxPair(input: {
  readonly config: OpenSandboxAnalysisRuntimeConfig;
  readonly factory: OpenSandboxSdkFactory;
  readonly run_id: string;
  readonly node_id: string;
  readonly profile: AnalysisSandboxProfile;
}) {
  const connectionConfig = new ConnectionConfig({
    domain: input.config.domain,
    protocol: input.config.protocol,
    apiKey: input.config.api_key,
    requestTimeoutSeconds: input.config.request_timeout_seconds,
  });
  const base = {
    connectionConfig,
    entrypoint: ["/opt/code-interpreter/code-interpreter.sh"],
    env: {
      PYTHONHASHSEED: "0",
      MPLBACKEND: "Agg",
      OMP_NUM_THREADS: "1",
      OPENBLAS_NUM_THREADS: "1",
      MKL_NUM_THREADS: "1",
      NUMEXPR_NUM_THREADS: "1",
      VECLIB_MAXIMUM_THREADS: "1",
      BLIS_NUM_THREADS: "1",
    },
    networkPolicy: { defaultAction: "deny" as const, egress: [] },
    timeoutSeconds: input.config.sandbox_timeout_seconds,
    readyTimeoutSeconds: input.config.ready_timeout_seconds,
    secureAccess: input.config.secure_access,
  } satisfies Partial<SandboxCreateOptions>;
  const metadata = {
    "data-agent-run": input.run_id,
    "data-agent-node": input.node_id,
  };
  let agent: AnalysisSandboxHandle | null = null;
  try {
    agent = await input.factory.createSandbox({
      ...base,
      image: input.config.agent_images[input.profile],
      resource: input.config.agent_resource,
      metadata: { ...metadata, "data-agent-role": "agent" },
    });
    const operator = await input.factory.createSandbox({
      ...base,
      image: input.config.operator_image,
      resource: input.config.operator_resource,
      metadata: { ...metadata, "data-agent-role": "operator" },
    });
    return { agent, operator };
  } catch {
    if (agent) {
      await agent.kill().catch(() => {});
      await agent.close().catch(() => {});
    }
    throw new AnalysisSandboxRuntimeError(
      "ANALYSIS_SANDBOX_STARTUP_FAILED",
      "SANDBOX_STARTUP",
      true,
    );
  }
}

async function initializeSandbox(sandbox: AnalysisSandboxHandle, factory: OpenSandboxSdkFactory) {
  const interpreter = await factory.createInterpreter(sandbox);
  await sandbox.files.createDirectories(
    [
      "/workspace/inputs",
      "/workspace/sealed",
      "/workspace/operator-inputs",
      "/workspace/operator-outputs",
      "/workspace/intermediate",
      "/workspace/outputs",
    ].map((path) => ({ path, mode: 700 })),
  );
  const context = await interpreter.codes.createContext(SupportedLanguages.PYTHON);
  if (!context.id) {
    throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_CONTEXT_FAILED", "CONTEXT", false);
  }
  return { interpreter, context };
}

export function createOpenSandboxAnalysisRuntime(input: {
  readonly config: OpenSandboxAnalysisRuntimeConfig;
  readonly sdk_factory?: OpenSandboxSdkFactory;
}): OpenSandboxAnalysisRuntime {
  const config = configSchema.parse(input.config);
  const factory = input.sdk_factory ?? defaultSdkFactory;
  return Object.freeze({
    async createSession(sessionInput: CreateAnalysisSandboxSessionInput) {
      safeSegmentSchema.parse(sessionInput.run_id);
      safeSegmentSchema.parse(sessionInput.node_id);
      if (sessionInput.signal?.aborted) {
        throw new AnalysisSandboxRuntimeError(
          "ANALYSIS_SANDBOX_CELL_CANCELLED",
          "SANDBOX_STARTUP",
          false,
        );
      }
      const pair = await createSandboxPair({ ...sessionInput, config, factory });
      let agentRuntime: Awaited<ReturnType<typeof initializeSandbox>> | null = null;
      let operatorRuntime: Awaited<ReturnType<typeof initializeSandbox>> | null = null;
      try {
        [agentRuntime, operatorRuntime] = await Promise.all([
          initializeSandbox(pair.agent, factory),
          initializeSandbox(pair.operator, factory),
        ]);
      } catch (error) {
        await Promise.allSettled([pair.agent.kill(), pair.operator.kill()]);
        await Promise.allSettled([pair.agent.close(), pair.operator.close()]);
        if (error instanceof AnalysisSandboxRuntimeError) throw error;
        throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_CONTEXT_FAILED", "CONTEXT", true);
      }
      const agent = agentRuntime;
      const operator = operatorRuntime;
      let closed = false;
      const assertOpen = () => {
        if (closed) {
          throw new AnalysisSandboxRuntimeError(
            "ANALYSIS_SANDBOX_CLEANUP_FAILED",
            "CLEANUP",
            false,
          );
        }
      };
      const read = async (
        sandbox: AnalysisSandboxHandle,
        pathInput: string,
        expected?: `sha256:${string}`,
      ) => {
        const path = sandboxPathSchema.parse(pathInput);
        try {
          const info = await sandbox.files.getFileInfo([path]);
          const size = info[path]?.size;
          if (typeof size === "number" && size > config.max_file_bytes) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
              "ARTIFACT",
              false,
            );
          }
          const bytes = await sandbox.files.readBytes(path);
          if (
            bytes.byteLength > config.max_file_bytes ||
            (expected && digest(bytes) !== expected)
          ) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
              "ARTIFACT",
              false,
            );
          }
          return bytes;
        } catch (error) {
          if (error instanceof AnalysisSandboxRuntimeError) throw error;
          throw new AnalysisSandboxRuntimeError(
            "ANALYSIS_SANDBOX_FILE_TRANSFER_FAILED",
            "FILE_TRANSFER",
            true,
          );
        }
      };
      return Object.freeze({
        agent_sandbox_id: pair.agent.id,
        operator_sandbox_id: pair.operator.id,
        async uploadAgentFile(uploadInput) {
          assertOpen();
          const path = sandboxPathSchema.parse(uploadInput.path);
          if (
            uploadInput.content.byteLength > config.max_file_bytes ||
            digest(uploadInput.content) !== uploadInput.content_sha256
          ) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
              "ARTIFACT",
              false,
            );
          }
          try {
            await pair.agent.files.writeFiles([{ path, data: uploadInput.content, mode: 400 }]);
          } catch {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_FILE_TRANSFER_FAILED",
              "FILE_TRANSFER",
              true,
            );
          }
        },
        runAgentCell(cellInput) {
          assertOpen();
          safeSegmentSchema.parse(cellInput.cell_id);
          return runCellWithDeadline({
            codes: agent.interpreter.codes,
            context: agent.context,
            cell_id: cellInput.cell_id,
            source: cellInput.source,
            timeout_ms: cellInput.timeout_ms,
            ...(cellInput.signal ? { signal: cellInput.signal } : {}),
            timeout_code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
            failure_code: "ANALYSIS_SANDBOX_CELL_FAILED",
            stdout_bytes: config.stdout_bytes,
            stderr_bytes: config.stderr_bytes,
          });
        },
        readAgentFile(readInput) {
          assertOpen();
          return read(pair.agent, readInput.path, readInput.expected_sha256);
        },
        async runOperator(operatorInput) {
          assertOpen();
          const callId = safeSegmentSchema.parse(operatorInput.call_id);
          if (
            operatorInput.request.byteLength > config.max_file_bytes ||
            digest(operatorInput.request) !== operatorInput.request_sha256
          ) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
              "ARTIFACT",
              false,
            );
          }
          const requestPath = `/workspace/operator-inputs/${callId}.json`;
          const outputPath = `/workspace/operator-outputs/${callId}.json`;
          try {
            await pair.operator.files.writeFiles([
              { path: requestPath, data: operatorInput.request, mode: 400 },
            ]);
          } catch {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_FILE_TRANSFER_FAILED",
              "FILE_TRANSFER",
              true,
            );
          }
          const source = [
            "from data_agent_stats.dispatcher import execute_call_file",
            `execute_call_file(${JSON.stringify(requestPath)}, ${JSON.stringify(outputPath)})`,
            JSON.stringify(`operator:${callId}:completed`),
          ].join("\n");
          const started = Date.now();
          const cell = await runCellWithDeadline({
            codes: operator.interpreter.codes,
            context: operator.context,
            cell_id: `operator-${callId}`,
            source,
            timeout_ms: operatorInput.timeout_ms,
            ...(operatorInput.signal ? { signal: operatorInput.signal } : {}),
            timeout_code: "ANALYSIS_SANDBOX_OPERATOR_TIMEOUT",
            failure_code: "ANALYSIS_SANDBOX_OPERATOR_FAILED",
            stdout_bytes: config.stdout_bytes,
            stderr_bytes: config.stderr_bytes,
          });
          const output = await read(pair.operator, outputPath);
          return Object.freeze({
            call_id: callId,
            status: "SUCCEEDED" as const,
            elapsed_ms: Math.max(0, Date.now() - started),
            request_sha256: operatorInput.request_sha256,
            output_sha256: digest(output),
            output,
            cell,
          });
        },
        async close() {
          if (closed) return;
          closed = true;
          const contextCleanup = await Promise.allSettled([
            agent.interpreter.codes.deleteContext(agent.context.id as string),
            operator.interpreter.codes.deleteContext(operator.context.id as string),
          ]);
          const sandboxCleanup = await Promise.allSettled([
            pair.agent.kill(),
            pair.operator.kill(),
          ]);
          await Promise.allSettled([pair.agent.close(), pair.operator.close()]);
          if ([...contextCleanup, ...sandboxCleanup].some(({ status }) => status === "rejected")) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_CLEANUP_FAILED",
              "CLEANUP",
              true,
            );
          }
        },
      } satisfies OpenSandboxAnalysisSession);
    },
  });
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new AnalysisSandboxRuntimeError(
      "ANALYSIS_SANDBOX_CONFIGURATION_INVALID",
      "CONFIGURATION",
      false,
    );
  }
  return value;
}

export function createEnvironmentOpenSandboxAnalysisRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): OpenSandboxAnalysisRuntime | null {
  if (environment.ANALYSIS_SANDBOX_ENABLED !== "true") return null;
  try {
    return createOpenSandboxAnalysisRuntime({
      config: {
        domain: requiredEnvironment(environment, "ANALYSIS_SANDBOX_SERVER_DOMAIN"),
        protocol: z
          .enum(["http", "https"])
          .parse(requiredEnvironment(environment, "ANALYSIS_SANDBOX_SERVER_PROTOCOL")),
        api_key: requiredEnvironment(environment, "ANALYSIS_SANDBOX_API_KEY"),
        request_timeout_seconds: z.coerce
          .number()
          .int()
          .min(1)
          .max(600)
          .parse(environment.ANALYSIS_SANDBOX_REQUEST_TIMEOUT_SECONDS ?? 120),
        ready_timeout_seconds: z.coerce
          .number()
          .int()
          .min(1)
          .max(600)
          .parse(environment.ANALYSIS_SANDBOX_READY_TIMEOUT_SECONDS ?? 180),
        sandbox_timeout_seconds: z.coerce
          .number()
          .int()
          .min(30)
          .max(3_600)
          .parse(environment.ANALYSIS_SANDBOX_TTL_SECONDS ?? 900),
        secure_access:
          z
            .enum(["true", "false"])
            .parse(requiredEnvironment(environment, "ANALYSIS_SANDBOX_SECURE_ACCESS")) === "true",
        agent_images: {
          CORE_ANALYSIS: requiredEnvironment(environment, "ANALYSIS_SANDBOX_AGENT_CORE_IMAGE"),
          ML_DIAGNOSTIC: requiredEnvironment(environment, "ANALYSIS_SANDBOX_AGENT_ML_IMAGE"),
          CAUSAL_L5: requiredEnvironment(environment, "ANALYSIS_SANDBOX_AGENT_CAUSAL_IMAGE"),
        },
        operator_image: requiredEnvironment(environment, "ANALYSIS_SANDBOX_OPERATOR_IMAGE"),
        agent_resource: { cpu: "1", memory: "1Gi" },
        operator_resource: { cpu: "1", memory: "1Gi" },
        max_file_bytes: 256 * 1024 * 1024,
        stdout_bytes: 4_096,
        stderr_bytes: 16_384,
      },
    });
  } catch (error) {
    if (error instanceof AnalysisSandboxRuntimeError) throw error;
    throw new AnalysisSandboxRuntimeError(
      "ANALYSIS_SANDBOX_CONFIGURATION_INVALID",
      "CONFIGURATION",
      false,
    );
  }
}

export const openSandboxAnalysisRuntimeInternals = Object.freeze({
  digest,
  sandboxPathSchema,
  safeSegmentSchema,
});
