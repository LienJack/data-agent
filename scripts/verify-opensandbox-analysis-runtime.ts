import { createHash } from "node:crypto";
import {
  type AnalysisSandboxProfile,
  createOpenSandboxAnalysisRuntime,
} from "../apps/worker/src/runs/opensandbox-analysis-runtime.js";

const REGISTRY_DIGEST =
  "sha256:9902973d92d20f9ce7d880f7914d71f7930542f88a5883726c6c4b9ca7fce55d" as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
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
const runtime = createOpenSandboxAnalysisRuntime({
  config: {
    domain: required("ANALYSIS_SANDBOX_SERVER_DOMAIN"),
    protocol: required("ANALYSIS_SANDBOX_SERVER_PROTOCOL") === "https" ? "https" : "http",
    api_key: required("ANALYSIS_SANDBOX_API_KEY"),
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

  const prepare = await session.runAgentCell({
    cell_id: "prepare",
    timeout_ms: 30_000,
    source: [
      "import importlib.util, json, pandas as pd",
      "assert importlib.util.find_spec('data_agent_stats') is None",
      "frame = pd.read_json('/workspace/inputs/probe.json')",
      "frame.to_parquet('/workspace/intermediate/probe.parquet', index=False)",
      "json.dumps({'rows': len(frame), 'operator_package_absent': True}, sort_keys=True)",
    ].join("\n"),
  });
  checks.agent_operator_package_absent = prepare.result_text?.includes(
    '"operator_package_absent": true',
  );

  const chart = await session.runAgentCell({
    cell_id: "chart",
    timeout_ms: 30_000,
    source: [
      "import matplotlib.pyplot as plt, pandas as pd",
      "reloaded = pd.read_parquet('/workspace/intermediate/probe.parquet')",
      "fig, ax = plt.subplots(figsize=(5, 3))",
      "ax.plot(reloaded['month'], reloaded['revenue'], marker='o')",
      "ax.set_ylabel('Revenue')",
      "fig.tight_layout()",
      "fig.savefig('/workspace/outputs/probe.png', dpi=120, metadata={})",
      "fig.savefig('/workspace/outputs/probe.svg', metadata={})",
      "plt.close(fig)",
      "'chart-written'",
    ].join("\n"),
  });
  checks.stateful_cells = chart.result_text?.includes("chart-written") === true;

  const parquet = await session.readAgentFile({ path: "/workspace/intermediate/probe.parquet" });
  const png = await session.readAgentFile({ path: "/workspace/outputs/probe.png" });
  const svg = await session.readAgentFile({ path: "/workspace/outputs/probe.svg" });
  checks.parquet = {
    bytes: parquet.byteLength,
    sha256: sha256(parquet),
    magic_ok:
      decoder.decode(parquet.subarray(0, 4)) === "PAR1" &&
      decoder.decode(parquet.subarray(parquet.byteLength - 4)) === "PAR1",
  };
  checks.png = {
    bytes: png.byteLength,
    sha256: sha256(png),
    magic_ok: Buffer.from(png.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
  };
  checks.svg = {
    bytes: svg.byteLength,
    sha256: sha256(svg),
    root_ok: decoder.decode(svg.subarray(0, 1_024)).includes("<svg"),
  };

  const call = encoder.encode(
    JSON.stringify({
      schema_version: "statistical-operator-tool-call@1.0.0",
      call_id: "probe_bh",
      operator_id: "multiple-testing.bh-fdr@1",
      operator_registry_digest: REGISTRY_DIGEST,
      runtime_profile: "CORE_ANALYSIS",
      obligation: {
        call_id: "probe_bh",
        operator_id: "multiple-testing.bh-fdr@1",
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
    }),
  );
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

  const pass =
    checks.distinct_sandboxes === true &&
    checks.agent_operator_package_absent === true &&
    checks.stateful_cells === true &&
    (checks.parquet as { magic_ok: boolean }).magic_ok &&
    (checks.png as { magic_ok: boolean }).magic_ok &&
    (checks.svg as { root_ok: boolean }).root_ok &&
    (checks.governed_operator as { succeeded: boolean; registry_bound: boolean }).succeeded &&
    (checks.governed_operator as { succeeded: boolean; registry_bound: boolean }).registry_bound;
  report.status = pass ? "PASSED" : "FAILED";
  if (!pass) process.exitCode = 1;
} catch (error) {
  report.status = "FAILED";
  report.failure = error instanceof Error ? `${error.name}:${error.message}` : "UNKNOWN";
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
