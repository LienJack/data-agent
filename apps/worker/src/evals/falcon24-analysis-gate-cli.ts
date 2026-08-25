import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24AgentAnalysisGate,
  falcon24AcceptanceCampaignIdSchema,
  falcon24AgentAnalysisRunResultSchema,
} from "@data-agent/contracts/evals";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "@data-agent/evals";
import { adaptPgPool, type SqlPool } from "@data-agent/platform/persistence";
import { createPostgresFalcon24AcceptanceCampaignAuthority } from "@data-agent/platform/runs";
import {
  loadRuntimeEnvironment,
  resolveRuntimeRepositoryRoot,
} from "@data-agent/platform/runtime-config";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
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
  readonly results: unknown;
  readonly strict_probe_path: string;
  readonly output_path: string;
  readonly sql_pool: SqlPool;
  readonly completed_at?: string;
}) {
  const results = actualRunsSchema.parse(input.results);
  const strictProbe = await verifyDeepSeekAnalysisStrictProbeReport(
    await readRequiredJson(input.strict_probe_path, "DEEPSEEK_STRICT_PROBE_REPORT_MISSING"),
  );
  const [suite, dataOracleReceipt] = await Promise.all([
    buildFalcon24AgentAnalysisAcceptanceSuite(),
    createFalcon24AnalysisDataOracle(input.sql_pool).inspect(),
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
}

async function main() {
  const root = resolveRuntimeRepositoryRoot(process.cwd());
  const environment = loadRuntimeEnvironment({ cwd: root, environment: process.env }).environment;
  const databaseUrl =
    environment.DATA_AGENT_DATABASE_URL?.trim() ??
    environment.DATA_AGENT_JOB_DATABASE_URL?.trim() ??
    environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("FALCON24_DATABASE_URL_MISSING");
  const scope = z
    .strictObject({ deployment_id: z.uuid(), tenant_id: z.uuid(), principal_id: z.uuid() })
    .parse({
      deployment_id: environment.WORKER_DEPLOYMENT_ID ?? environment.SEMANTIC_DEPLOYMENT_ID,
      tenant_id: environment.WORKER_TENANT_ID ?? environment.SEMANTIC_TENANT_ID,
      principal_id: environment.WORKER_PRINCIPAL_ID ?? environment.SEMANTIC_PRINCIPAL_ID,
    });
  const campaignId = falcon24AcceptanceCampaignIdSchema.parse(
    environment.FALCON24_ACCEPTANCE_CAMPAIGN_ID?.trim(),
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
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: "data-agent-falcon24-analysis-gate",
    max: 1,
  });
  try {
    const sqlPool = adaptPgPool(pool);
    const authority = createPostgresCapabilityAuthority(sqlPool);
    const capability = await authority.resolveForServerContext({ ...scope, access: "READ" });
    if (!capability.ok) throw new Error(capability.error.code);
    const results = await createPostgresFalcon24AcceptanceCampaignAuthority({
      pool: sqlPool,
      authorizer: authority.authorizer,
    }).loadVerifiedResults(capability.value, { campaign_id: campaignId });
    if (!results.ok) throw new Error(results.error.code);
    const artifact = await runFalcon24AnalysisGate({
      results: results.value,
      strict_probe_path: strictProbePath,
      output_path: outputPath,
      sql_pool: sqlPool,
    });
    process.stdout.write(
      `${JSON.stringify({ result: artifact.gate.result, artifact_hash: artifact.artifact_hash, output_path: outputPath })}\n`,
    );
  } finally {
    await pool.end();
  }
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
