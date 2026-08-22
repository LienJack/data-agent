import { randomUUID } from "node:crypto";
import {
  type AppScope,
  type AuthoritativeModelProviderInvocation,
  authorizeAvailableModelProfile,
  computeModelProfileHash,
  configureAvailableModelProfile,
  isAuthoritativeModelProviderInvocation,
  type ModelProfile,
  type ModelProviderPort,
  publicBenchmarkCaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  CertifiedModelAnalysisAgent,
  CertifiedModelAnalysisAgentError,
  INSIGHTBENCH_REFLECTION_RESPONSE_SCHEMA_VERSION,
  INSIGHTBENCH_REPORT_RESPONSE_SCHEMA_VERSION,
} from "../src/test-center/model-analysis-agent.js";
import {
  CertifiedModelSqlAgent,
  SQL_REFLECTION_RESPONSE_SCHEMA_VERSION,
} from "../src/test-center/model-sql-agent.js";

const scope = {
  app_id: "51000000-0000-4000-8000-000000000001",
  tenant_id: "51000000-0000-4000-8000-000000000002",
  environment: "test",
} as const satisfies AppScope;
const receiptHash = `sha256:${"a".repeat(64)}` as const;
const responseHash = `sha256:${"b".repeat(64)}` as const;

async function availableProfile(
  pricing: ModelProfile["operational_constraints"]["pricing"] = {
    verification_status: "VERIFIED",
    currency: "USD",
    input_microunits_per_million_tokens: 1_000,
    output_microunits_per_million_tokens: 2_000,
  },
) {
  const receiptRef = {
    artifact_id: "51000000-0000-4000-8000-000000000003",
    artifact_type: "ModelCertificationReceipt",
    ...scope,
    run_id: "51000000-0000-4000-8000-000000000004",
    revision: 1,
    content_hash: receiptHash,
  } as const;
  const profile: ModelProfile = {
    profile_id: "51000000-0000-4000-8000-000000000005",
    scope,
    provider: "openai",
    model_id: "fixture-model",
    profile_version: "1.0.0",
    capabilities: {
      structured_output: true,
      tool_calling: false,
      streaming: true,
      reasoning: false,
      vision: false,
    },
    operational_constraints: {
      context_window: {
        verification_status: "VERIFIED",
        max_context_tokens: 64_000,
        max_output_tokens: 4_096,
      },
      region_privacy: { verification_status: "UNVERIFIED" },
      pricing,
      fallback_compatibility: { verification_status: "UNVERIFIED" },
    },
    certification_status: "AVAILABLE",
    certification_receipt_ref: receiptRef,
    certified_model_id: "fixture-model",
  };
  const profileHash = await computeModelProfileHash(profile);
  return authorizeAvailableModelProfile(profile, {
    verifyCommitted: async () => true,
    resolve: async (reference) => ({
      schema_version: "1.0.0",
      receipt_ref: reference,
      profile_id: profile.profile_id,
      provider: profile.provider,
      model_id: profile.model_id,
      profile_version: profile.profile_version,
      profile_hash: profileHash,
      probe_hash: receiptHash,
      verdict: "PASS",
    }),
  });
}

function configuredProfile() {
  return configureAvailableModelProfile({
    profile_id: "51000000-0000-4000-8000-000000000005",
    scope,
    provider: "openai",
    model_id: "fixture-model",
    profile_version: "1.0.0",
    capabilities: {
      structured_output: true,
      tool_calling: false,
      streaming: true,
      reasoning: false,
      vision: false,
    },
    operational_constraints: {
      context_window: {
        verification_status: "VERIFIED",
        max_context_tokens: 64_000,
        max_output_tokens: 4_096,
      },
      region_privacy: { verification_status: "UNVERIFIED" },
      pricing: { verification_status: "UNVERIFIED" },
      fallback_compatibility: { verification_status: "UNVERIFIED" },
    },
    certification_status: "CONFIGURED",
  });
}

async function publicCase() {
  const draft = {
    case_id: "51000000-0000-4000-8000-000000000006",
    suite_id: "insightbench" as const,
    suite_version: "1.0.0",
    dataset_version: "fixture@1.0.0",
    ordinal: 0,
    database_id: "fixture",
    question: "Which category leads?",
    evidence: "Use the public CSV.",
    difficulty: "simple" as const,
    capabilities: ["ANALYSIS_REPORT" as const],
    registry: "DEMO" as const,
    schema: [
      {
        name: "dataset",
        columns: [{ name: "category", data_type: "TEXT", nullable: false, primary_key: false }],
      },
    ],
  };
  return publicBenchmarkCaseSchema.parse({
    ...draft,
    public_case_hash: await sha256ContentHash(draft),
  });
}

function eventsFor(
  request: AuthoritativeModelProviderInvocation,
  output: unknown,
): ReturnType<ModelProviderPort["stream"]> {
  async function* stream() {
    yield {
      schema_version: "1.0.0",
      request_id: request.request_id,
      attempt_id: request.attempt_id,
      scope: request.scope,
      run_id: request.run_id,
      provider: request.provider,
      profile_id: request.profile_id,
      profile_version: request.profile_version,
      model_id: request.model_id,
      sequence: 0,
      observed_at: "2026-08-09T00:00:00.000Z",
      event_type: "STARTED" as const,
    };
    yield {
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
      observed_at: "2026-08-09T00:00:01.000Z",
      event_type: "COMPLETED" as const,
      output_text: JSON.stringify(output),
      response_hash: responseHash,
      usage: {
        availability: "AVAILABLE" as const,
        source: "PROVIDER_REPORTED" as const,
        input_tokens: 120,
        output_tokens: 80,
        tool_calls: 0,
        unavailable_reason: null,
      },
    };
  }
  return stream();
}

const report = {
  answer_type: "ANALYSIS_REPORT" as const,
  summary: "Category A leads the two-row sample.",
  insights: [
    {
      title: "Category lead",
      finding: "Category A has the largest observed value.",
      evidence: "A=2; B=1",
      recommendation: "Inspect whether the gap persists in later samples.",
    },
  ],
};

const budget = {
  max_cases: 1,
  max_attempts_per_case: 2,
  max_case_duration_ms: 5_000,
  max_batch_duration_ms: 20_000,
  max_output_tokens_per_attempt: 1_000,
  max_cost_micros: 1_000,
  concurrency: 1,
};

describe("CertifiedModelAnalysisAgent", () => {
  it("uses only an authorized profile and preserves the same run/attempt correlation", async () => {
    const profile = await availableProfile();
    const observed: AuthoritativeModelProviderInvocation[] = [];
    const port: ModelProviderPort = {
      stream(request) {
        expect(isAuthoritativeModelProviderInvocation(request)).toBe(true);
        observed.push(request);
        return eventsFor(
          request,
          request.response_schema_version === INSIGHTBENCH_REPORT_RESPONSE_SCHEMA_VERSION
            ? report
            : {
                diagnosis_summary: "The first report needs broader segment coverage.",
                proposed_actions: ["Compare additional categories."],
                confidence: 0.8,
                retry_recommendation: "APPROVED",
                revised_report: report,
              },
        );
      },
    };
    const agent = new CertifiedModelAnalysisAgent({ profile, model_provider: port, budget });
    const testCase = await publicCase();
    const runId = randomUUID();
    const firstAttemptId = randomUUID();
    const answer = await agent.answer({
      test_case: testCase,
      csv_text: "category,value\nA,2\nB,1\n",
      seed: 42,
      invocation: {
        run_id: runId,
        attempt_id: firstAttemptId,
        attempt_index: 0,
        timeout_ms: 5_000,
        max_output_tokens: 1_000,
      },
    });
    expect(answer.report).toEqual(report);
    expect(answer.usage).toEqual({
      input_tokens: 120,
      output_tokens: 80,
      cost_micros: 2,
      currency: "USD",
    });

    const secondAttemptId = randomUUID();
    const reflection = await agent.reflect({
      test_case: testCase,
      csv_text: "category,value\nA,2\nB,1\n",
      prior_report: answer.report,
      feedback: {
        oracle_version: "fixture@1.0.0",
        failure_type: "METRIC_BELOW_THRESHOLD",
        public_message: "Coverage is below the frozen threshold.",
        candidate_row_count: null,
        gold_row_count: null,
        candidate_column_count: null,
        gold_column_count: null,
        oracle_receipt_hash: responseHash,
      },
      seed: 42,
      invocation: {
        run_id: runId,
        attempt_id: secondAttemptId,
        attempt_index: 1,
        timeout_ms: 5_000,
        max_output_tokens: 1_000,
      },
    });
    expect(reflection.retry_recommendation).toBe("APPROVED");
    expect(reflection.revised_answer?.report).toEqual(report);
    expect(observed.map(({ run_id }) => run_id)).toEqual([runId, runId]);
    expect(observed.map(({ attempt_id }) => attempt_id)).toEqual([firstAttemptId, secondAttemptId]);
    expect(observed.map(({ response_schema_version }) => response_schema_version)).toEqual([
      INSIGHTBENCH_REPORT_RESPONSE_SCHEMA_VERSION,
      INSIGHTBENCH_REFLECTION_RESPONSE_SCHEMA_VERSION,
    ]);
  });

  it("rejects an unbranded profile and a zero-cost budget before calling the provider", async () => {
    const profile = await availableProfile();
    expect(
      () =>
        new CertifiedModelAnalysisAgent({
          profile: { ...profile },
          model_provider: { async *stream() {} },
          budget,
        }),
    ).toThrowError(expect.objectContaining({ code: "MODEL_ANALYSIS_PROFILE_NOT_AUTHORIZED" }));

    let providerCalled = false;
    const agent = new CertifiedModelAnalysisAgent({
      profile,
      model_provider: {
        async *stream() {
          providerCalled = true;
          yield* [];
        },
      },
      budget: { ...budget, max_cost_micros: 0 },
    });
    await expect(
      agent.answer({
        test_case: await publicCase(),
        csv_text: "category,value\nA,2\n",
        seed: 42,
        invocation: {
          run_id: randomUUID(),
          attempt_id: randomUUID(),
          attempt_index: 0,
          timeout_ms: 5_000,
          max_output_tokens: 1_000,
        },
      }),
    ).rejects.toBeInstanceOf(CertifiedModelAnalysisAgentError);
    expect(providerCalled).toBe(false);
  });

  it("calls a configured model without certification or pricing authorization", async () => {
    const profile = configuredProfile();
    let providerCalled = false;
    const agent = new CertifiedModelAnalysisAgent({
      profile,
      model_provider: {
        stream(request) {
          providerCalled = true;
          return eventsFor(request, report);
        },
      },
      budget: { ...budget, max_cost_micros: 0 },
    });
    const answer = await agent.answer({
      test_case: await publicCase(),
      csv_text: "category,value\nA,2\nB,1\n",
      seed: 42,
      invocation: {
        run_id: randomUUID(),
        attempt_id: randomUUID(),
        attempt_index: 0,
        timeout_ms: 5_000,
        max_output_tokens: 1_000,
      },
    });

    expect(providerCalled).toBe(true);
    expect(answer.usage.cost_micros).toBe(0);
  });
});

describe("CertifiedModelSqlAgent", () => {
  it("runs with verified context limits when commercial pricing is unavailable", async () => {
    const profile = await availableProfile({ verification_status: "UNVERIFIED" });
    const port: ModelProviderPort = {
      stream: (request) =>
        eventsFor(request, { answer_type: "SQL", sql: "SELECT category FROM dataset" }),
    };
    const agent = new CertifiedModelSqlAgent({
      profile,
      model_provider: port,
      budget: { ...budget, max_cost_micros: 0 },
    });
    const answer = await agent.answer({
      test_case: await publicCase(),
      seed: 42,
      invocation: {
        run_id: randomUUID(),
        attempt_id: randomUUID(),
        timeout_ms: 5_000,
        max_output_tokens: 1_000,
      },
    });

    expect(answer.sql).toBe("SELECT category FROM dataset");
    expect(answer.usage).toMatchObject({ cost_micros: 0, currency: "USD" });
  });

  it("compacts provider reflection overruns before creating an authoritative receipt", async () => {
    const profile = await availableProfile();
    const observed: AuthoritativeModelProviderInvocation[] = [];
    const port: ModelProviderPort = {
      stream(request) {
        observed.push(request);
        return eventsFor(request, {
          diagnosis_summary: "D".repeat(3_000),
          proposed_actions: Array.from({ length: 6 }, (_, index) => `${index}:${"A".repeat(500)}`),
          confidence: 0.5,
          retry_recommendation: "APPROVED",
          revised_sql: "SELECT category FROM dataset",
        });
      },
    };
    const agent = new CertifiedModelSqlAgent({ profile, model_provider: port, budget });
    const reflection = await agent.reflect({
      test_case: await publicCase(),
      prior_sql: "SELECT * FROM dataset",
      feedback: {
        oracle_version: "fixture@1.0.0",
        failure_type: "ORACLE_MISMATCH",
        public_message: "Candidate and reference columns differ.",
        candidate_row_count: 2,
        gold_row_count: 2,
        candidate_column_count: 2,
        gold_column_count: 1,
        oracle_receipt_hash: responseHash,
      },
      seed: 42,
      invocation: {
        run_id: randomUUID(),
        attempt_id: randomUUID(),
        timeout_ms: 5_000,
        max_output_tokens: 1_000,
      },
    });

    expect(reflection.diagnosis_summary).toHaveLength(600);
    expect(reflection.proposed_actions).toHaveLength(4);
    expect(reflection.proposed_actions.every((action) => action.length <= 240)).toBe(true);
    expect(reflection.revised_answer?.sql).toBe("SELECT category FROM dataset");
    expect(observed[0]?.response_schema_version).toBe(SQL_REFLECTION_RESPONSE_SCHEMA_VERSION);
  });
});
