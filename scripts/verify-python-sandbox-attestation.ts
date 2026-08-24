import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const profileNames = ["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"] as const;
const profileSchema = z.strictObject({
  dependency_lock_digest: digestSchema,
  operator_registry_digest: digestSchema,
  runtime_digest: digestSchema,
  image_attestation_digest: digestSchema,
});
const attestationSchema = z.strictObject({
  schema_version: z.literal("python-sandbox-attestation@2.0.0"),
  python_version: z.literal("3.12.10"),
  target_platform: z.literal("linux/arm64"),
  sdk_version: z.literal("data-agent-sandbox-sdk@1.0.0"),
  policy_version: z.literal("python-policy@1.0.0"),
  base_image_digest: digestSchema,
  source_lock_digest: digestSchema,
  hardening_profile: z.literal(
    "network-none,read-only-root,no-new-privileges,cap-kill,setgid,setuid,ipc-setgid-v1,single-thread-numerics,pythonhashseed0",
  ),
  profiles: z.strictObject({
    CORE_ANALYSIS: profileSchema,
    ML_DIAGNOSTIC: profileSchema,
    CAUSAL_L5: profileSchema,
  }),
});

const hash = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const root = resolve(process.cwd());
const runtimeDirectory = resolve(root, "services/sandbox/src/data_agent_sandbox/python_runtime");
const runtimeEntries = await readdir(runtimeDirectory, { recursive: true });
const runtimePaths = [
  "services/sandbox/src/data_agent_sandbox/__main__.py",
  ...runtimeEntries
    .filter((name) => name.endsWith(".py") || name === "operators/manifest.json")
    .sort()
    .map((name) => `services/sandbox/src/data_agent_sandbox/python_runtime/${name}`),
];
const attestation = attestationSchema.parse(
  JSON.parse(await readFile(resolve(root, "infra/docker/python-sandbox-attestation.json"), "utf8")),
);
const sourceRows = await Promise.all(
  runtimePaths.map(async (path) => `${path}:${hash(await readFile(resolve(root, path))).slice(7)}`),
);
const operatorManifestSource = await readFile(resolve(runtimeDirectory, "operators/manifest.json"));
const operatorManifest = z
  .object({
    operators: z.array(
      z.object({
        implementation: z.strictObject({ module: z.string().min(1), symbol: z.string().min(1) }),
      }),
    ),
  })
  .parse(JSON.parse(operatorManifestSource.toString("utf8")));
const operatorRegistryRows = [
  "statistical-operator-registry@1.0.0",
  `manifest=${hash(operatorManifestSource)}`,
  ...(await Promise.all(
    operatorManifest.operators.map(async ({ implementation }) => {
      const prefix = "data_agent_sandbox.python_runtime.operators.";
      if (!implementation.module.startsWith(prefix)) {
        throw new Error("PYTHON_OPERATOR_IMPLEMENTATION_PATH_INVALID");
      }
      const moduleName = implementation.module.slice(prefix.length);
      if (!/^[a-z][a-z0-9_]*$/u.test(moduleName)) {
        throw new Error("PYTHON_OPERATOR_IMPLEMENTATION_PATH_INVALID");
      }
      const source = await readFile(resolve(runtimeDirectory, `operators/${moduleName}.py`));
      return `implementation=${implementation.module}:${implementation.symbol}:${hash(source)}`;
    }),
  )),
].sort();
const operatorRegistryDigest = hash(operatorRegistryRows.join("\n"));
const sourceLockDigest = hash(await readFile(resolve(root, "services/sandbox/uv.lock")));
const lockPath = {
  CORE_ANALYSIS: "infra/docker/python-sandbox-requirements.lock",
  ML_DIAGNOSTIC: "infra/docker/python-sandbox-requirements.ml.lock",
  CAUSAL_L5: "infra/docker/python-sandbox-requirements.causal.lock",
} as const;
const dockerfilePath = {
  CORE_ANALYSIS: "infra/docker/Dockerfile.python-sandbox",
  ML_DIAGNOSTIC: "infra/docker/Dockerfile.python-sandbox-ml",
  CAUSAL_L5: "infra/docker/Dockerfile.python-sandbox-causal",
} as const;
const expectedProfiles = Object.fromEntries(
  await Promise.all(
    profileNames.map(async (profile) => {
      const dependencyLockDigest = hash(await readFile(resolve(root, lockPath[profile])));
      const runtimeDigest = hash(
        [
          "python-sandbox-runtime@2.0.0",
          `profile=${profile}`,
          `python=${attestation.python_version}`,
          `platform=${attestation.target_platform}`,
          `sdk=${attestation.sdk_version}`,
          `policy=${attestation.policy_version}`,
          `operator_registry=${operatorRegistryDigest}`,
          ...sourceRows,
        ].join("\n"),
      );
      const imageAttestationDigest = hash(
        [
          "python-sandbox-image-attestation@2.0.0",
          `profile=${profile}`,
          `base=${attestation.base_image_digest}`,
          `runtime=${runtimeDigest}`,
          `operator_registry=${operatorRegistryDigest}`,
          `source_lock=${sourceLockDigest}`,
          `dependency_lock=${dependencyLockDigest}`,
          `hardening=${attestation.hardening_profile}`,
        ].join("\n"),
      );
      return [
        profile,
        {
          dependency_lock_digest: dependencyLockDigest,
          operator_registry_digest: operatorRegistryDigest,
          runtime_digest: runtimeDigest,
          image_attestation_digest: imageAttestationDigest,
        },
      ];
    }),
  ),
) as Record<(typeof profileNames)[number], z.infer<typeof profileSchema>>;

const expected = { source_lock_digest: sourceLockDigest, profiles: expectedProfiles };
if (
  attestation.source_lock_digest !== sourceLockDigest ||
  profileNames.some(
    (profile) =>
      JSON.stringify(attestation.profiles[profile]) !== JSON.stringify(expectedProfiles[profile]),
  )
) {
  throw new Error(`PYTHON_SANDBOX_ATTESTATION_MISMATCH:${JSON.stringify(expected)}`);
}

for (const profile of profileNames) {
  const dockerfile = await readFile(resolve(root, dockerfilePath[profile]), "utf8");
  const expectedProfile = expectedProfiles[profile];
  for (const [name, value] of Object.entries(expectedProfile)) {
    if (!dockerfile.includes(value)) {
      throw new Error(`PYTHON_SANDBOX_ATTESTATION_BINDING_MISSING:${profile}:${name}`);
    }
  }
  if (!dockerfile.includes(`PYTHON_SANDBOX_IMPORT_PROFILE=${profile}`)) {
    throw new Error(`PYTHON_SANDBOX_PROFILE_BINDING_MISSING:${profile}`);
  }
  if (!dockerfile.includes(`PYTHON_SANDBOX_TARGET_PLATFORM=${attestation.target_platform}`)) {
    throw new Error(`PYTHON_SANDBOX_PLATFORM_BINDING_MISSING:${profile}`);
  }
  for (const name of [
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "BLIS_NUM_THREADS",
  ]) {
    if (!dockerfile.includes(`${name}=1`)) {
      throw new Error(`PYTHON_SANDBOX_NUMERIC_THREAD_BINDING_MISSING:${profile}:${name}`);
    }
  }
}

const [compose, smoke, skillCatalog, generatedContract] = await Promise.all([
  readFile(resolve(root, "compose.yaml"), "utf8"),
  readFile(resolve(root, "services/sandbox/tests/python_container_smoke.py"), "utf8"),
  readFile(resolve(root, "apps/worker/src/analysis/skill-catalog.ts"), "utf8"),
  readFile(resolve(root, "packages/contracts/src/generated/statistical-operators.ts"), "utf8"),
]);
for (const profile of ["CORE_ANALYSIS", "ML_DIAGNOSTIC"] as const) {
  for (const value of Object.values(expectedProfiles[profile])) {
    if (!compose.includes(value)) {
      throw new Error(`PYTHON_SANDBOX_COMPOSE_BINDING_MISSING:${profile}`);
    }
  }
}
for (const value of Object.values(expectedProfiles.CORE_ANALYSIS)) {
  if (!smoke.includes(value)) {
    throw new Error("PYTHON_SANDBOX_CORE_BINDING_MISSING");
  }
}
for (const profile of profileNames) {
  for (const [name, value] of Object.entries(expectedProfiles[profile])) {
    if (name === "operator_registry_digest") continue;
    if (!skillCatalog.includes(value)) {
      throw new Error(`PYTHON_SANDBOX_WORKER_BINDING_MISSING:${profile}`);
    }
  }
}
if (
  !generatedContract.includes("export const STATISTICAL_OPERATOR_REGISTRY_DIGEST =") ||
  !generatedContract.includes(`"${operatorRegistryDigest}" as const`) ||
  !skillCatalog.includes("STATISTICAL_OPERATOR_REGISTRY_DIGEST")
) {
  throw new Error("PYTHON_SANDBOX_OPERATOR_REGISTRY_PROJECTION_MISSING");
}
process.stdout.write(`${JSON.stringify({ terminal: "VERIFIED", ...expected }, null, 2)}\n`);
