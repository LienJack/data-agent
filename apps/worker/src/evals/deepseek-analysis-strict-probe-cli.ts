import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createDirectModelProviderPort,
  getModelProviderBinding,
  ServerModelResponseSchemaRegistry,
} from "@data-agent/agent-runtime";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  analysisAgentFinalResponseSchema,
  createDirectModelProviderInvocation,
} from "@data-agent/contracts/ports";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import { ANALYSIS_MODEL_TOOL_DESCRIPTORS } from "../analysis/analysis-tool-descriptors.js";
import { createTrustedUtf8InputTokenUpperBoundCounter } from "../providers/trusted-input-token-upper-bound.js";
import {
  type DeepSeekAnalysisStrictProbeInvocation,
  type DeepSeekAnalysisStrictProbePlanEntry,
  runDeepSeekAnalysisStrictProbe,
} from "./deepseek-analysis-strict-probe.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const PROBE_TENANT_ID = "00000000-0000-4000-8000-00000000f241";
const RESPONSE_SCHEMA_VERSION = "analysis-agent-final@1.0.0";

function stableErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "reason_code" in error &&
    typeof error.reason_code === "string" &&
    /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.reason_code)
  ) {
    return error.reason_code;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.message)) {
    return error.message;
  }
  return "DEEPSEEK_STRICT_PROBE_FAILED";
}

function createProbeInvoker(credential: string) {
  const binding = getModelProviderBinding("deepseek");
  if (binding.default_model_id !== "deepseek-v4-flash") {
    throw new TypeError("DEEPSEEK_STRICT_PROBE_MODEL_IDENTITY_INVALID");
  }
  const responseSchemas = new ServerModelResponseSchemaRegistry([
    {
      response_schema_version: RESPONSE_SCHEMA_VERSION,
      schema: analysisAgentFinalResponseSchema,
    },
  ]);

  return async (
    plan: DeepSeekAnalysisStrictProbePlanEntry,
  ): Promise<DeepSeekAnalysisStrictProbeInvocation> => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 60_000);
    const scope = {
      app_id: APP_ID,
      tenant_id: PROBE_TENANT_ID,
      environment: "local",
    } as const;
    const taskHash = await sha256ContentHash({
      kind: "DEEPSEEK_ANALYSIS_STRICT_PROBE",
      ordinal: plan.ordinal,
      tool_name: plan.tool_name,
      arguments: plan.arguments,
    });
    const request = createDirectModelProviderInvocation({
      schema_version: "model-provider-request@1.0.0",
      request_id: plan.request_id,
      attempt_id: plan.request_id,
      scope,
      run_id: plan.request_id,
      provider: "deepseek",
      profile_id: binding.profile_id,
      profile_version: binding.profile_version,
      model_id: binding.default_model_id,
      task_ref: {
        artifact_id: plan.request_id,
        artifact_type: "ProviderTaskArtifact",
        ...scope,
        run_id: plan.request_id,
        revision: 1,
        content_hash: taskHash,
      },
      context_refs: [],
      messages: [
        {
          role: "system",
          content:
            "You are executing a server-owned DeepSeek Strict Tool compatibility probe. Follow the exact tool and argument request; never execute tools and never include secrets.",
        },
        { role: "user", content: plan.prompt },
      ],
      tool_allowlist: [plan.tool_name],
      response_schema_version: RESPONSE_SCHEMA_VERSION,
      budget: {
        timeout_ms: 60_000,
        max_input_tokens: 8_192,
        max_output_tokens: 1_024,
        max_tool_calls: 1,
      },
    });
    const provider = createDirectModelProviderPort({
      credential_resolver: {
        resolve: async (candidate) =>
          candidate.provider === "deepseek" && candidate.credential_env === binding.credential_env
            ? credential
            : null,
      },
      binding_resolver: {
        resolve: async (candidate) =>
          candidate.provider === binding.provider &&
          candidate.profile_id === binding.profile_id &&
          candidate.profile_version === binding.profile_version
            ? binding
            : null,
      },
      response_schema_registry: responseSchemas,
      input_token_counter: createTrustedUtf8InputTokenUpperBoundCounter(),
      dispatch_marker: { mark_dispatched: async () => {} },
      abort_signal: abortController.signal,
      tools: ANALYSIS_MODEL_TOOL_DESCRIPTORS,
    });
    const toolCalls: DeepSeekAnalysisStrictProbeInvocation["tool_calls"][number][] = [];
    try {
      for await (const event of provider.stream(request)) {
        if (event.event_type === "TOOL_CALL_CANDIDATE") {
          toolCalls.push({
            tool_call_id: event.tool_call_id,
            tool_name: event.tool_name,
            arguments: event.arguments,
          });
          continue;
        }
        if (event.event_type === "FAILED" || event.event_type === "THROTTLED") {
          throw Object.freeze({ reason_code: event.reason_code });
        }
        if (event.event_type === "COMPLETED") {
          return {
            request_id: plan.request_id,
            response_hash: event.response_hash,
            tool_calls: Object.freeze([...toolCalls]),
            usage: event.usage,
          };
        }
      }
      throw new TypeError("DEEPSEEK_STRICT_PROBE_TERMINAL_MISSING");
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function main(): Promise<void> {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
  const credential = environment.DEEPSEEK_API_KEY?.trim();
  if (!credential) throw new TypeError("DEEPSEEK_API_KEY_MISSING");
  const outputPath = resolve(
    root,
    environment.DEEPSEEK_ANALYSIS_STRICT_PROBE_OUTPUT?.trim() ??
      "artifacts/falcon24-agent-analysis/deepseek-analysis-strict-probe.json",
  );
  const report = await runDeepSeekAnalysisStrictProbe({
    invoke: createProbeInvoker(credential),
  });
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, outputPath);
  process.stdout.write(
    `${JSON.stringify({ terminal: "GO", passed_attempts: report.passed_attempts, tool_manifest_hash: report.tool_manifest_hash, report_hash: report.report_hash, output_path: outputPath })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ terminal: "HOLD", reason_code: stableErrorCode(error) })}\n`,
  );
  process.exitCode = 2;
});
