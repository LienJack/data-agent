import { describe, expect, it } from "vitest";
import {
  pythonExecutionEnvelopeSchema,
  pythonSandboxTransportOutcomeSchema,
} from "../src/index.js";

const digest = `sha256:${"a".repeat(64)}` as const;
const outputDigest = `sha256:${"b".repeat(64)}` as const;
const scope = {
  app_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
  run_id: "00000000-0000-4000-8000-000000000003",
} as const;
const sourceRef = {
  artifact_id: "00000000-0000-4000-8000-000000000004",
  artifact_type: "SensitiveExecutionArtifact" as const,
  ...scope,
  revision: 1,
  content_hash: digest,
};
const outputSlot = {
  name: "result",
  artifact_id: "00000000-0000-4000-8000-000000000005",
  artifact_type: "SandboxResult" as const,
  ...scope,
  revision: 1,
};
const operatorObligation = {
  call_id: "trend_fit",
  operator_id: "robust-trend.theil-sen-slope@1",
  result_binding: {
    result_output_name: "result",
    result_collection_path: "/method_evidence/trends",
    operator_collection_path: "/series",
    label_fields: ["label"],
    value_bindings: [
      {
        result_field: "slope",
        operator_field: "slope",
        comparison: "NUMERIC_TOLERANCE",
        absolute_tolerance: 1e-9,
        relative_tolerance: 1e-9,
      },
    ],
    require_exact_label_set: true,
  },
} as const;

function envelope() {
  return {
    protocol_version: "data-agent-python-sandbox-ipc@2.0.0",
    authorization: "sandbox-authorization-token-at-least-32-characters",
    request: {
      schema_version: "1.0.0",
      workspace_id: scope.tenant_id,
      run_id: scope.run_id,
      attempt: 0,
      fence_token: "fence-1",
      idempotency_key: "python-sandbox-v2-contract",
      source_ref: sourceRef,
      source_sha256: digest,
      entrypoint: "main",
      input_refs: [],
      output_contract: {
        schema_version: "python-output-contract@1.0.0",
        outputs: [{ name: "result", type: "JSON", required: true, max_bytes: 1024 }],
      },
      generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
      operator_registry_digest: digest,
      operator_obligations: [operatorObligation],
      runtime_digest: digest,
      dependency_lock_digest: digest,
      policy_version: "python-policy@1.0.0",
      budgets: {
        wall_time_ms: 1000,
        cpu_seconds: 1,
        memory_bytes: 268_435_456,
        input_bytes: 1024,
        output_bytes: 1024,
        max_pids: 8,
        max_open_files: 32,
        stdout_bytes: 1024,
        stderr_bytes: 1024,
      },
    },
    source_code_base64: "ZGVmIG1haW4oc2RrKTogcGFzcw==",
    inputs: [],
    output_slots: [outputSlot],
  } as const;
}

describe("Python Sandbox IPC v2 output authority", () => {
  it("authorizes an output identity without pre-authorizing its content hash", () => {
    const parsed = pythonExecutionEnvelopeSchema.parse(envelope());
    expect(parsed.output_slots[0]).not.toHaveProperty("content_hash");
    expect(
      pythonExecutionEnvelopeSchema.safeParse({
        ...envelope(),
        output_slots: undefined,
      }).success,
    ).toBe(false);
  });

  it("binds post-execution output bytes to the computed receipt reference", () => {
    const { name: _name, ...outputIdentity } = outputSlot;
    const outputReference = { ...outputIdentity, content_hash: outputDigest };
    const outcome = {
      protocol_version: "data-agent-python-sandbox-ipc@2.0.0",
      receipt: {
        schema_version: "1.0.0",
        workspace_id: scope.tenant_id,
        run_id: scope.run_id,
        attempt: 0,
        fence_token: "fence-1",
        idempotency_key: "python-sandbox-v2-contract",
        request_hash: digest,
        sandbox_image_digest: digest,
        python_version: "3.12.7",
        sdk_version: "data-agent-sandbox-sdk@1.0.0",
        dependency_lock_digest: digest,
        policy_version: "python-policy@1.0.0",
        generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
        operator_registry_digest: digest,
        operator_obligations: [operatorObligation],
        operator_receipts: [
          {
            schema_version: "statistical-operator-call-receipt@1.0.0",
            call_id: "trend_fit",
            operator_id: "robust-trend.theil-sen-slope@1",
            operator_registry_digest: digest,
            implementation_digest: digest,
            resolved_parameters: {},
            resolved_parameters_hash: digest,
            input_hash: digest,
            output_hash: outputDigest,
            result_binding_hash: outputDigest,
            sample_size: 18,
            group_count: 1,
            family_size: null,
            rank: null,
            applicability: "ASSUMPTION_BOUND",
            limitation_codes: ["SLOPE_UNIT_DEPENDS_ON_DECLARED_X_SCALE"],
          },
        ],
        operator_receipt_closure_hash: digest,
        started_at: "2026-08-24T00:00:00.000Z",
        finished_at: "2026-08-24T00:00:01.000Z",
        elapsed_ms: 1000,
        observed_resources: {
          peak_memory_bytes: 1,
          cpu_seconds: 0.1,
          output_bytes: 3,
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
          content_sha256: outputDigest,
          content_base64: "e30K",
          bytes: 3,
        },
      ],
      stdout: "",
      stderr: "",
    } as const;
    expect(pythonSandboxTransportOutcomeSchema.safeParse(outcome).success).toBe(true);
    expect(
      pythonSandboxTransportOutcomeSchema.safeParse({
        ...outcome,
        outputs: [{ ...outcome.outputs[0], content_sha256: digest }],
      }).success,
    ).toBe(false);
  });

  it("requires exact ordered operator receipt closure and registry identity", () => {
    const { name: _name, ...outputIdentity } = outputSlot;
    const outputReference = { ...outputIdentity, content_hash: outputDigest };
    const base = {
      protocol_version: "data-agent-python-sandbox-ipc@2.0.0",
      receipt: {
        schema_version: "1.0.0",
        workspace_id: scope.tenant_id,
        run_id: scope.run_id,
        attempt: 0,
        fence_token: "fence-1",
        idempotency_key: "python-sandbox-v2-contract",
        request_hash: digest,
        sandbox_image_digest: digest,
        python_version: "3.12.7",
        sdk_version: "data-agent-sandbox-sdk@1.0.0",
        dependency_lock_digest: digest,
        policy_version: "python-policy@1.0.0",
        generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
        operator_registry_digest: digest,
        operator_obligations: [operatorObligation],
        operator_receipts: [],
        operator_receipt_closure_hash: digest,
        started_at: "2026-08-24T00:00:00.000Z",
        finished_at: "2026-08-24T00:00:01.000Z",
        elapsed_ms: 1000,
        observed_resources: {
          peak_memory_bytes: 1,
          cpu_seconds: 0.1,
          output_bytes: 3,
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
          content_sha256: outputDigest,
          content_base64: "e30K",
          bytes: 3,
        },
      ],
      stdout: "",
      stderr: "",
    } as const;
    expect(pythonSandboxTransportOutcomeSchema.safeParse(base).success).toBe(false);
    expect(
      pythonExecutionEnvelopeSchema.safeParse({
        ...envelope(),
        request: { ...envelope().request, operator_registry_digest: undefined },
      }).success,
    ).toBe(false);
  });
});
