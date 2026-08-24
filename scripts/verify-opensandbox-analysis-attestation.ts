import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "../packages/contracts/src/generated/statistical-operators.js";

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const fileBindingSchema = z.strictObject({ path: z.string().min(1), sha256: hashSchema });
const attestationSchema = z.strictObject({
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const attestation = attestationSchema.parse(
  JSON.parse(
    readFileSync(resolve(root, "infra/docker/opensandbox-analysis-attestation.json"), "utf8"),
  ),
);

function sha256(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex")}`;
}

function assertBinding(path: string, expected: string): void {
  if (sha256(path) !== expected) throw new TypeError(`OPENSANDBOX_ATTESTATION_MISMATCH:${path}`);
}

const workerManifest = JSON.parse(
  readFileSync(resolve(root, "apps/worker/package.json"), "utf8"),
) as {
  dependencies: Record<string, string>;
};
if (
  workerManifest.dependencies["@alibaba-group/opensandbox"] !== attestation.sdk.opensandbox ||
  workerManifest.dependencies["@alibaba-group/opensandbox-code-interpreter"] !==
    attestation.sdk.code_interpreter
) {
  throw new TypeError("OPENSANDBOX_SDK_ATTESTATION_MISMATCH");
}
assertBinding(attestation.agent_dockerfile.path, attestation.agent_dockerfile.sha256);
for (const profile of Object.values(attestation.profiles)) {
  assertBinding(profile.lock_path, profile.lock_sha256);
}
assertBinding(attestation.operator.dockerfile_path, attestation.operator.dockerfile_sha256);
assertBinding(attestation.operator.manifest_path, attestation.operator.manifest_sha256);
if (attestation.operator.registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST) {
  throw new TypeError("OPENSANDBOX_OPERATOR_REGISTRY_ATTESTATION_MISMATCH");
}
if (Object.keys(attestation.local_probe.profile_counts).length !== 3) {
  throw new TypeError("OPENSANDBOX_PROFILE_COUNT_ATTESTATION_INCOMPLETE");
}
const dockerfiles = [
  readFileSync(resolve(root, attestation.agent_dockerfile.path), "utf8"),
  readFileSync(resolve(root, attestation.operator.dockerfile_path), "utf8"),
];
if (dockerfiles.some((source) => !source.includes(`FROM ${attestation.base_image}`))) {
  throw new TypeError("OPENSANDBOX_BASE_IMAGE_ATTESTATION_MISMATCH");
}

process.stdout.write(
  `${JSON.stringify({
    schema_version: attestation.schema_version,
    source_commit: attestation.opensandbox_source.commit,
    registered_profiles: Object.keys(attestation.profiles).sort(),
    operator_registry_digest: attestation.operator.registry_digest,
    local_probe: attestation.local_probe,
    production_gate: attestation.production_gate,
  })}\n`,
);
