import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  type SealedInsightBenchmarkCase,
  sealedInsightBenchmarkCaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  defaultBenchmarkRoot,
  getVerifiedInsightBenchImportReceipt,
  insightBenchInstallDirectory,
} from "./catalog.js";
import { parseBenchmarkCsv } from "./csv.js";
import {
  INSIGHTBENCH_DATASET_COMMIT,
  INSIGHTBENCH_DATASET_VERSION,
  INSIGHTBENCH_REPOSITORY_COMMIT,
  INSIGHTBENCH_SMOKE_FILES,
  INSIGHTBENCH_SOURCE_ROOT,
  type InsightBenchImportReceipt,
  insightBenchImportReceiptSchema,
} from "./insightbench-source.js";

const insightBenchJsonSchema = z.strictObject({
  dataset_csv_path: z.string(),
  user_dataset_csv_path: z.string().nullable(),
  metadata: z.strictObject({
    goal: z.string().min(1),
    role: z.string().min(1),
    category: z.string().min(1),
    dataset_description: z.string().min(1),
    header: z.string().min(1),
  }),
  summary: z.string().min(1),
  insights: z.array(z.string().min(1)).min(1),
  insight_list: z.array(
    z
      .object({
        insight: z.string().min(1),
        actionable_insight: z.string().optional(),
        question: z.string().optional(),
        insight_value: z.unknown().optional(),
        plot: z.unknown().optional(),
      })
      .passthrough(),
  ),
});

function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stableUuid(material: string): string {
  const hex = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function fetchPinnedFile(file: (typeof INSIGHTBENCH_SMOKE_FILES)[number]): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${INSIGHTBENCH_SOURCE_ROOT}/${file.relative_path}`, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "data-agent-test-center/1.0" },
    });
    if (!response.ok) throw new Error(`INSIGHTBENCH_DOWNLOAD_HTTP_${response.status}`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > file.bytes) {
      throw new Error("INSIGHTBENCH_DOWNLOAD_SIZE_MISMATCH");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== file.bytes || sha256Bytes(bytes) !== file.sha256) {
      throw new Error("INSIGHTBENCH_DOWNLOAD_DIGEST_MISMATCH");
    }
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

function collectReferenceValues(value: unknown, target: Set<string>): void {
  if (target.size >= 1_024 || value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const normalized = String(value).trim();
    if (normalized) target.add(normalized.slice(0, 1_024));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceValues(item, target);
    return;
  }
  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectReferenceValues(nested, target);
    }
  }
}

function inferColumnType(values: readonly string[]): string {
  const nonEmpty = values.filter((value) => value.trim().length > 0);
  if (nonEmpty.length === 0) return "TEXT";
  if (nonEmpty.every((value) => /^-?\d+$/.test(value.trim()))) return "INTEGER";
  if (nonEmpty.every((value) => Number.isFinite(Number(value)))) return "REAL";
  if (nonEmpty.every((value) => Number.isFinite(Date.parse(value)))) return "TIMESTAMP";
  return "TEXT";
}

async function buildCases(input: {
  readonly flag: number;
  readonly json: Buffer;
  readonly csv: Buffer;
}): Promise<{
  readonly publicCase: PublicBenchmarkCase;
  readonly sealedCase: SealedInsightBenchmarkCase;
}> {
  const source = insightBenchJsonSchema.parse(JSON.parse(input.json.toString("utf8")));
  const csv = parseBenchmarkCsv(input.csv.toString("utf8"));
  const publicDraft = {
    case_id: stableUuid(`insightbench:${INSIGHTBENCH_DATASET_VERSION}:flag-${input.flag}`),
    suite_id: "insightbench" as const,
    suite_version: "1.0.0",
    dataset_version: INSIGHTBENCH_DATASET_VERSION,
    ordinal: input.flag - 1,
    database_id: `flag-${input.flag}`,
    question: source.metadata.goal,
    evidence: `Role: ${source.metadata.role}. Category: ${source.metadata.category}. Dataset: ${source.metadata.dataset_description}`,
    difficulty: "moderate" as const,
    capabilities: ["ANALYSIS_REPORT" as const],
    registry: "DEMO" as const,
    schema: [
      {
        name: "dataset",
        columns: csv.headers.map((name) => {
          const values = csv.rows.map((row) => row[name] ?? "");
          return {
            name,
            data_type: inferColumnType(values),
            nullable: values.some((value) => value.trim().length === 0),
            primary_key: false,
          };
        }),
      },
    ],
  };
  const publicCase = publicBenchmarkCaseSchema.parse({
    ...publicDraft,
    public_case_hash: await sha256ContentHash(publicDraft),
  });
  const referenceInsights = new Set(source.insights.map((insight) => insight.trim()));
  const referenceValues = new Set<string>();
  for (const insight of source.insight_list) {
    referenceInsights.add(insight.insight.trim());
    collectReferenceValues(insight.insight_value, referenceValues);
    if (typeof insight.plot === "object" && insight.plot !== null) {
      const plot = insight.plot as Record<string, unknown>;
      for (const axisName of ["x_axis", "y_axis"] as const) {
        const axis = plot[axisName];
        if (typeof axis === "object" && axis !== null) {
          collectReferenceValues((axis as Record<string, unknown>).value, referenceValues);
        }
      }
    }
  }
  const sealedDraft = {
    public_case: publicCase,
    data_relative_path: `data/flag-${input.flag}.csv`,
    reference_summary: source.summary.trim(),
    reference_insights: [...referenceInsights],
    reference_values: [...referenceValues],
  };
  const sealedCase = sealedInsightBenchmarkCaseSchema.parse({
    ...sealedDraft,
    sealed_case_hash: await sha256ContentHash(sealedDraft),
  });
  return { publicCase, sealedCase };
}

export async function installInsightBenchSmokeSlice(
  input: { readonly benchmark_root?: string; readonly now?: () => Date } = {},
): Promise<InsightBenchImportReceipt> {
  const benchmarkRoot = input.benchmark_root ?? defaultBenchmarkRoot();
  const existing = await getVerifiedInsightBenchImportReceipt(benchmarkRoot);
  if (existing) return existing;
  const finalDirectory = insightBenchInstallDirectory(benchmarkRoot);
  try {
    await stat(finalDirectory);
    throw new Error("INSIGHTBENCH_INSTALLATION_EXISTS_INVALID");
  } catch (error) {
    if (error instanceof Error && error.message === "INSIGHTBENCH_INSTALLATION_EXISTS_INVALID") {
      throw error;
    }
    if (typeof error !== "object" || error === null || Reflect.get(error, "code") !== "ENOENT") {
      throw error;
    }
  }

  const downloaded = new Map<string, Buffer>();
  await Promise.all(
    INSIGHTBENCH_SMOKE_FILES.map(async (file) => {
      downloaded.set(file.relative_path, await fetchPinnedFile(file));
    }),
  );
  const cases = await Promise.all(
    [1, 2, 3, 4, 5].map((flag) => {
      const json = downloaded.get(`json/flag-${flag}.json`);
      const csv = downloaded.get(`notebooks/csvs/flag-${flag}.csv`);
      if (!json || !csv) throw new Error("INSIGHTBENCH_SOURCE_FILE_MISSING");
      return buildCases({ flag, json, csv });
    }),
  );

  await mkdir(dirname(finalDirectory), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(dirname(finalDirectory), ".insightbench-"));
  try {
    await mkdir(join(temporaryDirectory, "data"), { recursive: true });
    await mkdir(join(temporaryDirectory, "sealed"), { recursive: true, mode: 0o700 });
    const installedFiles: Array<{
      relative_path: string;
      bytes: number;
      sha256: `sha256:${string}`;
    }> = [];
    for (const flag of [1, 2, 3, 4, 5]) {
      const bytes = downloaded.get(`notebooks/csvs/flag-${flag}.csv`);
      if (!bytes) throw new Error("INSIGHTBENCH_SOURCE_FILE_MISSING");
      const relativePath = `data/flag-${flag}.csv`;
      await writeFile(join(temporaryDirectory, relativePath), bytes, { mode: 0o644 });
      installedFiles.push({
        relative_path: relativePath,
        bytes: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      });
    }
    const publicBytes = Buffer.from(
      `${JSON.stringify(
        cases.map(({ publicCase }) => publicCase),
        null,
        2,
      )}\n`,
    );
    const sealedBytes = Buffer.from(
      `${JSON.stringify(
        cases.map(({ sealedCase }) => sealedCase),
        null,
        2,
      )}\n`,
    );
    await writeFile(join(temporaryDirectory, "public-cases.json"), publicBytes, { mode: 0o644 });
    await writeFile(join(temporaryDirectory, "sealed", "sealed-cases.json"), sealedBytes, {
      mode: 0o600,
    });
    installedFiles.push(
      {
        relative_path: "public-cases.json",
        bytes: publicBytes.byteLength,
        sha256: sha256Bytes(publicBytes),
      },
      {
        relative_path: "sealed/sealed-cases.json",
        bytes: sealedBytes.byteLength,
        sha256: sha256Bytes(sealedBytes),
      },
    );
    installedFiles.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
    const digestMaterial = installedFiles
      .map((file) => `${file.relative_path}:${file.bytes}:${file.sha256}`)
      .join("\n");
    const receipt = insightBenchImportReceiptSchema.parse({
      receipt_version: "1.0.0",
      suite_id: "insightbench",
      suite_version: "1.0.0",
      dataset_version: INSIGHTBENCH_DATASET_VERSION,
      repository_commit: INSIGHTBENCH_REPOSITORY_COMMIT,
      dataset_commit: INSIGHTBENCH_DATASET_COMMIT,
      license_spdx_id: "CC-BY-4.0",
      selected_case_count: 5,
      source_files: INSIGHTBENCH_SMOKE_FILES.map((file) => ({
        relative_path: file.relative_path,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
      installed_files: installedFiles,
      installed_digest: sha256Bytes(Buffer.from(digestMaterial)),
      installed_at: (input.now ?? (() => new Date()))().toISOString(),
    });
    await writeFile(
      join(temporaryDirectory, "import-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o644 },
    );
    await rename(temporaryDirectory, finalDirectory);
    return receipt;
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
