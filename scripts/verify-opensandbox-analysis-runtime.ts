import { createHash } from "node:crypto";
import {
  type AnalysisSandboxProfile,
  AnalysisSandboxRuntimeError,
  createOpenSandboxAnalysisRuntime,
} from "../apps/worker/src/runs/opensandbox-analysis-runtime.js";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "../packages/contracts/src/generated/statistical-operators.js";

const REGISTRY_DIGEST = STATISTICAL_OPERATOR_REGISTRY_DIGEST;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function requiredBoolean(name: string): boolean {
  const value = required(name);
  if (value !== "true" && value !== "false") {
    throw new Error(`Invalid boolean environment variable: ${name}`);
  }
  return value === "true";
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const profile = (optional("ANALYSIS_SANDBOX_PROBE_PROFILE") ??
  "CORE_ANALYSIS") as AnalysisSandboxProfile;
const agentImage = required("ANALYSIS_SANDBOX_PROBE_AGENT_IMAGE");
const operatorImage = required("ANALYSIS_SANDBOX_PROBE_OPERATOR_IMAGE");
const useServerProxy = requiredBoolean("ANALYSIS_SANDBOX_USE_SERVER_PROXY");
const runtime = createOpenSandboxAnalysisRuntime({
  config: {
    domain: required("ANALYSIS_SANDBOX_SERVER_DOMAIN"),
    protocol: required("ANALYSIS_SANDBOX_SERVER_PROTOCOL") === "https" ? "https" : "http",
    api_key: required("ANALYSIS_SANDBOX_API_KEY"),
    use_server_proxy: useServerProxy,
    request_timeout_seconds: 120,
    ready_timeout_seconds: 180,
    sandbox_timeout_seconds: 600,
    secure_access: false,
    agent_images: {
      CORE_ANALYSIS: agentImage,
      ML_DIAGNOSTIC: agentImage,
      CAUSAL_L5: agentImage,
    },
    operator_image: operatorImage,
    agent_resource: { cpu: "1", memory: "1Gi" },
    operator_resource: { cpu: "1", memory: "1Gi" },
    max_file_bytes: 32 * 1024 * 1024,
    stdout_bytes: 4_096,
    stderr_bytes: 16_384,
  },
});

const report: Record<string, unknown> = {
  schema_version: "opensandbox-analysis-runtime-probe@1.0.0",
  profile,
  agent_image: agentImage,
  operator_image: operatorImage,
  registry_digest: REGISTRY_DIGEST,
  endpoint_mode: useServerProxy ? "SERVER_PROXY" : "DIRECT",
  use_server_proxy: useServerProxy,
  checks: {},
};

const session = await runtime.createSession({
  run_id: "opensandbox-probe",
  node_id: "analysis-runtime",
  profile,
});

try {
  report.agent_sandbox_id = session.agent_sandbox_id;
  report.operator_sandbox_id = session.operator_sandbox_id;
  const checks = report.checks as Record<string, unknown>;
  checks.distinct_sandboxes = session.agent_sandbox_id !== session.operator_sandbox_id;

  const input = encoder.encode(
    JSON.stringify([
      { month: "2026-01", revenue: 120.5 },
      { month: "2026-02", revenue: 95.25 },
      { month: "2026-03", revenue: 103.75 },
    ]),
  );
  await session.uploadAgentFile({
    path: "/workspace/inputs/probe.json",
    content: input,
    content_sha256: sha256(input),
  });

  const isolation = await session.runAgentCell({
    cell_id: "isolation",
    timeout_ms: 30_000,
    source: [
      "import importlib.util, json",
      "assert importlib.util.find_spec('data_agent_stats') is None",
      "json.dumps({'operator_package_absent': True}, sort_keys=True)",
    ].join("\n"),
  });
  checks.agent_operator_package_absent = isolation.result_text?.includes(
    '"operator_package_absent": true',
  );

  const prepareSource = [
    "import json, pandas as pd",
    "frame = pd.read_json('/workspace/inputs/probe.json')",
    "result_document = {'row_count': int(len(frame)), 'revenue_total': float(frame['revenue'].sum())}",
    "trend_table = frame[['month', 'revenue']].copy()",
    "operator_inputs = {'tests': [{'label': 'a', 'p_value': 0.01}, {'label': 'b', 'p_value': 0.04}, {'label': 'c', 'p_value': 0.2}]}",
    "operator_parameters = {'alpha': 0.05, 'method': 'bh'}",
    "json.dumps({'rows': len(frame)}, sort_keys=True)",
  ].join("\n");
  const preparePolicy = await session.admitAgentCell({
    cell_id: "prepare",
    source: prepareSource,
    generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
    timeout_ms: 30_000,
  });
  const deniedPolicy = await session.admitAgentCell({
    cell_id: "denied-system-import",
    source: "import subprocess",
    generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
    timeout_ms: 30_000,
  });
  checks.cell_policy = {
    admitted: preparePolicy.status === "ADMITTED",
    denied_system_import: deniedPolicy.status === "REJECTED",
  };
  const prepare = await session.runAgentCell({
    cell_id: "prepare",
    timeout_ms: 30_000,
    source: prepareSource,
  });

  const extracted = (await session.extractAgentSymbols({
    extraction_id: "probe_symbols",
    symbols: [
      { symbol_name: "result_document", expected_kind: "MAPPING" },
      { symbol_name: "trend_table", expected_kind: "TABLE" },
      { symbol_name: "operator_inputs", expected_kind: "MAPPING" },
      { symbol_name: "operator_parameters", expected_kind: "MAPPING" },
    ],
    limits: { max_rows: 100, max_columns: 16, max_bytes: 1_048_576 },
    timeout_ms: 30_000,
  })) as { readonly symbols?: readonly { readonly symbol_name?: string }[] };
  const extractedNames = extracted.symbols?.map(({ symbol_name: symbolName }) => symbolName) ?? [];
  checks.stateful_symbols = {
    prepared: prepare.status === "SUCCEEDED",
    exact_closure:
      JSON.stringify(extractedNames) ===
      JSON.stringify(["result_document", "trend_table", "operator_inputs", "operator_parameters"]),
  };

  const callDocument = {
    schema_version: "statistical-operator-tool-call@1.0.0",
    call_id: "probe_bh",
    operator_id: "multiple-testing.bh-fdr@1",
    operator_registry_digest: REGISTRY_DIGEST,
    runtime_profile: "CORE_ANALYSIS",
    obligation: {
      call_id: "probe_bh",
      operator_id: "multiple-testing.bh-fdr@1",
      input_lineage_bindings: [
        {
          lineage_kind: "SERVER_TRANSFORM_EXACT",
          operator_input_name: "tests",
          governed_input_name: "opensandbox_probe",
          transform_id: "opensandbox.probe.bh_fdr.v1",
        },
      ],
      result_binding: {
        result_output_name: "analysis_json",
        result_collection_path: "/tests",
        operator_collection_path: "/tests",
        label_fields: ["label"],
        value_bindings: [
          {
            result_field: "adjusted_p_value",
            operator_field: "adjusted_p_value",
            comparison: "NUMERIC_TOLERANCE",
            absolute_tolerance: 1e-12,
            relative_tolerance: 1e-12,
          },
        ],
        require_exact_label_set: true,
      },
    },
    inputs: {
      tests: [
        { label: "a", p_value: 0.01 },
        { label: "b", p_value: 0.04 },
        { label: "c", p_value: 0.2 },
      ],
    },
    parameters: { alpha: 0.05, method: "bh" },
  } as const;
  const call = encoder.encode(JSON.stringify(callDocument));
  const operator = await session.runOperator({
    call_id: "probe_bh",
    request: call,
    request_sha256: sha256(call),
    timeout_ms: 30_000,
  });
  const operatorResult = JSON.parse(decoder.decode(operator.output ?? new Uint8Array())) as {
    operator_id?: string;
    operator_registry_digest?: string;
    output?: { tests?: unknown[] };
  };
  checks.governed_operator = {
    succeeded: operator.status === "SUCCEEDED",
    registry_bound: operatorResult.operator_registry_digest === REGISTRY_DIGEST,
    operator_bound: operatorResult.operator_id === "multiple-testing.bh-fdr@1",
    row_count: operatorResult.output?.tests?.length ?? 0,
    output_sha256: operator.output_sha256,
  };
  const finalizationRequest = encoder.encode(
    JSON.stringify({
      schema_version: "statistical-operator-finalization@1.0.0",
      operator_registry_digest: REGISTRY_DIGEST,
      runtime_profile: "CORE_ANALYSIS",
      calls: [callDocument],
      json_outputs: { analysis_json: operatorResult.output },
    }),
  );
  const finalization = await session.finalizeOperators({
    finalization_id: "probe_receipts",
    request: finalizationRequest,
    request_sha256: sha256(finalizationRequest),
    timeout_ms: 30_000,
  });
  const finalizationResult = JSON.parse(decoder.decode(finalization.output)) as {
    operator_receipts?: unknown[];
    operator_receipt_closure_hash?: string;
  };
  checks.operator_receipt_closure = {
    receipt_count: finalizationResult.operator_receipts?.length ?? 0,
    closure_hash: finalizationResult.operator_receipt_closure_hash ?? null,
    bound:
      finalizationResult.operator_receipts?.length === 1 &&
      finalizationResult.operator_receipt_closure_hash?.startsWith("sha256:") === true,
  };

  const pass =
    checks.distinct_sandboxes === true &&
    checks.agent_operator_package_absent === true &&
    (checks.cell_policy as { admitted: boolean; denied_system_import: boolean }).admitted &&
    (checks.cell_policy as { admitted: boolean; denied_system_import: boolean })
      .denied_system_import &&
    (checks.stateful_symbols as { prepared: boolean; exact_closure: boolean }).prepared &&
    (checks.stateful_symbols as { prepared: boolean; exact_closure: boolean }).exact_closure &&
    (checks.governed_operator as { succeeded: boolean; registry_bound: boolean }).succeeded &&
    (checks.governed_operator as { succeeded: boolean; registry_bound: boolean }).registry_bound &&
    (checks.operator_receipt_closure as { bound: boolean }).bound;
  report.status = pass ? "PASSED" : "FAILED";
  if (!pass) process.exitCode = 1;
} catch (error) {
  report.status = "FAILED";
  report.failure = error instanceof Error ? `${error.name}:${error.message}` : "UNKNOWN";
  if (error instanceof AnalysisSandboxRuntimeError) {
    report.failure_stage = error.stage;
    report.failure_reason_code = error.reason_code;
    report.failure_retryable = error.retryable;
  }
  process.exitCode = 1;
} finally {
  try {
    await session.close();
    (report.checks as Record<string, unknown>).session_closed = true;
  } catch {
    (report.checks as Record<string, unknown>).session_closed = false;
    report.status = "FAILED";
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
