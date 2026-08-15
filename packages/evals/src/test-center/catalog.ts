import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import {
  type BenchmarkCatalogEntry,
  benchmarkCatalogEntrySchema,
  contentHashSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  BLADE_ARCHIVE_BYTES,
  BLADE_ARCHIVE_SHA256,
  BLADE_ARCHIVE_URL,
  BLADE_DATASET_VERSION,
  BLADE_FULL_MCQ_CASE_COUNT,
  BLADE_SMOKE_CASE_COUNT,
  BLADE_SOURCE_COMMIT,
  type BladeImportReceipt,
  bladeImportReceiptSchema,
} from "./blade-source.js";
import {
  DR_SPIDER_ARCHIVE_BYTES,
  DR_SPIDER_ARCHIVE_SHA256,
  DR_SPIDER_ARCHIVE_URL,
  DR_SPIDER_DATASET_VERSION,
  DR_SPIDER_FULL_POST_CASE_COUNT,
  DR_SPIDER_SMOKE_CASE_COUNT,
  DR_SPIDER_SOURCE_COMMIT,
  type DrSpiderImportReceipt,
  drSpiderImportReceiptSchema,
} from "./dr-spider-source.js";
import {
  INSIGHTBENCH_DATASET_VERSION,
  INSIGHTBENCH_REPOSITORY_COMMIT,
  INSIGHTBENCH_SMOKE_FILES,
  type InsightBenchImportReceipt,
  insightBenchImportReceiptSchema,
} from "./insightbench-source.js";

export const BIRD_MINI_DEV_SOURCE_COMMIT = "b3d4bcbbae9a96934ad812551eb400c7a3b23c12";
export const BIRD_MINI_DEV_ARCHIVE_SHA256 =
  "sha256:cc48ba16838204e4e214512030cb572eeb5f7bcdd999bae4b9b6ff12ec13b92f";
export const BIRD_MINI_DEV_ARCHIVE_BYTES = 800_943_648;
export const BIRD_MINI_DEV_ARCHIVE_URL =
  "https://bird-bench.oss-cn-beijing.aliyuncs.com/minidev.zip";
export const BIRD_PUBLISHED_BASELINE_SHA256 =
  "sha256:ef9fcb0470d9710c8a9674fd35874ec0986925e27a4d5d9ccece8bff606fb5df";
export const BIRD_PUBLISHED_BASELINE_URL = `https://raw.githubusercontent.com/bird-bench/mini_dev/${BIRD_MINI_DEV_SOURCE_COMMIT}/llm/exp_result/sql_output_kg/predict_mini_dev_gpt-4-turbo_sqlite.json`;

export const birdImportReceiptSchema = z.strictObject({
  receipt_version: z.literal("1.0.0"),
  suite_id: z.literal("bird-mini-dev"),
  suite_version: z.literal("1.0.0"),
  dataset_version: z.literal("bird-mini-dev-v1-2024-06"),
  source_commit: z.literal(BIRD_MINI_DEV_SOURCE_COMMIT),
  source_url: z.literal(BIRD_MINI_DEV_ARCHIVE_URL),
  archive_sha256: z.literal(BIRD_MINI_DEV_ARCHIVE_SHA256),
  archive_bytes: z.literal(BIRD_MINI_DEV_ARCHIVE_BYTES),
  license_spdx_id: z.literal("CC-BY-SA-4.0"),
  selected_database_id: z.literal("superhero"),
  selected_case_count: z.literal(10),
  database_sha256: contentHashSchema,
  public_cases_sha256: contentHashSchema,
  sealed_cases_sha256: contentHashSchema,
  baseline_source_sha256: z.literal(BIRD_PUBLISHED_BASELINE_SHA256),
  agent_predictions_sha256: contentHashSchema,
  installed_digest: contentHashSchema,
  installed_at: z.iso.datetime({ offset: true }),
});

export type BirdImportReceipt = z.infer<typeof birdImportReceiptSchema>;

export function defaultBenchmarkRoot(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.DATA_AGENT_BENCHMARK_ROOT?.trim()) {
    return environment.DATA_AGENT_BENCHMARK_ROOT.trim();
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "data-agent", "benchmarks");
  }
  if (platform() === "win32" && environment.APPDATA?.trim()) {
    return join(environment.APPDATA.trim(), "data-agent", "benchmarks");
  }
  return join(
    environment.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share"),
    "data-agent",
    "benchmarks",
  );
}

export function birdInstallDirectory(root = defaultBenchmarkRoot()): string {
  return join(root, "installed", "bird-mini-dev", "1.0.0");
}

export function insightBenchInstallDirectory(root = defaultBenchmarkRoot()): string {
  return join(root, "installed", "insightbench", "1.0.0");
}

export function drSpiderInstallDirectory(root = defaultBenchmarkRoot()): string {
  return join(root, "installed", "dr-spider", "1.0.0");
}

export function bladeInstallDirectory(root = defaultBenchmarkRoot()): string {
  return join(root, "installed", "blade", "1.0.0");
}

async function sha256File(path: string): Promise<`sha256:${string}`> {
  const bytes = await readFile(path);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readVerifiedBirdReceipt(root: string): Promise<BirdImportReceipt | null> {
  const directory = birdInstallDirectory(root);
  try {
    const receipt = birdImportReceiptSchema.parse(
      JSON.parse(await readFile(join(directory, "import-receipt.json"), "utf8")),
    );
    const [database, publicCases, sealedCases, predictions] = await Promise.all([
      sha256File(join(directory, "databases", "superhero.sqlite")),
      sha256File(join(directory, "public-cases.json")),
      sha256File(join(directory, "sealed", "sealed-cases.json")),
      sha256File(join(directory, "agents", "gpt-4-turbo-published.json")),
    ]);
    if (
      database !== receipt.database_sha256 ||
      publicCases !== receipt.public_cases_sha256 ||
      sealedCases !== receipt.sealed_cases_sha256 ||
      predictions !== receipt.agent_predictions_sha256
    ) {
      return null;
    }
    const material = [database, publicCases, sealedCases, predictions].join("\n");
    const installedDigest = `sha256:${createHash("sha256").update(material).digest("hex")}`;
    return installedDigest === receipt.installed_digest ? receipt : null;
  } catch {
    return null;
  }
}

async function readVerifiedDrSpiderReceipt(root: string): Promise<DrSpiderImportReceipt | null> {
  const directory = drSpiderInstallDirectory(root);
  try {
    const receipt = drSpiderImportReceiptSchema.parse(
      JSON.parse(await readFile(join(directory, "import-receipt.json"), "utf8")),
    );
    const verifiedFiles = await Promise.all(
      receipt.installed_files.map(async (file) => ({
        ...file,
        actual: await sha256File(join(directory, file.relative_path)),
      })),
    );
    if (verifiedFiles.some((file) => file.actual !== file.sha256)) return null;
    const digestMaterial = receipt.installed_files
      .map((file) => `${file.relative_path}:${file.bytes}:${file.sha256}`)
      .join("\n");
    const digest = `sha256:${createHash("sha256").update(digestMaterial).digest("hex")}`;
    return digest === receipt.installed_digest ? receipt : null;
  } catch {
    return null;
  }
}

async function readVerifiedBladeReceipt(root: string): Promise<BladeImportReceipt | null> {
  const directory = bladeInstallDirectory(root);
  try {
    const receipt = bladeImportReceiptSchema.parse(
      JSON.parse(await readFile(join(directory, "import-receipt.json"), "utf8")),
    );
    const [publicCases, sealedCases] = await Promise.all([
      sha256File(join(directory, "public-cases.json")),
      sha256File(join(directory, "sealed", "sealed-cases.json")),
    ]);
    if (
      publicCases !== receipt.public_cases_sha256 ||
      sealedCases !== receipt.sealed_cases_sha256
    ) {
      return null;
    }
    const digest = `sha256:${createHash("sha256")
      .update(`${publicCases}\n${sealedCases}`)
      .digest("hex")}`;
    return digest === receipt.installed_digest ? receipt : null;
  } catch {
    return null;
  }
}

async function drSpiderInstallationState(root: string): Promise<{
  readonly status: "READY" | "NOT_DOWNLOADED" | "INVALID";
  readonly reason: string | null;
  readonly digest: string | null;
}> {
  const receipt = await readVerifiedDrSpiderReceipt(root);
  if (receipt) return { status: "READY", reason: null, digest: receipt.installed_digest };
  try {
    await stat(drSpiderInstallDirectory(root));
    return {
      status: "INVALID",
      reason: "Dr.Spider 安装目录存在，但 Receipt 或文件摘要校验失败。",
      digest: null,
    };
  } catch {
    return {
      status: "NOT_DOWNLOADED",
      reason: "固定 Dr.Spider Smoke Slice 尚未安装。",
      digest: null,
    };
  }
}

async function bladeInstallationState(root: string): Promise<{
  readonly status: "READY" | "NOT_DOWNLOADED" | "INVALID";
  readonly reason: string | null;
  readonly digest: string | null;
}> {
  const receipt = await readVerifiedBladeReceipt(root);
  if (receipt) return { status: "READY", reason: null, digest: receipt.installed_digest };
  try {
    await stat(bladeInstallDirectory(root));
    return {
      status: "INVALID",
      reason: "BLADE 安装目录存在，但 Receipt 或文件摘要校验失败。",
      digest: null,
    };
  } catch {
    return {
      status: "NOT_DOWNLOADED",
      reason: "固定 BLADE MCQ Smoke Slice 尚未安装。",
      digest: null,
    };
  }
}

async function birdInstallationState(root: string): Promise<{
  readonly status: "NOT_DOWNLOADED" | "READY" | "INVALID";
  readonly digest: string | null;
  readonly reason: string | null;
}> {
  const directory = birdInstallDirectory(root);
  try {
    await stat(directory);
  } catch {
    return {
      status: "NOT_DOWNLOADED",
      digest: null,
      reason: "尚未安装经摘要验证的 BIRD Mini-Dev Smoke Slice。",
    };
  }
  const receipt = await readVerifiedBirdReceipt(root);
  return receipt
    ? { status: "READY", digest: receipt.installed_digest, reason: null }
    : {
        status: "INVALID",
        digest: null,
        reason: "安装目录存在，但 Import Receipt 或文件摘要不一致。",
      };
}

async function readVerifiedInsightBenchReceipt(
  root: string,
): Promise<InsightBenchImportReceipt | null> {
  const directory = insightBenchInstallDirectory(root);
  try {
    const receipt = insightBenchImportReceiptSchema.parse(
      JSON.parse(await readFile(join(directory, "import-receipt.json"), "utf8")),
    );
    const expectedSourceFiles = new Map(
      INSIGHTBENCH_SMOKE_FILES.map((file) => [file.relative_path, `${file.bytes}:${file.sha256}`]),
    );
    if (
      new Set(receipt.source_files.map((file) => file.relative_path)).size !==
        expectedSourceFiles.size ||
      receipt.source_files.some(
        (file) => expectedSourceFiles.get(file.relative_path) !== `${file.bytes}:${file.sha256}`,
      )
    ) {
      return null;
    }
    const allowedInstalledPaths = new Set([
      "data/flag-1.csv",
      "data/flag-2.csv",
      "data/flag-3.csv",
      "data/flag-4.csv",
      "data/flag-5.csv",
      "public-cases.json",
      "sealed/sealed-cases.json",
    ]);
    if (
      new Set(receipt.installed_files.map((file) => file.relative_path)).size !==
        allowedInstalledPaths.size ||
      receipt.installed_files.some((file) => !allowedInstalledPaths.has(file.relative_path))
    ) {
      return null;
    }
    const installedFiles = await Promise.all(
      receipt.installed_files.map(async (file) => {
        const path = join(directory, file.relative_path);
        const metadata = await stat(path);
        const digest = await sha256File(path);
        if (metadata.size !== file.bytes || digest !== file.sha256)
          throw new Error("DIGEST_MISMATCH");
        return file;
      }),
    );
    const material = [...installedFiles]
      .sort((left, right) => left.relative_path.localeCompare(right.relative_path))
      .map((file) => `${file.relative_path}:${file.bytes}:${file.sha256}`)
      .join("\n");
    const installedDigest = `sha256:${createHash("sha256").update(material).digest("hex")}`;
    return installedDigest === receipt.installed_digest ? receipt : null;
  } catch {
    return null;
  }
}

async function insightBenchInstallationState(root: string): Promise<{
  readonly status: "NOT_DOWNLOADED" | "READY" | "INVALID";
  readonly digest: string | null;
  readonly reason: string | null;
}> {
  const directory = insightBenchInstallDirectory(root);
  try {
    await stat(directory);
  } catch {
    return {
      status: "NOT_DOWNLOADED",
      digest: null,
      reason: "可自动导入固定版本的 InsightBench 5 题分析 Smoke Slice。",
    };
  }
  const receipt = await readVerifiedInsightBenchReceipt(root);
  return receipt
    ? { status: "READY", digest: receipt.installed_digest, reason: null }
    : {
        status: "INVALID",
        digest: null,
        reason: "InsightBench 安装目录存在，但 Import Receipt 或文件摘要不一致。",
      };
}

function fixedCatalogEntries(
  now: string,
): readonly Omit<
  BenchmarkCatalogEntry,
  "dataset_status" | "status_reason" | "previewable" | "runnable" | "installed_digest"
>[] {
  return [
    {
      suite_id: "bird-mini-dev",
      suite_version: "1.0.0",
      name: "BIRD Mini-Dev",
      description:
        "真实 SQLite Text2SQL 执行评测；首个 Smoke Slice 固定为 superhero 数据库 10 题。",
      source: {
        repository_url: "https://github.com/bird-bench/mini_dev",
        source_commit: BIRD_MINI_DEV_SOURCE_COMMIT,
        dataset_version: "bird-mini-dev-v1-2024-06",
        download_url: BIRD_MINI_DEV_ARCHIVE_URL,
        archive_sha256: BIRD_MINI_DEV_ARCHIVE_SHA256,
        archive_bytes: BIRD_MINI_DEV_ARCHIVE_BYTES,
      },
      license: {
        spdx_id: "CC-BY-SA-4.0",
        name: "Creative Commons Attribution Share Alike 4.0 International",
        attribution_required: true,
        redistribution_allowed: true,
        source_url: "https://huggingface.co/datasets/birdsql/bird_mini_dev",
      },
      capabilities: ["TEXT_TO_SQL"],
      oracle_kind: "SQL_RESULT_EQUIVALENCE",
      oracle_version: "bird-sqlite-result-equivalence@1.0.0",
      case_count: 500,
      smoke_case_count: 10,
      supports_reflection: true,
      updated_at: now,
    },
    {
      suite_id: "dr-spider",
      suite_version: "1.0.0",
      name: "Dr.Spider",
      description: "原题与 17 类扰动题成对评测 Text2SQL 鲁棒性；提供固定 DB 内容扰动 Smoke Slice。",
      source: {
        repository_url: "https://github.com/awslabs/diagnostic-robustness-text-to-sql",
        source_commit: DR_SPIDER_SOURCE_COMMIT,
        dataset_version: DR_SPIDER_DATASET_VERSION,
        download_url: DR_SPIDER_ARCHIVE_URL,
        archive_sha256: DR_SPIDER_ARCHIVE_SHA256,
        archive_bytes: DR_SPIDER_ARCHIVE_BYTES,
      },
      license: {
        spdx_id: "CC-BY-4.0",
        name: "Creative Commons Attribution 4.0 International",
        attribution_required: true,
        redistribution_allowed: true,
        source_url:
          "https://github.com/awslabs/diagnostic-robustness-text-to-sql/blob/main/LICENSE-ANNOTATIONS",
      },
      capabilities: ["TEXT_TO_SQL", "SQL_ROBUSTNESS"],
      oracle_kind: "PAIRED_SQL_ROBUSTNESS",
      oracle_version: "dr-spider-sqlite-result-equivalence@1.0.0",
      case_count: DR_SPIDER_FULL_POST_CASE_COUNT,
      smoke_case_count: DR_SPIDER_SMOKE_CASE_COUNT,
      supports_reflection: true,
      updated_at: now,
    },
    {
      suite_id: "insightbench",
      suite_version: "1.0.0",
      name: "InsightBench",
      description: "业务 CSV 的端到端洞察报告评测；首批固定 5 题，可自动导入、批量作答与反省。",
      source: {
        repository_url: "https://github.com/ServiceNow/insight-bench",
        source_commit: INSIGHTBENCH_REPOSITORY_COMMIT,
        dataset_version: INSIGHTBENCH_DATASET_VERSION,
        download_url: "https://huggingface.co/datasets/ServiceNow/insight_bench",
        archive_sha256: null,
        archive_bytes: null,
      },
      license: {
        spdx_id: "CC-BY-4.0",
        name: "Creative Commons Attribution 4.0 International",
        attribution_required: true,
        redistribution_allowed: true,
        source_url: "https://huggingface.co/datasets/ServiceNow/insight_bench",
      },
      capabilities: ["ANALYSIS_REPORT"],
      oracle_kind: "RULE_METRICS_WITH_JUDGE",
      oracle_version: "insightbench-lexical-grounding@1.0.0",
      case_count: 100,
      smoke_case_count: 5,
      supports_reflection: true,
      updated_at: now,
    },
    {
      suite_id: "bird-critic",
      suite_version: "0.1.0",
      name: "BIRD-Critic",
      description: "真实 PostgreSQL SQL 诊断与修复题库；完整私有测试真值尚未获授权。",
      source: {
        repository_url: "https://github.com/bird-bench/BIRD-CRITIC-1",
        source_commit: "f408d6c9db9f16e75b44a1e23f22c04579d1f390",
        dataset_version: "hf-af2b1c3e-sqlite",
        download_url:
          "https://huggingface.co/datasets/birdsql/bird-critic-1.0-sqlite/resolve/af2b1c3e2f8b3480e5569212198761c770df06d0/sqlite-00000-of-00001.jsonl",
        archive_sha256: "sha256:4abb18afbc7c1f8e9c566d04707ebbdc8508247924ced01b927ef716393fd468",
        archive_bytes: 928_636,
      },
      license: {
        spdx_id: "CC-BY-SA-4.0",
        name: "Creative Commons Attribution Share Alike 4.0 International",
        attribution_required: true,
        redistribution_allowed: true,
        source_url: "https://github.com/bird-bench/BIRD-CRITIC-1",
      },
      capabilities: ["SQL_REPAIR"],
      oracle_kind: "SQL_TEST_CASES",
      oracle_version: "license-and-truth-gated",
      case_count: 500,
      smoke_case_count: 0,
      supports_reflection: false,
      updated_at: now,
    },
    {
      suite_id: "dab",
      suite_version: "0.1.0",
      name: "Data Agent Benchmark",
      description: "跨 SQLite/PostgreSQL/DuckDB/MongoDB 的真实 Data Agent 任务；许可证未闭合。",
      source: {
        repository_url: "https://github.com/ucbepic/DataAgentBench",
        source_commit: "80b912bf43facbb422f76fd346eee49dbbb8bb9d",
        dataset_version: "upstream-main-2026-08-09",
        download_url: null,
        archive_sha256: null,
        archive_bytes: null,
      },
      license: {
        spdx_id: "NOASSERTION",
        name: "License review required",
        attribution_required: true,
        redistribution_allowed: false,
        source_url: "https://github.com/ucbepic/DataAgentBench",
      },
      capabilities: ["DATA_AGENT_END_TO_END"],
      oracle_kind: "EXTERNAL_VALIDATOR",
      oracle_version: "license-blocked",
      case_count: 54,
      smoke_case_count: 0,
      supports_reflection: false,
      updated_at: now,
    },
    {
      suite_id: "blade",
      suite_version: "1.0.0",
      name: "BLADE",
      description:
        "围绕统计变量与数据变换选择的数据分析决策评测；提供跨数据集固定 MCQ Smoke Slice。",
      source: {
        repository_url: "https://github.com/behavioral-data/BLADE",
        source_commit: BLADE_SOURCE_COMMIT,
        dataset_version: BLADE_DATASET_VERSION,
        download_url: BLADE_ARCHIVE_URL,
        archive_sha256: BLADE_ARCHIVE_SHA256,
        archive_bytes: BLADE_ARCHIVE_BYTES,
      },
      license: {
        spdx_id: "ODC-By-1.0",
        name: "Open Data Commons Attribution License 1.0",
        attribution_required: true,
        redistribution_allowed: true,
        source_url:
          "https://github.com/behavioral-data/BLADE/blob/main/blade_bench/datasets/LICENSE",
      },
      capabilities: ["MULTIPLE_CHOICE"],
      oracle_kind: "EXACT_CHOICE",
      oracle_version: "blade-exact-choice@1.0.0",
      case_count: BLADE_FULL_MCQ_CASE_COUNT,
      smoke_case_count: BLADE_SMOKE_CASE_COUNT,
      supports_reflection: true,
      updated_at: now,
    },
    {
      suite_id: "datascibench",
      suite_version: "0.1.0",
      name: "DataSciBench",
      description:
        "覆盖数据科学代码、建模与报告任务；数据集为 CC-BY-4.0，但下载需 Hugging Face 授权。",
      source: {
        repository_url: "https://github.com/THUDM/DataSciBench",
        source_commit: "84ef3d4d94d7362a5149cf14a73dc168fc4f2f33",
        dataset_version: "hf-f15d3e40-gated",
        download_url: "https://huggingface.co/datasets/zd21/DataSciBench",
        archive_sha256: null,
        archive_bytes: null,
      },
      license: {
        spdx_id: "CC-BY-4.0",
        name: "Creative Commons Attribution 4.0 International",
        attribution_required: true,
        redistribution_allowed: true,
        source_url: "https://huggingface.co/datasets/zd21/DataSciBench",
      },
      capabilities: ["DATA_AGENT_END_TO_END"],
      oracle_kind: "EXTERNAL_VALIDATOR",
      oracle_version: "license-blocked",
      case_count: 0,
      smoke_case_count: 0,
      supports_reflection: false,
      updated_at: now,
    },
    {
      suite_id: "scienceagentbench",
      suite_version: "0.1.0",
      name: "ScienceAgentBench",
      description: "102 个真实科学数据分析代码任务；完整数据包需人工获取并核验例外许可。",
      source: {
        repository_url: "https://github.com/OSU-NLP-Group/ScienceAgentBench",
        source_commit: "c26e151ed601ba109dc4d35e057ff8e73fec469d",
        dataset_version: "hf-9c6e96c9-annotations",
        download_url:
          "https://huggingface.co/datasets/osunlp/ScienceAgentBench/resolve/9c6e96c9e74572e979b0930ee735041cef528cb7/data/verified-00000-of-00001.parquet",
        archive_sha256: "sha256:77637b5cb4ece9d392e634f8d7d6b9305055a98b2d1e6c7fe4a09f1e3dc38c98",
        archive_bytes: 129_086,
      },
      license: {
        spdx_id: "LicenseRef-Mixed",
        name: "CC-BY-4.0 with upstream task exceptions",
        attribution_required: true,
        redistribution_allowed: false,
        source_url: "https://github.com/OSU-NLP-Group/ScienceAgentBench#license",
      },
      capabilities: ["DATA_AGENT_END_TO_END"],
      oracle_kind: "EXTERNAL_VALIDATOR",
      oracle_version: "access-gated",
      case_count: 102,
      smoke_case_count: 0,
      supports_reflection: false,
      updated_at: now,
    },
    {
      suite_id: "spreadsheetbench-2",
      suite_version: "0.1.0",
      name: "SpreadsheetBench 2",
      description:
        "端到端业务表格调试、财务建模、模板与可视化任务；公开数据包可下载，执行沙箱 Adapter 待接入。",
      source: {
        repository_url: "https://github.com/RUCKBReasoning/SpreadsheetBench-2",
        source_commit: "599b24aa479242d39e1e50eb5a85830a823ffdfc",
        dataset_version: "hf-9dea6002",
        download_url:
          "https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2/resolve/9dea60025792fbac5928ce9f44812362dccbeecd/spreadsheetbench-v2.zip",
        archive_sha256: "sha256:ec7873c4c5a2295c5ee8da46534232498fec7f7402dfee78a00009964efdb475",
        archive_bytes: 134_207_025,
      },
      license: {
        spdx_id: "MIT",
        name: "MIT License",
        attribution_required: true,
        redistribution_allowed: true,
        source_url: "https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2",
      },
      capabilities: ["DATA_AGENT_END_TO_END"],
      oracle_kind: "EXTERNAL_VALIDATOR",
      oracle_version: "license-blocked",
      case_count: 0,
      smoke_case_count: 0,
      supports_reflection: false,
      updated_at: now,
    },
    {
      suite_id: "agenticdatabench-ecommerce",
      suite_version: "1.0.0",
      name: "ADB Official-compatible E-commerce",
      description:
        "固定上游版本的 3 道 E-commerce 官方兼容候选题；输出 Adapter 认证完成前保持 HOLD。",
      source: {
        repository_url: "https://github.com/AgenticDataBench/AgenticDataBench",
        source_commit: "61bb0d6be3439797d2c75a6ede198b0b296cc226",
        dataset_version: "adb-ecommerce-bounded-v1",
        download_url: null,
        archive_sha256: null,
        archive_bytes: null,
      },
      license: {
        spdx_id: "Apache-2.0",
        name: "Apache License 2.0",
        attribution_required: true,
        redistribution_allowed: true,
        source_url:
          "https://github.com/AgenticDataBench/AgenticDataBench/blob/61bb0d6be3439797d2c75a6ede198b0b296cc226/LICENSE",
      },
      capabilities: ["DATA_AGENT_END_TO_END", "PYTHON_ANALYSIS"],
      oracle_kind: "ARTIFACT_RULES",
      oracle_version: "adb-ecommerce-artifact-oracle@1.0.0",
      case_count: 3,
      smoke_case_count: 3,
      supports_reflection: true,
      updated_at: now,
    },
    {
      suite_id: "ecommerce-production",
      suite_version: "1.0.0",
      name: "E-commerce Production Suite",
      description:
        "24 道中文生产型多表分析题，固定 DEMO/TUNING/LOCAL_HOLDOUT 分层与 SQL+Python 产物契约。",
      source: {
        repository_url: "https://github.com/AgenticDataBench/AgenticDataBench",
        source_commit: "61bb0d6be3439797d2c75a6ede198b0b296cc226",
        dataset_version: "adb-ecommerce-bounded-v1",
        download_url: null,
        archive_sha256: null,
        archive_bytes: null,
      },
      license: {
        spdx_id: "Apache-2.0",
        name: "Apache License 2.0 plus documented third-party provenance",
        attribution_required: true,
        redistribution_allowed: true,
        source_url:
          "https://github.com/AgenticDataBench/AgenticDataBench/blob/61bb0d6be3439797d2c75a6ede198b0b296cc226/LICENSE",
      },
      capabilities: ["TEXT_TO_SQL", "DATA_AGENT_END_TO_END", "PYTHON_ANALYSIS"],
      oracle_kind: "ARTIFACT_RULES",
      oracle_version: "ecommerce-production-oracle@1.0.0",
      case_count: 24,
      smoke_case_count: 8,
      supports_reflection: true,
      updated_at: now,
    },
  ];
}

export async function getBenchmarkCatalog(
  root = defaultBenchmarkRoot(),
  now = new Date().toISOString(),
): Promise<readonly BenchmarkCatalogEntry[]> {
  const birdState = await birdInstallationState(root);
  const insightBenchState = await insightBenchInstallationState(root);
  const drSpiderState = await drSpiderInstallationState(root);
  const bladeState = await bladeInstallationState(root);
  return Object.freeze(
    fixedCatalogEntries(now).map((entry) => {
      if (entry.suite_id === "bird-mini-dev") {
        return benchmarkCatalogEntrySchema.parse({
          ...entry,
          dataset_status: birdState.status,
          status_reason: birdState.reason,
          previewable: birdState.status === "READY",
          runnable: birdState.status === "READY",
          installed_digest: birdState.digest,
        });
      }
      if (entry.suite_id === "insightbench") {
        return benchmarkCatalogEntrySchema.parse({
          ...entry,
          dataset_status: insightBenchState.status,
          status_reason: insightBenchState.reason,
          previewable: insightBenchState.status === "READY",
          runnable: insightBenchState.status === "READY",
          installed_digest: insightBenchState.digest,
        });
      }
      if (entry.suite_id === "dr-spider") {
        return benchmarkCatalogEntrySchema.parse({
          ...entry,
          dataset_status: drSpiderState.status,
          status_reason: drSpiderState.reason,
          previewable: drSpiderState.status === "READY",
          runnable: drSpiderState.status === "READY",
          installed_digest: drSpiderState.digest,
        });
      }
      if (entry.suite_id === "blade") {
        return benchmarkCatalogEntrySchema.parse({
          ...entry,
          dataset_status: bladeState.status,
          status_reason: bladeState.reason,
          previewable: bladeState.status === "READY",
          runnable: bladeState.status === "READY",
          installed_digest: bladeState.digest,
        });
      }
      if (entry.suite_id === "dab") {
        return benchmarkCatalogEntrySchema.parse({
          ...entry,
          dataset_status: "LICENSE_BLOCKED",
          status_reason: "上游仓库未提供可闭合的数据再分发许可证；保持失败关闭。",
          previewable: false,
          runnable: false,
          installed_digest: null,
        });
      }
      if (entry.suite_id === "scienceagentbench") {
        return benchmarkCatalogEntrySchema.parse({
          ...entry,
          dataset_status: "ACCESS_GATED",
          status_reason: "完整数据包需要人工获取；且部分任务沿用上游例外许可证。",
          previewable: false,
          runnable: false,
          installed_digest: null,
        });
      }
      if (entry.suite_id === "bird-critic") {
        return benchmarkCatalogEntrySchema.parse({
          ...entry,
          dataset_status: "ACCESS_GATED",
          status_reason:
            "公开 SQLite 题面与模板数据库可获取，但自动评分所需 test_cases 与参考修复需向上游申请。",
          previewable: false,
          runnable: false,
          installed_digest: null,
        });
      }
      if (entry.suite_id === "datascibench") {
        return benchmarkCatalogEntrySchema.parse({
          ...entry,
          dataset_status: "ACCESS_GATED",
          status_reason: "Hugging Face 数据集启用了自动审批门禁，需要用户账户授权后下载。",
          previewable: false,
          runnable: false,
          installed_digest: null,
        });
      }
      if (
        entry.suite_id === "agenticdatabench-ecommerce" ||
        entry.suite_id === "ecommerce-production"
      ) {
        return benchmarkCatalogEntrySchema.parse({
          ...entry,
          dataset_status: "INVALID",
          status_reason:
            "固定数据与题库资产已安装，但 PostgreSQL/Python Artifact Oracle 尚未完成端到端认证；保持 HOLD。",
          previewable: entry.suite_id === "ecommerce-production",
          runnable: false,
          installed_digest: null,
        });
      }
      return benchmarkCatalogEntrySchema.parse({
        ...entry,
        dataset_status: "NOT_DOWNLOADED",
        status_reason: "Adapter 与固定 Smoke Slice 尚未安装。",
        previewable: false,
        runnable: false,
        installed_digest: null,
      });
    }),
  );
}

export async function getBenchmarkCatalogEntry(
  suiteId: string,
  root = defaultBenchmarkRoot(),
): Promise<BenchmarkCatalogEntry | null> {
  return (await getBenchmarkCatalog(root)).find((suite) => suite.suite_id === suiteId) ?? null;
}

export async function getVerifiedBirdImportReceipt(
  root = defaultBenchmarkRoot(),
): Promise<BirdImportReceipt | null> {
  return readVerifiedBirdReceipt(root);
}

export async function getVerifiedInsightBenchImportReceipt(
  root = defaultBenchmarkRoot(),
): Promise<InsightBenchImportReceipt | null> {
  return readVerifiedInsightBenchReceipt(root);
}

export async function getVerifiedDrSpiderImportReceipt(
  root = defaultBenchmarkRoot(),
): Promise<DrSpiderImportReceipt | null> {
  return readVerifiedDrSpiderReceipt(root);
}

export async function getVerifiedBladeImportReceipt(
  root = defaultBenchmarkRoot(),
): Promise<BladeImportReceipt | null> {
  return readVerifiedBladeReceipt(root);
}
