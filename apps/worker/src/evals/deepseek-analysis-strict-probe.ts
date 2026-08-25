import { createHash } from "node:crypto";
import {
  projectDeepSeekStrictToolInputSchema,
  type ServerOwnedToolDescriptor,
} from "@data-agent/agent-runtime";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import {
  ANALYSIS_PYTHON_CELL_TOOL_NAME,
  ANALYSIS_RESULT_PUBLISH_TOOL_NAME,
  ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
  type ModelProviderEvent,
} from "@data-agent/contracts/ports";
import { z } from "zod";
import {
  ANALYSIS_MODEL_TOOL_DESCRIPTORS,
  analysisModelToolCallCandidateSchema,
} from "../analysis/analysis-tool-descriptors.js";

export const DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS = 100 as const;
export const DEEPSEEK_ANALYSIS_STRICT_PROBE_VERSION =
  "deepseek-analysis-strict-probe@1.3.0" as const;

const probeToolNameSchema = z.enum([
  ANALYSIS_PYTHON_CELL_TOOL_NAME,
  ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
  ANALYSIS_RESULT_PUBLISH_TOOL_NAME,
]);

const probeAttemptSchema = z.strictObject({
  ordinal: z.number().int().min(1).max(DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS),
  request_id: z.uuid(),
  tool_name: probeToolNameSchema,
  request_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  response_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  arguments_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  tool_call_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
  status: z.literal("PASS"),
});

const probeReportMaterialSchema = z
  .strictObject({
    schema_version: z.literal(DEEPSEEK_ANALYSIS_STRICT_PROBE_VERSION),
    provider: z.literal("deepseek"),
    model_id: z.literal("deepseek-v4-flash"),
    strict: z.literal(true),
    expected_attempts: z.literal(DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS),
    completed_attempts: z.literal(DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS),
    passed_attempts: z.literal(DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS),
    tool_manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    attempts: z.array(probeAttemptSchema).length(DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS),
    result: z.literal("GO"),
    started_at: z.iso.datetime({ offset: true }),
    completed_at: z.iso.datetime({ offset: true }),
  })
  .superRefine((report, context) => {
    const ordinals = report.attempts.map(({ ordinal }) => ordinal);
    const requestIds = report.attempts.map(({ request_id: requestId }) => requestId);
    const expectedOrdinals = Array.from(
      { length: DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS },
      (_, index) => index + 1,
    );
    if (
      JSON.stringify(ordinals) !== JSON.stringify(expectedOrdinals) ||
      new Set(requestIds).size !== requestIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Strict probe attempts must be complete, ordered, and uniquely identified.",
        path: ["attempts"],
      });
    }
    const observedTools = new Set(report.attempts.map(({ tool_name: toolName }) => toolName));
    if (observedTools.size !== 3) {
      context.addIssue({
        code: "custom",
        message: "Strict probe must cover every Analysis Tool descriptor.",
        path: ["attempts"],
      });
    }
  });

export const deepseekAnalysisStrictProbeReportSchema = probeReportMaterialSchema.extend({
  report_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});

export type DeepSeekAnalysisStrictProbeReport = z.infer<
  typeof deepseekAnalysisStrictProbeReportSchema
>;

export interface DeepSeekAnalysisStrictProbeInvocation {
  readonly request_id: string;
  readonly response_hash: string;
  readonly tool_calls: readonly Readonly<{
    readonly tool_call_id: string;
    readonly tool_name: string;
    readonly arguments: unknown;
  }>[];
  readonly usage: Extract<ModelProviderEvent, { readonly event_type: "COMPLETED" }>["usage"];
}

export interface DeepSeekAnalysisStrictProbePlanEntry {
  readonly ordinal: number;
  readonly request_id: string;
  readonly tool_name: z.infer<typeof probeToolNameSchema>;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly prompt: string;
}

const toolNames = [
  ANALYSIS_PYTHON_CELL_TOOL_NAME,
  ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
  ANALYSIS_RESULT_PUBLISH_TOOL_NAME,
] as const;

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function argumentsFor(
  toolName: z.infer<typeof probeToolNameSchema>,
  ordinal: number,
): Readonly<Record<string, unknown>> {
  if (toolName === ANALYSIS_PYTHON_CELL_TOOL_NAME) {
    return {
      source: `strict_probe_value = ${ordinal}`,
      timeout_ms: 1_000,
    };
  }
  if (toolName === ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME) {
    return {
      call_id: `strict_probe_${ordinal}`,
      operator_id: "robust-trend.theil-sen-slope@1",
    };
  }
  return {
    publish_id: `strict_probe_${ordinal}`,
    result_symbol: "strict_probe_result",
    table_bindings: [{ table_id: "probe_table", data_symbol: "strict_probe_table" }],
    chart_bindings: [
      {
        chart_id: "probe_chart",
        x_field: "period",
        y_fields: ["value"],
        series_field: "",
        lower_bound_field: "",
        upper_bound_field: "",
      },
    ],
    operator_bindings: [],
  };
}

export function buildDeepSeekAnalysisStrictProbePlan(): readonly DeepSeekAnalysisStrictProbePlanEntry[] {
  return Object.freeze(
    Array.from({ length: DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS }, (_, index) => {
      const ordinal = index + 1;
      const toolName = toolNames[index % toolNames.length] ?? ANALYSIS_PYTHON_CELL_TOOL_NAME;
      const argumentsDocument = argumentsFor(toolName, ordinal);
      return Object.freeze({
        ordinal,
        request_id: stableUuid(`deepseek-analysis-strict-probe\0${ordinal}\0${toolName}`),
        tool_name: toolName,
        arguments: argumentsDocument,
        prompt: [
          `Call the required ${toolName} tool exactly once.`,
          "Use exactly the following JSON object as its arguments and do not add fields:",
          canonicalizeJson(argumentsDocument),
          "Do not execute the tool and do not answer with prose.",
        ].join("\n"),
      });
    }),
  );
}

export async function computeAnalysisStrictToolManifestHash(
  descriptors: readonly ServerOwnedToolDescriptor[] = ANALYSIS_MODEL_TOOL_DESCRIPTORS,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(
    descriptors.map((descriptor) => ({
      tool_name: descriptor.tool_name,
      description: descriptor.description,
      strict: descriptor.strict === true,
      network_access: descriptor.network_access ?? { mode: "DENY" },
      input_schema: projectDeepSeekStrictToolInputSchema(descriptor.input_schema),
    })),
  );
}

export async function runDeepSeekAnalysisStrictProbe(input: {
  readonly invoke: (
    plan: DeepSeekAnalysisStrictProbePlanEntry,
  ) => Promise<DeepSeekAnalysisStrictProbeInvocation>;
  readonly now?: () => Date;
}): Promise<DeepSeekAnalysisStrictProbeReport> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const attempts = [];
  for (const plan of buildDeepSeekAnalysisStrictProbePlan()) {
    const requestHash = await sha256ContentHash({
      request_id: plan.request_id,
      tool_name: plan.tool_name,
      arguments: plan.arguments,
      prompt: plan.prompt,
    });
    const invocation = await input.invoke(plan);
    if (invocation.request_id !== plan.request_id || invocation.tool_calls.length !== 1) {
      throw new TypeError("DEEPSEEK_STRICT_PROBE_TOOL_PROTOCOL_INVALID");
    }
    const toolCall = invocation.tool_calls[0];
    if (!toolCall) throw new TypeError("DEEPSEEK_STRICT_PROBE_TOOL_PROTOCOL_INVALID");
    const parsed = analysisModelToolCallCandidateSchema.safeParse(toolCall);
    if (!parsed.success || parsed.data.tool_name !== plan.tool_name) {
      throw new TypeError("DEEPSEEK_STRICT_PROBE_ARGUMENTS_INVALID");
    }
    const descriptor = ANALYSIS_MODEL_TOOL_DESCRIPTORS.find(
      ({ tool_name: toolName }) => toolName === plan.tool_name,
    );
    if (!descriptor?.input_schema.safeParse(toolCall.arguments).success) {
      throw new TypeError("DEEPSEEK_STRICT_PROBE_ARGUMENTS_INVALID");
    }
    if (canonicalizeJson(toolCall.arguments) !== canonicalizeJson(plan.arguments)) {
      throw new TypeError("DEEPSEEK_STRICT_PROBE_ARGUMENTS_SUBSTITUTED");
    }
    const usage = invocation.usage;
    attempts.push(
      probeAttemptSchema.parse({
        ordinal: plan.ordinal,
        request_id: plan.request_id,
        tool_name: plan.tool_name,
        request_hash: requestHash,
        response_hash: invocation.response_hash,
        arguments_hash: await sha256ContentHash(toolCall.arguments),
        tool_call_hash: await sha256ContentHash(parsed.data),
        input_tokens: usage.availability === "AVAILABLE" ? usage.input_tokens : null,
        output_tokens: usage.availability === "AVAILABLE" ? usage.output_tokens : null,
        status: "PASS",
      }),
    );
  }
  const material = probeReportMaterialSchema.parse({
    schema_version: DEEPSEEK_ANALYSIS_STRICT_PROBE_VERSION,
    provider: "deepseek",
    model_id: "deepseek-v4-flash",
    strict: true,
    expected_attempts: DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS,
    completed_attempts: attempts.length,
    passed_attempts: attempts.length,
    tool_manifest_hash: await computeAnalysisStrictToolManifestHash(),
    attempts,
    result: "GO",
    started_at: startedAt,
    completed_at: now().toISOString(),
  });
  return deepseekAnalysisStrictProbeReportSchema.parse({
    ...material,
    report_hash: await sha256ContentHash(material),
  });
}

export async function verifyDeepSeekAnalysisStrictProbeReport(
  input: unknown,
): Promise<DeepSeekAnalysisStrictProbeReport> {
  const report = deepseekAnalysisStrictProbeReportSchema.parse(input);
  const { report_hash: observedHash, ...material } = report;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("DEEPSEEK_STRICT_PROBE_REPORT_HASH_INVALID");
  }
  if (report.tool_manifest_hash !== (await computeAnalysisStrictToolManifestHash())) {
    throw new TypeError("DEEPSEEK_STRICT_PROBE_MANIFEST_DRIFT");
  }
  const plan = buildDeepSeekAnalysisStrictProbePlan();
  for (const [index, attempt] of report.attempts.entries()) {
    const expected = plan[index];
    if (
      !expected ||
      attempt.ordinal !== expected.ordinal ||
      attempt.request_id !== expected.request_id ||
      attempt.tool_name !== expected.tool_name ||
      attempt.request_hash !==
        (await sha256ContentHash({
          request_id: expected.request_id,
          tool_name: expected.tool_name,
          arguments: expected.arguments,
          prompt: expected.prompt,
        })) ||
      attempt.arguments_hash !== (await sha256ContentHash(expected.arguments))
    ) {
      throw new TypeError("DEEPSEEK_STRICT_PROBE_PLAN_EVIDENCE_INVALID");
    }
  }
  return report;
}
