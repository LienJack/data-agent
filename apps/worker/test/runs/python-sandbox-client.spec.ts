import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PythonExecutionEnvelopeV2,
  pythonExecutionEnvelopeSchema,
  pythonSandboxTransportOutcomeSchema,
} from "@data-agent/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEnvironmentPythonSandboxClient,
  createPythonSandboxClient,
  PythonSandboxTransportError,
} from "../../src/runs/python-sandbox-client.js";

const appId = "00000000-0000-4000-8000-00000000da01";
const workspaceId = "00000000-0000-4000-8000-00000000aa11";
const runId = "00000000-0000-4000-8000-00000000bb22";
const digest = `sha256:${"a".repeat(64)}` as const;
const sourceReference = {
  artifact_id: "00000000-0000-4000-8000-00000000cc33",
  artifact_type: "SandboxProgram" as const,
  app_id: appId,
  tenant_id: workspaceId,
  environment: "local",
  run_id: runId,
  revision: 1,
  content_hash: digest,
};
const outputReference = {
  ...sourceReference,
  artifact_id: "00000000-0000-4000-8000-00000000dd44",
  artifact_type: "SandboxResult" as const,
};

const envelope: PythonExecutionEnvelopeV2 = pythonExecutionEnvelopeSchema.parse({
  protocol_version: "data-agent-python-sandbox-ipc@2.0.0",
  authorization: "test-authorization-token-with-32-chars",
  request: {
    schema_version: "1.0.0",
    workspace_id: workspaceId,
    run_id: runId,
    attempt: 0,
    fence_token: "fence-1",
    idempotency_key: "python-client-test-1",
    source_ref: sourceReference,
    source_sha256: digest,
    entrypoint: "main",
    input_refs: [],
    output_contract: {
      schema_version: "python-output-contract@1.0.0",
      outputs: [{ name: "result", type: "JSON", required: true, max_bytes: 1024 }],
    },
    runtime_digest: digest,
    dependency_lock_digest: digest,
    policy_version: "python-sandbox-policy@1.0.0",
    budgets: {
      wall_time_ms: 5_000,
      cpu_seconds: 2,
      memory_bytes: 268_435_456,
      input_bytes: 1_024,
      output_bytes: 1_024,
      max_pids: 8,
      max_open_files: 32,
      stdout_bytes: 1_024,
      stderr_bytes: 1_024,
    },
  },
  source_code_base64: Buffer.from("def main(sdk): pass").toString("base64"),
  inputs: [],
  output_slots: [
    { name: "result", ...(({ content_hash: _hash, ...slot }) => slot)(outputReference) },
  ],
});

const outcome = pythonSandboxTransportOutcomeSchema.parse({
  protocol_version: "data-agent-python-sandbox-ipc@2.0.0",
  receipt: {
    schema_version: "1.0.0",
    workspace_id: workspaceId,
    run_id: runId,
    attempt: 0,
    fence_token: "fence-1",
    idempotency_key: "python-client-test-1",
    request_hash: digest,
    sandbox_image_digest: digest,
    python_version: "3.12.10",
    sdk_version: "data-agent-python-sdk@1.0.0",
    dependency_lock_digest: digest,
    policy_version: "python-sandbox-policy@1.0.0",
    started_at: "2026-08-15T00:00:00.000Z",
    finished_at: "2026-08-15T00:00:00.010Z",
    elapsed_ms: 10,
    observed_resources: {
      peak_memory_bytes: 1,
      cpu_seconds: 0.01,
      output_bytes: 2,
      stdout_bytes: 0,
      stderr_bytes: 0,
      exit_code: 0,
      signal: null,
    },
    hard_controls: {
      network_isolated: true,
      filesystem_isolated: true,
      memory_limit_enforced: true,
      cpu_limit_enforced: true,
      pid_limit_enforced: true,
    },
    status: "SUCCEEDED",
    failure_code: null,
    output_refs: [outputReference],
    stdout_ref: null,
    stderr_ref: null,
  },
  outputs: [
    {
      name: "result",
      type: "JSON",
      reference: outputReference,
      content_sha256: digest,
      content_base64: "e30=",
      bytes: 2,
    },
  ],
  stdout: "",
  stderr: "",
});

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  delete process.env.PYTHON_SANDBOX_ENABLED;
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function socketServer(response: string) {
  const directory = await mkdtemp(join(tmpdir(), "pyipc-"));
  directories.push(directory);
  const socketPath = join(directory, "s.sock");
  const server = createServer((socket) => {
    socket.on("data", () => undefined);
    socket.on("end", () => socket.end(response));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
}

describe("Python Sandbox UDS client", () => {
  it("returns a strictly validated sandbox outcome", async () => {
    const socketPath = await socketServer(`${JSON.stringify(outcome)}\n`);
    await expect(
      createPythonSandboxClient({ socketPath, responseTimeoutMs: 1_000 }).execute(envelope),
    ).resolves.toEqual(outcome);
  });

  it("maps malformed or oversized responses to a stable protocol error", async () => {
    const malformedPath = await socketServer("not-json\n");
    await expect(
      createPythonSandboxClient({ socketPath: malformedPath, responseTimeoutMs: 1_000 }).execute(
        envelope,
      ),
    ).rejects.toMatchObject({ code: "PYTHON_PROTOCOL_INVALID" });
    const oversizedPath = await socketServer(`${JSON.stringify(outcome)}\n`);
    await expect(
      createPythonSandboxClient({
        socketPath: oversizedPath,
        responseTimeoutMs: 1_000,
        maxResponseBytes: 8,
      }).execute(envelope),
    ).rejects.toMatchObject({ code: "PYTHON_PROTOCOL_INVALID" });
  });

  it("fails closed when the socket is unavailable and remains opt-in by environment", async () => {
    const missingPath = join(tmpdir(), `missing-${crypto.randomUUID()}.sock`);
    await expect(
      createPythonSandboxClient({ socketPath: missingPath, responseTimeoutMs: 100 }).execute(
        envelope,
      ),
    ).rejects.toBeInstanceOf(PythonSandboxTransportError);
    expect(createEnvironmentPythonSandboxClient()).toBeNull();
    process.env.PYTHON_SANDBOX_ENABLED = "true";
    expect(createEnvironmentPythonSandboxClient()).not.toBeNull();
    expect(createEnvironmentPythonSandboxClient({ PYTHON_SANDBOX_ENABLED: "false" })).toBeNull();
    expect(createEnvironmentPythonSandboxClient({ PYTHON_SANDBOX_ENABLED: "true" })).not.toBeNull();
  });
});
