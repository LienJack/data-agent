import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24AgentAnalysisGate,
  falcon24AgentAnalysisRunResultSchema,
} from "@data-agent/contracts/evals";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "@data-agent/evals";
import { adaptPgPool } from "@data-agent/platform/persistence";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import pg from "pg";
import { z } from "zod";
import { verifyDeepSeekAnalysisStrictProbeReport } from "./deepseek-analysis-strict-probe.js";
import { createFalcon24AnalysisDataOracle } from "./falcon24-analysis-data-oracle.js";

const actualRunsSchema = z.array(falcon24AgentAnalysisRunResultSchema).length(30);

async function readRequiredJson(path: string, missingCode: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new TypeError(missingCode);
    }
    throw error;
  }
}

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function runFalcon24AnalysisGate(input: {
  readonly results_path: string;
  readonly strict_probe_path: string;
  readonly output_path: string;
  readonly database_url: string;
  readonly completed_at?: string;
}) {
  const results = actualRunsSchema.parse(
    await readRequiredJson(input.results_path, "FALCON24_ANALYSIS_RUNS_MISSING"),
  );
  const strictProbe = await verifyDeepSeekAnalysisStrictProbeReport(
    await readRequiredJson(input.strict_probe_path, "DEEPSEEK_STRICT_PROBE_REPORT_MISSING"),
  );
  const pool = new pg.Pool({
    connectionString: input.database_url,
    application_name: "data-agent-falcon24-analysis-gate",
    max: 1,
  });
  try {
    const [suite, dataOracleReceipt] = await Promise.all([
      buildFalcon24AgentAnalysisAcceptanceSuite(),
      createFalcon24AnalysisDataOracle(adaptPgPool(pool)).inspect(),
    ]);
    const completedAt = input.completed_at ?? new Date().toISOString();
    const gate = await buildFalcon24AgentAnalysisGate({
      gate_id: stableUuid(`falcon24-analysis:${suite.suite_hash}`),
      suite,
      results,
      completed_at: completedAt,
    });
    const material = {
      schema_version: "falcon24-agent-analysis-release@2.0.0" as const,
      dataset_id: "falcon_db_24" as const,
      deepseek_strict_probe: {
        expected_attempts: strictProbe.expected_attempts,
        passed_attempts: strictProbe.passed_attempts,
        tool_manifest_hash: strictProbe.tool_manifest_hash,
        report_hash: strictProbe.report_hash,
      },
      data_oracle_receipt: dataOracleReceipt,
      gate,
    };
    const artifact = { ...material, artifact_hash: await sha256ContentHash(material) };
    await mkdir(dirname(input.output_path), { recursive: true });
    await writeFile(input.output_path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return artifact;
  } finally {
    await pool.end();
  }
}

async function main() {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
  const databaseUrl =
    environment.DATA_AGENT_DATABASE_URL?.trim() ??
    environment.DATA_AGENT_JOB_DATABASE_URL?.trim() ??
    environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("FALCON24_DATABASE_URL_MISSING");
  const resultsPath = resolve(
    root,
    environment.FALCON24_ANALYSIS_RESULTS?.trim() ??
      "artifacts/falcon24-agent-analysis/actual-runs.json",
  );
  const outputPath = resolve(
    root,
    environment.FALCON24_ANALYSIS_GATE_OUTPUT?.trim() ??
      "artifacts/falcon24-agent-analysis/release-gate.json",
  );
  const strictProbePath = resolve(
    root,
    environment.DEEPSEEK_ANALYSIS_STRICT_PROBE_OUTPUT?.trim() ??
      "artifacts/falcon24-agent-analysis/deepseek-analysis-strict-probe.json",
  );
  const artifact = await runFalcon24AnalysisGate({
    results_path: resultsPath,
    strict_probe_path: strictProbePath,
    output_path: outputPath,
    database_url: databaseUrl,
  });
  process.stdout.write(
    `${JSON.stringify({ result: artifact.gate.result, artifact_hash: artifact.artifact_hash, output_path: outputPath })}\n`,
  );
}

export function classifyFalcon24AnalysisGateFailure(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
    return "FALCON24_ANALYSIS_RUNS_MISSING";
  }
  if (error instanceof z.ZodError) return "FALCON24_ANALYSIS_EVIDENCE_INVALID";
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.message)) {
    return error.message;
  }
  return "FALCON24_ANALYSIS_GATE_FAILED";
}

if (
  process.argv[1]?.endsWith("falcon24-analysis-gate-cli.ts") ||
  process.argv[1]?.endsWith("falcon24-analysis-gate-cli.js")
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ terminal: "HOLD", reason_code: classifyFalcon24AnalysisGateFailure(error) })}\n`,
    );
    process.exitCode = 2;
  });
}
