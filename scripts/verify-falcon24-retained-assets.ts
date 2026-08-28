import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  falcon24RetainedLlmConfigSchema,
  verifyFalcon24RetainedAssetsManifest,
} from "../packages/contracts/src/index.js";

const RETAINED_MANIFEST_PATH = "infra/falcon/e1/retained-assets-manifest.json";

export interface Falcon24RetainedAssetHistoryReader {
  readonly resolveManifestIntroductionCommit: (relativePath: string) => string;
  readonly readCurrentFile: (relativePath: string) => Buffer;
  readonly readFileAtCommit: (commit: string, relativePath: string) => Buffer;
}

function rawHash(content: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function stableRead(reader: () => Buffer, reasonCode: string, relativePath: string): Buffer {
  try {
    return reader();
  } catch {
    throw new TypeError(`${reasonCode}:${relativePath}`);
  }
}

export function createGitRetainedAssetHistoryReader(
  repositoryRoot: string,
): Falcon24RetainedAssetHistoryReader {
  const root = resolve(repositoryRoot);
  return Object.freeze({
    resolveManifestIntroductionCommit: (relativePath: string) => {
      const commits = execFileSync(
        "git",
        ["log", "--diff-filter=A", "--follow", "--format=%H", "--", relativePath],
        { cwd: root, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      const commit = commits[0];
      if (commits.length !== 1 || !commit || !/^[a-f0-9]{40}$/u.test(commit)) {
        throw new TypeError("FALCON24_E1_RETAINED_MANIFEST_HISTORY_INVALID");
      }
      return commit;
    },
    readCurrentFile: (relativePath: string) => readFileSync(resolve(root, relativePath)),
    readFileAtCommit: (commit: string, relativePath: string) =>
      execFileSync("git", ["show", `${commit}:${relativePath}`], {
        cwd: root,
        maxBuffer: 20 * 1024 * 1024,
      }),
  });
}

export async function verifyFalcon24RetainedAssets(
  repositoryRoot = resolve(process.cwd()),
  historyReader: Falcon24RetainedAssetHistoryReader = createGitRetainedAssetHistoryReader(
    repositoryRoot,
  ),
) {
  const currentManifestBytes = stableRead(
    () => historyReader.readCurrentFile(RETAINED_MANIFEST_PATH),
    "FALCON24_E1_RETAINED_CURRENT_FILE_MISSING",
    RETAINED_MANIFEST_PATH,
  );
  const manifest = await verifyFalcon24RetainedAssetsManifest(
    JSON.parse(currentManifestBytes.toString("utf8")),
  );
  const manifestOriginCommit =
    historyReader.resolveManifestIntroductionCommit(RETAINED_MANIFEST_PATH);
  const historicalManifestBytes = stableRead(
    () => historyReader.readFileAtCommit(manifestOriginCommit, RETAINED_MANIFEST_PATH),
    "FALCON24_E1_RETAINED_HISTORICAL_FILE_MISSING",
    RETAINED_MANIFEST_PATH,
  );
  if (!currentManifestBytes.equals(historicalManifestBytes)) {
    throw new TypeError("FALCON24_E1_RETAINED_MANIFEST_BYTES_DRIFT");
  }

  const currentSemanticDriftFiles: string[] = [];
  for (const reference of manifest.semantics.source_files) {
    const historicalBytes = stableRead(
      () => historyReader.readFileAtCommit(manifestOriginCommit, reference.path),
      "FALCON24_E1_RETAINED_HISTORICAL_FILE_MISSING",
      reference.path,
    );
    if (rawHash(historicalBytes) !== reference.hash) {
      throw new TypeError(`FALCON24_E1_RETAINED_HISTORICAL_SOURCE_HASH_INVALID:${reference.path}`);
    }
    const currentBytes = stableRead(
      () => historyReader.readCurrentFile(reference.path),
      "FALCON24_E1_RETAINED_CURRENT_FILE_MISSING",
      reference.path,
    );
    if (rawHash(currentBytes) !== reference.hash) currentSemanticDriftFiles.push(reference.path);
  }

  const llm = falcon24RetainedLlmConfigSchema.parse(
    JSON.parse(
      stableRead(
        () => historyReader.readCurrentFile("infra/falcon/e1/llm-provider-model-profile.json"),
        "FALCON24_E1_RETAINED_CURRENT_FILE_MISSING",
        "infra/falcon/e1/llm-provider-model-profile.json",
      ).toString("utf8"),
    ),
  );
  const currentFileReferences = [
    ...manifest.llm.source_files,
    ...manifest.analysis_runtime.source_files,
    { path: manifest.upstream.manifest_path, hash: manifest.upstream.manifest_hash },
    { path: manifest.active_dataset.bundle_path, hash: manifest.active_dataset.bundle_sha256 },
    {
      path: manifest.questions.public_manifest_path,
      hash: manifest.questions.public_manifest_hash,
    },
    {
      path: manifest.questions.sealed_manifest_path,
      hash: manifest.questions.sealed_manifest_hash,
    },
    { path: manifest.questions.test_manifest_path, hash: manifest.questions.test_manifest_hash },
    { path: manifest.llm.manifest_path, hash: manifest.llm.manifest_hash },
    {
      path: manifest.analysis_runtime.operator_manifest_path,
      hash: manifest.analysis_runtime.operator_manifest_hash,
    },
    {
      path: manifest.analysis_runtime.attestation_path,
      hash: manifest.analysis_runtime.attestation_hash,
    },
  ];
  const uniqueCurrentReferences = new Map<string, `sha256:${string}`>();
  for (const reference of currentFileReferences) {
    const existing = uniqueCurrentReferences.get(reference.path);
    if (existing && existing !== reference.hash) {
      throw new TypeError(`FALCON24_E1_RETAINED_REFERENCE_CONFLICT:${reference.path}`);
    }
    uniqueCurrentReferences.set(reference.path, reference.hash);
  }
  for (const [relativePath, expectedHash] of uniqueCurrentReferences) {
    const content = stableRead(
      () => historyReader.readCurrentFile(relativePath),
      "FALCON24_E1_RETAINED_CURRENT_FILE_MISSING",
      relativePath,
    );
    if (rawHash(content) !== expectedHash) {
      throw new TypeError(`FALCON24_E1_RETAINED_CURRENT_FILE_HASH_INVALID:${relativePath}`);
    }
  }
  if (JSON.stringify(llm.profiles) !== JSON.stringify(manifest.llm.profiles)) {
    throw new TypeError("FALCON24_E1_LLM_MANIFEST_PROJECTION_INVALID");
  }
  return Object.freeze({
    terminal: "READY" as const,
    manifest_hash: manifest.manifest_hash,
    manifest_origin_commit: manifestOriginCommit,
    verified_historical_semantic_file_count: manifest.semantics.source_files.length,
    verified_current_retained_file_count: uniqueCurrentReferences.size,
    verified_file_count: manifest.semantics.source_files.length + uniqueCurrentReferences.size,
    current_semantic_drift_files: Object.freeze([...currentSemanticDriftFiles].sort()),
  });
}

async function main(): Promise<void> {
  process.stdout.write(`${JSON.stringify(await verifyFalcon24RetainedAssets())}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const [candidateCode, candidatePath] = message.split(":", 2);
    const reasonCode = /^[A-Z][A-Z0-9_]{2,127}$/u.test(candidateCode ?? "")
      ? candidateCode
      : "FALCON24_E1_RETAINED_VERIFY_FAILED";
    process.stderr.write(
      `${JSON.stringify({
        terminal: "HOLD",
        reason_code: reasonCode,
        ...(candidatePath ? { subject_path: candidatePath } : {}),
      })}\n`,
    );
    process.exitCode = 1;
  });
}
