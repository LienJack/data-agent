import { performance } from "node:perf_hooks";
import {
  type BenchmarkAgentDescriptor,
  type BenchmarkOracleFeedback,
  type BenchmarkUsage,
  PUBLISHED_BASELINE_AGENT_ID,
  type PublicBenchmarkCase,
  SUBMITTED_ANSWER_AGENT_ID,
} from "@data-agent/contracts";

export interface BenchmarkAgentAnswer {
  readonly sql: string;
  readonly usage: BenchmarkUsage;
  readonly latency_ms: number;
}

export interface BenchmarkAgentReflection {
  readonly diagnosis_summary: string;
  readonly proposed_actions: readonly string[];
  readonly confidence: number;
  readonly retry_recommendation: "APPROVED" | "REJECTED";
  readonly revised_answer: BenchmarkAgentAnswer | null;
}

export interface BenchmarkSqlAgentInvocationContext {
  readonly run_id: string;
  readonly attempt_id: string;
  readonly timeout_ms: number;
  readonly max_output_tokens: number;
}

export interface BenchmarkEvalAgent {
  readonly descriptor: BenchmarkAgentDescriptor;
  answer(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly seed: number;
    readonly invocation: BenchmarkSqlAgentInvocationContext;
  }): Promise<BenchmarkAgentAnswer>;
  reflect(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly prior_sql: string;
    readonly feedback: BenchmarkOracleFeedback;
    readonly seed: number;
    readonly invocation: BenchmarkSqlAgentInvocationContext;
  }): Promise<BenchmarkAgentReflection>;
}

const zeroUsage: BenchmarkUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cost_micros: 0,
  currency: "USD",
};

export class PublishedBirdBaselineAgent implements BenchmarkEvalAgent {
  readonly descriptor: BenchmarkAgentDescriptor = {
    agent_id: PUBLISHED_BASELINE_AGENT_ID,
    agent_version: "bird-published-gpt4-turbo@b3d4bcb",
    display_name: "BIRD published GPT-4 Turbo baseline",
    kind: "PUBLISHED_BASELINE",
    provider: "openai",
    model_id: "gpt-4-turbo",
    available: true,
    unavailable_reason: null,
    supports_reflection: false,
  };

  constructor(private readonly predictions: Readonly<Record<string, string>>) {}

  async answer(input: { readonly test_case: PublicBenchmarkCase }): Promise<BenchmarkAgentAnswer> {
    const started = performance.now();
    const sql = this.predictions[input.test_case.case_id];
    if (!sql?.trim()) throw new Error("PUBLISHED_BASELINE_PREDICTION_MISSING");
    return {
      sql: sql.trim(),
      usage: zeroUsage,
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
    };
  }

  async reflect(): Promise<BenchmarkAgentReflection> {
    return {
      diagnosis_summary: "公开冻结预测不具备运行时自反省能力。",
      proposed_actions: ["改用支持 Oracle 反馈的运行时 Agent。"],
      confidence: 1,
      retry_recommendation: "REJECTED",
      revised_answer: null,
    };
  }
}

export class SubmittedAnswerAgent implements BenchmarkEvalAgent {
  readonly descriptor: BenchmarkAgentDescriptor = {
    agent_id: SUBMITTED_ANSWER_AGENT_ID,
    agent_version: "submitted-answer@1.0.0",
    display_name: "提交答案",
    kind: "SUBMITTED_ANSWER",
    provider: null,
    model_id: null,
    available: true,
    unavailable_reason: null,
    supports_reflection: false,
  };

  constructor(private readonly answers: Readonly<Record<string, string>>) {}

  async answer(input: { readonly test_case: PublicBenchmarkCase }): Promise<BenchmarkAgentAnswer> {
    const sql = this.answers[input.test_case.case_id];
    if (!sql?.trim()) throw new Error("SUBMITTED_ANSWER_MISSING");
    return { sql: sql.trim(), usage: zeroUsage, latency_ms: 0 };
  }

  async reflect(): Promise<BenchmarkAgentReflection> {
    return {
      diagnosis_summary: "提交答案模式不会代表 Agent 生成新的重试答案。",
      proposed_actions: ["提供支持 Reflection 的服务端 Agent Adapter。"],
      confidence: 1,
      retry_recommendation: "REJECTED",
      revised_answer: null,
    };
  }
}
