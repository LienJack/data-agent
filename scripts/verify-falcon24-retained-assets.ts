import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  falcon24RetainedLlmConfigSchema,
  verifyFalcon24RetainedAssetsManifest,
} from "../packages/contracts/src/index.js";

function rawHash(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const manifest = await verifyFalcon24RetainedAssetsManifest(
    JSON.parse(
      readFileSync(resolve(root, "infra/falcon/e1/retained-assets-manifest.json"), "utf8"),
    ),
  );
  const llm = falcon24RetainedLlmConfigSchema.parse(
    JSON.parse(
      readFileSync(resolve(root, "infra/falcon/e1/llm-provider-model-profile.json"), "utf8"),
    ),
  );
  const fileReferences = [
    ...manifest.semantics.source_files,
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
  for (const reference of fileReferences) {
    if (rawHash(resolve(root, reference.path)) !== reference.hash) {
      throw new TypeError(`FALCON24_E1_RETAINED_FILE_HASH_INVALID:${reference.path}`);
    }
  }
  if (JSON.stringify(llm.profiles) !== JSON.stringify(manifest.llm.profiles)) {
    throw new TypeError("FALCON24_E1_LLM_MANIFEST_PROJECTION_INVALID");
  }
  process.stdout.write(
    `${JSON.stringify({
      terminal: "READY",
      manifest_hash: manifest.manifest_hash,
      verified_file_count: new Set(fileReferences.map(({ path }) => path)).size,
    })}\n`,
  );
}

await main().catch((error) => {
  const code =
    error instanceof Error && /^[A-Z][A-Z0-9_:/+@.-]+$/u.test(error.message)
      ? error.message
      : "FALCON24_E1_RETAINED_VERIFY_FAILED";
  process.stderr.write(`${JSON.stringify({ terminal: "HOLD", reason_code: code })}\n`);
  process.exitCode = 1;
});
