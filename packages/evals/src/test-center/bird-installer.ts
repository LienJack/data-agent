import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  sealedBenchmarkCaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  BIRD_MINI_DEV_ARCHIVE_BYTES,
  BIRD_MINI_DEV_ARCHIVE_SHA256,
  BIRD_MINI_DEV_ARCHIVE_URL,
  BIRD_MINI_DEV_SOURCE_COMMIT,
  BIRD_PUBLISHED_BASELINE_SHA256,
  BIRD_PUBLISHED_BASELINE_URL,
  type BirdImportReceipt,
  birdImportReceiptSchema,
  birdInstallDirectory,
  defaultBenchmarkRoot,
} from "./catalog.js";

const CASES_MEMBER = "minidev/MINIDEV/mini_dev_sqlite.json";
const SCHEMA_MEMBER = "minidev/MINIDEV/dev_tables.json";
const DATABASE_MEMBER = "minidev/MINIDEV/dev_databases/superhero/superhero.sqlite";
const MAX_ARCHIVE_LIST_BYTES = 4 * 1024 * 1024;
const MAX_SELECTED_MEMBER_BYTES = 2 * 1024 * 1024;
const MAX_BASELINE_BYTES = 2 * 1024 * 1024;

const birdCaseSchema = z.strictObject({
  question_id: z.number().int().positive(),
  db_id: z.string().min(1),
  question: z.string().min(1),
  evidence: z.string(),
  SQL: z.string().min(1),
  difficulty: z.enum(["simple", "moderate", "challenging"]),
});

const birdTableSchema = z.strictObject({
  db_id: z.string().min(1),
  table_names_original: z.array(z.string().min(1)),
  column_names_original: z.array(z.tuple([z.number().int(), z.string().min(1)])),
  column_types: z.array(z.string().min(1)),
  primary_keys: z.array(
    z.union([z.number().int().nonnegative(), z.array(z.number().int().nonnegative()).min(1)]),
  ),
  foreign_keys: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])),
  table_names: z.array(z.string()),
  column_names: z.array(z.tuple([z.number().int(), z.string()])),
});

function stableUuid(material: string): string {
  const hex = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function sha256File(path: string): Promise<`sha256:${string}`> {
  return sha256Bytes(await readFile(path));
}

async function runUnzip(args: readonly string[], maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", [...args], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let diagnosticBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxBytes) {
        child.kill("SIGKILL");
        reject(new Error("BENCHMARK_ARCHIVE_MEMBER_TOO_LARGE"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      diagnosticBytes += chunk.length;
      if (diagnosticBytes <= 8_192) stderr.push(chunk);
    });
    child.once("error", () => reject(new Error("BENCHMARK_UNZIP_UNAVAILABLE")));
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `BENCHMARK_ARCHIVE_READ_FAILED:${Buffer.concat(stderr).toString("utf8").slice(0, 256)}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

export function validateBenchmarkArchiveListing(listing: string): void {
  const required = new Set([CASES_MEMBER, SCHEMA_MEMBER, DATABASE_MEMBER]);
  for (const rawEntry of listing.split(/\r?\n/u)) {
    if (!rawEntry) continue;
    if (rawEntry.includes("\0") || rawEntry.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(rawEntry)) {
      throw new Error("BENCHMARK_ARCHIVE_PATH_UNSAFE");
    }
    const normalized = normalize(rawEntry).split(sep).join("/");
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
      throw new Error("BENCHMARK_ARCHIVE_PATH_UNSAFE");
    }
    required.delete(rawEntry);
  }
  if (required.size > 0) throw new Error("BENCHMARK_ARCHIVE_REQUIRED_MEMBER_MISSING");
}

async function extractSelectedMember(archivePath: string, member: string): Promise<Buffer> {
  return runUnzip(["-p", archivePath, member], MAX_SELECTED_MEMBER_BYTES);
}

async function fetchPinnedBaseline(fetchImpl: typeof fetch): Promise<Buffer> {
  const response = await fetchImpl(BIRD_PUBLISHED_BASELINE_URL, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || response.url !== BIRD_PUBLISHED_BASELINE_URL) {
    throw new Error("BENCHMARK_BASELINE_DOWNLOAD_FAILED");
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BASELINE_BYTES) throw new Error("BENCHMARK_BASELINE_TOO_LARGE");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BASELINE_BYTES) throw new Error("BENCHMARK_BASELINE_TOO_LARGE");
  if (sha256Bytes(bytes) !== BIRD_PUBLISHED_BASELINE_SHA256) {
    throw new Error("BENCHMARK_BASELINE_DIGEST_MISMATCH");
  }
  return bytes;
}

function databaseSchemaFor(tableInput: z.infer<typeof birdTableSchema>) {
  const primaryKeys = new Set(tableInput.primary_keys.flat());
  return tableInput.table_names_original.map((tableName, tableIndex) => ({
    name: tableName,
    columns: tableInput.column_names_original.flatMap(([ownerIndex, columnName], columnIndex) =>
      ownerIndex === tableIndex
        ? [
            {
              name: columnName,
              data_type: tableInput.column_types[columnIndex] ?? "unknown",
              nullable: !primaryKeys.has(columnIndex),
              primary_key: primaryKeys.has(columnIndex),
            },
          ]
        : [],
    ),
  }));
}

async function buildCases(
  caseBytes: Buffer,
  schemaBytes: Buffer,
): Promise<{
  readonly publicCases: readonly PublicBenchmarkCase[];
  readonly sealedCases: readonly z.infer<typeof sealedBenchmarkCaseSchema>[];
}> {
  const allCases = z.array(birdCaseSchema).parse(JSON.parse(caseBytes.toString("utf8")));
  const table = z
    .array(birdTableSchema)
    .parse(JSON.parse(schemaBytes.toString("utf8")))
    .find((candidate) => candidate.db_id === "superhero");
  if (!table) throw new Error("BENCHMARK_SCHEMA_NOT_FOUND");
  const selected = allCases
    .map((value, sourceIndex) => ({ value, sourceIndex }))
    .filter(({ value }) => value.db_id === "superhero")
    .slice(0, 10);
  if (selected.length !== 10) throw new Error("BENCHMARK_SMOKE_SLICE_INCOMPLETE");

  const schema = databaseSchemaFor(table);
  const publicCases: PublicBenchmarkCase[] = [];
  const sealedCases: z.infer<typeof sealedBenchmarkCaseSchema>[] = [];
  for (const [ordinal, selectedCase] of selected.entries()) {
    const caseId = stableUuid(`bird-mini-dev:v1:${selectedCase.value.question_id}`);
    const publicDraft = {
      case_id: caseId,
      suite_id: "bird-mini-dev" as const,
      suite_version: "1.0.0",
      dataset_version: "bird-mini-dev-v1-2024-06",
      ordinal,
      database_id: selectedCase.value.db_id,
      question: selectedCase.value.question,
      evidence: selectedCase.value.evidence.trim() || null,
      difficulty: selectedCase.value.difficulty,
      capabilities: ["TEXT_TO_SQL" as const],
      registry: ordinal < 8 ? ("DEMO" as const) : ("TUNING" as const),
      schema,
    };
    const publicCase = publicBenchmarkCaseSchema.parse({
      ...publicDraft,
      public_case_hash: await sha256ContentHash(publicDraft),
    });
    const sealedDraft = {
      public_case: publicCase,
      database_relative_path: "databases/superhero.sqlite",
      gold_sql: selectedCase.value.SQL,
    };
    const sealedCase = sealedBenchmarkCaseSchema.parse({
      ...sealedDraft,
      sealed_case_hash: await sha256ContentHash(sealedDraft),
    });
    publicCases.push(publicCase);
    sealedCases.push(sealedCase);
  }
  return { publicCases, sealedCases };
}

function buildPublishedPredictions(
  baselineBytes: Buffer,
  caseBytes: Buffer,
  publicCases: readonly PublicBenchmarkCase[],
): Readonly<Record<string, string>> {
  const predictions = z
    .record(z.string(), z.string())
    .parse(JSON.parse(baselineBytes.toString("utf8")));
  const allCases = z.array(birdCaseSchema).parse(JSON.parse(caseBytes.toString("utf8")));
  const sourceIndexes = allCases
    .map((value, sourceIndex) => ({ value, sourceIndex }))
    .filter(({ value }) => value.db_id === "superhero")
    .slice(0, 10)
    .map(({ sourceIndex }) => sourceIndex);
  return Object.freeze(
    Object.fromEntries(
      publicCases.map((publicCase, index) => {
        const sourceIndex = sourceIndexes[index];
        const raw = sourceIndex === undefined ? undefined : predictions[String(sourceIndex)];
        if (!raw) throw new Error("BENCHMARK_BASELINE_CASE_MISSING");
        const [sql, databaseId] = raw.split("\t----- bird -----\t");
        if (!sql?.trim() || databaseId?.trim() !== publicCase.database_id) {
          throw new Error("BENCHMARK_BASELINE_CASE_INVALID");
        }
        return [publicCase.case_id, sql.trim()];
      }),
    ),
  );
}

function verifySqliteDatabase(bytes: Buffer): void {
  const header = bytes.subarray(0, 16).toString("utf8");
  if (header !== "SQLite format 3\0") throw new Error("BENCHMARK_DATABASE_INVALID");
}

export interface InstallBirdMiniDevInput {
  readonly archive_path: string;
  readonly benchmark_root?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export async function installBirdMiniDevSmokeSlice(
  input: InstallBirdMiniDevInput,
): Promise<BirdImportReceipt> {
  const archivePath = input.archive_path;
  if (basename(archivePath).length === 0) throw new Error("BENCHMARK_ARCHIVE_PATH_INVALID");
  const archiveStat = await stat(archivePath);
  if (!archiveStat.isFile() || archiveStat.size !== BIRD_MINI_DEV_ARCHIVE_BYTES) {
    throw new Error("BENCHMARK_ARCHIVE_SIZE_MISMATCH");
  }
  if ((await sha256File(archivePath)) !== BIRD_MINI_DEV_ARCHIVE_SHA256) {
    throw new Error("BENCHMARK_ARCHIVE_DIGEST_MISMATCH");
  }
  const listing = await runUnzip(["-Z1", archivePath], MAX_ARCHIVE_LIST_BYTES);
  validateBenchmarkArchiveListing(listing.toString("utf8"));

  const [caseBytes, schemaBytes, databaseBytes, baselineBytes] = await Promise.all([
    extractSelectedMember(archivePath, CASES_MEMBER),
    extractSelectedMember(archivePath, SCHEMA_MEMBER),
    extractSelectedMember(archivePath, DATABASE_MEMBER),
    fetchPinnedBaseline(input.fetch ?? fetch),
  ]);
  verifySqliteDatabase(databaseBytes);
  const { publicCases, sealedCases } = await buildCases(caseBytes, schemaBytes);
  const publishedPredictions = buildPublishedPredictions(baselineBytes, caseBytes, publicCases);

  const root = input.benchmark_root ?? defaultBenchmarkRoot();
  const finalDirectory = birdInstallDirectory(root);
  try {
    await stat(finalDirectory);
    throw new Error("BENCHMARK_INSTALL_TARGET_EXISTS");
  } catch (error) {
    if (error instanceof Error && error.message === "BENCHMARK_INSTALL_TARGET_EXISTS") throw error;
  }
  await mkdir(dirname(finalDirectory), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(dirname(finalDirectory), ".bird-mini-dev-"));
  const publicPath = join(temporaryDirectory, "public-cases.json");
  const sealedPath = join(temporaryDirectory, "sealed", "sealed-cases.json");
  const databasePath = join(temporaryDirectory, "databases", "superhero.sqlite");
  const predictionsPath = join(temporaryDirectory, "agents", "gpt-4-turbo-published.json");
  await Promise.all([
    mkdir(dirname(sealedPath), { recursive: true }),
    mkdir(dirname(databasePath), { recursive: true }),
    mkdir(dirname(predictionsPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(publicPath, `${JSON.stringify(publicCases, null, 2)}\n`, { mode: 0o444 }),
    writeFile(sealedPath, `${JSON.stringify(sealedCases, null, 2)}\n`, { mode: 0o600 }),
    writeFile(databasePath, databaseBytes, { mode: 0o444 }),
    writeFile(predictionsPath, `${JSON.stringify(publishedPredictions, null, 2)}\n`, {
      mode: 0o444,
    }),
  ]);

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const result = database.prepare("pragma integrity_check").get() as {
      integrity_check?: unknown;
    };
    if (result.integrity_check !== "ok") throw new Error("BENCHMARK_DATABASE_INTEGRITY_FAILED");
  } finally {
    database.close();
  }

  const [databaseSha256, publicCasesSha256, sealedCasesSha256, predictionsSha256] =
    await Promise.all([
      sha256File(databasePath),
      sha256File(publicPath),
      sha256File(sealedPath),
      sha256File(predictionsPath),
    ]);
  const installedDigest = sha256Bytes(
    Buffer.from(
      [databaseSha256, publicCasesSha256, sealedCasesSha256, predictionsSha256].join("\n"),
    ),
  );
  const receipt = birdImportReceiptSchema.parse({
    receipt_version: "1.0.0",
    suite_id: "bird-mini-dev",
    suite_version: "1.0.0",
    dataset_version: "bird-mini-dev-v1-2024-06",
    source_commit: BIRD_MINI_DEV_SOURCE_COMMIT,
    source_url: BIRD_MINI_DEV_ARCHIVE_URL,
    archive_sha256: BIRD_MINI_DEV_ARCHIVE_SHA256,
    archive_bytes: BIRD_MINI_DEV_ARCHIVE_BYTES,
    license_spdx_id: "CC-BY-SA-4.0",
    selected_database_id: "superhero",
    selected_case_count: 10,
    database_sha256: databaseSha256,
    public_cases_sha256: publicCasesSha256,
    sealed_cases_sha256: sealedCasesSha256,
    baseline_source_sha256: BIRD_PUBLISHED_BASELINE_SHA256,
    agent_predictions_sha256: predictionsSha256,
    installed_digest: installedDigest,
    installed_at: (input.now?.() ?? new Date()).toISOString(),
  });
  await writeFile(
    join(temporaryDirectory, "import-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { mode: 0o444 },
  );
  await chmod(temporaryDirectory, 0o755);
  await rename(temporaryDirectory, finalDirectory);
  return receipt;
}
