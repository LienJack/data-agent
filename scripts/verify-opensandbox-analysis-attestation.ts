import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "../packages/contracts/src/generated/statistical-operators.js";
import {
  sha256ContentHash,
  verifyFalcon24RetainedAssetsManifest,
} from "../packages/contracts/src/index.js";

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const fileBindingSchema = z.strictObject({ path: z.string().min(1), sha256: hashSchema });
export const openSandboxAnalysisAttestationSchema = z.strictObject({
  schema_version: z.literal("opensandbox-analysis-attestation@1.0.0"),
  opensandbox_source: z.strictObject({
    repository: z.literal("https://github.com/opensandbox-group/OpenSandbox"),
    commit: z.literal("180554b146dceec254a5b98318c4c6fad056ff6b"),
    server_version: z.literal("0.2.2"),
  }),
  sdk: z.strictObject({
    opensandbox: z.string().min(1),
    code_interpreter: z.string().min(1),
  }),
  base_image: z.string().regex(/^opensandbox\/code-interpreter@sha256:[a-f0-9]{64}$/u),
  agent_dockerfile: fileBindingSchema,
  profiles: z.strictObject({
    CORE_ANALYSIS: z.strictObject({ lock_path: z.string(), lock_sha256: hashSchema }),
    ML_DIAGNOSTIC: z.strictObject({ lock_path: z.string(), lock_sha256: hashSchema }),
    CAUSAL_L5: z.strictObject({ lock_path: z.string(), lock_sha256: hashSchema }),
  }),
  operator: z.strictObject({
    dockerfile_path: z.string(),
    dockerfile_sha256: hashSchema,
    manifest_path: z.string(),
    manifest_sha256: hashSchema,
    registry_digest: hashSchema,
  }),
  local_probe: z.strictObject({
    status: z.literal("PASS"),
    endpoint_mode: z.literal("DIRECT"),
    use_server_proxy: z.literal(false),
    pids_limit: z.number().int().min(128),
    secure_access: z.literal(false),
    production_isolation_proven: z.literal(false),
    known_rejected_configuration: z.strictObject({
      pids_limit: z.literal(32),
      failure: z.literal("RuntimeError: can't start new thread"),
    }),
    profile_counts: z.record(
      z.enum(["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]),
      z.strictObject({
        status: z.literal("PASS"),
        sandbox: z.strictObject({
          before: z.literal(0),
          peak: z.literal(2),
          after: z.literal(0),
        }),
        egress: z.strictObject({
          before: z.literal(0),
          peak: z.literal(2),
          after: z.literal(0),
        }),
      }),
    ),
  }),
  production_gate: z.strictObject({
    decision: z.literal("HOLD"),
    required_runtime: z.literal("KATA_OR_GVISOR_WITH_CILIUM"),
    release_image_digests_required: z.literal(true),
  }),
});

function sha256(root: string, path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex")}`;
}

function assertBinding(root: string, path: string, expected: string): void {
  if (sha256(root, path) !== expected) {
    throw new TypeError(`OPENSANDBOX_ATTESTATION_MISMATCH:${path}`);
  }
}

export async function verifyOpenSandboxAnalysisAttestation(
  repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
) {
  const attestationPath = "infra/docker/opensandbox-analysis-attestation.json";
  const retainedPath = "infra/falcon/e1/retained-assets-manifest.json";
  const attestation = openSandboxAnalysisAttestationSchema.parse(
    JSON.parse(readFileSync(resolve(repositoryRoot, attestationPath), "utf8")),
  );
  const retained = await verifyFalcon24RetainedAssetsManifest(
    JSON.parse(readFileSync(resolve(repositoryRoot, retainedPath), "utf8")),
  );
  const attestationHash = sha256(repositoryRoot, attestationPath);
  if (attestationHash !== retained.analysis_runtime.attestation_hash) {
    throw new TypeError("OPENSANDBOX_RETAINED_ATTESTATION_HASH_MISMATCH");
  }

  const workerManifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, "apps/worker/package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  if (
    workerManifest.dependencies["@alibaba-group/opensandbox"] !== attestation.sdk.opensandbox ||
    workerManifest.dependencies["@alibaba-group/opensandbox-code-interpreter"] !==
      attestation.sdk.code_interpreter
  ) {
    throw new TypeError("OPENSANDBOX_SDK_ATTESTATION_MISMATCH");
  }
  assertBinding(
    repositoryRoot,
    attestation.agent_dockerfile.path,
    attestation.agent_dockerfile.sha256,
  );
  for (const profile of Object.values(attestation.profiles)) {
    assertBinding(repositoryRoot, profile.lock_path, profile.lock_sha256);
  }
  assertBinding(
    repositoryRoot,
    attestation.operator.dockerfile_path,
    attestation.operator.dockerfile_sha256,
  );
  assertBinding(
    repositoryRoot,
    attestation.operator.manifest_path,
    attestation.operator.manifest_sha256,
  );
  if (
    attestation.operator.registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST ||
    attestation.operator.registry_digest !== retained.analysis_runtime.operator_registry_digest ||
    attestation.operator.manifest_sha256 !== retained.analysis_runtime.operator_manifest_hash
  ) {
    throw new TypeError("OPENSANDBOX_OPERATOR_REGISTRY_ATTESTATION_MISMATCH");
  }
  if (Object.keys(attestation.local_probe.profile_counts).length !== 3) {
    throw new TypeError("OPENSANDBOX_PROFILE_COUNT_ATTESTATION_INCOMPLETE");
  }
  const dockerfiles = [
    readFileSync(resolve(repositoryRoot, attestation.agent_dockerfile.path), "utf8"),
    readFileSync(resolve(repositoryRoot, attestation.operator.dockerfile_path), "utf8"),
  ];
  if (dockerfiles.some((source) => !source.includes(`FROM ${attestation.base_image}`))) {
    throw new TypeError("OPENSANDBOX_BASE_IMAGE_ATTESTATION_MISMATCH");
  }
  for (const source of retained.analysis_runtime.source_files) {
    assertBinding(repositoryRoot, source.path, source.hash);
  }
  if (
    (await sha256ContentHash(retained.analysis_runtime.source_files)) !==
    retained.analysis_runtime.source_bundle_hash
  ) {
    throw new TypeError("OPENSANDBOX_RUNTIME_SOURCE_BUNDLE_MISMATCH");
  }
  const evidenceHash = await sha256ContentHash({
    attestation_hash: attestationHash,
    source_files: retained.analysis_runtime.source_files,
    sdk: attestation.sdk,
    base_image: attestation.base_image,
    production_gate: attestation.production_gate,
    local_probe: attestation.local_probe,
  });
  return Object.freeze({
    schema_version: "falcon24-e1-runtime-attestation-proof@1.0.0" as const,
    attestation_hash: attestationHash,
    operator_manifest_hash: attestation.operator.manifest_sha256,
    operator_registry_digest: attestation.operator.registry_digest,
    source_bundle_hash: retained.analysis_runtime.source_bundle_hash,
    attestation_evidence_hash: evidenceHash,
    production_gate: attestation.production_gate.decision,
    production_isolation_proven: attestation.local_probe.production_isolation_proven,
  });
}

async function main(): Promise<void> {
  process.stdout.write(`${JSON.stringify(await verifyOpenSandboxAnalysisAttestation())}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
