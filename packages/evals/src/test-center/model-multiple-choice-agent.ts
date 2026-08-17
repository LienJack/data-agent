import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  type AvailableModelProfile,
  authorizeModelProviderInvocation,
  type BenchmarkAgentDescriptor,
  type BenchmarkMultipleChoiceAnswer,
  type BenchmarkRunBudget,
  type BenchmarkUsage,
  benchmarkAgentDescriptorSchema,
  benchmarkMultipleChoiceAnswerSchema,
  CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID,
  isAvailableModelProfile,
  type ModelProviderEvent,
  type ModelProviderPort,
  type PublicBenchmarkCase,
} from "@data-agent/contracts";
import type { BenchmarkSqlAgentInvocationContext } from "./agents.js";
import { CertifiedModelAnalysisAgentError } from "./model-analysis-agent.js";
import { reportedTokenCounts } from "./model-provider-usage.js";

export const MULTIPLE_CHOICE_RESPONSE_SCHEMA_VERSION = "benchmark-multiple-choice@1.0.0";
export const modelMultipleChoiceResponseSchema = benchmarkMultipleChoiceAnswerSchema;

interface CompletedModelEvent
  extends Extract<ModelProviderEvent, { readonly event_type: "COMPLETED" }> {}

export interface BenchmarkMultipleChoiceAgentAnswer {
  readonly answer: BenchmarkMultipleChoiceAnswer;
  readonly usage: BenchmarkUsage;
  readonly latency_ms: number;
}

export interface BenchmarkMultipleChoiceAgent {
  readonly descriptor: BenchmarkAgentDescriptor;
  answer(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly seed: number;
    readonly invocation: BenchmarkSqlAgentInvocationContext;
    readonly excluded_choices?: readonly ("A" | "B" | "C" | "D")[];
  }): Promise<BenchmarkMultipleChoiceAgentAnswer>;
}

function estimateCostMicros(input: {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly input_rate: number;
  readonly output_rate: number;
}): number {
  const million = 1_000_000n;
  const total =
    (BigInt(input.input_tokens) * BigInt(input.input_rate) + million - 1n) / million +
    (BigInt(input.output_tokens) * BigInt(input.output_rate) + million - 1n) / million;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CertifiedModelAnalysisAgentError(
      "MODEL_ANALYSIS_BUDGET_EXCEEDED",
      "模型调用成本超出安全整数范围。",
    );
  }
  return Number(total);
}

function messages(input: {
  readonly test_case: PublicBenchmarkCase;
  readonly seed: number;
  readonly excluded_choices?: readonly ("A" | "B" | "C" | "D")[];
}) {
  const excluded = input.excluded_choices ?? [];
  return [
    {
      role: "system" as const,
      content: [
        "You are a data-analysis multiple-choice benchmark agent.",
        'Return exactly one structured object: {"answer_type":"MULTIPLE_CHOICE","choice":"A|B|C|D","rationale":"concise reason"}.',
        "Use only the public research context and options. Never request or infer hidden answer keys.",
        "Honor whether the question asks for the MOST or LEAST justifiable choice.",
        "Evaluate whether each option operationalizes the named conceptual variable and supports the stated research question.",
        "For LEAST questions, first identify an option that targets a different construct entirely; an imperfect multi-feature transformation that still directly contains the target is usually more justifiable than an unrelated-only transformation.",
        "For conceptual-variable choices, check both construct relevance and the declared analytic role (IV, DV, control); a plausible variable assigned to the wrong causal role can be the least justifiable.",
        "Do not rank an option only by loose association with the topic; align it with the research question's focal cause, outcome, and controls.",
        excluded.length > 0
          ? `The exact-choice Oracle confirmed these prior choices are wrong: ${excluded.join(", ")}. Exclude them and independently compare the remaining choices; the Oracle did not reveal the answer.`
          : "No prior-choice feedback is available.",
        "Keep the rationale under 500 characters.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `Seed: ${input.seed}`,
        `Dataset: ${input.test_case.database_id}`,
        `Research context: ${input.test_case.evidence ?? "None"}`,
        `Question and options:\n${input.test_case.question}`,
      ].join("\n\n"),
    },
  ];
}

export class CertifiedModelMultipleChoiceAgent implements BenchmarkMultipleChoiceAgent {
  readonly descriptor: BenchmarkAgentDescriptor;
  readonly #profile: AvailableModelProfile;
  readonly #modelProvider: ModelProviderPort;
  readonly #budget: BenchmarkRunBudget;
  readonly #contextWindow: Extract<
    AvailableModelProfile["operational_constraints"]["context_window"],
    { readonly verification_status: "VERIFIED" }
  >;
  readonly #pricing: Extract<
    AvailableModelProfile["operational_constraints"]["pricing"],
    { readonly verification_status: "VERIFIED" }
  >;
  #spentCostMicros = 0;

  constructor(input: {
    readonly profile: AvailableModelProfile;
    readonly model_provider: ModelProviderPort;
    readonly budget: BenchmarkRunBudget;
  }) {
    if (!isAvailableModelProfile(input.profile)) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_PROFILE_NOT_AUTHORIZED",
        "选择题模型 Agent 只接受经过持久化 Receipt 重验的 AVAILABLE Profile。",
      );
    }
    const contextWindow = input.profile.operational_constraints.context_window;
    const pricing = input.profile.operational_constraints.pricing;
    if (contextWindow.verification_status !== "VERIFIED") {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_CONTEXT_NOT_VERIFIED",
        "选择题模型 Agent 需要已验证的 Context Window。",
      );
    }
    if (pricing.verification_status !== "VERIFIED" || pricing.currency !== "USD") {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_PRICING_NOT_VERIFIED",
        "选择题模型 Agent 需要已验证的 USD 定价。",
      );
    }
    this.#profile = input.profile;
    this.#modelProvider = input.model_provider;
    this.#budget = input.budget;
    this.#contextWindow = contextWindow;
    this.#pricing = pricing;
    this.descriptor = benchmarkAgentDescriptorSchema.parse({
      agent_id: CERTIFIED_MODEL_MULTIPLE_CHOICE_AGENT_ID,
      agent_version: `certified-model-multiple-choice@${input.profile.profile_version}`,
      display_name: `${input.profile.provider} ${input.profile.model_id} multiple-choice agent`,
      kind: "CERTIFIED_MODEL_MULTIPLE_CHOICE",
      provider: input.profile.provider,
      model_id: input.profile.model_id,
      available: true,
      unavailable_reason: null,
      supports_reflection: true,
    });
  }

  async answer(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly seed: number;
    readonly invocation: BenchmarkSqlAgentInvocationContext;
    readonly excluded_choices?: readonly ("A" | "B" | "C" | "D")[];
  }): Promise<BenchmarkMultipleChoiceAgentAnswer> {
    const promptMessages = messages(input);
    const inputTokenBudget =
      promptMessages.reduce(
        (total, message) => total + Buffer.byteLength(message.content, "utf8"),
        0,
      ) + 8_192;
    const maxOutputTokens = Math.min(input.invocation.max_output_tokens, 1_024);
    if (inputTokenBudget + maxOutputTokens > this.#contextWindow.max_context_tokens) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_INPUT_TOO_LARGE",
        "选择题内容超出认证 Profile 的 Context Window。",
      );
    }
    const maximumCost = estimateCostMicros({
      input_tokens: inputTokenBudget,
      output_tokens: maxOutputTokens,
      input_rate: this.#pricing.input_microunits_per_million_tokens,
      output_rate: this.#pricing.output_microunits_per_million_tokens,
    });
    if (this.#spentCostMicros + maximumCost > this.#budget.max_cost_micros) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_BUDGET_EXCEEDED",
        "选择题模型调用的成本上界超过冻结预算。",
      );
    }
    const request = await authorizeModelProviderInvocation(
      {
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
        messages: promptMessages,
        tool_allowlist: [],
        response_schema_version: MULTIPLE_CHOICE_RESPONSE_SCHEMA_VERSION,
        budget: {
          timeout_ms: input.invocation.timeout_ms,
          max_input_tokens: inputTokenBudget,
          max_output_tokens: maxOutputTokens,
          max_tool_calls: 0,
        },
      },
      async ({ scope, profile_id }) =>
        scope.app_id === this.#profile.scope.app_id &&
        scope.tenant_id === this.#profile.scope.tenant_id &&
        scope.environment === this.#profile.scope.environment &&
        profile_id === this.#profile.profile_id
          ? this.#profile
          : null,
    );
    const started = performance.now();
    let completed: CompletedModelEvent | null = null;
    for await (const event of this.#modelProvider.stream(request)) {
      if (event.event_type === "FAILED") {
        throw new CertifiedModelAnalysisAgentError(
          "MODEL_ANALYSIS_PROVIDER_FAILED",
          `认证模型调用失败：${event.reason_code}`,
          event.reason_code,
        );
      }
      if (event.event_type === "COMPLETED") completed = event;
    }
    if (!completed) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_PROVIDER_FAILED",
        "认证模型调用未返回完成事件。",
      );
    }
    let output: unknown;
    try {
      output = JSON.parse(completed.output_text);
    } catch {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_RESPONSE_INVALID",
        "认证模型返回的选择题结果不是合法 JSON。",
      );
    }
    const answer = modelMultipleChoiceResponseSchema.safeParse(output);
    if (!answer.success) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_RESPONSE_INVALID",
        "认证模型返回的选择题结果不符合契约。",
      );
    }
    const tokenCounts = reportedTokenCounts(completed.usage);
    const cost = estimateCostMicros({
      input_tokens: tokenCounts.input_tokens,
      output_tokens: tokenCounts.output_tokens,
      input_rate: this.#pricing.input_microunits_per_million_tokens,
      output_rate: this.#pricing.output_microunits_per_million_tokens,
    });
    this.#spentCostMicros += cost;
    return {
      answer: answer.data,
      usage: {
        input_tokens: tokenCounts.input_tokens,
        output_tokens: tokenCounts.output_tokens,
        cost_micros: cost,
        currency: "USD",
      },
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
    };
  }
}
