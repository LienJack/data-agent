import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  type AvailableModelProfile,
  authorizeModelProviderInvocation,
  type BenchmarkAgentDescriptor,
  type BenchmarkOracleFeedback,
  type BenchmarkRunBudget,
  type BenchmarkUsage,
  benchmarkAgentDescriptorSchema,
  benchmarkSqlAnswerSchema,
  CERTIFIED_MODEL_SQL_AGENT_ID,
  isAvailableModelProfile,
  type ModelProviderEvent,
  type ModelProviderPort,
  type PublicBenchmarkCase,
} from "@data-agent/contracts";
import { z } from "zod";
import type {
  BenchmarkAgentAnswer,
  BenchmarkAgentReflection,
  BenchmarkEvalAgent,
  BenchmarkSqlAgentInvocationContext,
} from "./agents.js";
import { CertifiedModelAnalysisAgentError } from "./model-analysis-agent.js";
import { reportedTokenCounts } from "./model-provider-usage.js";

export const SQL_ANSWER_RESPONSE_SCHEMA_VERSION = "benchmark-sql-answer@1.0.0";
export const SQL_REFLECTION_RESPONSE_SCHEMA_VERSION = "benchmark-sql-reflection@1.1.0";

export const modelSqlAnswerResponseSchema = benchmarkSqlAnswerSchema;
export const modelSqlReflectionResponseSchema = z.strictObject({
  // Provider structured-output enforcement is best effort for OpenAI-compatible endpoints.
  // Accept a bounded overrun here, then compact before the value reaches an authoritative receipt.
  diagnosis_summary: z.string().min(1).max(20_000),
  proposed_actions: z.array(z.string().min(1).max(4_096)).min(1).max(16),
  confidence: z.number().min(0).max(1),
  retry_recommendation: z.enum(["APPROVED", "REJECTED"]),
  revised_sql: z.string().min(1).max(100_000).nullable(),
});

const RESPONSE_SCHEMA_INPUT_ALLOWANCE_BYTES = 8_192;
const REFLECTION_DIAGNOSIS_MAX_LENGTH = 600;
const REFLECTION_ACTION_MAX_LENGTH = 240;
const REFLECTION_ACTION_MAX_COUNT = 4;

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

function schemaPrompt(testCase: PublicBenchmarkCase): string {
  return testCase.schema
    .map(
      (table) =>
        `Table ${table.name}: ${table.columns
          .map(
            (column) =>
              `${column.name} ${column.data_type}${column.primary_key ? " PRIMARY KEY" : ""}${
                column.nullable ? "" : " NOT NULL"
              }`,
          )
          .join(", ")}`,
    )
    .join("\n");
}

function answerMessages(input: { readonly test_case: PublicBenchmarkCase; readonly seed: number }) {
  return [
    {
      role: "system" as const,
      content: [
        "You are a SQL benchmark agent.",
        'Return exactly one structured object: {"answer_type":"SQL","sql":"non-empty SQL"}.',
        "Use only the public question, evidence, and schema. Never request or infer hidden gold SQL.",
        "Produce executable SQL for the named database dialect and avoid markdown fences.",
        "Before returning, verify that every referenced table and column exists exactly in the supplied schema; aliases do not create columns.",
        "PostgreSQL folds unquoted identifiers to lower case. Double-quote every schema identifier containing uppercase letters, spaces, or punctuation exactly as supplied.",
        "Select exactly the semantic attributes requested by the question and avoid SELECT * unless the question explicitly requests every column.",
        "When the question asks for an entity and corresponding metrics, include that entity as the first output attribute followed by the requested metrics.",
        "In Chinese double-negation filters such as 排除非欺诈/排除非成功, exclude the negated class and retain the positive class.",
        "Return the smallest requested output shape. Intermediate counts, denominators, totals, rates, ranks, filters, and sort keys are not output columns unless the question explicitly asks to list them.",
        "For Chinese 哪些/谁 questions, return only the requested entity identifier unless 及其/和它的/列出该指标 explicitly requests another attribute. For 占比是多少, return the grouping dimension and ratio, not the numerator total.",
        "For 哪些...最高/最低/最多/最少, filter to the tied extrema with RANK/DENSE_RANK or an extremum comparison; ORDER BY alone must not return every entity.",
        "Do not put entity IDs into the RANK/DENSE_RANK window ordering because that destroys ties. Filter the rank first, then apply stable entity tie breakers only in the final ORDER BY.",
        "When output order matters outside an extremum rank window, add stable requested-entity tie breakers after the primary sort metric.",
        "For a latest/most-recent event metric, rank event rows per requested entity first and compute the metric from that same selected row; never combine unrelated MIN and MAX rows.",
        "Copy quoted literal values byte-for-byte from the question, including leading or trailing spaces and punctuation; never trim or normalize them.",
        "Keep SELECT expressions in the question's mention order; for 'number/count of X by each Y', put the aggregate first and then the grouping attributes.",
        "When a person's name is split into first_name and last_name, interpret ordering by 'name' as first_name then last_name unless the question explicitly says surname or last name.",
        "Do not add DISTINCT unless the question or evidence explicitly asks for unique rows.",
        "Keep separate first_name and last_name columns separate unless the question explicitly asks for one concatenated full-name field.",
        "For negative relationship questions, prefer a NULL-safe correlated NOT EXISTS using only verified relationship columns, and return the requested entity attribute rather than its join key.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `Seed: ${input.seed}`,
        `Database: ${input.test_case.database_id}`,
        `Question: ${input.test_case.question}`,
        `Evidence: ${input.test_case.evidence ?? "None"}`,
        "Schema:",
        schemaPrompt(input.test_case),
      ].join("\n"),
    },
  ];
}

function reflectionMessages(input: {
  readonly test_case: PublicBenchmarkCase;
  readonly prior_sql: string;
  readonly feedback: BenchmarkOracleFeedback;
  readonly seed: number;
}) {
  return [
    {
      role: "system" as const,
      content: [
        "You are a SQL benchmark repair agent.",
        "Use only public case data, the prior SQL, and non-leaking Oracle feedback.",
        "Return diagnosis_summary, proposed_actions, confidence, retry_recommendation, and revised_sql.",
        "Do not expose chain-of-thought or narrate alternatives. diagnosis_summary must be one concise sentence under 600 characters.",
        "Return at most 4 proposed_actions; each must be one imperative sentence under 240 characters.",
        "When retry_recommendation is REJECTED, revised_sql must be null.",
        "If candidate and gold row counts match but gold has more columns, preserve the existing candidate column order and append the missing requested derived column; do not prepend or reorder existing columns.",
        "For a singular who/which question where the candidate has multiple rows but gold has one, apply the requested extremum ordering, a stable tie-breaker, and LIMIT 1.",
        "Treat row count, column count, and the public message as constraints only; never guess hidden result values.",
        "If candidate rows are fewer than gold and DISTINCT was not explicitly requested, remove DISTINCT before changing joins.",
        "If gold has more columns than a concatenated-name candidate, restore separate first_name and last_name columns before the remaining measures.",
        "After SQL execution failure, re-derive every identifier from the supplied schema and make a semantic repair; do not merely remove an alias or DISTINCT.",
        "Preserve every quoted literal exactly as written in the public question, including surrounding whitespace.",
        "For negative relationship questions, use a correlated NOT EXISTS with schema-verified keys and select the exact requested outer attribute.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `Seed: ${input.seed}`,
        `Database: ${input.test_case.database_id}`,
        `Question: ${input.test_case.question}`,
        `Evidence: ${input.test_case.evidence ?? "None"}`,
        "Schema:",
        schemaPrompt(input.test_case),
        `Prior SQL: ${input.prior_sql}`,
        `Oracle feedback: ${JSON.stringify(input.feedback)}`,
      ].join("\n"),
    },
  ];
}

function compactReflectionText(value: string, maximumLength: number): string {
  return value.length <= maximumLength ? value : value.slice(0, maximumLength).trimEnd();
}

interface CompletedModelEvent
  extends Extract<ModelProviderEvent, { readonly event_type: "COMPLETED" }> {}

export class CertifiedModelSqlAgent implements BenchmarkEvalAgent {
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
        "SQL 模型 Agent 只接受经过持久化 Receipt 重验的 AVAILABLE Profile。",
      );
    }
    const contextWindow = input.profile.operational_constraints.context_window;
    const pricing = input.profile.operational_constraints.pricing;
    if (contextWindow.verification_status !== "VERIFIED") {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_CONTEXT_NOT_VERIFIED",
        "SQL 模型 Agent 需要已验证的 Context Window 约束。",
      );
    }
    if (pricing.verification_status === "VERIFIED" && pricing.currency !== "USD") {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_PRICING_NOT_VERIFIED",
        "SQL 模型 Agent 的已验证定价必须使用 USD。",
      );
    }
    if (input.budget.max_output_tokens_per_attempt > contextWindow.max_output_tokens) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_BUDGET_EXCEEDED",
        "冻结的单次输出预算超过认证 Profile 的输出上限。",
      );
    }
    this.#profile = input.profile;
    this.#modelProvider = input.model_provider;
    this.#budget = input.budget;
    this.#contextWindow = contextWindow;
    this.#pricing = pricing;
    this.descriptor = benchmarkAgentDescriptorSchema.parse({
      agent_id: CERTIFIED_MODEL_SQL_AGENT_ID,
      agent_version: `certified-model-sql@${input.profile.profile_version}`,
      display_name: `${input.profile.provider} ${input.profile.model_id} SQL agent`,
      kind: "CERTIFIED_MODEL_SQL",
      provider: input.profile.provider,
      model_id: input.profile.model_id,
      available: true,
      unavailable_reason: null,
      supports_reflection: true,
    });
  }

  async #invoke(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly invocation: BenchmarkSqlAgentInvocationContext;
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
        "题目与 Schema 超出认证 Profile 的 Context Window。",
      );
    }
    const maximumAttemptCost = this.#cost(inputTokenBudget, maxOutputTokens);
    if (this.#spentCostMicros + maximumAttemptCost > this.#budget.max_cost_micros) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_BUDGET_EXCEEDED",
        "模型调用的保守成本上界超过冻结批次预算。",
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
        messages: input.messages,
        tool_allowlist: [],
        response_schema_version: input.response_schema_version,
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
    const tokenCounts = reportedTokenCounts(completed.usage);
    const cost = this.#cost(tokenCounts.input_tokens, tokenCounts.output_tokens);
    this.#spentCostMicros += cost;
    let output: unknown;
    try {
      output = JSON.parse(completed.output_text);
    } catch {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_RESPONSE_INVALID",
        "认证模型返回的 SQL 结果不是合法 JSON。",
      );
    }
    return {
      output,
      event: completed,
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
    };
  }

  #usage(event: CompletedModelEvent): BenchmarkUsage {
    const tokenCounts = reportedTokenCounts(event.usage);
    return {
      input_tokens: tokenCounts.input_tokens,
      output_tokens: tokenCounts.output_tokens,
      cost_micros: this.#cost(tokenCounts.input_tokens, tokenCounts.output_tokens),
      currency: "USD",
    };
  }

  #cost(inputTokens: number, outputTokens: number): number {
    return this.#pricing.verification_status === "VERIFIED"
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
    readonly seed: number;
    readonly invocation: BenchmarkSqlAgentInvocationContext;
  }): Promise<BenchmarkAgentAnswer> {
    const result = await this.#invoke({
      test_case: input.test_case,
      invocation: input.invocation,
      response_schema_version: SQL_ANSWER_RESPONSE_SCHEMA_VERSION,
      messages: answerMessages(input),
    });
    const answer = modelSqlAnswerResponseSchema.safeParse(result.output);
    if (!answer.success) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_RESPONSE_INVALID",
        "认证模型返回的 SQL 首答不符合契约。",
      );
    }
    return {
      sql: answer.data.sql,
      usage: this.#usage(result.event),
      latency_ms: result.latency_ms,
    };
  }

  async reflect(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly prior_sql: string;
    readonly feedback: BenchmarkOracleFeedback;
    readonly seed: number;
    readonly invocation: BenchmarkSqlAgentInvocationContext;
  }): Promise<BenchmarkAgentReflection> {
    const result = await this.#invoke({
      test_case: input.test_case,
      invocation: input.invocation,
      response_schema_version: SQL_REFLECTION_RESPONSE_SCHEMA_VERSION,
      messages: reflectionMessages(input),
    });
    const reflection = modelSqlReflectionResponseSchema.safeParse(result.output);
    if (!reflection.success) {
      throw new CertifiedModelAnalysisAgentError(
        "MODEL_ANALYSIS_RESPONSE_INVALID",
        "认证模型返回的 SQL 反省不符合契约。",
      );
    }
    const revised = reflection.data.revised_sql;
    return {
      diagnosis_summary: compactReflectionText(
        reflection.data.diagnosis_summary,
        REFLECTION_DIAGNOSIS_MAX_LENGTH,
      ),
      proposed_actions: reflection.data.proposed_actions
        .slice(0, REFLECTION_ACTION_MAX_COUNT)
        .map((action) => compactReflectionText(action, REFLECTION_ACTION_MAX_LENGTH)),
      confidence: reflection.data.confidence,
      retry_recommendation: reflection.data.retry_recommendation,
      revised_answer:
        revised === null
          ? null
          : { sql: revised, usage: this.#usage(result.event), latency_ms: result.latency_ms },
    };
  }
}
