import { createHash } from "node:crypto";
import {
  ConnectionConfig,
  type Execution,
  Sandbox,
  type SandboxCreateOptions,
  type SandboxInfo,
  SandboxManager,
} from "@alibaba-group/opensandbox";
import {
  type CodeContext,
  CodeInterpreter,
  SupportedLanguages,
} from "@alibaba-group/opensandbox-code-interpreter";
import type { GovernedOperatorResultRef } from "@data-agent/contracts/ports";
import { z } from "zod";
import type { AnalysisContextReplayAction } from "../analysis/governed-result-bridge.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

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
  | "ANALYSIS_SANDBOX_CAPACITY_EXHAUSTED"
  | "ANALYSIS_SANDBOX_STARTUP_FAILED"
  | "ANALYSIS_SANDBOX_FILE_TRANSFER_FAILED"
  | "ANALYSIS_SANDBOX_CONTEXT_FAILED"
  | "ANALYSIS_SANDBOX_CELL_TIMEOUT"
  | "ANALYSIS_SANDBOX_CELL_CANCELLED"
  | "ANALYSIS_SANDBOX_CELL_POLICY_REJECTED"
  | "ANALYSIS_SANDBOX_CELL_FAILED"
  | "ANALYSIS_SANDBOX_SYMBOL_EXTRACTION_REJECTED"
  | "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH"
  | "ANALYSIS_SANDBOX_OPERATOR_TIMEOUT"
  | "ANALYSIS_SANDBOX_OPERATOR_FAILED"
  | "ANALYSIS_SANDBOX_ARTIFACT_INVALID"
  | "ANALYSIS_SANDBOX_CLEANUP_FAILED";

export type AnalysisSymbolExtractionFailureCode =
  | "ANALYSIS_RESULT_NESTING_EXCEEDED"
  | "ANALYSIS_RESULT_INTEGER_UNSAFE"
  | "ANALYSIS_RESULT_NUMBER_NON_FINITE"
  | "ANALYSIS_RESULT_DECIMAL_NON_FINITE"
  | "ANALYSIS_RESULT_TIMESTAMP_TIMEZONE_REQUIRED"
  | "ANALYSIS_RESULT_ARRAY_LIMIT_EXCEEDED"
  | "ANALYSIS_RESULT_OBJECT_INVALID"
  | "ANALYSIS_RESULT_VALUE_TYPE_UNSUPPORTED"
  | "ANALYSIS_RESULT_TABLE_EMPTY_SCHEMA"
  | "ANALYSIS_RESULT_TABLE_ROW_INVALID"
  | "ANALYSIS_RESULT_TABLE_COLUMNS_UNSTABLE"
  | "ANALYSIS_RESULT_TABLE_TYPE_UNSUPPORTED"
  | "ANALYSIS_RESULT_TABLE_BOUNDS_OR_SCHEMA_INVALID"
  | "ANALYSIS_RESULT_SYMBOL_MISSING"
  | "ANALYSIS_RESULT_MAPPING_TYPE_UNSUPPORTED"
  | "ANALYSIS_RESULT_EXTRACTION_SIZE_EXCEEDED";

export type AnalysisOperatorFailureReasonCode =
  | "PYTHON_OPERATOR_APPLICABILITY_HOLD"
  | "PYTHON_OPERATOR_DUPLICATE_CALL_ID"
  | "PYTHON_OPERATOR_INPUT_INVALID"
  | "PYTHON_OPERATOR_NOT_AUTHORIZED"
  | "PYTHON_OPERATOR_NOT_REGISTERED"
  | "PYTHON_OPERATOR_NUMERIC_FAILURE"
  | "PYTHON_OPERATOR_PARAMETER_INVALID"
  | "PYTHON_OPERATOR_PATH_INVALID"
  | "PYTHON_OPERATOR_RECEIPT_CLOSURE_MISMATCH"
  | "PYTHON_OPERATOR_REGISTRY_DIGEST_MISMATCH"
  | "PYTHON_OPERATOR_REQUIRED_CALL_MISSING"
  | "PYTHON_OPERATOR_RESULT_BINDING_MISMATCH"
  | "PYTHON_OPERATOR_UNDECLARED_CALL";

export type AnalysisSandboxFailureReasonCode =
  | AnalysisSymbolExtractionFailureCode
  | AnalysisOperatorFailureReasonCode;

const analysisSymbolExtractionFailureCodes = new Set<AnalysisSymbolExtractionFailureCode>([
  "ANALYSIS_RESULT_NESTING_EXCEEDED",
  "ANALYSIS_RESULT_INTEGER_UNSAFE",
  "ANALYSIS_RESULT_NUMBER_NON_FINITE",
  "ANALYSIS_RESULT_DECIMAL_NON_FINITE",
  "ANALYSIS_RESULT_TIMESTAMP_TIMEZONE_REQUIRED",
  "ANALYSIS_RESULT_ARRAY_LIMIT_EXCEEDED",
  "ANALYSIS_RESULT_OBJECT_INVALID",
  "ANALYSIS_RESULT_VALUE_TYPE_UNSUPPORTED",
  "ANALYSIS_RESULT_TABLE_EMPTY_SCHEMA",
  "ANALYSIS_RESULT_TABLE_ROW_INVALID",
  "ANALYSIS_RESULT_TABLE_COLUMNS_UNSTABLE",
  "ANALYSIS_RESULT_TABLE_TYPE_UNSUPPORTED",
  "ANALYSIS_RESULT_TABLE_BOUNDS_OR_SCHEMA_INVALID",
  "ANALYSIS_RESULT_SYMBOL_MISSING",
  "ANALYSIS_RESULT_MAPPING_TYPE_UNSUPPORTED",
  "ANALYSIS_RESULT_EXTRACTION_SIZE_EXCEEDED",
]);

const analysisOperatorFailureReasonCodes = new Set<AnalysisOperatorFailureReasonCode>([
  "PYTHON_OPERATOR_APPLICABILITY_HOLD",
  "PYTHON_OPERATOR_DUPLICATE_CALL_ID",
  "PYTHON_OPERATOR_INPUT_INVALID",
  "PYTHON_OPERATOR_NOT_AUTHORIZED",
  "PYTHON_OPERATOR_NOT_REGISTERED",
  "PYTHON_OPERATOR_NUMERIC_FAILURE",
  "PYTHON_OPERATOR_PARAMETER_INVALID",
  "PYTHON_OPERATOR_PATH_INVALID",
  "PYTHON_OPERATOR_RECEIPT_CLOSURE_MISMATCH",
  "PYTHON_OPERATOR_REGISTRY_DIGEST_MISMATCH",
  "PYTHON_OPERATOR_REQUIRED_CALL_MISSING",
  "PYTHON_OPERATOR_RESULT_BINDING_MISMATCH",
  "PYTHON_OPERATOR_UNDECLARED_CALL",
]);

function safeAnalysisSymbolExtractionFailureCode(
  value: string | undefined,
): AnalysisSymbolExtractionFailureCode | null {
  const candidates = value?.match(/ANALYSIS_RESULT_[A-Z0-9_]+/gu) ?? [];
  const distinct = [...new Set(candidates)];
  if (distinct.length !== 1) return null;
  const [candidate] = distinct;
  return analysisSymbolExtractionFailureCodes.has(candidate as AnalysisSymbolExtractionFailureCode)
    ? (candidate as AnalysisSymbolExtractionFailureCode)
    : null;
}

function safeAnalysisOperatorFailureReasonCode(
  value: string | undefined,
): AnalysisOperatorFailureReasonCode | null {
  const candidates = value?.match(/PYTHON_OPERATOR_[A-Z0-9_]+/gu) ?? [];
  const distinct = [...new Set(candidates)];
  if (distinct.length !== 1) return null;
  const [candidate] = distinct;
  return analysisOperatorFailureReasonCodes.has(candidate as AnalysisOperatorFailureReasonCode)
    ? (candidate as AnalysisOperatorFailureReasonCode)
    : null;
}

export class AnalysisSandboxRuntimeError extends Error {
  override readonly name = "AnalysisSandboxRuntimeError";

  constructor(
    readonly code: AnalysisSandboxRuntimeFailureCode,
    readonly stage: AnalysisSandboxFailureStage,
    readonly retryable: boolean,
    readonly reason_code: AnalysisSandboxFailureReasonCode | null = null,
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

export interface AnalysisOperatorFinalizationObservation {
  readonly finalization_id: string;
  readonly status: "SUCCEEDED";
  readonly elapsed_ms: number;
  readonly request_sha256: `sha256:${string}`;
  readonly output_sha256: `sha256:${string}`;
  readonly output: Uint8Array;
  readonly cell: AnalysisSandboxCellObservation;
}

export interface AnalysisCellPolicyObservation {
  readonly schema_version: "analysis-cell-policy-result@1.0.0";
  readonly cell_id: string;
  readonly status: "ADMITTED" | "REJECTED";
  readonly violations: readonly {
    readonly code: string;
    readonly line: number;
    readonly detail: string;
  }[];
}

export interface OpenSandboxAnalysisRuntimeConfig {
  readonly domain: string;
  readonly protocol: "http" | "https";
  readonly api_key: string;
  readonly use_server_proxy: boolean;
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
  readonly max_concurrent_sessions?: number;
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

interface SandboxCommandPort {
  run(
    command: string,
    options: {
      readonly workingDirectory?: string;
      readonly timeoutSeconds?: number;
      readonly envs?: Readonly<Record<string, string>>;
    },
    handlers?: {
      readonly onInit?: (input: { readonly id: string }) => void | Promise<void>;
    },
    signal?: AbortSignal,
  ): Promise<Execution>;
  interrupt(commandId: string): Promise<void>;
}

interface AnalysisSandboxHandle {
  readonly id: string;
  readonly files: SandboxFilePort;
  readonly commands: SandboxCommandPort;
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

export interface AnalysisManagedSandboxInfo {
  readonly id: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly state: string;
  readonly created_at: Date;
}

export interface AnalysisSandboxLifecyclePort {
  list(input: {
    readonly metadata: Readonly<Record<string, string>>;
  }): Promise<readonly AnalysisManagedSandboxInfo[]>;
  kill(sandboxId: string): Promise<void>;
  close(): Promise<void>;
}

export interface OpenSandboxSdkFactory {
  createSandbox(options: SandboxCreateOptions): Promise<AnalysisSandboxHandle>;
  createInterpreter(sandbox: AnalysisSandboxHandle): Promise<AnalysisInterpreterHandle>;
  createLifecycleManager(connectionConfig: ConnectionConfig): AnalysisSandboxLifecyclePort;
}

function managedSandboxInfo(info: SandboxInfo): AnalysisManagedSandboxInfo {
  return Object.freeze({
    id: info.id,
    metadata: Object.freeze({ ...(info.metadata ?? {}) }),
    state: info.status.state,
    created_at: info.createdAt,
  });
}

const defaultSdkFactory: OpenSandboxSdkFactory = Object.freeze({
  async createSandbox(options: SandboxCreateOptions) {
    return Sandbox.create(options) as Promise<AnalysisSandboxHandle>;
  },
  async createInterpreter(sandbox: AnalysisSandboxHandle) {
    return CodeInterpreter.create(sandbox as Sandbox) as Promise<AnalysisInterpreterHandle>;
  },
  createLifecycleManager(connectionConfig: ConnectionConfig): AnalysisSandboxLifecyclePort {
    const manager = SandboxManager.create({ connectionConfig });
    return Object.freeze({
      async list(input: {
        readonly metadata: Readonly<Record<string, string>>;
      }): Promise<readonly AnalysisManagedSandboxInfo[]> {
        const items: AnalysisManagedSandboxInfo[] = [];
        let page = 1;
        for (;;) {
          const response = await manager.listSandboxInfos({
            metadata: { ...input.metadata },
            page,
            pageSize: 100,
          });
          items.push(
            ...response.items
              .filter(({ status }) => status.state !== "Deleted")
              .map(managedSandboxInfo),
          );
          if (!response.pagination?.hasNextPage) break;
          page += 1;
        }
        return Object.freeze(items);
      },
      kill(sandboxId: string) {
        return manager.killSandbox(sandboxId);
      },
      close() {
        return manager.close();
      },
    });
  },
});

export interface OpenSandboxAnalysisSession {
  readonly agent_sandbox_id: string;
  readonly operator_sandbox_id: string;
  readonly runtime_profile: AnalysisSandboxProfile;
  readonly agent_image: string;
  readonly operator_image: string;
  readonly secure_access: boolean;
  uploadAgentFile(input: {
    readonly path: string;
    readonly content: Uint8Array;
    readonly content_sha256: `sha256:${string}`;
  }): Promise<void>;
  bindGovernedInput(input: {
    readonly input_name: string;
    readonly input_path: string;
    readonly format: "ARROW" | "CSV" | "JSON";
    readonly content_sha256: `sha256:${string}`;
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly binding_id: string;
    readonly input_symbol: string;
    readonly content_sha256: `sha256:${string}`;
  }>;
  admitAgentCell(input: {
    readonly cell_id: string;
    readonly source: string;
    readonly generated_source_policy: "OPEN_ANALYSIS" | "GOVERNED_OPERATOR_ORCHESTRATION";
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  }): Promise<AnalysisCellPolicyObservation>;
  runAgentCell(input: {
    readonly cell_id: string;
    readonly source: string;
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  }): Promise<AnalysisSandboxCellObservation>;
  recoverAgentContext(input: {
    readonly replay: readonly AnalysisContextReplayAction[];
    readonly signal?: AbortSignal;
  }): Promise<void>;
  freezeAgentContext(): Promise<void>;
  bindGovernedResult(input: {
    readonly governed_result: GovernedOperatorResultRef;
    readonly authoritative_content: Uint8Array;
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly binding_id: string;
    readonly result_symbol: string;
    readonly result_sha256: `sha256:${string}`;
  }>;
  extractAgentSymbols(input: {
    readonly extraction_id: string;
    readonly symbols: readonly {
      readonly symbol_name: string;
      readonly expected_kind: "MAPPING" | "TABLE";
    }[];
    readonly limits: {
      readonly max_rows: number;
      readonly max_columns: number;
      readonly max_bytes: number;
    };
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  runOperator(input: {
    readonly call_id: string;
    readonly request: Uint8Array;
    readonly request_sha256: `sha256:${string}`;
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  }): Promise<AnalysisOperatorObservation>;
  finalizeOperators(input: {
    readonly finalization_id: string;
    readonly request: Uint8Array;
    readonly request_sha256: `sha256:${string}`;
    readonly timeout_ms: number;
    readonly signal?: AbortSignal;
  }): Promise<AnalysisOperatorFinalizationObservation>;
  close(): Promise<void>;
}

export interface OpenSandboxAnalysisRuntime {
  cleanupSession(input: { readonly run_id: string; readonly node_id: string }): Promise<{
    readonly killed: number;
    readonly residual: 0;
  }>;
  createSession(input: {
    readonly run_id: string;
    readonly node_id: string;
    readonly profile: AnalysisSandboxProfile;
    readonly signal?: AbortSignal;
  }): Promise<OpenSandboxAnalysisSession>;
  sweepOrphans(input?: { readonly now?: Date; readonly grace_seconds?: number }): Promise<{
    readonly examined: number;
    readonly killed: number;
    readonly residual: number;
  }>;
}

type CreateAnalysisSandboxSessionInput = Parameters<OpenSandboxAnalysisRuntime["createSession"]>[0];

const configSchema = z.strictObject({
  domain: z.string().trim().min(1).max(512),
  protocol: z.enum(["http", "https"]),
  api_key: z.string().min(16).max(1_024),
  use_server_proxy: z.boolean(),
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
  max_concurrent_sessions: z.number().int().min(1).max(32).default(1),
});

const safeSegmentSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const cellPolicyObservationSchema = z.strictObject({
  schema_version: z.literal("analysis-cell-policy-result@1.0.0"),
  cell_id: safeSegmentSchema,
  status: z.enum(["ADMITTED", "REJECTED"]),
  violations: z.array(
    z.strictObject({
      code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
      line: z.number().int().positive(),
      detail: z.string().max(1_024),
    }),
  ),
});
const sandboxPathSchema = z
  .string()
  .regex(
    /^\/workspace\/(?:inputs|operator-inputs|operator-outputs|intermediate)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u,
  );
const pythonSymbolSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u);
const symbolExtractionInputSchema = z.strictObject({
  extraction_id: safeSegmentSchema,
  symbols: z
    .array(
      z.strictObject({
        symbol_name: pythonSymbolSchema,
        expected_kind: z.enum(["MAPPING", "TABLE"]),
      }),
    )
    .min(1)
    .max(65)
    .superRefine((symbols, context) => {
      if (new Set(symbols.map(({ symbol_name }) => symbol_name)).size !== symbols.length) {
        context.addIssue({ code: "custom", message: "Extraction symbols must be unique." });
      }
    }),
  limits: z.strictObject({
    max_rows: z.number().int().positive().max(5_000),
    max_columns: z.number().int().positive().max(128),
    max_bytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
  }),
  timeout_ms: z.number().int().min(100).max(120_000),
});

const ANALYSIS_SANDBOX_OWNER_METADATA = Object.freeze({
  "managed-by": "data-agent-analysis",
});
const MANAGEMENT_CONFIRMATION_ATTEMPTS = 10;
const MANAGEMENT_CONFIRMATION_INTERVAL_MS = 100;

function analysisSandboxMetadata(input: {
  readonly run_id: string;
  readonly node_id: string;
  readonly role?: "agent" | "operator";
}): Readonly<Record<string, string>> {
  return Object.freeze({
    ...ANALYSIS_SANDBOX_OWNER_METADATA,
    "run-id": input.run_id,
    "node-id": input.node_id,
    ...(input.role ? { role: input.role } : {}),
  });
}

function activeManagedSandboxes(
  sandboxes: readonly AnalysisManagedSandboxInfo[],
): readonly AnalysisManagedSandboxInfo[] {
  return sandboxes.filter(({ state }) => state !== "Deleted");
}

async function waitForManagementPlane<T>(
  observe: () => Promise<T>,
  accepted: (value: T) => boolean,
): Promise<T> {
  let last = await observe();
  for (let attempt = 1; attempt < MANAGEMENT_CONFIRMATION_ATTEMPTS; attempt += 1) {
    if (accepted(last)) return last;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, MANAGEMENT_CONFIRMATION_INTERVAL_MS);
      timer.unref();
    });
    last = await observe();
  }
  return last;
}

async function withLifecycleManager<T>(input: {
  readonly factory: OpenSandboxSdkFactory;
  readonly connection_config: ConnectionConfig;
  readonly action: (manager: AnalysisSandboxLifecyclePort) => Promise<T>;
}): Promise<T> {
  const manager = input.factory.createLifecycleManager(input.connection_config);
  try {
    return await input.action(manager);
  } finally {
    await manager.close();
  }
}

async function purgeManagedSandboxes(input: {
  readonly factory: OpenSandboxSdkFactory;
  readonly connection_config: ConnectionConfig;
  readonly metadata: Readonly<Record<string, string>>;
}): Promise<number> {
  return withLifecycleManager({
    factory: input.factory,
    connection_config: input.connection_config,
    async action(manager) {
      const initial = activeManagedSandboxes(await manager.list({ metadata: input.metadata }));
      await Promise.all(initial.map(({ id }) => manager.kill(id)));
      const residual = await waitForManagementPlane(
        async () => activeManagedSandboxes(await manager.list({ metadata: input.metadata })),
        (items) => items.length === 0,
      );
      if (residual.length > 0) {
        throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_CLEANUP_FAILED", "CLEANUP", true);
      }
      return initial.length;
    },
  });
}

async function confirmManagedSandboxPair(input: {
  readonly factory: OpenSandboxSdkFactory;
  readonly connection_config: ConnectionConfig;
  readonly metadata: Readonly<Record<string, string>>;
  readonly agent_id: string;
  readonly operator_id: string;
}): Promise<void> {
  await withLifecycleManager({
    factory: input.factory,
    connection_config: input.connection_config,
    async action(manager) {
      const expected = new Map([
        [input.agent_id, "agent"],
        [input.operator_id, "operator"],
      ]);
      const observed = await waitForManagementPlane(
        async () => activeManagedSandboxes(await manager.list({ metadata: input.metadata })),
        (items) =>
          items.length === expected.size &&
          items.every(({ id, metadata }) => expected.get(id) === metadata.role),
      );
      if (
        observed.length !== expected.size ||
        !observed.every(({ id, metadata }) => expected.get(id) === metadata.role)
      ) {
        throw new AnalysisSandboxRuntimeError(
          "ANALYSIS_SANDBOX_STARTUP_FAILED",
          "SANDBOX_STARTUP",
          true,
        );
      }
    },
  });
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function governedInputBindingIdentity(input: {
  readonly input_name: string;
  readonly content_sha256: `sha256:${string}`;
}) {
  const suffix = createHash("sha256")
    .update([input.input_name, input.content_sha256].join("\0"))
    .digest("hex")
    .slice(0, 24);
  return Object.freeze({
    binding_id: `input-binding-${suffix}`,
    input_symbol: `__da_input_${suffix}`,
  });
}

function buildGovernedInputBindingSource(input: {
  readonly input_path: string;
  readonly input_symbol: string;
  readonly content_sha256: `sha256:${string}`;
  readonly format: "ARROW" | "CSV" | "JSON";
  readonly max_bytes: number;
}): string {
  return `# server-owned-governed-input-binding@1.0.0
import hashlib as _da_input_hashlib
import io as _da_input_io
import json as _da_input_json
import pandas as _da_input_pd

_da_input_path = ${JSON.stringify(input.input_path)}
_da_input_expected_hash = ${JSON.stringify(input.content_sha256)}
_da_input_format = ${JSON.stringify(input.format)}
_da_input_max_bytes = ${input.max_bytes}
with open(_da_input_path, "rb") as _da_input_stream:
    _da_input_bytes = _da_input_stream.read(_da_input_max_bytes + 1)
if len(_da_input_bytes) > _da_input_max_bytes:
    raise RuntimeError("ANALYSIS_GOVERNED_INPUT_SIZE_EXCEEDED")
_da_input_observed_hash = "sha256:" + _da_input_hashlib.sha256(_da_input_bytes).hexdigest()
if _da_input_observed_hash != _da_input_expected_hash:
    raise RuntimeError("ANALYSIS_GOVERNED_INPUT_BINDING_HASH_MISMATCH")
if _da_input_format == "ARROW":
    import pyarrow as _da_input_pa
    import pyarrow.ipc as _da_input_ipc
    with _da_input_ipc.open_file(_da_input_pa.BufferReader(_da_input_bytes)) as _da_input_reader:
        _da_input_value = _da_input_reader.read_all().to_pandas()
elif _da_input_format == "CSV":
    _da_input_value = _da_input_pd.read_csv(_da_input_io.BytesIO(_da_input_bytes))
elif _da_input_format == "JSON":
    _da_input_document = _da_input_json.loads(_da_input_bytes.decode("utf-8"))
    _da_input_value = _da_input_pd.DataFrame(_da_input_document)
else:
    raise RuntimeError("ANALYSIS_GOVERNED_INPUT_FORMAT_UNSUPPORTED")
globals()[${JSON.stringify(input.input_symbol)}] = _da_input_value
`;
}

function governedBindingIdentity(result: GovernedOperatorResultRef) {
  const suffix = createHash("sha256")
    .update(
      [
        result.run_id,
        result.node_id,
        result.attempt_id,
        String(result.context_generation),
        result.call_id,
        result.operator_id,
        result.result_sha256,
      ].join("\0"),
    )
    .digest("hex")
    .slice(0, 24);
  return Object.freeze({
    binding_id: `binding-${suffix}`,
    result_symbol: `__da_gov_${suffix}`,
  });
}

function buildGovernedResultBindingSource(input: {
  readonly input_path: string;
  readonly result_symbol: string;
  readonly result_sha256: `sha256:${string}`;
  readonly max_bytes: number;
}): string {
  return `# server-owned-governed-result-binding@1.0.0
import hashlib as _da_hashlib
import json as _da_json
import math as _da_math
import types as _da_types

_da_binding_path = ${JSON.stringify(input.input_path)}
_da_expected_hash = ${JSON.stringify(input.result_sha256)}
_da_max_bytes = ${input.max_bytes}
with open(_da_binding_path, "rb") as _da_stream:
    _da_bytes = _da_stream.read(_da_max_bytes + 1)
if len(_da_bytes) > _da_max_bytes:
    raise RuntimeError("ANALYSIS_GOVERNED_RESULT_SIZE_EXCEEDED")
_da_observed_hash = "sha256:" + _da_hashlib.sha256(_da_bytes).hexdigest()
if _da_observed_hash != _da_expected_hash:
    raise RuntimeError("ANALYSIS_GOVERNED_RESULT_BINDING_HASH_MISMATCH")
_da_value = _da_json.loads(_da_bytes.decode("utf-8"))

def _da_freeze(value, depth=0):
    if depth > 16:
        raise RuntimeError("ANALYSIS_GOVERNED_RESULT_NESTING_EXCEEDED")
    module = type(value).__module__
    name = type(value).__name__
    if value is None or type(value) in {bool, int, str}:
        return value
    if type(value) is float:
        if not _da_math.isfinite(value):
            raise RuntimeError("ANALYSIS_GOVERNED_RESULT_NUMBER_NON_FINITE")
        return value
    if type(value) is list:
        if len(value) > 100000:
            raise RuntimeError("ANALYSIS_GOVERNED_RESULT_ARRAY_LIMIT_EXCEEDED")
        return tuple(_da_freeze(item, depth + 1) for item in value)
    if type(value) is dict or (module == "builtins" and name == "mappingproxy"):
        if len(value) > 10000 or any(type(key) is not str or not key for key in value):
            raise RuntimeError("ANALYSIS_GOVERNED_RESULT_OBJECT_INVALID")
        return _da_types.MappingProxyType({key: _da_freeze(value[key], depth + 1) for key in sorted(value)})
    raise RuntimeError("ANALYSIS_GOVERNED_RESULT_VALUE_UNSUPPORTED")

globals()[${JSON.stringify(input.result_symbol)}] = _da_freeze(_da_value)
`;
}

function buildFixedSymbolExtractionSource(input: {
  readonly specs: readonly {
    readonly symbol_name: string;
    readonly expected_kind: "MAPPING" | "TABLE";
  }[];
  readonly output_path: string;
  readonly max_rows: number;
  readonly max_columns: number;
  readonly max_bytes: number;
}): string {
  const specs = JSON.stringify(input.specs);
  const outputPath = JSON.stringify(input.output_path);
  return `# server-owned-analysis-symbol-extractor@2.0.0
import datetime as _analysis_datetime
import decimal as _analysis_decimal
import json as _analysis_json
import math as _analysis_math

_analysis_specs = _analysis_json.loads(${JSON.stringify(specs)})
_analysis_output_path = ${outputPath}
_analysis_max_rows = ${input.max_rows}
_analysis_max_columns = ${input.max_columns}
_analysis_max_bytes = ${input.max_bytes}

def _analysis_wire(value, depth=0):
    if depth > 16:
        raise TypeError("ANALYSIS_RESULT_NESTING_EXCEEDED")
    module = type(value).__module__
    name = type(value).__name__
    if module == "numpy" and name in {"bool_", "int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64", "float16", "float32", "float64"}:
        value = value.item()
    elif module == "numpy" and name == "datetime64":
        import pandas as _analysis_pd
        value = _analysis_pd.Timestamp(value)
    if value is None:
        return {"kind": "NULL"}
    if type(value) is bool:
        return {"kind": "BOOLEAN", "value": value}
    if type(value) is int:
        if abs(value) > 9007199254740991:
            raise TypeError("ANALYSIS_RESULT_INTEGER_UNSAFE")
        return {"kind": "INTEGER", "value": str(value)}
    if type(value) is float:
        if _analysis_math.isnan(value):
            return {"kind": "NULL"}
        if not _analysis_math.isfinite(value):
            raise TypeError("ANALYSIS_RESULT_NUMBER_NON_FINITE")
        return {"kind": "NUMBER", "value": value}
    if type(value) is _analysis_decimal.Decimal:
        if not value.is_finite():
            raise TypeError("ANALYSIS_RESULT_DECIMAL_NON_FINITE")
        return {"kind": "DECIMAL", "value": format(value, "f")}
    if isinstance(value, _analysis_datetime.datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise TypeError("ANALYSIS_RESULT_TIMESTAMP_TIMEZONE_REQUIRED")
        return {"kind": "TIMESTAMP", "value": value.isoformat()}
    if isinstance(value, _analysis_datetime.date):
        return {"kind": "DATE", "value": value.isoformat()}
    if type(value) is str:
        return {"kind": "STRING", "value": value}
    if type(value) is list or type(value) is tuple:
        if len(value) > 100000:
            raise TypeError("ANALYSIS_RESULT_ARRAY_LIMIT_EXCEEDED")
        return {"kind": "ARRAY", "items": [_analysis_wire(item, depth + 1) for item in value]}
    if type(value) is dict or (module == "builtins" and name == "mappingproxy"):
        if len(value) > 10000 or any(type(key) is not str or not key for key in value):
            raise TypeError("ANALYSIS_RESULT_OBJECT_INVALID")
        return {
            "kind": "OBJECT",
            "entries": [
                {"key": key, "value": _analysis_wire(value[key], depth + 1)}
                for key in sorted(value)
            ],
        }
    raise TypeError("ANALYSIS_RESULT_VALUE_TYPE_UNSUPPORTED")

def _analysis_table(value):
    if type(value).__module__.startswith("pandas.") and type(value).__name__ == "DataFrame":
        columns = list(value.columns)
        rows = list(value.itertuples(index=False, name=None))
    elif type(value) is list:
        if not value:
            raise TypeError("ANALYSIS_RESULT_TABLE_EMPTY_SCHEMA")
        if any(type(row) is not dict for row in value):
            raise TypeError("ANALYSIS_RESULT_TABLE_ROW_INVALID")
        columns = list(value[0].keys())
        if any(list(row.keys()) != columns for row in value):
            raise TypeError("ANALYSIS_RESULT_TABLE_COLUMNS_UNSTABLE")
        rows = [tuple(row[column] for column in columns) for row in value]
    else:
        raise TypeError("ANALYSIS_RESULT_TABLE_TYPE_UNSUPPORTED")
    if (
        not columns
        or len(columns) > _analysis_max_columns
        or len(rows) > _analysis_max_rows
        or any(type(column) is not str or not column for column in columns)
        or len(set(columns)) != len(columns)
    ):
        raise TypeError("ANALYSIS_RESULT_TABLE_BOUNDS_OR_SCHEMA_INVALID")
    return {
        "columns": columns,
        "rows": [[_analysis_wire(value) for value in row] for row in rows],
    }

_analysis_symbols = []
for _analysis_spec in _analysis_specs:
    _analysis_name = _analysis_spec["symbol_name"]
    if _analysis_name not in globals():
        raise NameError("ANALYSIS_RESULT_SYMBOL_MISSING")
    _analysis_value = globals()[_analysis_name]
    if _analysis_spec["expected_kind"] == "MAPPING":
        if type(_analysis_value) is not dict and type(_analysis_value).__name__ != "mappingproxy":
            raise TypeError("ANALYSIS_RESULT_MAPPING_TYPE_UNSUPPORTED")
        _analysis_symbols.append({
            "symbol_name": _analysis_name,
            "symbol_kind": "MAPPING",
            "value": _analysis_wire(_analysis_value),
        })
    else:
        _analysis_symbols.append({
            "symbol_name": _analysis_name,
            "symbol_kind": "TABLE",
            **_analysis_table(_analysis_value),
        })

_analysis_document = {
    "schema_version": "analysis-extracted-symbols@1.0.0",
    "symbols": _analysis_symbols,
}
_analysis_bytes = _analysis_json.dumps(
    _analysis_document,
    ensure_ascii=False,
    allow_nan=False,
    separators=(",", ":"),
).encode("utf-8")
if not _analysis_bytes or len(_analysis_bytes) > _analysis_max_bytes:
    raise ValueError("ANALYSIS_RESULT_EXTRACTION_SIZE_EXCEEDED")
with open(_analysis_output_path, "wb") as _analysis_file:
    _analysis_file.write(_analysis_bytes)
len(_analysis_bytes)
`;
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
    | "ANALYSIS_SANDBOX_CELL_FAILED"
    | "ANALYSIS_SANDBOX_OPERATOR_FAILED"
    | "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH"
  >;
  readonly stdout_bytes: number;
  readonly stderr_bytes: number;
  readonly return_python_error: boolean;
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
  let cancelled = false;
  let rejectBoundary: ((reason: Error) => void) | null = null;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectBoundary?.(new Error("ANALYSIS_CELL_DEADLINE"));
  }, input.timeout_ms);
  timeout.unref();
  const cancel = () => {
    cancelled = true;
    controller.abort();
    rejectBoundary?.(new Error("ANALYSIS_CELL_CANCELLED"));
  };
  input.signal?.addEventListener("abort", cancel, { once: true });
  const started = Date.now();
  try {
    const executionPromise = input.codes.run(input.source, {
      context: input.context,
      signal: controller.signal,
    });
    const execution = await Promise.race([executionPromise, boundary]);
    const observation = cellObservation({
      cell_id: input.cell_id,
      execution,
      elapsed_ms: Math.max(0, Date.now() - started),
      stdout_bytes: input.stdout_bytes,
      stderr_bytes: input.stderr_bytes,
    });
    if (observation.status === "FAILED" && !input.return_python_error) {
      throw new AnalysisSandboxRuntimeError(
        input.failure_code,
        input.failure_code === "ANALYSIS_SANDBOX_OPERATOR_FAILED"
          ? "OPERATOR"
          : input.failure_code === "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH"
            ? "CONTEXT"
            : "CELL",
        false,
      );
    }
    return observation;
  } catch (error) {
    if (timedOut || cancelled || input.signal?.aborted || controller.signal.aborted) {
      await Promise.race([
        input.codes.interrupt(contextId).catch(() => {}),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          timer.unref();
        }),
      ]);
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

async function runOperatorCommandWithDeadline(input: {
  readonly sandbox: AnalysisSandboxHandle;
  readonly cell_id: string;
  readonly command: string;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal;
  readonly stdout_bytes: number;
  readonly stderr_bytes: number;
}): Promise<AnalysisSandboxCellObservation> {
  const controller = new AbortController();
  let commandId: string | null = null;
  let timedOut = false;
  let cancelled = false;
  let rejectBoundary: ((reason: Error) => void) | null = null;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectBoundary?.(new Error("ANALYSIS_OPERATOR_DEADLINE"));
  }, input.timeout_ms);
  timeout.unref();
  const cancel = () => {
    cancelled = true;
    controller.abort();
    rejectBoundary?.(new Error("ANALYSIS_OPERATOR_CANCELLED"));
  };
  input.signal?.addEventListener("abort", cancel, { once: true });
  const started = Date.now();
  try {
    const executionPromise = input.sandbox.commands.run(
      input.command,
      {
        workingDirectory: "/workspace",
        timeoutSeconds: Math.max(1, Math.ceil(input.timeout_ms / 1_000)),
        envs: {
          PYTHONHASHSEED: "0",
          MPLBACKEND: "Agg",
          OMP_NUM_THREADS: "1",
          OPENBLAS_NUM_THREADS: "1",
          MKL_NUM_THREADS: "1",
          NUMEXPR_NUM_THREADS: "1",
          VECLIB_MAXIMUM_THREADS: "1",
          BLIS_NUM_THREADS: "1",
        },
      },
      {
        onInit: (event) => {
          commandId = event.id;
        },
      },
      controller.signal,
    );
    const execution = await Promise.race([executionPromise, boundary]);
    const observation = cellObservation({
      cell_id: input.cell_id,
      execution,
      elapsed_ms: Math.max(0, Date.now() - started),
      stdout_bytes: input.stdout_bytes,
      stderr_bytes: input.stderr_bytes,
    });
    if (observation.status === "FAILED" || execution.exitCode !== 0) {
      throw new AnalysisSandboxRuntimeError(
        "ANALYSIS_SANDBOX_OPERATOR_FAILED",
        "OPERATOR",
        false,
        safeAnalysisOperatorFailureReasonCode(
          [observation.stderr, observation.error?.value, observation.stdout]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join("\n"),
        ),
      );
    }
    return observation;
  } catch (error) {
    if (timedOut || cancelled || input.signal?.aborted || controller.signal.aborted) {
      if (commandId) {
        await Promise.race([
          input.sandbox.commands.interrupt(commandId).catch(() => {}),
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 2_000);
            timer.unref();
          }),
        ]);
      }
      throw new AnalysisSandboxRuntimeError(
        timedOut ? "ANALYSIS_SANDBOX_OPERATOR_TIMEOUT" : "ANALYSIS_SANDBOX_CELL_CANCELLED",
        "OPERATOR",
        timedOut,
      );
    }
    if (error instanceof AnalysisSandboxRuntimeError) throw error;
    throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_OPERATOR_FAILED", "OPERATOR", false);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", cancel);
  }
}

async function createSandboxPair(input: {
  readonly config: OpenSandboxAnalysisRuntimeConfig;
  readonly factory: OpenSandboxSdkFactory;
  readonly connection_config: ConnectionConfig;
  readonly run_id: string;
  readonly node_id: string;
  readonly profile: AnalysisSandboxProfile;
}) {
  const base = {
    connectionConfig: input.connection_config,
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
  let agent: AnalysisSandboxHandle | null = null;
  try {
    agent = await input.factory.createSandbox({
      ...base,
      entrypoint: ["/opt/code-interpreter/code-interpreter.sh"],
      image: input.config.agent_images[input.profile],
      resource: input.config.agent_resource,
      metadata: analysisSandboxMetadata({ ...input, role: "agent" }),
    });
    const operator = await input.factory.createSandbox({
      ...base,
      entrypoint: ["tail", "-f", "/dev/null"],
      image: input.config.operator_image,
      resource: input.config.operator_resource,
      metadata: analysisSandboxMetadata({ ...input, role: "operator" }),
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
      "/workspace/operator-inputs",
      "/workspace/operator-outputs",
      "/workspace/intermediate",
    ].map((path) => ({ path, mode: 700 })),
  );
  const context = await interpreter.codes.createContext(SupportedLanguages.PYTHON);
  if (!context.id) {
    throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_CONTEXT_FAILED", "CONTEXT", false);
  }
  return { interpreter, context };
}

async function initializeOperatorSandbox(sandbox: AnalysisSandboxHandle) {
  await sandbox.files.createDirectories(
    ["/workspace/operator-inputs", "/workspace/operator-outputs"].map((path) => ({
      path,
      mode: 700,
    })),
  );
  return sandbox;
}

export function createOpenSandboxAnalysisRuntime(input: {
  readonly config: OpenSandboxAnalysisRuntimeConfig;
  readonly sdk_factory?: OpenSandboxSdkFactory;
}): OpenSandboxAnalysisRuntime {
  const config = configSchema.parse(input.config);
  const factory = input.sdk_factory ?? defaultSdkFactory;
  const connectionConfig = new ConnectionConfig({
    domain: config.domain,
    protocol: config.protocol,
    apiKey: config.api_key,
    useServerProxy: config.use_server_proxy,
    requestTimeoutSeconds: config.request_timeout_seconds,
  });
  let activeSessions = 0;
  return Object.freeze({
    async cleanupSession(
      cleanupInput: Parameters<OpenSandboxAnalysisRuntime["cleanupSession"]>[0],
    ) {
      safeSegmentSchema.parse(cleanupInput.run_id);
      safeSegmentSchema.parse(cleanupInput.node_id);
      const killed = await purgeManagedSandboxes({
        factory,
        connection_config: connectionConfig,
        metadata: analysisSandboxMetadata(cleanupInput),
      });
      return Object.freeze({ killed, residual: 0 as const });
    },
    async sweepOrphans(sweepInput: { readonly now?: Date; readonly grace_seconds?: number } = {}) {
      const now = sweepInput.now ?? new Date();
      const graceSeconds = z
        .number()
        .int()
        .min(0)
        .max(3_600)
        .parse(sweepInput.grace_seconds ?? 60);
      return withLifecycleManager({
        factory,
        connection_config: connectionConfig,
        async action(manager) {
          const managed = activeManagedSandboxes(
            await manager.list({ metadata: ANALYSIS_SANDBOX_OWNER_METADATA }),
          );
          const cutoff = now.getTime() - (config.sandbox_timeout_seconds + graceSeconds) * 1_000;
          const orphans = managed.filter(({ created_at }) => created_at.getTime() <= cutoff);
          await Promise.all(orphans.map(({ id }) => manager.kill(id)));
          const orphanIds = new Set(orphans.map(({ id }) => id));
          const residual = await waitForManagementPlane(
            async () =>
              activeManagedSandboxes(
                await manager.list({ metadata: ANALYSIS_SANDBOX_OWNER_METADATA }),
              ).filter(({ id }) => orphanIds.has(id)),
            (items) => items.length === 0,
          );
          if (residual.length > 0) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_CLEANUP_FAILED",
              "CLEANUP",
              true,
            );
          }
          return Object.freeze({
            examined: managed.length,
            killed: orphans.length,
            residual: residual.length,
          });
        },
      });
    },
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
      if (activeSessions >= config.max_concurrent_sessions) {
        throw new AnalysisSandboxRuntimeError(
          "ANALYSIS_SANDBOX_CAPACITY_EXHAUSTED",
          "SANDBOX_STARTUP",
          true,
        );
      }
      activeSessions += 1;
      let reservationReleased = false;
      const releaseReservation = () => {
        if (reservationReleased) return;
        reservationReleased = true;
        activeSessions -= 1;
      };
      let pair: Awaited<ReturnType<typeof createSandboxPair>> | null = null;
      const sessionMetadata = analysisSandboxMetadata(sessionInput);
      try {
        await purgeManagedSandboxes({
          factory,
          connection_config: connectionConfig,
          metadata: sessionMetadata,
        });
        pair = await createSandboxPair({
          ...sessionInput,
          config,
          factory,
          connection_config: connectionConfig,
        });
        await confirmManagedSandboxPair({
          factory,
          connection_config: connectionConfig,
          metadata: sessionMetadata,
          agent_id: pair.agent.id,
          operator_id: pair.operator.id,
        });
      } catch (error) {
        if (pair) {
          await Promise.allSettled([pair.agent.close(), pair.operator.close()]);
        }
        await purgeManagedSandboxes({
          factory,
          connection_config: connectionConfig,
          metadata: sessionMetadata,
        }).catch(() => {});
        releaseReservation();
        if (error instanceof AnalysisSandboxRuntimeError) throw error;
        throw new AnalysisSandboxRuntimeError(
          "ANALYSIS_SANDBOX_STARTUP_FAILED",
          "SANDBOX_STARTUP",
          true,
        );
      }
      if (!pair) {
        releaseReservation();
        throw new AnalysisSandboxRuntimeError(
          "ANALYSIS_SANDBOX_STARTUP_FAILED",
          "SANDBOX_STARTUP",
          true,
        );
      }
      let agentRuntime: Awaited<ReturnType<typeof initializeSandbox>> | null = null;
      let operatorRuntime: Awaited<ReturnType<typeof initializeOperatorSandbox>> | null = null;
      try {
        [agentRuntime, operatorRuntime] = await Promise.all([
          initializeSandbox(pair.agent, factory),
          initializeOperatorSandbox(pair.operator),
        ]);
      } catch (error) {
        await Promise.allSettled([pair.agent.kill(), pair.operator.kill()]);
        await Promise.allSettled([pair.agent.close(), pair.operator.close()]);
        try {
          await purgeManagedSandboxes({
            factory,
            connection_config: connectionConfig,
            metadata: sessionMetadata,
          });
        } catch {
          releaseReservation();
          throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_CLEANUP_FAILED", "CLEANUP", true);
        }
        releaseReservation();
        if (error instanceof AnalysisSandboxRuntimeError) throw error;
        throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_CONTEXT_FAILED", "CONTEXT", true);
      }
      const agentInterpreter = agentRuntime.interpreter;
      let agentContext = agentRuntime.context;
      const operator = operatorRuntime;
      let closed = false;
      let contextFrozen = false;
      const governedInputBindings: {
        readonly input_name: string;
        readonly input_path: string;
        readonly format: "ARROW" | "CSV" | "JSON";
        readonly content_sha256: `sha256:${string}`;
        readonly binding_id: string;
        readonly input_symbol: string;
        readonly source: string;
      }[] = [];
      const assertOpen = () => {
        if (closed) {
          throw new AnalysisSandboxRuntimeError(
            "ANALYSIS_SANDBOX_CLEANUP_FAILED",
            "CLEANUP",
            false,
          );
        }
      };
      const assertContextActive = () => {
        assertOpen();
        if (contextFrozen) {
          throw new AnalysisSandboxRuntimeError(
            "ANALYSIS_SANDBOX_CONTEXT_FAILED",
            "CONTEXT",
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
        runtime_profile: sessionInput.profile,
        agent_image: config.agent_images[sessionInput.profile],
        operator_image: config.operator_image,
        secure_access: config.secure_access,
        async uploadAgentFile(uploadInput) {
          assertContextActive();
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
        async bindGovernedInput(bindingInput) {
          assertContextActive();
          safeSegmentSchema.parse(bindingInput.input_name);
          sandboxPathSchema.parse(bindingInput.input_path);
          const identity = governedInputBindingIdentity(bindingInput);
          const existing = governedInputBindings.find(
            ({ input_name: inputName }) => inputName === bindingInput.input_name,
          );
          if (existing) {
            if (
              existing.content_sha256 !== bindingInput.content_sha256 ||
              existing.input_path !== bindingInput.input_path ||
              existing.format !== bindingInput.format ||
              existing.binding_id !== identity.binding_id ||
              existing.input_symbol !== identity.input_symbol
            ) {
              throw new AnalysisSandboxRuntimeError(
                "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH",
                "CONTEXT",
                false,
              );
            }
            return Object.freeze({
              binding_id: existing.binding_id,
              input_symbol: existing.input_symbol,
              content_sha256: existing.content_sha256,
            });
          }
          const source = buildGovernedInputBindingSource({
            input_path: bindingInput.input_path,
            input_symbol: identity.input_symbol,
            content_sha256: bindingInput.content_sha256,
            format: bindingInput.format,
            max_bytes: config.max_file_bytes,
          });
          await runCellWithDeadline({
            codes: agentInterpreter.codes,
            context: agentContext,
            cell_id: identity.binding_id,
            source,
            timeout_ms: Math.min(bindingInput.timeout_ms, 30_000),
            ...(bindingInput.signal ? { signal: bindingInput.signal } : {}),
            timeout_code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
            failure_code: "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH",
            stdout_bytes: 0,
            stderr_bytes: config.stderr_bytes,
            return_python_error: false,
          });
          governedInputBindings.push({ ...bindingInput, ...identity, source });
          return Object.freeze({
            ...identity,
            content_sha256: bindingInput.content_sha256,
          });
        },
        async admitAgentCell(cellInput) {
          assertContextActive();
          const cellId = safeSegmentSchema.parse(cellInput.cell_id);
          const request = Buffer.from(
            JSON.stringify({
              schema_version: "analysis-cell-policy-request@1.0.0",
              cell_id: cellId,
              source: cellInput.source,
              runtime_profile: sessionInput.profile,
              generated_source_policy: cellInput.generated_source_policy,
            }),
            "utf8",
          );
          if (request.byteLength > config.max_file_bytes) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
              "ARTIFACT",
              false,
            );
          }
          const requestPath = `/workspace/operator-inputs/${cellId}.policy.json`;
          const outputPath = `/workspace/operator-outputs/${cellId}.policy.json`;
          try {
            await pair.operator.files.writeFiles([{ path: requestPath, data: request, mode: 400 }]);
          } catch {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_FILE_TRANSFER_FAILED",
              "FILE_TRANSFER",
              true,
            );
          }
          await runOperatorCommandWithDeadline({
            sandbox: operator,
            cell_id: `cell-policy-${cellId}`,
            command: `python -m data_agent_stats.dispatcher validate-cell ${JSON.stringify(requestPath)} ${JSON.stringify(outputPath)}`,
            timeout_ms: cellInput.timeout_ms,
            ...(cellInput.signal ? { signal: cellInput.signal } : {}),
            stdout_bytes: config.stdout_bytes,
            stderr_bytes: config.stderr_bytes,
          });
          const output = await read(pair.operator, outputPath);
          try {
            return cellPolicyObservationSchema.parse(
              JSON.parse(Buffer.from(output).toString("utf8")),
            );
          } catch {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_OPERATOR_FAILED",
              "OPERATOR",
              false,
            );
          }
        },
        runAgentCell(cellInput) {
          assertContextActive();
          safeSegmentSchema.parse(cellInput.cell_id);
          return runCellWithDeadline({
            codes: agentInterpreter.codes,
            context: agentContext,
            cell_id: cellInput.cell_id,
            source: cellInput.source,
            timeout_ms: cellInput.timeout_ms,
            ...(cellInput.signal ? { signal: cellInput.signal } : {}),
            timeout_code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
            failure_code: "ANALYSIS_SANDBOX_CELL_FAILED",
            stdout_bytes: config.stdout_bytes,
            stderr_bytes: config.stderr_bytes,
            return_python_error: true,
          });
        },
        async recoverAgentContext(recoveryInput) {
          assertContextActive();
          if (recoveryInput.signal?.aborted) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_CELL_CANCELLED",
              "CONTEXT",
              false,
            );
          }
          try {
            await agentInterpreter.codes.deleteContext(agentContext.id as string);
            const replacement = await agentInterpreter.codes.createContext(
              SupportedLanguages.PYTHON,
            );
            if (!replacement.id) {
              throw new AnalysisSandboxRuntimeError(
                "ANALYSIS_SANDBOX_CONTEXT_FAILED",
                "CONTEXT",
                true,
              );
            }
            agentContext = replacement;
            for (const binding of governedInputBindings) {
              await runCellWithDeadline({
                codes: agentInterpreter.codes,
                context: agentContext,
                cell_id: `replay-${binding.binding_id}`,
                source: binding.source,
                timeout_ms: 30_000,
                ...(recoveryInput.signal ? { signal: recoveryInput.signal } : {}),
                timeout_code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
                failure_code: "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH",
                stdout_bytes: 0,
                stderr_bytes: config.stderr_bytes,
                return_python_error: false,
              });
            }
            for (const action of recoveryInput.replay) {
              if (action.action_type === "MODEL_CELL") {
                safeSegmentSchema.parse(action.cell_id);
                await runCellWithDeadline({
                  codes: agentInterpreter.codes,
                  context: agentContext,
                  cell_id: `replay-${action.journal_seq}-${action.cell_id}`,
                  source: action.source,
                  timeout_ms: Math.min(action.timeout_ms, 30_000),
                  ...(recoveryInput.signal ? { signal: recoveryInput.signal } : {}),
                  timeout_code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
                  failure_code: "ANALYSIS_SANDBOX_CELL_FAILED",
                  stdout_bytes: 0,
                  stderr_bytes: config.stderr_bytes,
                  return_python_error: false,
                });
                continue;
              }
              const governed = action.governed_result;
              const identity = governedBindingIdentity(governed);
              if (
                action.authoritative_content.byteLength !== governed.result_bytes ||
                digest(action.authoritative_content) !== governed.result_sha256 ||
                identity.result_symbol !== action.expected_symbol ||
                identity.binding_id !== action.expected_binding_id
              ) {
                throw new AnalysisSandboxRuntimeError(
                  "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH",
                  "CONTEXT",
                  false,
                );
              }
              const inputPath = `/workspace/intermediate/${identity.binding_id}.json`;
              await pair.agent.files.writeFiles([
                { path: inputPath, data: action.authoritative_content, mode: 400 },
              ]);
              await runCellWithDeadline({
                codes: agentInterpreter.codes,
                context: agentContext,
                cell_id: `replay-${action.journal_seq}-${identity.binding_id}`,
                source: buildGovernedResultBindingSource({
                  input_path: inputPath,
                  result_symbol: identity.result_symbol,
                  result_sha256: governed.result_sha256,
                  max_bytes: 16 * 1024 * 1024,
                }),
                timeout_ms: 30_000,
                ...(recoveryInput.signal ? { signal: recoveryInput.signal } : {}),
                timeout_code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
                failure_code: "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH",
                stdout_bytes: 0,
                stderr_bytes: config.stderr_bytes,
                return_python_error: false,
              });
            }
          } catch (error) {
            if (error instanceof AnalysisSandboxRuntimeError) throw error;
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_CONTEXT_FAILED",
              "CONTEXT",
              true,
            );
          }
        },
        async freezeAgentContext() {
          assertContextActive();
          try {
            await agentInterpreter.codes.deleteContext(agentContext.id as string);
            contextFrozen = true;
          } catch {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_CONTEXT_FAILED",
              "CONTEXT",
              false,
            );
          }
        },
        async bindGovernedResult(bindingInput) {
          assertContextActive();
          const governed = bindingInput.governed_result;
          const identity = governedBindingIdentity(governed);
          if (
            bindingInput.authoritative_content.byteLength !== governed.result_bytes ||
            bindingInput.authoritative_content.byteLength > 16 * 1024 * 1024 ||
            digest(bindingInput.authoritative_content) !== governed.result_sha256
          ) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH",
              "ARTIFACT",
              false,
            );
          }
          const inputPath = `/workspace/intermediate/${identity.binding_id}.json`;
          try {
            await pair.agent.files.writeFiles([
              { path: inputPath, data: bindingInput.authoritative_content, mode: 400 },
            ]);
            await runCellWithDeadline({
              codes: agentInterpreter.codes,
              context: agentContext,
              cell_id: identity.binding_id,
              source: buildGovernedResultBindingSource({
                input_path: inputPath,
                result_symbol: identity.result_symbol,
                result_sha256: governed.result_sha256,
                max_bytes: 16 * 1024 * 1024,
              }),
              timeout_ms: Math.min(bindingInput.timeout_ms, 30_000),
              ...(bindingInput.signal ? { signal: bindingInput.signal } : {}),
              timeout_code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
              failure_code: "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH",
              stdout_bytes: 0,
              stderr_bytes: config.stderr_bytes,
              return_python_error: false,
            });
          } catch (error) {
            if (error instanceof AnalysisSandboxRuntimeError) throw error;
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_BINDING_HASH_MISMATCH",
              "CONTEXT",
              false,
            );
          }
          return Object.freeze({
            ...identity,
            result_sha256: governed.result_sha256,
          });
        },
        async extractAgentSymbols(extractionInput) {
          assertContextActive();
          const parsed = symbolExtractionInputSchema.parse(extractionInput);
          if (parsed.limits.max_bytes > config.max_file_bytes) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
              "ARTIFACT",
              false,
            );
          }
          const outputPath = `/workspace/intermediate/${parsed.extraction_id}.symbols.json`;
          const source = buildFixedSymbolExtractionSource({
            specs: parsed.symbols,
            output_path: outputPath,
            max_rows: parsed.limits.max_rows,
            max_columns: parsed.limits.max_columns,
            max_bytes: parsed.limits.max_bytes,
          });
          try {
            const observation = await runCellWithDeadline({
              codes: agentInterpreter.codes,
              context: agentContext,
              cell_id: `extract-${parsed.extraction_id}`,
              source,
              timeout_ms: parsed.timeout_ms,
              ...(extractionInput.signal ? { signal: extractionInput.signal } : {}),
              timeout_code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
              failure_code: "ANALYSIS_SANDBOX_CELL_FAILED",
              stdout_bytes: 0,
              stderr_bytes: config.stderr_bytes,
              return_python_error: true,
            });
            if (observation.status === "FAILED") {
              const reasonCode = safeAnalysisSymbolExtractionFailureCode(observation.error?.value);
              if (reasonCode) {
                throw new AnalysisSandboxRuntimeError(
                  "ANALYSIS_SANDBOX_SYMBOL_EXTRACTION_REJECTED",
                  "CELL",
                  false,
                  reasonCode,
                );
              }
              throw new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_CELL_FAILED", "CELL", false);
            }
            const bytes = await read(pair.agent, outputPath);
            if (bytes.byteLength > parsed.limits.max_bytes) {
              throw new AnalysisSandboxRuntimeError(
                "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
                "ARTIFACT",
                false,
              );
            }
            return JSON.parse(utf8Decoder.decode(bytes)) as unknown;
          } catch (error) {
            if (error instanceof AnalysisSandboxRuntimeError) throw error;
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
              "ARTIFACT",
              false,
            );
          }
        },
        async runOperator(operatorInput) {
          assertContextActive();
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
          const started = Date.now();
          const cell = await runOperatorCommandWithDeadline({
            sandbox: operator,
            cell_id: `operator-${callId}`,
            command: `python -m data_agent_stats.dispatcher call ${JSON.stringify(requestPath)} ${JSON.stringify(outputPath)}`,
            timeout_ms: operatorInput.timeout_ms,
            ...(operatorInput.signal ? { signal: operatorInput.signal } : {}),
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
        async finalizeOperators(finalizationInput) {
          assertContextActive();
          const finalizationId = safeSegmentSchema.parse(finalizationInput.finalization_id);
          if (
            finalizationInput.request.byteLength > config.max_file_bytes ||
            digest(finalizationInput.request) !== finalizationInput.request_sha256
          ) {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_ARTIFACT_INVALID",
              "ARTIFACT",
              false,
            );
          }
          const requestPath = `/workspace/operator-inputs/${finalizationId}.finalize.json`;
          const outputPath = `/workspace/operator-outputs/${finalizationId}.receipt.json`;
          try {
            await pair.operator.files.writeFiles([
              { path: requestPath, data: finalizationInput.request, mode: 400 },
            ]);
          } catch {
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_FILE_TRANSFER_FAILED",
              "FILE_TRANSFER",
              true,
            );
          }
          const started = Date.now();
          const cell = await runOperatorCommandWithDeadline({
            sandbox: operator,
            cell_id: `operator-finalization-${finalizationId}`,
            command: `python -m data_agent_stats.dispatcher finalize ${JSON.stringify(requestPath)} ${JSON.stringify(outputPath)}`,
            timeout_ms: finalizationInput.timeout_ms,
            ...(finalizationInput.signal ? { signal: finalizationInput.signal } : {}),
            stdout_bytes: config.stdout_bytes,
            stderr_bytes: config.stderr_bytes,
          });
          const output = await read(pair.operator, outputPath);
          return Object.freeze({
            finalization_id: finalizationId,
            status: "SUCCEEDED" as const,
            elapsed_ms: Math.max(0, Date.now() - started),
            request_sha256: finalizationInput.request_sha256,
            output_sha256: digest(output),
            output,
            cell,
          });
        },
        async close() {
          if (closed) return;
          closed = true;
          try {
            if (!contextFrozen) {
              await Promise.allSettled([
                agentInterpreter.codes.deleteContext(agentContext.id as string),
              ]);
            }
            await Promise.allSettled([pair.agent.kill(), pair.operator.kill()]);
            await Promise.allSettled([pair.agent.close(), pair.operator.close()]);
            await purgeManagedSandboxes({
              factory,
              connection_config: connectionConfig,
              metadata: sessionMetadata,
            });
          } catch (error) {
            if (error instanceof AnalysisSandboxRuntimeError) throw error;
            throw new AnalysisSandboxRuntimeError(
              "ANALYSIS_SANDBOX_CLEANUP_FAILED",
              "CLEANUP",
              true,
            );
          } finally {
            releaseReservation();
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
        use_server_proxy:
          z
            .enum(["true", "false"])
            .parse(requiredEnvironment(environment, "ANALYSIS_SANDBOX_USE_SERVER_PROXY")) ===
          "true",
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
        max_concurrent_sessions: z.coerce
          .number()
          .int()
          .min(1)
          .max(32)
          .parse(environment.ANALYSIS_SANDBOX_MAX_CONCURRENT_SESSIONS ?? 1),
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
  buildFixedSymbolExtractionSource,
  buildGovernedInputBindingSource,
  buildGovernedResultBindingSource,
  safeAnalysisOperatorFailureReasonCode,
  safeAnalysisSymbolExtractionFailureCode,
  digest,
  governedInputBindingIdentity,
  governedBindingIdentity,
  sandboxPathSchema,
  safeSegmentSchema,
});
