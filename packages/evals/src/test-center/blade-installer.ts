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
import {
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  type SealedMultipleChoiceBenchmarkCase,
  sealedMultipleChoiceBenchmarkCaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  BLADE_ARCHIVE_BYTES,
  BLADE_ARCHIVE_SHA256,
  BLADE_ARCHIVE_URL,
  BLADE_DATASET_VERSION,
  BLADE_SMOKE_CASE_COUNT,
  BLADE_SMOKE_DATASETS,
  BLADE_SOURCE_COMMIT,
  type BladeImportReceipt,
  bladeImportReceiptSchema,
} from "./blade-source.js";
import {
  bladeInstallDirectory,
  defaultBenchmarkRoot,
  getVerifiedBladeImportReceipt,
} from "./catalog.js";

const ARCHIVE_PREFIX = `BLADE-${BLADE_SOURCE_COMMIT}/blade_bench/datasets`;
const MAX_LISTING_BYTES = 4 * 1024 * 1024;
const MAX_MEMBER_BYTES = 8 * 1024 * 1024;

const infoSchema = z.object({
  research_questions: z.array(z.string().min(1)).min(1),
  data_desc: z.object({ dataset_description: z.string().min(1) }),
});

const choiceBaseSchema = z.object({ rationale: z.string(), is_llm_generated: z.boolean() });
const cvarChoiceSchema = choiceBaseSchema.extend({ cvar_str: z.string().min(1) });
const transformChoiceSchema = choiceBaseSchema.extend({ code: z.string().min(1) });
const cvarQuestionSchema = z.object({
  mc_type: z.enum(["select_pos", "select_neg"]),
  options: z.array(cvarChoiceSchema).min(2).max(4),
  correct_answer: cvarChoiceSchema,
});
const transformQuestionSchema = z.object({
  coneptual_var_str: z.string().min(1),
  mc_type: z.enum(["select_pos", "select_neg"]),
  options: z.array(transformChoiceSchema).min(2).max(4),
  correct_answer: transformChoiceSchema,
});
const mcqDatasetSchema = z.object({
  mcqs_cvar: z.array(cvarQuestionSchema),
  mcqs_transform: z.record(z.string(), z.array(transformQuestionSchema)),
});

type CvarQuestion = z.infer<typeof cvarQuestionSchema>;
type TransformQuestion = z.infer<typeof transformQuestionSchema>;

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
        reject(new Error("BLADE_ARCHIVE_MEMBER_TOO_LARGE"));
        return;
      }
      stdout.push(chunk);
    });
    child.once("error", () => reject(new Error("BLADE_TAR_UNAVAILABLE")));
    child.once("close", (code) => {
      if (code !== 0) reject(new Error("BLADE_ARCHIVE_READ_FAILED"));
      else resolve(Buffer.concat(stdout));
    });
  });
}

function requiredMembers(): readonly string[] {
  return BLADE_SMOKE_DATASETS.flatMap((datasetId) => [
    `${ARCHIVE_PREFIX}/${datasetId}/info.json`,
    `${ARCHIVE_PREFIX}/${datasetId}/mcq_dataset.json`,
  ]);
}

function validateListing(listing: string): void {
  const required = new Set(requiredMembers());
  for (const entry of listing.split(/\r?\n/u)) {
    if (!entry) continue;
    if (entry.includes("\0") || entry.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(entry)) {
      throw new Error("BLADE_ARCHIVE_PATH_UNSAFE");
    }
    const normalized = normalize(entry).split(sep).join("/");
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
      throw new Error("BLADE_ARCHIVE_PATH_UNSAFE");
    }
    required.delete(entry);
  }
  if (required.size > 0) throw new Error("BLADE_ARCHIVE_REQUIRED_MEMBER_MISSING");
}

async function downloadArchive(path: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(BLADE_ARCHIVE_URL, {
    redirect: "error",
    signal: AbortSignal.timeout(300_000),
    headers: { "user-agent": "data-agent-test-center/1.0" },
  });
  if (!response.ok || response.url !== BLADE_ARCHIVE_URL || !response.body) {
    throw new Error(`BLADE_DOWNLOAD_HTTP_${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength !== BLADE_ARCHIVE_BYTES) {
    throw new Error("BLADE_DOWNLOAD_SIZE_MISMATCH");
  }
  const file = await open(path, "wx", 0o600);
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > BLADE_ARCHIVE_BYTES) throw new Error("BLADE_DOWNLOAD_TOO_LARGE");
      await file.write(next.value);
    }
  } finally {
    reader.releaseLock();
    await file.close();
  }
  if (received !== BLADE_ARCHIVE_BYTES) throw new Error("BLADE_DOWNLOAD_SIZE_MISMATCH");
}

function firstQuestion(
  dataset: z.infer<typeof mcqDatasetSchema>,
): CvarQuestion | TransformQuestion {
  const cvar = dataset.mcqs_cvar[0];
  if (cvar) return cvar;
  const transform = Object.values(dataset.mcqs_transform).flat()[0];
  if (!transform) throw new Error("BLADE_MCQ_DATASET_EMPTY");
  return transform;
}

function choiceKey(choice: object): string {
  return JSON.stringify(choice);
}

function renderQuestion(question: CvarQuestion | TransformQuestion): {
  readonly prompt: string;
  readonly correctChoice: "A" | "B" | "C" | "D";
} {
  const mostOrLeast = question.mc_type === "select_pos" ? "MOST" : "LEAST";
  const transform = "coneptual_var_str" in question;
  const instruction = transform
    ? `Select the transformation code that is ${mostOrLeast} justifiable for operationalizing ${question.coneptual_var_str}.`
    : `Select the conceptual variable that is ${mostOrLeast} justifiable for the analysis.`;
  const letters = ["A", "B", "C", "D"] as const;
  const options = question.options.map((option, index) => {
    const value = "code" in option ? option.code : option.cvar_str;
    return `${letters[index]}. ${value}`;
  });
  const correctIndex = question.options.findIndex(
    (option) => choiceKey(option) === choiceKey(question.correct_answer),
  );
  const correctChoice = letters[correctIndex];
  if (!correctChoice) throw new Error("BLADE_MCQ_CORRECT_CHOICE_MISSING");
  return { prompt: `${instruction}\n\n${options.join("\n\n")}`, correctChoice };
}

async function buildCases(members: ReadonlyMap<string, Buffer>): Promise<{
  readonly publicCases: readonly PublicBenchmarkCase[];
  readonly sealedCases: readonly SealedMultipleChoiceBenchmarkCase[];
}> {
  const publicCases: PublicBenchmarkCase[] = [];
  const sealedCases: SealedMultipleChoiceBenchmarkCase[] = [];
  for (const [ordinal, datasetId] of BLADE_SMOKE_DATASETS.entries()) {
    const info = infoSchema.parse(
      JSON.parse(members.get(`${ARCHIVE_PREFIX}/${datasetId}/info.json`)?.toString("utf8") ?? ""),
    );
    const dataset = mcqDatasetSchema.parse(
      JSON.parse(
        members.get(`${ARCHIVE_PREFIX}/${datasetId}/mcq_dataset.json`)?.toString("utf8") ?? "",
      ),
    );
    const rendered = renderQuestion(firstQuestion(dataset));
    const publicDraft = {
      case_id: stableUuid(`blade:${BLADE_DATASET_VERSION}:${datasetId}:0`),
      suite_id: "blade" as const,
      suite_version: "1.0.0",
      dataset_version: BLADE_DATASET_VERSION,
      ordinal,
      database_id: datasetId,
      question: rendered.prompt,
      evidence: [
        `Research question: ${info.research_questions[0]}`,
        `Dataset context: ${info.data_desc.dataset_description}`,
      ]
        .join("\n\n")
        .slice(0, 20_000),
      difficulty: "moderate" as const,
      capabilities: ["MULTIPLE_CHOICE" as const],
      registry: ordinal < 5 ? ("TUNING" as const) : ("HOLDOUT" as const),
      schema: [],
    };
    const publicCase = publicBenchmarkCaseSchema.parse({
      ...publicDraft,
      public_case_hash: await sha256ContentHash(publicDraft),
    });
    const sealedDraft = { public_case: publicCase, correct_choice: rendered.correctChoice };
    const sealedCase = sealedMultipleChoiceBenchmarkCaseSchema.parse({
      ...sealedDraft,
      sealed_case_hash: await sha256ContentHash(sealedDraft),
    });
    publicCases.push(publicCase);
    sealedCases.push(sealedCase);
  }
  return { publicCases, sealedCases };
}

export async function installBladeSmokeSlice(
  input: {
    readonly archive_path?: string;
    readonly benchmark_root?: string;
    readonly fetch?: typeof fetch;
    readonly now?: () => Date;
  } = {},
): Promise<BladeImportReceipt> {
  const benchmarkRoot = input.benchmark_root ?? defaultBenchmarkRoot();
  const existing = await getVerifiedBladeImportReceipt(benchmarkRoot);
  if (existing) return existing;
  const finalDirectory = bladeInstallDirectory(benchmarkRoot);
  try {
    await stat(finalDirectory);
    throw new Error("BLADE_INSTALLATION_EXISTS_INVALID");
  } catch (error) {
    if (error instanceof Error && error.message === "BLADE_INSTALLATION_EXISTS_INVALID")
      throw error;
    if (typeof error !== "object" || error === null || Reflect.get(error, "code") !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(dirname(finalDirectory), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(dirname(finalDirectory), ".blade-"));
  try {
    const archivePath = input.archive_path ?? join(temporaryDirectory, "source.tar.gz");
    if (!input.archive_path) await downloadArchive(archivePath, input.fetch ?? fetch);
    const archiveStat = await stat(archivePath);
    if (!archiveStat.isFile() || archiveStat.size !== BLADE_ARCHIVE_BYTES) {
      throw new Error("BLADE_ARCHIVE_SIZE_MISMATCH");
    }
    if ((await sha256File(archivePath)) !== BLADE_ARCHIVE_SHA256) {
      throw new Error("BLADE_ARCHIVE_DIGEST_MISMATCH");
    }
    const listing = await runTar(["-tzf", archivePath], MAX_LISTING_BYTES);
    validateListing(listing.toString("utf8"));
    const memberEntries = await Promise.all(
      requiredMembers().map(
        async (member) =>
          [member, await runTar(["-xOzf", archivePath, member], MAX_MEMBER_BYTES)] as const,
      ),
    );
    const cases = await buildCases(new Map(memberEntries));
    const publicBytes = Buffer.from(`${JSON.stringify(cases.publicCases, null, 2)}\n`);
    const sealedBytes = Buffer.from(`${JSON.stringify(cases.sealedCases, null, 2)}\n`);
    await mkdir(join(temporaryDirectory, "sealed"), { recursive: true, mode: 0o700 });
    await Promise.all([
      writeFile(join(temporaryDirectory, "public-cases.json"), publicBytes, { mode: 0o444 }),
      writeFile(join(temporaryDirectory, "sealed", "sealed-cases.json"), sealedBytes, {
        mode: 0o600,
      }),
    ]);
    const publicDigest = sha256Bytes(publicBytes);
    const sealedDigest = sha256Bytes(sealedBytes);
    const installedDigest = sha256Bytes(Buffer.from(`${publicDigest}\n${sealedDigest}`));
    const receipt = bladeImportReceiptSchema.parse({
      receipt_version: "1.0.0",
      suite_id: "blade",
      suite_version: "1.0.0",
      dataset_version: BLADE_DATASET_VERSION,
      source_commit: BLADE_SOURCE_COMMIT,
      source_url: BLADE_ARCHIVE_URL,
      archive_sha256: BLADE_ARCHIVE_SHA256,
      archive_bytes: BLADE_ARCHIVE_BYTES,
      code_license_spdx_id: "Apache-2.0",
      data_license_spdx_id: "ODC-By-1.0",
      selected_datasets: [...BLADE_SMOKE_DATASETS],
      selected_case_count: BLADE_SMOKE_CASE_COUNT,
      public_cases_sha256: publicDigest,
      sealed_cases_sha256: sealedDigest,
      installed_digest: installedDigest,
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
