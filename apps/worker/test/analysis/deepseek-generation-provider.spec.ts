import {
  type AuthoritativeModelProviderInvocation,
  configureAvailableModelProfile,
  type ModelProviderEvent,
  type ModelProviderPort,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createDeepSeekPythonGenerationProvider,
  createRunBoundDeepSeekPythonGenerationProvider,
} from "../../src/analysis/deepseek-generation-provider.js";
import type { RunProviderDispatchCapability } from "../../src/runs/run-execution-context.js";

const id = (suffix: number) => `32000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

function profile(modelId = "deepseek-v4-flash") {
  return configureAvailableModelProfile({
    profile_id: id(4),
    scope,
    provider: "deepseek",
    model_id: modelId,
    profile_version: "1.0.0",
    capabilities: {
      structured_output: true,
      tool_calling: false,
      streaming: true,
      reasoning: true,
      vision: false,
    },
    operational_constraints: {
      context_window: {
        verification_status: "VERIFIED",
        max_context_tokens: 128_000,
        max_output_tokens: 8_192,
      },
      region_privacy: { verification_status: "UNVERIFIED" },
      fallback_compatibility: { verification_status: "UNVERIFIED" },
    },
    certification_status: "CONFIGURED",
  });
}

function eventFor(
  request: AuthoritativeModelProviderInvocation,
  terminal: "COMPLETED" | "FAILED" | "THROTTLED" = "COMPLETED",
): ModelProviderEvent {
  const base = {
    schema_version: "1.0.0",
    request_id: request.request_id,
    attempt_id: request.attempt_id,
    scope: request.scope,
    run_id: request.run_id,
    provider: request.provider,
    profile_id: request.profile_id,
    profile_version: request.profile_version,
    model_id: request.model_id,
    sequence: 1,
    observed_at: "2026-08-24T00:00:01.000Z",
  } as const;
  if (terminal === "FAILED") {
    return {
      ...base,
      event_type: "FAILED",
      reason_code: "UPSTREAM_FAILED",
      retryable: false,
      delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
    };
  }
  if (terminal === "THROTTLED") {
    return {
      ...base,
      event_type: "THROTTLED",
      reason_code: "MODEL_PROVIDER_THROTTLED",
      retryable: true,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      retry_after_ms: 1_000,
    };
  }
  return {
    ...base,
    event_type: "COMPLETED",
    output_text:
      '{"schema_version":"analysis-python-source@1.0.0","python_source":"def main(context):\\n    pass\\n"}',
    response_hash: hash("a"),
    usage: {
      availability: "AVAILABLE",
      source: "PROVIDER_REPORTED",
      input_tokens: 100,
      output_tokens: 20,
      tool_calls: 0,
      unavailable_reason: null,
    },
  };
}

const lease = {
  scope,
  principal_id: id(5),
  outbox_id: id(6),
  run_id: runId,
  command_id: id(7),
  command_kind: "START_L2_RESEARCH",
  attempt_id: id(8),
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 120_000,
  worker_id: "analysis-worker",
  lease_token: 1,
  worker_fence: 1,
  expires_at: "2026-08-24T00:02:00.000Z",
  payload: {},
} as const;

const analysisProgramRef = {
  artifact_id: id(9),
  artifact_type: "AnalysisProgram",
  ...scope,
  run_id: runId,
  revision: 1,
  content_hash: hash("b"),
} as const;

function generationRequest() {
  return {
    lease,
    analysis_program_ref: analysisProgramRef,
    node_id: "falcon24-question-1",
    generation_attempt: 0,
    provider: "deepseek",
    model_id: "deepseek-v4-flash",
    response_schema_version: "analysis-python-source@1.0.0",
    system: "Return governed Python only.",
    prompt: '{"input_schemas":[]}',
    max_output_tokens: 8_192,
  } as const;
}

describe("DeepSeek Python generation provider", () => {
  it("uses the run-bound capability for governed production generation", async () => {
    const invoke = vi.fn(async (input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) => ({
      ok: true as const,
      value: {
        output_text:
          '{"schema_version":"analysis-python-source@1.0.0","python_source":"def main(context):\\n    pass\\n"}',
        tool_calls: [],
        projection: {
          invocation_id: input.logical_call_id,
          status: "COMPLETED" as const,
          provider: "deepseek",
          model_id: "deepseek-v4-flash",
        },
      },
    }));
    const generation = createRunBoundDeepSeekPythonGenerationProvider({ invoke });
    const request = generationRequest();
    const response = await generation.generate(request);
    const call = invoke.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      logical_call_id: expect.any(String),
      analysis_python: {
        node_id: request.node_id,
        generation_attempt: 0,
        response_schema_version: "analysis-python-source@1.0.0",
        max_output_tokens: 8_192,
      },
    });
    expect(response).toMatchObject({
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      provider_invocation_ref: {
        resource_id: call?.logical_call_id,
        resource_revision: 1,
      },
    });
  });

  it("binds the fixed model invocation and returns its durable receipt reference", async () => {
    const captured: { request: AuthoritativeModelProviderInvocation | null } = { request: null };
    const provider: ModelProviderPort = {
      async *stream(request) {
        captured.request = request;
        yield eventFor(request);
      },
    };
    const generation = createDeepSeekPythonGenerationProvider({ profile: profile(), provider });
    const response = await generation.generate(generationRequest());

    expect(captured.request).toMatchObject({
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      task_ref: analysisProgramRef,
      tool_allowlist: [],
      response_schema_version: "analysis-python-source@1.0.0",
      budget: { max_output_tokens: 8_192, max_tool_calls: 0 },
    });
    expect(response.provider_invocation_ref).toEqual({
      resource_id: captured.request?.request_id,
      resource_revision: 1,
      resource_hash: hash("a"),
    });
  });

  it("rejects model substitution and converts provider terminals to stable failures", async () => {
    expect(() =>
      createDeepSeekPythonGenerationProvider({
        profile: profile("deepseek-other"),
        provider: { stream: vi.fn() as never },
      }),
    ).toThrow("ANALYSIS_PYTHON_MODEL_PROFILE_INVALID");

    for (const terminal of ["FAILED", "THROTTLED"] as const) {
      const provider: ModelProviderPort = {
        async *stream(request) {
          yield eventFor(request, terminal);
        },
      };
      const generation = createDeepSeekPythonGenerationProvider({ profile: profile(), provider });
      await expect(generation.generate(generationRequest())).rejects.toThrow(
        `ANALYSIS_PYTHON_PROVIDER_${terminal}`,
      );
    }
  });
});
