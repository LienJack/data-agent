import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  type AvailableModelProfile,
  type BenchmarkAgentDescriptor,
  type BenchmarkAnalysisReport,
  type BenchmarkOracleFeedback,
  type BenchmarkRunBudget,
  benchmarkAgentDescriptorSchema,
  benchmarkAnalysisReportSchema,
  CERTIFIED_MODEL_ANALYSIS_AGENT_ID,
  createDirectModelProviderInvocation,
  isAvailableModelProfile,
  type ModelProviderEvent,
  type ModelProviderPort,
  type PublicBenchmarkCase,
} from "@data-agent/contracts";
import { z } from "zod";
import type {
  BenchmarkAnalysisAgent,
  BenchmarkAnalysisAgentAnswer,
  BenchmarkAnalysisAgentInvocationContext,
  BenchmarkAnalysisAgentReflection,
} from "./analysis-agent.js";
import { reportedTokenCounts } from "./model-provider-usage.js";

export const INSIGHTBENCH_REPORT_RESPONSE_SCHEMA_VERSION = "insightbench-analysis-report@1.0.0";
export const INSIGHTBENCH_REFLECTION_RESPONSE_SCHEMA_VERSION =
  "insightbench-analysis-reflection@1.0.0";

export const insightBenchModelReportResponseSchema = benchmarkAnalysisReportSchema;
export const insightBenchModelReflectionResponseSchema = z.strictObject({
  diagnosis_summary: z.string().min(1).max(2_048),
  proposed_actions: z.array(z.string().min(1).max(1_024)).min(1).max(16),
  confidence: z.number().min(0).max(1),
  retry_recommendation: z.enum(["APPROVED", "REJECTED"]),
  revised_report: benchmarkAnalysisReportSchema.nullable(),
});

const RESPONSE_SCHEMA_INPUT_ALLOWANCE_BYTES = 8_192;

export class CertifiedModelAnalysisAgentError extends Error {
  override readonly name = "CertifiedModelAnalysisAgentError";

  constructor(
    readonly code:
      | "MODEL_ANALYSIS_PROFILE_NOT_AUTHORIZED"
      | "MODEL_ANALYSIS_CONTEXT_NOT_VERIFIED"
      | "MODEL_ANALYSIS_INPUT_TOO_LARGE"
      | "MODEL_ANALYSIS_BUDGET_EXCEEDED"
      | "MODEL_ANALYSIS_PROVIDER_FAILED"
      | "MODEL_ANALYSIS_RESPONSE_INVALID",
    message: string,
    readonly diagnostic_code: string = code,
  ) {
    super(message);
  }
}

function estimateCostMicros(input: {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly input_rate: number;
  readonly output_rate: number;
}): number {
  const million = 1_000_000n;
  const inputCost =
    (BigInt(input.input_tokens) * BigInt(input.input_rate) + million - 1n) / million;
  const outputCost =
    (BigInt(input.output_tokens) * BigInt(input.output_rate) + million - 1n) / million;
  const total = inputCost + outputCost;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CertifiedModelAnalysisAgentError(
      "MODEL_ANALYSIS_BUDGET_EXCEEDED",
      "模型调用成本超出安全整数范围。",
    );
  }
  return Number(total);
}

function promptInputTokenUpperBound(messages: readonly { readonly content: string }[]): number {
  return (
    messages.reduce((total, message) => total + Buffer.byteLength(message.content, "utf8"), 0) +
    RESPONSE_SCHEMA_INPUT_ALLOWANCE_BYTES
  );
}

function reportSystemPrompt(): string {
  return [
    "You are a data-analysis benchmark agent.",
    "Use only the public question, public evidence, schema, and CSV in this request.",
    "Return exactly one structured analysis report with this contract:",
    '{"answer_type":"ANALYSIS_REPORT","summary":"non-empty string","insights":[{"title":"non-empty string","finding":"non-empty string","evidence":"non-empty string","recommendation":"non-empty string"}]}.',
    "Do not add fields outside that contract and include at least one insight.",
    "Every finding must cite concrete evidence from the CSV; never invent reference answers.",
    "Prefer several complementary, non-duplicative insights and actionable recommendations.",
  ].join("\n");
}

function answerUserPrompt(input: {
  readonly test_case: PublicBenchmarkCase;
  readonly csv_text: string;
  readonly seed: number;
}): string {
  return [
    `Seed: ${input.seed}`,
    `Question: ${input.test_case.question}`,
    `Evidence: ${input.test_case.evidence ?? "None"}`,
    `Public schema: ${JSON.stringify(input.test_case.schema)}`,
    "CSV:",
    input.csv_text,
  ].join("\n");
}

function reflectionUserPrompt(input: {
  readonly test_case: PublicBenchmarkCase;
  readonly csv_text: string;
  readonly prior_report: BenchmarkAnalysisReport;
  readonly feedback: BenchmarkOracleFeedback;
  readonly seed: number;
}): string {
  return [
    `Seed: ${input.seed}`,
    `Question: ${input.test_case.question}`,
    `Evidence: ${input.test_case.evidence ?? "None"}`,
    `Public schema: ${JSON.stringify(input.test_case.schema)}`,
    `Prior report: ${JSON.stringify(input.prior_report)}`,
    `Non-leaking deterministic Oracle feedback: ${JSON.stringify(input.feedback)}`,
    "Diagnose the report using only that public feedback and the unchanged CSV.",
    "If a bounded retry is justified, return APPROVED and a revised report; otherwise return REJECTED and null.",
    "CSV:",
    input.csv_text,
  ].join("\n");
}

interface CompletedModelEvent
  extends Extract<ModelProviderEvent, { readonly event_type: "COMPLETED" }> {}

export class CertifiedModelAnalysisAgent implements BenchmarkAnalysisAgent {
  readonly descriptor: BenchmarkAgentDescriptor;
  readonly #profile: AvailableModelProfile;
  readonly #modelProvider: ModelProviderPort;
  readonly #budget: BenchmarkRunBudget;
  readonly #contextWindow: Extract<
    AvailableModelProfile["operational_constraints"]["context_window"],
    { readonly verification_status: "VERIFIED" }
  >;
  readonly #pricing: AvailableModelProfile["operational_constraints"]["pricing"];
  #spentCostMicros = 0;

  constructor(input: {
    readonly profile: AvailableModelProfile;
    readonly model_provider: ModelProviderPort;
    readonly budget: BenchmarkRunBudget;
  }) {
    if (!isAvailableModelProfile(input.profile)) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_PROFILE_NOT_AUTHORIZED",
        "InsightBench 模型 Agent 只接受服务端配置的可用 Profile。",
      );
    }
    const contextWindow = input.profile.operational_constraints.context_window;
    if (contextWindow.verification_status !== "VERIFIED") {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_CONTEXT_NOT_VERIFIED",
        "InsightBench 模型 Agent 需要已验证的 Context Window 约束。",
      );
    }
    const pricing = input.profile.operational_constraints.pricing;
    if (input.budget.max_output_tokens_per_attempt > contextWindow.max_output_tokens) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_BUDGET_EXCEEDED",
        "冻结的单次输出预算超过配置 Profile 的输出上限。",
      );
    }
    this.#profile = input.profile;
    this.#modelProvider = input.model_provider;
    this.#budget = input.budget;
    this.#contextWindow = contextWindow;
    this.#pricing = pricing;
    this.descriptor = benchmarkAgentDescriptorSchema.parse({
      agent_id: CERTIFIED_MODEL_ANALYSIS_AGENT_ID,
      agent_version: `certified-model-analysis@${input.profile.profile_version}`,
      display_name: `${input.profile.provider} ${input.profile.model_id} analysis agent`,
      kind: "CERTIFIED_MODEL_ANALYSIS",
      provider: input.profile.provider,
      model_id: input.profile.model_id,
      available: true,
      unavailable_reason: null,
      supports_reflection: true,
    });
  }

  async #invoke(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly invocation: BenchmarkAnalysisAgentInvocationContext;
    readonly response_schema_version: string;
    readonly messages: readonly { readonly role: "system" | "user"; readonly content: string }[];
  }): Promise<{
    readonly output: unknown;
    readonly event: CompletedModelEvent;
    readonly latency_ms: number;
  }> {
    const inputTokenBudget = promptInputTokenUpperBound(input.messages);
    const maxOutputTokens = input.invocation.max_output_tokens;
    if (
      inputTokenBudget + maxOutputTokens > this.#contextWindow.max_context_tokens ||
      maxOutputTokens > this.#contextWindow.max_output_tokens
    ) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_INPUT_TOO_LARGE",
        "题目与 CSV 超出配置 Profile 的 Context Window。",
      );
    }
    const maximumAttemptCost = this.#cost(inputTokenBudget, maxOutputTokens);
    if (this.#spentCostMicros + maximumAttemptCost > this.#budget.max_cost_micros) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_BUDGET_EXCEEDED",
        "模型调用的保守成本上界超过冻结批次预算。",
      );
    }

    const request = createDirectModelProviderInvocation({
      schema_version: "1.0.0",
      request_id: randomUUID(),
      attempt_id: input.invocation.attempt_id,
      scope: this.#profile.scope,
      run_id: input.invocation.run_id,
      provider: this.#profile.provider,
      profile_id: this.#profile.profile_id,
      profile_version: this.#profile.profile_version,
      model_id: this.#profile.model_id,
      task_ref: {
        artifact_id: input.test_case.case_id,
        artifact_type: "EvalCase",
        ...this.#profile.scope,
        run_id: input.invocation.run_id,
        revision: 1,
        content_hash: input.test_case.public_case_hash,
      },
      context_refs: [],
      messages: input.messages,
      tool_allowlist: [],
      response_schema_version: input.response_schema_version,
      budget: {
        timeout_ms: input.invocation.timeout_ms,
        max_input_tokens: inputTokenBudget,
        max_output_tokens: maxOutputTokens,
        max_tool_calls: 0,
      },
    });

    const started = performance.now();
    let completed: CompletedModelEvent | null = null;
    for await (const event of this.#modelProvider.stream(request)) {
      if (event.event_type === "FAILED") {
        throw new CertifiedModelAnalysisAgentError(
          "MODEL_ANALYSIS_PROVIDER_FAILED",
          `模型调用失败：${event.reason_code}`,
          event.reason_code,
        );
      }
      if (event.event_type === "COMPLETED") completed = event;
    }
    if (!completed) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_PROVIDER_FAILED",
        "模型调用未返回完成事件。",
      );
    }
    const tokenCounts = reportedTokenCounts(completed.usage);
    const actualCost = this.#cost(tokenCounts.input_tokens, tokenCounts.output_tokens);
    this.#spentCostMicros += actualCost;
    let output: unknown;
    try {
      output = JSON.parse(completed.output_text);
    } catch {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_RESPONSE_INVALID",
        "模型返回的结构化结果不是合法 JSON。",
      );
    }
    return {
      output,
      event: completed,
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
    };
  }

  #cost(inputTokens: number, outputTokens: number): number {
    return this.#pricing.verification_status === "VERIFIED" && this.#pricing.currency === "USD"
      ? estimateCostMicros({
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          input_rate: this.#pricing.input_microunits_per_million_tokens,
          output_rate: this.#pricing.output_microunits_per_million_tokens,
        })
      : 0;
  }

  async answer(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly csv_text: string;
    readonly seed: number;
    readonly invocation: BenchmarkAnalysisAgentInvocationContext;
  }): Promise<BenchmarkAnalysisAgentAnswer> {
    const result = await this.#invoke({
      test_case: input.test_case,
      invocation: input.invocation,
      response_schema_version: INSIGHTBENCH_REPORT_RESPONSE_SCHEMA_VERSION,
      messages: [
        { role: "system", content: reportSystemPrompt() },
        { role: "user", content: answerUserPrompt(input) },
      ],
    });
    const report = insightBenchModelReportResponseSchema.safeParse(result.output);
    if (!report.success) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_RESPONSE_INVALID",
        "模型返回的首答不符合分析报告契约。",
      );
    }
    const tokenCounts = reportedTokenCounts(result.event.usage);
    return {
      report: report.data,
      usage: {
        input_tokens: tokenCounts.input_tokens,
        output_tokens: tokenCounts.output_tokens,
        cost_micros: this.#cost(tokenCounts.input_tokens, tokenCounts.output_tokens),
        currency: "USD",
      },
      latency_ms: result.latency_ms,
    };
  }

  async reflect(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly csv_text: string;
    readonly prior_report: BenchmarkAnalysisReport;
    readonly feedback: BenchmarkOracleFeedback;
    readonly seed: number;
    readonly invocation: BenchmarkAnalysisAgentInvocationContext;
  }): Promise<BenchmarkAnalysisAgentReflection> {
    const result = await this.#invoke({
      test_case: input.test_case,
      invocation: input.invocation,
      response_schema_version: INSIGHTBENCH_REFLECTION_RESPONSE_SCHEMA_VERSION,
      messages: [
        { role: "system", content: reportSystemPrompt() },
        { role: "user", content: reflectionUserPrompt(input) },
      ],
    });
    const reflection = insightBenchModelReflectionResponseSchema.safeParse(result.output);
    if (!reflection.success) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_RESPONSE_INVALID",
        "模型返回的反省不符合结构化契约。",
      );
    }
    const tokenCounts = reportedTokenCounts(result.event.usage);
    const usage = {
      input_tokens: tokenCounts.input_tokens,
      output_tokens: tokenCounts.output_tokens,
      cost_micros: this.#cost(tokenCounts.input_tokens, tokenCounts.output_tokens),
      currency: "USD" as const,
    };
    return {
      diagnosis_summary: reflection.data.diagnosis_summary,
      proposed_actions: reflection.data.proposed_actions,
      confidence: reflection.data.confidence,
      retry_recommendation: reflection.data.retry_recommendation,
      revised_answer: reflection.data.revised_report
        ? { report: reflection.data.revised_report, usage, latency_ms: result.latency_ms }
        : null,
    };
  }
}
