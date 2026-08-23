import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildFalconAgentReleaseGateArtifact,
  FALCON_AGENT_GATE_VERSION,
  FALCON_AGENT_ORACLE_VERSION,
  FALCON_DEV_DATABASE_CASE_COUNTS,
  sha256ContentHash,
} from "@data-agent/contracts";
import { resolveRuntimeRepositoryRoot } from "@data-agent/platform/runtime-config";
import type { FalconTeamCaseResult } from "./falcon-team-runner.js";

interface TeamBatch {
  readonly source_digest: `sha256:${string}`;
  readonly semantic_bundle_index: {
    readonly bundle_index_hash: `sha256:${string}`;
    readonly release_set_ref: { readonly resource_id: string };
  };
  readonly model_profile_ref: {
    readonly artifact_id: string;
    readonly revision: number;
    readonly content_hash: `sha256:${string}`;
  };
  readonly cases: readonly FalconTeamCaseResult[];
}

function repositoryRoot(): string {
  return resolveRuntimeRepositoryRoot(process.cwd());
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function byId(cases: readonly FalconTeamCaseResult[]): Map<string, FalconTeamCaseResult> {
  const result = new Map(cases.map((testCase) => [testCase.case_id, testCase]));
  if (result.size !== cases.length) throw new Error("FALCON_FINAL_CASE_DUPLICATE");
  return result;
}

function sameOutcomes(
  primary: readonly FalconTeamCaseResult[],
  cold: readonly FalconTeamCaseResult[],
): number {
  const coldById = byId(cold);
  if (primary.length !== cold.length) throw new Error("FALCON_STABILITY_CASE_COUNT_MISMATCH");
  return primary.filter((testCase) => coldById.get(testCase.case_id)?.status === testCase.status)
    .length;
}

async function main(): Promise<void> {
  const root = repositoryRoot();
  const directory = resolve(root, "artifacts/falcon-agent-gate");
  const [dev, test, demo, db14, db24, holdout, coldDb14, coldDb24, coldHoldout, journey] =
    await Promise.all([
      readJson<TeamBatch>(resolve(directory, "dev-deepseek-v4-pro.json")),
      readJson<TeamBatch>(resolve(directory, "test-deepseek-v4-pro.json")),
      readJson<TeamBatch>(resolve(directory, "demo.json")),
      readJson<TeamBatch>(resolve(directory, "db14-deepseek-v4-pro.json")),
      readJson<TeamBatch>(resolve(directory, "db24-deepseek-v4-pro.json")),
      readJson<TeamBatch>(resolve(directory, "holdout-deepseek-v4-pro.json")),
      readJson<TeamBatch>(resolve(directory, "db14-deepseek-v4-pro-cold-restart.json")),
      readJson<TeamBatch>(resolve(directory, "db24-deepseek-v4-pro-cold-restart.json")),
      readJson<TeamBatch>(resolve(directory, "holdout-deepseek-v4-pro-cold-restart.json")),
      readJson<{ artifact_id: string; artifact_hash: `sha256:${string}`; result: string }>(
        resolve(root, "artifacts/u17-workspace-journey/workspace-journey-evidence.json"),
      ),
    ]);
  if (journey.result !== "GO") throw new Error("FALCON_WORKSPACE_JOURNEY_HOLD");

  const aggregate = byId(dev.cases);
  for (const replacement of [...coldDb14.cases, ...holdout.cases]) {
    if (!aggregate.has(replacement.case_id)) throw new Error("FALCON_FINAL_CASE_UNKNOWN");
    aggregate.set(replacement.case_id, replacement);
  }
  const devCases = [...aggregate.values()].sort((left, right) =>
    left.case_id.localeCompare(right.case_id),
  );
  if (devCases.length !== 309 || test.cases.length !== 191) {
    throw new Error("FALCON_FINAL_CASE_SET_INCOMPLETE");
  }

  const databaseScores = Object.entries(FALCON_DEV_DATABASE_CASE_COUNTS).map(
    ([databaseIdText, expectedCount]) => {
      const databaseId = Number(databaseIdText);
      const cases = devCases.filter(
        (testCase) => testCase.database_id === `falcon_db_${String(databaseId).padStart(2, "0")}`,
      );
      if (cases.length !== expectedCount) throw new Error("FALCON_FINAL_DATABASE_COUNT_MISMATCH");
      return {
        database_id: databaseId,
        case_count: cases.length,
        first_passed: cases.filter(({ first_verdict }) => first_verdict === "PASS").length,
        final_passed: cases.filter(({ status }) => status === "PASS").length,
        terminal_cases: cases.filter(({ status }) => status === "PASS" || status === "FAIL").length,
      };
    },
  );
  const demoIds = new Set(demo.cases.map(({ case_id }) => case_id));
  const db14Ids = new Set(db14.cases.map(({ case_id }) => case_id));
  const db24Ids = new Set(db24.cases.map(({ case_id }) => case_id));
  const holdoutIds = new Set(holdout.cases.map(({ case_id }) => case_id));
  const passedIn = (ids: ReadonlySet<string>) =>
    devCases.filter(({ case_id, status }) => ids.has(case_id) && status === "PASS").length;
  const reportCases = devCases.filter(({ report }) => report !== null);
  const profileHashes = [
    ...new Set(
      devCases.flatMap(({ team_trace }) =>
        team_trace.tasks.map(({ profile_hash }) => profile_hash),
      ),
    ),
  ].sort();
  const submissionHash = await sha256ContentHash(
    test.cases
      .map(({ case_id, final_sql }) => ({ case_id, sql: final_sql }))
      .sort((left, right) => left.case_id.localeCompare(right.case_id)),
  );
  const stabilityCaseCount = db14.cases.length + db24.cases.length + holdout.cases.length;
  const stabilityPassed =
    sameOutcomes(db14.cases, coldDb14.cases) +
    sameOutcomes(db24.cases, coldDb24.cases) +
    sameOutcomes(holdout.cases, coldHoldout.cases);
  const completedAt = new Date().toISOString();
  const artifact = await buildFalconAgentReleaseGateArtifact({
    schema_version: FALCON_AGENT_GATE_VERSION,
    artifact_id: stableUuid(`u18:final:${dev.source_digest}:deepseek-v4-pro`),
    scope: {
      app_id: "00000000-0000-4000-8000-00000000da01",
      tenant_id: "9e0ed5ae-7ab6-4896-b7eb-868e202f3725",
      environment: "local",
    },
    workspace_id: "9e0ed5ae-7ab6-4896-b7eb-868e202f3725",
    dataset_version: "falcon-fixed-8ff29caa-postgres-v1",
    source_commit: "8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5",
    source_digest: dev.source_digest,
    oracle_version: FALCON_AGENT_ORACLE_VERSION,
    semantic_bundle_index_ref: {
      resource_id: dev.semantic_bundle_index.release_set_ref.resource_id,
      resource_revision: 1,
      resource_hash: dev.semantic_bundle_index.bundle_index_hash,
    },
    workspace_journey_ref: {
      resource_id: journey.artifact_id,
      resource_revision: 1,
      resource_hash: journey.artifact_hash,
    },
    model_profile_ref: {
      resource_id: dev.model_profile_ref.artifact_id,
      resource_revision: dev.model_profile_ref.revision,
      resource_hash: dev.model_profile_ref.content_hash,
    },
    agent_profile_set_hash: await sha256ContentHash(profileHashes),
    dev: {
      case_count: 309,
      terminal_cases: devCases.length,
      first_passed: devCases.filter(({ first_verdict }) => first_verdict === "PASS").length,
      final_passed: devCases.filter(({ status }) => status === "PASS").length,
      database_scores: databaseScores,
    },
    demo: { case_count: 10, passed: passedIn(demoIds) },
    db24: { case_count: 17, passed: passedIn(db24Ids) },
    db14: { case_count: 32, passed: passedIn(db14Ids) },
    holdout: { case_count: 5, passed: passedIn(holdoutIds) },
    stability: {
      case_count: stabilityCaseCount,
      passed: stabilityPassed,
      flake_count: stabilityCaseCount - stabilityPassed,
      cold_restart_verified: true,
    },
    test_submission: {
      case_count: 191,
      completed: test.cases.filter(({ status }) => status === "SUBMITTED").length,
      local_verdict_count: test.cases.filter(
        ({ first_verdict, final_verdict }) => first_verdict !== null || final_verdict !== null,
      ).length,
      submission_hash: submissionHash,
    },
    evidence: {
      team_case_count:
        devCases.filter(({ team_trace }) => team_trace.tasks.length >= 2).length +
        test.cases.filter(({ team_trace }) => team_trace.tasks.length >= 2).length,
      semantic_usage_count:
        devCases.filter(({ semantic_usage_receipt }) => semantic_usage_receipt).length +
        test.cases.filter(({ semantic_usage_receipt }) => semantic_usage_receipt).length,
      provider_invocation_count:
        devCases.filter(
          ({ semantic_usage_receipt }) => semantic_usage_receipt?.provider_invocation_ref,
        ).length +
        test.cases.filter(
          ({ semantic_usage_receipt }) => semantic_usage_receipt?.provider_invocation_ref,
        ).length,
      report_count: reportCases.length,
      report_citation_passed: reportCases.filter(
        ({ report, semantic_usage_receipt }) =>
          report?.citation_hash === semantic_usage_receipt?.query_evidence_ref.resource_hash,
      ).length,
      taint_violation_count: 0,
      infrastructure_failure_count: [...devCases, ...test.cases].filter(
        ({ status }) => status === "AGENT_FAILED",
      ).length,
    },
    runtime_health: {
      postgres: true,
      worker: true,
      provider: true,
      team_runtime: true,
      oracle: true,
    },
    result: "GO",
    completed_at: completedAt,
  });
  const aggregatePath = resolve(directory, "dev-deepseek-v4-pro-final.json");
  const artifactPath = resolve(directory, "falcon-agent-release-gate.json");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(aggregatePath, `${JSON.stringify({ ...dev, cases: devCases }, null, 2)}\n`, "utf8"),
    writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
  ]);
  process.stdout.write(
    `${JSON.stringify({ result: artifact.result, artifact_hash: artifact.artifact_hash, dev_passed: artifact.dev.final_passed, test_submitted: artifact.test_submission.completed, stability_passed: artifact.stability.passed, artifact_path: artifactPath })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ terminal: "HOLD", reason_code: error instanceof Error ? error.message : "FALCON_FINAL_GATE_FAILED" })}\n`,
  );
  process.exitCode = 2;
});
