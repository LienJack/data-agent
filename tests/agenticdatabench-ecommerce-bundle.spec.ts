import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FIXED_DATASET_REVISION,
  FIXED_REPOSITORY_COMMIT,
  buildBundle,
  bundleManifestSchema,
  canonicalJson,
  sha256,
  sourceManifestSchema,
  verifyBundle,
  type SourceManifest,
} from "../scripts/lib/agenticdatabench-ecommerce-bundle.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sourceManifest(content: string): SourceManifest {
  const bytes = Buffer.byteLength(content);
  return {
    schemaVersion: "agenticdatabench-ecommerce-source-manifest@1",
    repository: {
      url: "https://github.com/AgenticDataBench/AgenticDataBench",
      commit: FIXED_REPOSITORY_COMMIT,
    },
    dataset: {
      url: "https://huggingface.co/datasets/shawnzzzh/AgenticDataBench",
      revision: FIXED_DATASET_REVISION,
      declaredLicense: "apache-2.0",
    },
    slicePolicy: { order: "physical_file_order", amazonRecordLimit: 10_000, lineEnding: "preserve_upstream" },
    sources: Array.from({ length: 12 }, (_, index) => ({
      id: `source_${index.toString().padStart(2, "0")}`,
      upstreamPath: `fixed/source-${index}.csv`,
      sourceFile: `source-${index}.csv`,
      bundlePath: `seed/source-${index}.csv.gz`,
      format: "csv" as const,
      materialization: "full" as const,
      recordLimit: null,
      upstreamBytes: bytes,
      upstreamObjectId: `object-${index}`,
      upstreamSha256: null,
      materializedBytes: bytes,
      materializedSha256: sha256(content),
      rows: 1,
      columns: ["value"],
    })),
  };
}

async function fixture(): Promise<{ root: string; source: string; output: string; manifest: SourceManifest }> {
  const root = await mkdtemp(join(tmpdir(), "adb-ecommerce-bundle-"));
  temporaryDirectories.push(root);
  const source = join(root, "source");
  const output = join(root, "output");
  await Promise.all([mkdir(source), mkdir(output)]);
  const content = "value\n1\n";
  const manifest = sourceManifest(content);
  await Promise.all(manifest.sources.map((entry) => writeFile(join(source, entry.sourceFile), content, "utf8")));
  await writeFile(join(output, "source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { root, source, output, manifest };
}

describe("AgenticDataBench E-commerce bundle contracts", () => {
  it("rejects unknown source-manifest fields and a drifting dataset revision", () => {
    const manifest = sourceManifest("value\n1\n");
    expect(() => sourceManifestSchema.parse({ ...manifest, unexpected: true })).toThrow();
    expect(() =>
      sourceManifestSchema.parse({ ...manifest, dataset: { ...manifest.dataset, revision: "moving-main" } }),
    ).toThrow();
  });

  it("rejects traversal in source and compressed paths", () => {
    const manifest = sourceManifest("value\n1\n");
    expect(() =>
      sourceManifestSchema.parse({
        ...manifest,
        sources: manifest.sources.map((entry, index) =>
          index === 0 ? { ...entry, sourceFile: "../secret.csv" } : entry,
        ),
      }),
    ).toThrow();
    expect(() =>
      bundleManifestSchema.parse({
        schemaVersion: "agenticdatabench-ecommerce-bundle-manifest@1",
        sourceManifestSha256: sha256("source"),
        compression: { algorithm: "gzip", level: 9, mtime: 0 },
        totalCompressedBytes: 12,
        entries: Array.from({ length: 12 }, (_, index) => ({
          id: `source_${index}`,
          path: index === 0 ? "../escape.gz" : `seed/${index}.gz`,
          compressedBytes: 1,
          compressedSha256: sha256(`${index}`),
          materializedBytes: 1,
          materializedSha256: sha256(`${index}`),
          rows: 1,
        })),
        bundleDigest: sha256("bundle"),
      }),
    ).toThrow();
  });

  it("rejects duplicate IDs before writing chunks", async () => {
    const { source, output, manifest } = await fixture();
    manifest.sources[1] = { ...manifest.sources[1], id: manifest.sources[0]?.id ?? "source_00" };
    await writeFile(join(output, "source-manifest.json"), JSON.stringify(manifest), "utf8");
    await expect(buildBundle(source, output)).rejects.toThrow("SOURCE_DUPLICATE");
  });

  it("rejects source hash and row-count drift", async () => {
    const hashFixture = await fixture();
    await writeFile(join(hashFixture.source, "source-0.csv"), "value\n2\n", "utf8");
    await expect(buildBundle(hashFixture.source, hashFixture.output)).rejects.toThrow("SOURCE_HASH_MISMATCH");

    const rowFixture = await fixture();
    const changed = {
      ...rowFixture.manifest,
      sources: rowFixture.manifest.sources.map((entry, index) => (index === 0 ? { ...entry, rows: 2 } : entry)),
    };
    await writeFile(join(rowFixture.output, "source-manifest.json"), JSON.stringify(changed), "utf8");
    await expect(buildBundle(rowFixture.source, rowFixture.output)).rejects.toThrow("SOURCE_ROW_COUNT_MISMATCH");
  });

  it("builds reproducibly and detects compressed-byte tampering", async () => {
    const first = await fixture();
    const secondOutput = join(first.root, "second-output");
    await mkdir(secondOutput);
    await writeFile(
      join(secondOutput, "source-manifest.json"),
      await readFile(join(first.output, "source-manifest.json")),
    );

    const firstManifest = await buildBundle(first.source, first.output);
    const secondManifest = await buildBundle(first.source, secondOutput);
    expect(canonicalJson(secondManifest)).toBe(canonicalJson(firstManifest));
    for (const entry of firstManifest.entries) {
      expect(await readFile(join(secondOutput, entry.path))).toEqual(await readFile(join(first.output, entry.path)));
    }
    await verifyBundle(first.output);

    const target = firstManifest.entries[0];
    if (!target) throw new Error("fixture did not create a bundle entry");
    const bytes = await readFile(join(first.output, target.path));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    await writeFile(join(first.output, target.path), bytes);
    await expect(verifyBundle(first.output)).rejects.toThrow("BUNDLE_HASH_MISMATCH");
  });
});
