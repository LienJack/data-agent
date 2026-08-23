import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { z } from "zod";

export const FIXED_REPOSITORY_COMMIT = "61bb0d6be3439797d2c75a6ede198b0b296cc226";
export const FIXED_DATASET_REVISION = "3b0ac3fde63fd615de92bf70c1dd93b73f92d92f";
export const MAX_CHUNK_BYTES = 50 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !isAbsolute(value) && !value.split(/[\\/]/u).includes(".."), {
    message: "path must remain inside the bundle",
  });

export const sourceEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/u),
  upstreamPath: z.string().min(1),
  sourceFile: relativePathSchema,
  bundlePath: relativePathSchema,
  format: z.enum(["csv", "jsonl"]),
  materialization: z.enum(["full", "head_physical_records"]),
  recordLimit: z.number().int().positive().nullable(),
  upstreamBytes: z.number().int().positive(),
  upstreamObjectId: z.string().min(1),
  upstreamSha256: digestSchema.nullable(),
  materializedBytes: z.number().int().positive(),
  materializedSha256: digestSchema,
  rows: z.number().int().nonnegative(),
  columns: z.array(z.string().min(1)).min(1),
});

export const sourceManifestSchema = z.strictObject({
  schemaVersion: z.literal("agenticdatabench-ecommerce-source-manifest@1"),
  repository: z.strictObject({
    url: z.literal("https://github.com/AgenticDataBench/AgenticDataBench"),
    commit: z.literal(FIXED_REPOSITORY_COMMIT),
  }),
  dataset: z.strictObject({
    url: z.literal("https://huggingface.co/datasets/shawnzzzh/AgenticDataBench"),
    revision: z.literal(FIXED_DATASET_REVISION),
    declaredLicense: z.literal("apache-2.0"),
  }),
  slicePolicy: z.strictObject({
    order: z.literal("physical_file_order"),
    amazonRecordLimit: z.literal(10_000),
    lineEnding: z.literal("preserve_upstream"),
  }),
  sources: z.array(sourceEntrySchema).length(12),
});

export const bundleEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/u),
  path: relativePathSchema,
  compressedBytes: z.number().int().positive().max(MAX_CHUNK_BYTES),
  compressedSha256: digestSchema,
  materializedBytes: z.number().int().positive(),
  materializedSha256: digestSchema,
  rows: z.number().int().nonnegative(),
});

export const bundleManifestSchema = z.strictObject({
  schemaVersion: z.literal("agenticdatabench-ecommerce-bundle-manifest@1"),
  sourceManifestSha256: digestSchema,
  compression: z.strictObject({
    algorithm: z.literal("gzip"),
    level: z.literal(9),
    mtime: z.literal(0),
  }),
  totalCompressedBytes: z.number().int().positive().max(MAX_BUNDLE_BYTES),
  entries: z.array(bundleEntrySchema).length(12),
  bundleDigest: digestSchema,
});

export type SourceManifest = z.infer<typeof sourceManifestSchema>;
export type BundleManifest = z.infer<typeof bundleManifestSchema>;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

function assertContained(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(root, candidate);
  const rel = relative(absoluteRoot, absoluteCandidate);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`BUNDLE_PATH_INVALID: ${candidate}`);
  }
  return absoluteCandidate;
}

async function countRecords(
  chunks: AsyncIterable<Buffer | string>,
  format: "csv" | "jsonl",
): Promise<number> {
  let count = 0;
  let sawByte = false;
  let finalByte = -1;
  let insideQuotes = false;
  for await (const chunk of chunks) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sawByte ||= bytes.length > 0;
    for (const byte of bytes) {
      if (format === "csv" && byte === 0x22) insideQuotes = !insideQuotes;
      if (byte === 0x0a && !insideQuotes) count += 1;
    }
    if (bytes.length > 0) finalByte = bytes[bytes.length - 1] ?? -1;
  }
  const records = count + (sawByte && finalByte !== 0x0a ? 1 : 0);
  return format === "csv" ? records - 1 : records;
}

async function gzipDeterministic(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  await rm(temporary, { force: true });
  // Node emits a zero gzip mtime, so identical inputs produce identical chunks.
  await pipeline(createReadStream(source), createGzip({ level: 9 }), createWriteStream(temporary));
  await rename(temporary, destination);
}

function computeBundleDigest(entries: BundleManifest["entries"]): string {
  return sha256(
    canonicalJson(
      entries.map(({ id, path, compressedSha256 }) => ({ id, path, compressedSha256 })),
    ),
  );
}

export async function readSourceManifest(path: string): Promise<SourceManifest> {
  return sourceManifestSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export async function readBundleManifest(path: string): Promise<BundleManifest> {
  return bundleManifestSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export async function buildBundle(
  sourceDirectory: string,
  outputDirectory: string,
): Promise<BundleManifest> {
  const sourceManifestPath = join(outputDirectory, "source-manifest.json");
  const sourceManifest = await readSourceManifest(sourceManifestPath);
  const sourceIds = new Set<string>();
  const sourcePaths = new Set<string>();
  for (const entry of sourceManifest.sources) {
    if (sourceIds.has(entry.id) || sourcePaths.has(entry.bundlePath))
      throw new Error(`SOURCE_DUPLICATE: ${entry.id}`);
    sourceIds.add(entry.id);
    sourcePaths.add(entry.bundlePath);
  }

  const entries: BundleManifest["entries"] = [];
  for (const source of sourceManifest.sources) {
    const sourcePath = assertContained(sourceDirectory, source.sourceFile);
    const actualStat = await stat(sourcePath);
    const actualHash = await hashFile(sourcePath);
    const actualRows = await countRecords(createReadStream(sourcePath), source.format);
    if (actualStat.size !== source.materializedBytes)
      throw new Error(`SOURCE_SIZE_MISMATCH: ${source.id}`);
    if (actualHash !== source.materializedSha256)
      throw new Error(`SOURCE_HASH_MISMATCH: ${source.id}`);
    if (actualRows !== source.rows) throw new Error(`SOURCE_ROW_COUNT_MISMATCH: ${source.id}`);
    if (source.materialization === "head_physical_records" && actualRows !== source.recordLimit) {
      throw new Error(`SOURCE_SLICE_ORDER_MISMATCH: ${source.id}`);
    }

    const destination = assertContained(outputDirectory, source.bundlePath);
    await gzipDeterministic(sourcePath, destination);
    const compressedStat = await stat(destination);
    if (compressedStat.size > MAX_CHUNK_BYTES)
      throw new Error(`BUNDLE_CHUNK_TOO_LARGE: ${source.id}`);
    entries.push({
      id: source.id,
      path: source.bundlePath,
      compressedBytes: compressedStat.size,
      compressedSha256: await hashFile(destination),
      materializedBytes: source.materializedBytes,
      materializedSha256: source.materializedSha256,
      rows: source.rows,
    });
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));
  const totalCompressedBytes = entries.reduce((total, entry) => total + entry.compressedBytes, 0);
  if (totalCompressedBytes > MAX_BUNDLE_BYTES) throw new Error("BUNDLE_TOTAL_TOO_LARGE");
  const manifest: BundleManifest = bundleManifestSchema.parse({
    schemaVersion: "agenticdatabench-ecommerce-bundle-manifest@1",
    sourceManifestSha256: sha256(canonicalJson(sourceManifest)),
    compression: { algorithm: "gzip", level: 9, mtime: 0 },
    totalCompressedBytes,
    entries,
    bundleDigest: computeBundleDigest(entries),
  });
  await writeFile(
    join(outputDirectory, "bundle-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

export async function verifyBundle(bundleDirectory: string): Promise<BundleManifest> {
  const sourceManifest = await readSourceManifest(join(bundleDirectory, "source-manifest.json"));
  const manifest = await readBundleManifest(join(bundleDirectory, "bundle-manifest.json"));
  if (manifest.sourceManifestSha256 !== sha256(canonicalJson(sourceManifest))) {
    throw new Error("BUNDLE_SOURCE_MANIFEST_MISMATCH");
  }
  if (manifest.bundleDigest !== computeBundleDigest(manifest.entries))
    throw new Error("BUNDLE_DIGEST_MISMATCH");
  const ids = new Set<string>();
  let total = 0;
  for (const entry of manifest.entries) {
    if (ids.has(entry.id)) throw new Error(`BUNDLE_DUPLICATE: ${entry.id}`);
    ids.add(entry.id);
    const path = assertContained(bundleDirectory, entry.path);
    const actualStat = await stat(path);
    if (actualStat.size !== entry.compressedBytes)
      throw new Error(`BUNDLE_SIZE_MISMATCH: ${entry.id}`);
    if ((await hashFile(path)) !== entry.compressedSha256)
      throw new Error(`BUNDLE_HASH_MISMATCH: ${entry.id}`);
    total += actualStat.size;

    const hash = createHash("sha256");
    let bytes = 0;
    const gunzip = createReadStream(path).pipe(createGunzip());
    const observedChunks: Buffer[] = [];
    for await (const chunk of gunzip) {
      const data = chunk as Buffer;
      hash.update(data);
      bytes += data.length;
      observedChunks.push(data);
    }
    const source = sourceManifest.sources.find((candidate) => candidate.id === entry.id);
    if (!source) throw new Error(`BUNDLE_SOURCE_MISSING: ${entry.id}`);
    const records = await countRecords(
      (async function* (): AsyncGenerator<Buffer> {
        yield* observedChunks;
      })(),
      source.format,
    );
    if (bytes !== entry.materializedBytes)
      throw new Error(`BUNDLE_OUTPUT_SIZE_MISMATCH: ${entry.id}`);
    if (`sha256:${hash.digest("hex")}` !== entry.materializedSha256) {
      throw new Error(`BUNDLE_OUTPUT_HASH_MISMATCH: ${entry.id}`);
    }
    if (records !== entry.rows) throw new Error(`BUNDLE_OUTPUT_ROW_COUNT_MISMATCH: ${entry.id}`);
  }
  if (total !== manifest.totalCompressedBytes) throw new Error("BUNDLE_TOTAL_SIZE_MISMATCH");
  return manifest;
}

export function defaultBundleDirectory(): string {
  return resolve(
    dirname(new URL(import.meta.url).pathname),
    "../../infra/agenticdatabench/ecommerce-v1",
  );
}

export function formatBundleSummary(manifest: BundleManifest): string {
  return `${manifest.entries.length} chunks, ${manifest.totalCompressedBytes} bytes, ${manifest.bundleDigest}`;
}
