import { describe, expect, it } from "vitest";
import {
  computePythonExecutionRequestHash,
  pythonExecutionRequestSchema,
  pythonSandboxReceiptSchema,
} from "../src/ports/python-sandbox.js";

const hash = `sha256:${"a".repeat(64)}` as const;
const sourceRef = {
  artifact_id: "00000000-0000-4000-8000-00000000a101",
  artifact_type: "SandboxProgram" as const,
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-00000000a102",
  environment: "local",
  run_id: "00000000-0000-4000-8000-00000000a103",
  revision: 1,
  content_hash: hash,
};
const request = {
  schema_version: "1.0.0" as const,
  workspace_id: sourceRef.tenant_id,
  run_id: sourceRef.run_id,
  attempt: 0 as const,
  fence_token: "fence-1",
  idempotency_key: "python-execution-1",
  source_ref: sourceRef,
  source_sha256: hash,
  entrypoint: "main" as const,
  input_refs: [],
  output_contract: {
    schema_version: "python-output-contract@1.0.0" as const,
    outputs: [{ name: "summary", type: "CSV" as const, required: true, max_bytes: 1_000_000 }],
  },
  runtime_digest: hash,
  dependency_lock_digest: hash,
  policy_version: "python-policy@1.0.0",
  budgets: {
    wall_time_ms: 30_000,
    cpu_seconds: 20,
    memory_bytes: 536_870_912,
    input_bytes: 67_108_864,
    output_bytes: 67_108_864,
    max_pids: 16,
    max_open_files: 64,
    stdout_bytes: 65_536,
    stderr_bytes: 65_536,
  },
};

describe("Python Sandbox contracts", () => {
  it("rejects unknown fields, scope swaps and source hash drift", () => {
    expect(() => pythonExecutionRequestSchema.parse({ ...request, dsn: "postgres://forbidden" })).toThrow();
    expect(() => pythonExecutionRequestSchema.parse({ ...request, workspace_id: "00000000-0000-4000-8000-00000000ffff" })).toThrow();
    expect(() => pythonExecutionRequestSchema.parse({ ...request, source_sha256: `sha256:${"b".repeat(64)}` })).toThrow();
  });

  it("binds deterministic request hashes", async () => {
    const parsed = pythonExecutionRequestSchema.parse(request);
    expect(await computePythonExecutionRequestHash(parsed)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(await computePythonExecutionRequestHash(parsed)).toBe(await computePythonExecutionRequestHash(parsed));
  });

  it("rejects failed receipts that claim committed output", () => {
    expect(() => pythonSandboxReceiptSchema.parse({
      schema_version: "1.0.0",
      workspace_id: request.workspace_id,
      run_id: request.run_id,
      attempt: 0,
      fence_token: request.fence_token,
      idempotency_key: request.idempotency_key,
      request_hash: hash,
      sandbox_image_digest: hash,
      python_version: "3.12.9",
      sdk_version: "1.0.0",
      dependency_lock_digest: hash,
      policy_version: request.policy_version,
      started_at: "2026-08-15T00:00:00.000Z",
      finished_at: "2026-08-15T00:00:01.000Z",
      elapsed_ms: 1000,
      observed_resources: { peak_memory_bytes: 1, cpu_seconds: 0.1, output_bytes: 0, stdout_bytes: 0, stderr_bytes: 0, exit_code: 1, signal: null },
      hard_controls: { network_isolated: true, filesystem_isolated: true, memory_limit_enforced: true, cpu_limit_enforced: true, pid_limit_enforced: true },
      status: "FAILED",
      failure_code: "PYTHON_ERROR",
      output_refs: [sourceRef],
      stdout_ref: null,
      stderr_ref: null,
    })).toThrow();
  });
});
