import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  type SealedBenchmarkCase,
  sealedBenchmarkCaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  defaultBenchmarkRoot,
  drSpiderInstallDirectory,
  getVerifiedDrSpiderImportReceipt,
} from "./catalog.js";
import {
  DR_SPIDER_ARCHIVE_BYTES,
  DR_SPIDER_ARCHIVE_SHA256,
  DR_SPIDER_ARCHIVE_URL,
  DR_SPIDER_DATASET_VERSION,
  DR_SPIDER_SMOKE_CASE_COUNT,
  DR_SPIDER_SOURCE_COMMIT,
  type DrSpiderImportReceipt,
  drSpiderImportReceiptSchema,
} from "./dr-spider-source.js";

const PERTURBATION = "DB_DBcontent_equivalence";
const DATABASE_IDS = ["tvshow_0", "dog_kennels_0"] as const;
const CASES_PER_DATABASE = DR_SPIDER_SMOKE_CASE_COUNT / DATABASE_IDS.length;
const QUESTION_MEMBER = `./${PERTURBATION}/questions_post_perturbation.json`;
const TABLE_MEMBER = `./${PERTURBATION}/tables_post_perturbation.json`;
const GOLD_MEMBER = `./${PERTURBATION}/gold_post_perturbation.sql`;
const databaseMember = (databaseId: string) =>
  `./${PERTURBATION}/database_post_perturbation/${databaseId}/${databaseId}.sqlite`;
const MAX_LISTING_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_MEMBER_BYTES = 32 * 1024 * 1024;
const MAX_DATABASE_MEMBER_BYTES = 16 * 1024 * 1024;

const sourceCaseSchema = z.object({
  db_id: z.string().min(1),
  question: z.string().min(1),
  q_id_spider_dev: z.number().int().nonnegative(),
});

const tableSchema = z.object({
  db_id: z.string().min(1),
  table_names_original: z.array(z.string().min(1)),
  column_names_original: z.array(z.tuple([z.number().int(), z.string().min(1)])),
  column_types: z.array(z.string().min(1)),
  primary_keys: z.array(
    z.union([z.number().int().nonnegative(), z.array(z.number().int().nonnegative()).min(1)]),
  ),
});

function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function sha256File(path: string): Promise<`sha256:${string}`> {
  return sha256Bytes(await readFile(path));
}

function stableUuid(material: string): string {
  const hex = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function runTar(args: readonly string[], maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", [...args], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxBytes) {
        child.kill("SIGKILL");
        reject(new Error("DR_SPIDER_ARCHIVE_MEMBER_TOO_LARGE"));
        return;
      }
      stdout.push(chunk);
    });
    child.once("error", () => reject(new Error("DR_SPIDER_TAR_UNAVAILABLE")));
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error("DR_SPIDER_ARCHIVE_READ_FAILED"));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

function validateListing(listing: string): void {
  const required = new Set([
    QUESTION_MEMBER,
    TABLE_MEMBER,
    GOLD_MEMBER,
    ...DATABASE_IDS.map(databaseMember),
  ]);
  for (const entry of listing.split(/\r?\n/u)) {
    if (!entry) continue;
    if (entry.includes("\0") || entry.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(entry)) {
      throw new Error("DR_SPIDER_ARCHIVE_PATH_UNSAFE");
    }
    const normalized = normalize(entry).split(sep).join("/");
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
      throw new Error("DR_SPIDER_ARCHIVE_PATH_UNSAFE");
    }
    required.delete(entry);
  }
  if (required.size > 0) throw new Error("DR_SPIDER_ARCHIVE_REQUIRED_MEMBER_MISSING");
}

async function extractMember(
  archivePath: string,
  member: string,
  maxBytes: number,
): Promise<Buffer> {
  return runTar(["-xOzf", archivePath, member], maxBytes);
}

async function downloadArchive(path: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(DR_SPIDER_ARCHIVE_URL, {
    redirect: "error",
    signal: AbortSignal.timeout(600_000),
    headers: { "user-agent": "data-agent-test-center/1.0" },
  });
  if (!response.ok || response.url !== DR_SPIDER_ARCHIVE_URL || !response.body) {
    throw new Error(`DR_SPIDER_DOWNLOAD_HTTP_${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength !== DR_SPIDER_ARCHIVE_BYTES) {
    throw new Error("DR_SPIDER_DOWNLOAD_SIZE_MISMATCH");
  }
  const file = await open(path, "wx", 0o600);
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > DR_SPIDER_ARCHIVE_BYTES) throw new Error("DR_SPIDER_DOWNLOAD_TOO_LARGE");
      await file.write(next.value);
    }
  } finally {
    reader.releaseLock();
    await file.close();
  }
  if (received !== DR_SPIDER_ARCHIVE_BYTES) throw new Error("DR_SPIDER_DOWNLOAD_SIZE_MISMATCH");
}

function databaseSchema(input: z.infer<typeof tableSchema>) {
  const primaryKeys = new Set(input.primary_keys.flat());
  return input.table_names_original.map((tableName, tableIndex) => ({
    name: tableName,
    columns: input.column_names_original.flatMap(([owner, columnName], columnIndex) =>
      owner === tableIndex
        ? [
            {
              name: columnName,
              data_type: input.column_types[columnIndex] ?? "unknown",
              nullable: !primaryKeys.has(columnIndex),
              primary_key: primaryKeys.has(columnIndex),
            },
          ]
        : [],
    ),
  }));
}

function parseGoldLines(
  bytes: Buffer,
): readonly { readonly sql: string; readonly db_id: string }[] {
  return bytes
    .toString("utf8")
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => {
      const separator = line.lastIndexOf("\t");
      if (separator <= 0) throw new Error("DR_SPIDER_GOLD_LINE_INVALID");
      return { sql: line.slice(0, separator).trim(), db_id: line.slice(separator + 1).trim() };
    });
}

async function buildCases(input: {
  readonly questions: Buffer;
  readonly tables: Buffer;
  readonly gold: Buffer;
}): Promise<{
  readonly publicCases: readonly PublicBenchmarkCase[];
  readonly sealedCases: readonly SealedBenchmarkCase[];
}> {
  const questions = z.array(sourceCaseSchema).parse(JSON.parse(input.questions.toString("utf8")));
  const tables = z.array(tableSchema).parse(JSON.parse(input.tables.toString("utf8")));
  const gold = parseGoldLines(input.gold);
  if (gold.length !== questions.length) throw new Error("DR_SPIDER_GOLD_CASE_COUNT_MISMATCH");
  const selected = DATABASE_IDS.flatMap((databaseId) =>
    questions
      .map((question, sourceIndex) => ({ question, sourceIndex, gold: gold[sourceIndex] }))
      .filter((entry) => entry.question.db_id === databaseId && entry.gold?.db_id === databaseId)
      // Upstream questions are adjacent semantic paraphrase pairs. Keep one member per pair.
      .filter((_, databaseOrdinal) => databaseOrdinal % 2 === 0)
      .slice(0, CASES_PER_DATABASE),
  );
  if (selected.length !== DR_SPIDER_SMOKE_CASE_COUNT) {
    throw new Error("DR_SPIDER_SMOKE_SLICE_INCOMPLETE");
  }
  const publicCases: PublicBenchmarkCase[] = [];
  const sealedCases: SealedBenchmarkCase[] = [];
  for (const [ordinal, entry] of selected.entries()) {
    const databaseId = entry.question.db_id;
    const table = tables.find((candidate) => candidate.db_id === databaseId);
    if (!table) throw new Error("DR_SPIDER_SCHEMA_NOT_FOUND");
    const publicDraft = {
      case_id: stableUuid(
        `dr-spider:${DR_SPIDER_DATASET_VERSION}:${PERTURBATION}:${databaseId}:${entry.question.q_id_spider_dev}`,
      ),
      suite_id: "dr-spider" as const,
      suite_version: "1.0.0",
      dataset_version: DR_SPIDER_DATASET_VERSION,
      ordinal,
      database_id: databaseId,
      question: entry.question.question,
      evidence:
        "Dr.Spider DB content-equivalence post-perturbation case from a paraphrase-deduplicated slice; use only the supplied post-perturbation schema.",
      difficulty: "moderate" as const,
      capabilities: ["TEXT_TO_SQL" as const, "SQL_ROBUSTNESS" as const],
      registry: databaseId === DATABASE_IDS[0] ? ("TUNING" as const) : ("HOLDOUT" as const),
      schema: databaseSchema(table),
    };
    const publicCase = publicBenchmarkCaseSchema.parse({
      ...publicDraft,
      public_case_hash: await sha256ContentHash(publicDraft),
    });
    const sealedDraft = {
      public_case: publicCase,
      database_relative_path: `databases/${databaseId}.sqlite`,
      gold_sql: entry.gold?.sql,
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

export async function installDrSpiderSmokeSlice(
  input: {
    readonly archive_path?: string;
    readonly benchmark_root?: string;
    readonly fetch?: typeof fetch;
    readonly now?: () => Date;
  } = {},
): Promise<DrSpiderImportReceipt> {
  const benchmarkRoot = input.benchmark_root ?? defaultBenchmarkRoot();
  const existing = await getVerifiedDrSpiderImportReceipt(benchmarkRoot);
  if (existing) return existing;
  const finalDirectory = drSpiderInstallDirectory(benchmarkRoot);
  try {
    await stat(finalDirectory);
    throw new Error("DR_SPIDER_INSTALLATION_EXISTS_INVALID");
  } catch (error) {
    if (error instanceof Error && error.message === "DR_SPIDER_INSTALLATION_EXISTS_INVALID") {
      throw error;
    }
    if (typeof error !== "object" || error === null || Reflect.get(error, "code") !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(dirname(finalDirectory), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(dirname(finalDirectory), ".dr-spider-"));
  try {
    const archivePath = input.archive_path ?? join(temporaryDirectory, "source.tar.gz");
    if (!input.archive_path) await downloadArchive(archivePath, input.fetch ?? fetch);
    const archiveStat = await stat(archivePath);
    if (!archiveStat.isFile() || archiveStat.size !== DR_SPIDER_ARCHIVE_BYTES) {
      throw new Error("DR_SPIDER_ARCHIVE_SIZE_MISMATCH");
    }
    if ((await sha256File(archivePath)) !== DR_SPIDER_ARCHIVE_SHA256) {
      throw new Error("DR_SPIDER_ARCHIVE_DIGEST_MISMATCH");
    }
    const listing = await runTar(["-tzf", archivePath], MAX_LISTING_BYTES);
    validateListing(listing.toString("utf8"));
    const [questions, tables, gold, databases] = await Promise.all([
      extractMember(archivePath, QUESTION_MEMBER, MAX_METADATA_MEMBER_BYTES),
      extractMember(archivePath, TABLE_MEMBER, MAX_METADATA_MEMBER_BYTES),
      extractMember(archivePath, GOLD_MEMBER, MAX_METADATA_MEMBER_BYTES),
      Promise.all(
        DATABASE_IDS.map(async (databaseId) => ({
          databaseId,
          bytes: await extractMember(
            archivePath,
            databaseMember(databaseId),
            MAX_DATABASE_MEMBER_BYTES,
          ),
        })),
      ),
    ]);
    if (
      databases.some(
        (database) => database.bytes.subarray(0, 16).toString("utf8") !== "SQLite format 3\0",
      )
    ) {
      throw new Error("DR_SPIDER_DATABASE_INVALID");
    }
    const cases = await buildCases({ questions, tables, gold });
    const publicBytes = Buffer.from(`${JSON.stringify(cases.publicCases, null, 2)}\n`);
    const sealedBytes = Buffer.from(`${JSON.stringify(cases.sealedCases, null, 2)}\n`);
    const installed = [
      { relative_path: "public-cases.json", bytes: publicBytes },
      { relative_path: "sealed/sealed-cases.json", bytes: sealedBytes },
      ...databases.map((database) => ({
        relative_path: `databases/${database.databaseId}.sqlite`,
        bytes: database.bytes,
      })),
    ] as const;
    await Promise.all([
      mkdir(join(temporaryDirectory, "sealed"), { recursive: true, mode: 0o700 }),
      mkdir(join(temporaryDirectory, "databases"), { recursive: true }),
    ]);
    for (const file of installed) {
      await writeFile(join(temporaryDirectory, file.relative_path), file.bytes, {
        mode: file.relative_path.startsWith("sealed/") ? 0o600 : 0o444,
      });
    }
    for (const databaseId of DATABASE_IDS) {
      const databasePath = join(temporaryDirectory, `databases/${databaseId}.sqlite`);
      const sqlite = new DatabaseSync(databasePath, {
        readOnly: true,
        enableDoubleQuotedStringLiterals: true,
      });
      try {
        const result = sqlite.prepare("pragma integrity_check").get() as {
          integrity_check?: unknown;
        };
        if (result.integrity_check !== "ok") {
          throw new Error("DR_SPIDER_DATABASE_INTEGRITY_FAILED");
        }
        for (const sealedCase of cases.sealedCases.filter(
          (candidate) => candidate.public_case.database_id === databaseId,
        )) {
          try {
            sqlite.prepare(sealedCase.gold_sql).all();
          } catch {
            throw new Error("DR_SPIDER_GOLD_VALIDATION_FAILED");
          }
        }
      } finally {
        sqlite.close();
      }
    }
    const installedFiles = installed
      .map((file) => ({
        relative_path: file.relative_path,
        bytes: file.bytes.byteLength,
        sha256: sha256Bytes(file.bytes),
      }))
      .sort((left, right) => left.relative_path.localeCompare(right.relative_path));
    const digestMaterial = installedFiles
      .map((file) => `${file.relative_path}:${file.bytes}:${file.sha256}`)
      .join("\n");
    const receipt = drSpiderImportReceiptSchema.parse({
      receipt_version: "1.0.0",
      suite_id: "dr-spider",
      suite_version: "1.0.0",
      dataset_version: DR_SPIDER_DATASET_VERSION,
      source_commit: DR_SPIDER_SOURCE_COMMIT,
      source_url: DR_SPIDER_ARCHIVE_URL,
      archive_sha256: DR_SPIDER_ARCHIVE_SHA256,
      archive_bytes: DR_SPIDER_ARCHIVE_BYTES,
      license_spdx_id: "CC-BY-4.0",
      perturbation: PERTURBATION,
      selected_database_ids: [...DATABASE_IDS],
      selected_case_count: DR_SPIDER_SMOKE_CASE_COUNT,
      installed_files: installedFiles,
      installed_digest: sha256Bytes(Buffer.from(digestMaterial)),
      installed_at: (input.now ?? (() => new Date()))().toISOString(),
    });
    await writeFile(
      join(temporaryDirectory, "import-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o444 },
    );
    if (!input.archive_path) await rm(archivePath, { force: true });
    await chmod(temporaryDirectory, 0o755);
    await rename(temporaryDirectory, finalDirectory);
    return receipt;
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
