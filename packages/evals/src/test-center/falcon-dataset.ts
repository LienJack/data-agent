import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FALCON_CASE_COUNT,
  FALCON_DATABASE_COUNT,
  FALCON_DEV_CASE_COUNT,
  FALCON_TEST_CASE_COUNT,
  type FalconSourceManifest,
  falconExpectedResultSchema,
  falconSourceManifestSchema,
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  type SealedFalconCase,
  sealedFalconCaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import { falconSemanticContext } from "./falcon-semantic-context.js";

const compatibilityFixtureSchema = z.strictObject({
  fixture_kind: z.string().min(1).max(64),
  public_case: publicBenchmarkCaseSchema,
  expected_results: z.array(falconExpectedResultSchema).min(1).max(16),
  is_order: z.boolean(),
});

export interface FalconPreviewDataset {
  readonly manifest: FalconSourceManifest;
  readonly public_cases: readonly PublicBenchmarkCase[];
  readonly main_demo_cases: readonly PublicBenchmarkCase[];
  readonly smoke_cases: readonly PublicBenchmarkCase[];
}

export interface FalconDevDataset extends FalconPreviewDataset {
  readonly sealed_cases: readonly SealedFalconCase[];
  readonly installed_digest: `sha256:${string}`;
}

export interface FalconBundleVerification {
  readonly manifest: FalconSourceManifest;
  readonly compatibility_fixture_count: 5;
  readonly verified_file_count: number;
  readonly installed_digest: `sha256:${string}`;
}

function defaultFalconDirectory(): string {
  const relative = "infra/falcon/v1";
  for (const candidate of [
    resolve(process.cwd(), relative),
    resolve(process.cwd(), "../..", relative),
  ]) {
    if (existsSync(resolve(candidate, "source-manifest.json"))) return candidate;
  }
  throw new Error("FALCON_BUNDLE_NOT_FOUND");
}

async function sha256File(path: string): Promise<`sha256:${string}`> {
  const bytes = await readFile(path);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function verifyPublicCase(testCase: PublicBenchmarkCase): Promise<void> {
  const { public_case_hash: expected, ...material } = testCase;
  if ((await sha256ContentHash(material)) !== expected) {
    throw new Error(`FALCON_PUBLIC_CASE_DIGEST_MISMATCH:${testCase.case_id}`);
  }
}

async function loadSourcePublicCases(directory: string): Promise<readonly PublicBenchmarkCase[]> {
  const sourceCases = z
    .array(publicBenchmarkCaseSchema)
    .length(FALCON_CASE_COUNT)
    .parse(await readJson(resolve(directory, "public-cases.json")));
  await Promise.all(sourceCases.map(verifyPublicCase));
  return sourceCases;
}

async function derivePublicCase(
  testCase: PublicBenchmarkCase,
  changes: Partial<
    Pick<PublicBenchmarkCase, "registry" | "runnable" | "status_reason" | "evidence">
  >,
): Promise<PublicBenchmarkCase> {
  const { public_case_hash: _sourceHash, ...sourceMaterial } = testCase;
  const material = { ...sourceMaterial, ...changes };
  return publicBenchmarkCaseSchema.parse({
    ...material,
    public_case_hash: await sha256ContentHash(material),
  });
}

async function withSemanticContext(testCase: PublicBenchmarkCase): Promise<PublicBenchmarkCase> {
  const context = falconSemanticContext(testCase);
  if (!context) return testCase;
  return derivePublicCase(testCase, {
    evidence: [testCase.evidence, context].filter(Boolean).join("\n\n"),
  });
}

async function readManifest(directory: string): Promise<FalconSourceManifest> {
  return falconSourceManifestSchema.parse(
    await readJson(resolve(directory, "source-manifest.json")),
  );
}

export async function verifyFalconBundle(
  directory = defaultFalconDirectory(),
): Promise<FalconBundleVerification> {
  const manifest = await readManifest(directory);
  const verifiedBundles = await Promise.all(
    manifest.files.map(async (file) => ({
      file,
      digest: await sha256File(resolve(directory, file.relative_path)),
    })),
  );
  if (verifiedBundles.some(({ file, digest }) => digest !== file.bundle_sha256)) {
    throw new Error("FALCON_BUNDLE_DIGEST_MISMATCH");
  }
  const fixedFiles = [
    ["public-cases.json", manifest.public_cases_sha256],
    ["sealed/dev-cases.json", manifest.sealed_cases_sha256],
    ["test-cases.json", manifest.test_cases_sha256],
    ["compatibility-fixtures.json", manifest.compatibility_fixtures_sha256],
  ] as const;
  const verifiedFixed = await Promise.all(
    fixedFiles.map(async ([relativePath, expected]) => ({
      relativePath,
      expected,
      actual: await sha256File(resolve(directory, relativePath)),
    })),
  );
  if (verifiedFixed.some((file) => file.actual !== file.expected)) {
    throw new Error("FALCON_MANIFEST_FILE_DIGEST_MISMATCH");
  }
  const sourceMaterial = [
    ...manifest.files.map((file) => `${file.relative_path}:${file.bundle_sha256}`),
    ...verifiedFixed.map((file) => `${file.relativePath}:${file.actual}`),
  ].join("\n");
  const installedDigest =
    `sha256:${createHash("sha256").update(sourceMaterial).digest("hex")}` as const;
  if (installedDigest !== manifest.source_digest) {
    throw new Error("FALCON_SOURCE_DIGEST_MISMATCH");
  }
  const fixtures = z
    .array(compatibilityFixtureSchema)
    .length(5)
    .parse(await readJson(resolve(directory, "compatibility-fixtures.json")));
  await Promise.all(fixtures.map((fixture) => verifyPublicCase(fixture.public_case)));
  return Object.freeze({
    manifest,
    compatibility_fixture_count: 5 as const,
    verified_file_count: manifest.files.length + fixedFiles.length,
    installed_digest: installedDigest,
  });
}

export async function loadFalconPreview(
  directory = defaultFalconDirectory(),
): Promise<FalconPreviewDataset> {
  const verification = await verifyFalconBundle(directory);
  const sourceCases = await Promise.all(
    (await loadSourcePublicCases(directory)).map(withSemanticContext),
  );
  const publicCases = await Promise.all(
    sourceCases
      .filter((testCase) => testCase.registry !== "LOCAL_HOLDOUT")
      .map((testCase) =>
        testCase.registry === "OFFICIAL_TEST_BLIND"
          ? derivePublicCase(testCase, {
              runnable: false,
              status_reason:
                "官方 TEST 仅允许生成提交包；本地不持有 expected result，不能报告准确率。",
            })
          : testCase,
      ),
  );
  const devCases = sourceCases.filter((testCase) => testCase.registry !== "OFFICIAL_TEST_BLIND");
  const testCases = sourceCases.filter((testCase) => testCase.registry === "OFFICIAL_TEST_BLIND");
  if (
    devCases.length !== FALCON_DEV_CASE_COUNT ||
    testCases.length !== FALCON_TEST_CASE_COUNT ||
    new Set(sourceCases.map((testCase) => testCase.case_id)).size !== FALCON_CASE_COUNT ||
    new Set(sourceCases.map((testCase) => testCase.database_id)).size !== FALCON_DATABASE_COUNT
  ) {
    throw new Error("FALCON_PUBLIC_CASE_SET_INVALID");
  }
  const mainDemoCases = publicCases.filter(
    (testCase) => testCase.database_id === "falcon_db_24" && testCase.registry === "DEMO",
  );
  const smokeCases = publicCases.filter(
    (testCase) =>
      testCase.database_id === "falcon_db_14" && testCase.registry !== "OFFICIAL_TEST_BLIND",
  );
  if (mainDemoCases.length !== 10 || smokeCases.length !== 32) {
    throw new Error("FALCON_DEMO_CASE_SET_INVALID");
  }
  return Object.freeze({
    manifest: verification.manifest,
    public_cases: Object.freeze(publicCases),
    main_demo_cases: Object.freeze(mainDemoCases),
    smoke_cases: Object.freeze(smokeCases),
  });
}

/** Server/Worker-only. Public routes must use loadFalconPreview. */
export async function loadFalconDevDataset(
  directory = defaultFalconDirectory(),
): Promise<FalconDevDataset> {
  const preview = await loadFalconPreview(directory);
  const sourceCases = await Promise.all(
    (await loadSourcePublicCases(directory)).map(withSemanticContext),
  );
  const devCases = await Promise.all(
    sourceCases
      .filter((testCase) => testCase.registry !== "OFFICIAL_TEST_BLIND")
      .map((testCase) =>
        testCase.registry === "LOCAL_HOLDOUT"
          ? derivePublicCase(testCase, { registry: "TUNING" })
          : testCase,
      ),
  );
  const sealedCases = z
    .array(sealedFalconCaseSchema)
    .length(FALCON_DEV_CASE_COUNT)
    .parse(await readJson(resolve(directory, "sealed/dev-cases.json")));
  const publicById = new Map(devCases.map((testCase) => [testCase.case_id, testCase]));
  for (const sealedCase of sealedCases) {
    const publicCase = publicById.get(sealedCase.public_case.case_id);
    if (!publicCase || publicCase.registry === "OFFICIAL_TEST_BLIND") {
      throw new Error("FALCON_SEALED_CASE_SCOPE_INVALID");
    }
    const { sealed_case_hash: expected, ...material } = sealedCase;
    if ((await sha256ContentHash(material)) !== expected) {
      throw new Error(`FALCON_SEALED_CASE_DIGEST_MISMATCH:${publicCase.case_id}`);
    }
  }
  return Object.freeze({
    ...preview,
    public_cases: Object.freeze(devCases),
    main_demo_cases: Object.freeze(
      devCases.filter(
        (testCase) => testCase.database_id === "falcon_db_24" && testCase.registry === "DEMO",
      ),
    ),
    smoke_cases: Object.freeze(
      devCases.filter((testCase) => testCase.database_id === "falcon_db_14"),
    ),
    sealed_cases: Object.freeze(sealedCases),
    installed_digest: preview.manifest.source_digest as `sha256:${string}`,
  });
}

export async function loadFalconTestCases(
  directory = defaultFalconDirectory(),
): Promise<readonly PublicBenchmarkCase[]> {
  const preview = await loadFalconPreview(directory);
  const testCases = z
    .array(publicBenchmarkCaseSchema)
    .length(FALCON_TEST_CASE_COUNT)
    .parse(await readJson(resolve(directory, "test-cases.json")));
  const previewIds = new Set(
    preview.public_cases
      .filter((testCase) => testCase.registry === "OFFICIAL_TEST_BLIND")
      .map((testCase) => testCase.case_id),
  );
  if (testCases.some((testCase) => !previewIds.has(testCase.case_id))) {
    throw new Error("FALCON_TEST_CASE_SET_INVALID");
  }
  return Object.freeze(testCases);
}
