import { randomUUID } from "node:crypto";
import {
  buildAgentTeamPublicTrace,
  buildFalconSemanticUsageReceipt,
  type FalconSemanticBundleIndex,
  type PublicBenchmarkCase,
  sha256ContentHash,
} from "@data-agent/contracts";
import type {
  BenchmarkAgentAnswer,
  BenchmarkAgentReflection,
  BenchmarkEvalAgent,
  FalconResultOracle,
} from "@data-agent/evals";

function blindReviewFeedback(publicMessage: string) {
  return Object.freeze({
    oracle_version: "pre-oracle-blind-review@1.0.0",
    failure_type: null,
    public_message: `Oracle has not run. ${publicMessage} Re-read the public question and schema, verify every identifier, join, filter, aggregation, output column, NULL rule, and ordering requirement, then revise only when necessary.`,
    candidate_row_count: null,
    gold_row_count: null,
    candidate_column_count: null,
    gold_column_count: null,
    oracle_receipt_hash: `sha256:${"0".repeat(64)}` as const,
  });
}

export interface FalconInvocationObservation {
  readonly invocation_id: string;
  readonly invocation_hash: `sha256:${string}`;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly usage_available: boolean;
}

export interface FalconTeamCaseResult {
  readonly case_id: string;
  readonly database_id: string;
  readonly registry: PublicBenchmarkCase["registry"];
  readonly run_id: string;
  readonly status: "PASS" | "FAIL" | "SUBMITTED" | "AGENT_FAILED";
  readonly first_sql: string | null;
  readonly final_sql: string | null;
  readonly first_verdict: "PASS" | "FAIL" | null;
  readonly final_verdict: "PASS" | "FAIL" | null;
  readonly first_oracle_receipt_hash: string | null;
  readonly final_oracle_receipt_hash: string | null;
  readonly semantic_usage_receipt: Awaited<
    ReturnType<typeof buildFalconSemanticUsageReceipt>
  > | null;
  readonly team_trace: Awaited<ReturnType<typeof buildAgentTeamPublicTrace>>;
  readonly report: {
    readonly summary: string;
    readonly claim: string;
    readonly citation_hash: `sha256:${string}`;
  } | null;
  readonly error_code: string | null;
}

export interface FalconTeamRunnerDependencies {
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
  };
  readonly bundle_index: FalconSemanticBundleIndex;
  readonly agent_profile_hashes: Readonly<{
    orchestrator: `sha256:${string}`;
    text2sql: `sha256:${string}`;
    report: `sha256:${string}`;
  }>;
  readonly create_agent: () => BenchmarkEvalAgent;
  readonly oracle: Pick<FalconResultOracle, "evaluate">;
  readonly observe_invocation: (attemptId: string) => FalconInvocationObservation | null;
  readonly diagnose_sql?: (testCase: PublicBenchmarkCase, sql: string) => Promise<string>;
  readonly is_sql_executable?: (testCase: PublicBenchmarkCase, sql: string) => Promise<boolean>;
  readonly normalize_sql?: (testCase: PublicBenchmarkCase, sql: string) => string;
  readonly now?: () => Date;
  readonly create_id?: () => string;
  readonly timeout_ms?: number;
  readonly max_output_tokens?: number;
}

function databaseNumber(databaseId: string): number {
  const parsed = Number(databaseId.slice(-2));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 28) {
    throw new Error("FALCON_DATABASE_ID_INVALID");
  }
  return parsed;
}

function stableErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "diagnostic_code" in error &&
    typeof error.diagnostic_code === "string" &&
    /^[A-Z][A-Z0-9_]*$/u.test(error.diagnostic_code)
  ) {
    return error.diagnostic_code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]*$/u.test(error.code)
  ) {
    return error.code;
  }
  return "FALCON_AGENT_ANSWER_FAILED";
}

function reference(resourceId: string, resourceHash: `sha256:${string}`) {
  return { resource_id: resourceId, resource_revision: 1, resource_hash: resourceHash };
}

async function safeBlindReflection(input: {
  readonly agent: BenchmarkEvalAgent;
  readonly testCase: PublicBenchmarkCase;
  readonly first: BenchmarkAgentAnswer;
  readonly runId: string;
  readonly attemptId: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly seed: number;
  readonly feedback: Parameters<BenchmarkEvalAgent["reflect"]>[0]["feedback"];
}): Promise<BenchmarkAgentReflection | null> {
  if (!input.agent.descriptor.supports_reflection) return null;
  try {
    return await input.agent.reflect({
      test_case: input.testCase,
      prior_sql: input.first.sql,
      feedback: input.feedback,
      seed: input.seed,
      invocation: {
        run_id: input.runId,
        attempt_id: input.attemptId,
        timeout_ms: input.timeoutMs,
        max_output_tokens: input.maxOutputTokens,
      },
    });
  } catch {
    return null;
  }
}

async function teamTrace(input: {
  readonly dependencies: FalconTeamRunnerDependencies;
  readonly runId: string;
  readonly rootTaskId: string;
  readonly textTaskId: string;
  readonly reportTaskId: string | null;
  readonly now: string;
  readonly accepted: boolean;
}) {
  const tasks = [
    {
      task_id: input.rootTaskId,
      parent_task_id: null,
      depth: 0 as const,
      profile_id: "data-agent-orchestrator" as const,
      profile_revision: 1,
      profile_hash: input.dependencies.agent_profile_hashes.orchestrator,
      task_revision: 1,
      attempt_id: input.dependencies.create_id?.() ?? randomUUID(),
      worker_fence: 1,
      status: input.accepted ? ("ACCEPTED" as const) : ("REJECTED" as const),
      created_at: input.now,
    },
    {
      task_id: input.textTaskId,
      parent_task_id: input.rootTaskId,
      depth: 1 as const,
      profile_id: "governed-text2sql-agent" as const,
      profile_revision: 1,
      profile_hash: input.dependencies.agent_profile_hashes.text2sql,
      task_revision: 1,
      attempt_id: input.dependencies.create_id?.() ?? randomUUID(),
      worker_fence: 1,
      status: input.accepted ? ("ACCEPTED" as const) : ("REJECTED" as const),
      created_at: input.now,
    },
    ...(input.reportTaskId
      ? [
          {
            task_id: input.reportTaskId,
            parent_task_id: input.rootTaskId,
            depth: 1 as const,
            profile_id: "report-writing-agent" as const,
            profile_revision: 1,
            profile_hash: input.dependencies.agent_profile_hashes.report,
            task_revision: 1,
            attempt_id: input.dependencies.create_id?.() ?? randomUUID(),
            worker_fence: 1,
            status: input.accepted ? ("ACCEPTED" as const) : ("REJECTED" as const),
            created_at: input.now,
          },
        ]
      : []),
  ].sort((left, right) => left.task_id.localeCompare(right.task_id));
  const childIds = [input.textTaskId, ...(input.reportTaskId ? [input.reportTaskId] : [])].sort();
  const handoffs = childIds
    .map((childTaskId) => ({
      handoff_id: input.dependencies.create_id?.() ?? randomUUID(),
      parent_task_id: input.rootTaskId,
      child_task_id: childTaskId,
      parent_expected_revision: 1,
      request_hash: input.dependencies.bundle_index.bundle_index_hash,
      created_at: input.now,
    }))
    .sort((left, right) => left.handoff_id.localeCompare(right.handoff_id));
  const verifier = {
    task_id: input.rootTaskId,
    task_revision: 1,
    decision_id: input.dependencies.create_id?.() ?? randomUUID(),
    completion_hash: input.dependencies.bundle_index.bundle_index_hash,
    decision_hash: await sha256ContentHash({
      run_id: input.runId,
      accepted: input.accepted,
      release_set_hash: input.dependencies.bundle_index.release_set_ref.resource_hash,
    }),
    created_at: input.now,
  };
  return buildAgentTeamPublicTrace({
    schema_version: "agent-team-public-trace@1.0.0",
    scope: input.dependencies.scope,
    run_id: input.runId,
    tasks,
    handoffs,
    epochs: [],
    verifier_decisions: [verifier],
  });
}

export function createFalconTeamRunner(dependencies: FalconTeamRunnerDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.create_id ?? randomUUID;
  const timeoutMs = dependencies.timeout_ms ?? 30_000;
  const maxOutputTokens = dependencies.max_output_tokens ?? 2_048;

  return Object.freeze({
    async runCase(input: {
      readonly test_case: PublicBenchmarkCase;
      readonly mode: "DEV" | "TEST";
      readonly reflection_mode: "NONE" | "BLIND" | "ORACLE_FEEDBACK";
      readonly report: boolean;
      readonly seed: number;
    }): Promise<FalconTeamCaseResult> {
      const runId = createId();
      const rootTaskId = createId();
      const textTaskId = createId();
      const reportTaskId = input.report ? createId() : null;
      const occurredAt = now().toISOString();
      const agent = dependencies.create_agent();
      const firstAttemptId = createId();
      let first: BenchmarkAgentAnswer;
      try {
        first = await agent.answer({
          test_case: input.test_case,
          seed: input.seed,
          invocation: {
            run_id: runId,
            attempt_id: firstAttemptId,
            timeout_ms: timeoutMs,
            max_output_tokens: maxOutputTokens,
          },
        });
        first = {
          ...first,
          sql: dependencies.normalize_sql?.(input.test_case, first.sql) ?? first.sql,
        };
      } catch (error) {
        return {
          case_id: input.test_case.case_id,
          database_id: input.test_case.database_id,
          registry: input.test_case.registry,
          run_id: runId,
          status: "AGENT_FAILED",
          first_sql: null,
          final_sql: null,
          first_verdict: null,
          final_verdict: null,
          first_oracle_receipt_hash: null,
          final_oracle_receipt_hash: null,
          semantic_usage_receipt: null,
          team_trace: await teamTrace({
            dependencies,
            runId,
            rootTaskId,
            textTaskId,
            reportTaskId,
            now: occurredAt,
            accepted: false,
          }),
          report: null,
          error_code: stableErrorCode(error),
        };
      }

      let firstEvaluation: Awaited<ReturnType<FalconResultOracle["evaluate"]>> | null = null;
      const oracleInput = {
        database_path: input.test_case.database_id,
        gold_sql: `falcon-expected://${input.test_case.case_id}`,
      };
      if (input.mode === "DEV" && input.reflection_mode === "ORACLE_FEEDBACK") {
        firstEvaluation = await dependencies.oracle.evaluate({
          ...oracleInput,
          candidate_sql: first.sql,
        });
      }
      const reflectionAttemptId = createId();
      const diagnostic =
        input.reflection_mode === "BLIND"
          ? await (dependencies.diagnose_sql?.(input.test_case, first.sql) ??
              Promise.resolve("No execution diagnostic is available."))
          : "Blind review is disabled.";
      const reflection =
        input.reflection_mode !== "NONE" && firstEvaluation?.verdict !== "PASS"
          ? await safeBlindReflection({
              agent,
              testCase: input.test_case,
              first,
              runId,
              attemptId: reflectionAttemptId,
              timeoutMs,
              maxOutputTokens,
              seed: input.seed,
              feedback:
                input.reflection_mode === "ORACLE_FEEDBACK" && firstEvaluation
                  ? firstEvaluation.feedback
                  : blindReviewFeedback(diagnostic),
            })
          : null;
      const reflectedSql = reflection?.revised_answer?.sql ?? first.sql;
      let finalSql = dependencies.normalize_sql?.(input.test_case, reflectedSql) ?? reflectedSql;
      if (
        finalSql !== first.sql &&
        dependencies.is_sql_executable &&
        (await dependencies.is_sql_executable(input.test_case, first.sql)) &&
        !(await dependencies.is_sql_executable(input.test_case, finalSql))
      ) {
        finalSql = first.sql;
      }
      let finalEvaluation: Awaited<ReturnType<FalconResultOracle["evaluate"]>> | null = null;
      if (input.mode === "DEV") {
        firstEvaluation ??= await dependencies.oracle.evaluate({
          ...oracleInput,
          candidate_sql: first.sql,
        });
        finalEvaluation =
          finalSql === first.sql
            ? firstEvaluation
            : await dependencies.oracle.evaluate({ ...oracleInput, candidate_sql: finalSql });
      }
      const accepted = input.mode === "TEST" || finalEvaluation?.verdict === "PASS";
      const bundleEntry = dependencies.bundle_index.entries.find(
        (entry) => entry.database_id === databaseNumber(input.test_case.database_id),
      );
      if (!bundleEntry) throw new Error("FALCON_SEMANTIC_PACKAGE_MISSING");
      const invocation = dependencies.observe_invocation(
        reflection?.revised_answer ? reflectionAttemptId : firstAttemptId,
      );
      if (!invocation) throw new Error("FALCON_PROVIDER_INVOCATION_EVIDENCE_MISSING");
      const queryEvidenceHash = await sha256ContentHash({
        case_id: input.test_case.case_id,
        sql: finalSql,
        verdict: input.mode === "TEST" ? "SUBMITTED" : finalEvaluation?.verdict,
        release_set_hash: dependencies.bundle_index.release_set_ref.resource_hash,
      });
      const contextHash = await sha256ContentHash({
        case_id: input.test_case.case_id,
        package_hash: bundleEntry.package_ref.resource_hash,
        question_hash: input.test_case.public_case_hash,
      });
      const physicalObjectIds = input.test_case.schema.map((table) => table.name);
      const mappingIds = input.test_case.schema.map((table) => `mapping-${table.name}`);
      const usageReceipt = await buildFalconSemanticUsageReceipt({
        schema_version: "falcon-semantic-usage-receipt@1.0.0",
        scope: dependencies.scope,
        receipt_id: createId(),
        case_id: input.test_case.case_id,
        database_id: bundleEntry.database_id,
        run_id: runId,
        task_id: textTaskId,
        release_set_hash: dependencies.bundle_index.release_set_ref.resource_hash,
        package_ref: bundleEntry.package_ref,
        context_receipt_ref: reference(createId(), contextHash),
        physical_object_ids:
          physicalObjectIds.length > 0
            ? physicalObjectIds
            : [`schema-${input.test_case.database_id}`],
        mapping_ids:
          mappingIds.length > 0 ? mappingIds : [`mapping-${input.test_case.database_id}`],
        join_ids: [],
        provider_invocation_ref: reference(invocation.invocation_id, invocation.invocation_hash),
        query_evidence_ref: reference(createId(), queryEvidenceHash),
        token_usage: invocation.usage_available
          ? {
              availability: "AVAILABLE",
              source: "PROVIDER_REPORTED",
              input_tokens: invocation.input_tokens ?? 0,
              output_tokens: invocation.output_tokens ?? 0,
            }
          : {
              availability: "UNAVAILABLE",
              source: "PROVIDER_DID_NOT_REPORT",
              input_tokens: null,
              output_tokens: null,
            },
        accepted_at: occurredAt,
      });
      const report = input.report
        ? {
            summary: accepted
              ? "The governed Text2SQL task produced accepted query evidence."
              : "The governed Text2SQL task did not produce accepted query evidence.",
            claim: `Falcon case ${input.test_case.case_id} is ${accepted ? "accepted" : "rejected"}.`,
            citation_hash: queryEvidenceHash,
          }
        : null;
      return {
        case_id: input.test_case.case_id,
        database_id: input.test_case.database_id,
        registry: input.test_case.registry,
        run_id: runId,
        status: input.mode === "TEST" ? "SUBMITTED" : accepted ? "PASS" : "FAIL",
        first_sql: first.sql,
        final_sql: finalSql,
        first_verdict:
          input.mode === "TEST" ? null : firstEvaluation?.verdict === "PASS" ? "PASS" : "FAIL",
        final_verdict:
          input.mode === "TEST" ? null : finalEvaluation?.verdict === "PASS" ? "PASS" : "FAIL",
        first_oracle_receipt_hash: firstEvaluation?.feedback.oracle_receipt_hash ?? null,
        final_oracle_receipt_hash: finalEvaluation?.feedback.oracle_receipt_hash ?? null,
        semantic_usage_receipt: usageReceipt,
        team_trace: await teamTrace({
          dependencies,
          runId,
          rootTaskId,
          textTaskId,
          reportTaskId,
          now: occurredAt,
          accepted,
        }),
        report,
        error_code: accepted
          ? null
          : (finalEvaluation?.diagnostic_code ?? "FALCON_ORACLE_MISMATCH"),
      };
    },
  });
}
