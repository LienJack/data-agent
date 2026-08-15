import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const attestationSchema = z.strictObject({
  schema_version: z.literal("python-sandbox-attestation@1.0.0"),
  python_version: z.literal("3.12.10"),
  sdk_version: z.literal("data-agent-sandbox-sdk@1.0.0"),
  policy_version: z.literal("python-policy@1.0.0"),
  base_image_digest: digestSchema,
  dependency_lock_digest: digestSchema,
  requirements_lock_digest: digestSchema,
  runtime_digest: digestSchema,
  hardening_profile: z.literal(
    "network-none,read-only-root,no-new-privileges,cap-kill,setgid,setuid,ipc-setgid-v1",
  ),
  image_attestation_digest: digestSchema,
});

const hash = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const root = resolve(process.cwd());
const runtimeDirectory = resolve(root, "services/sandbox/src/data_agent_sandbox/python_runtime");
const runtimePaths = [
  "services/sandbox/src/data_agent_sandbox/__main__.py",
  ...(await readdir(runtimeDirectory))
    .filter((name) => name.endsWith(".py"))
    .sort()
    .map((name) => `services/sandbox/src/data_agent_sandbox/python_runtime/${name}`),
];
const attestation = attestationSchema.parse(
  JSON.parse(await readFile(resolve(root, "infra/docker/python-sandbox-attestation.json"), "utf8")),
);
const sourceRows = await Promise.all(
  runtimePaths.map(async (path) => `${path}:${hash(await readFile(resolve(root, path))).slice(7)}`),
);
const runtimeDigest = hash(
  [
    "python-sandbox-runtime@1.0.0",
    `python=${attestation.python_version}`,
    `sdk=${attestation.sdk_version}`,
    `policy=${attestation.policy_version}`,
    ...sourceRows,
  ].join("\n"),
);
const dependencyLockDigest = hash(await readFile(resolve(root, "services/sandbox/uv.lock")));
const requirementsLockDigest = hash(
  await readFile(resolve(root, "infra/docker/python-sandbox-requirements.lock")),
);
const imageDigest = hash(
  [
    "python-sandbox-image-attestation@1.0.0",
    `base=${attestation.base_image_digest}`,
    `runtime=${runtimeDigest}`,
    `dependency_lock=${dependencyLockDigest}`,
    `requirements_lock=${requirementsLockDigest}`,
    `hardening=${attestation.hardening_profile}`,
  ].join("\n"),
);
const expected = {
  dependency_lock_digest: dependencyLockDigest,
  requirements_lock_digest: requirementsLockDigest,
  runtime_digest: runtimeDigest,
  image_attestation_digest: imageDigest,
};
for (const [key, value] of Object.entries(expected)) {
  if (attestation[key as keyof typeof attestation] !== value) {
    throw new Error(`PYTHON_SANDBOX_ATTESTATION_MISMATCH:${key}`);
  }
}
const [dockerfile, compose, smoke] = await Promise.all([
  readFile(resolve(root, "infra/docker/Dockerfile.python-sandbox"), "utf8"),
  readFile(resolve(root, "compose.yaml"), "utf8"),
  readFile(resolve(root, "services/sandbox/tests/python_container_smoke.py"), "utf8"),
]);
for (const [name, value, documents] of [
  ["runtime_digest", runtimeDigest, [dockerfile, compose, smoke]],
  ["dependency_lock_digest", dependencyLockDigest, [dockerfile, compose, smoke]],
  ["image_attestation_digest", imageDigest, [dockerfile]],
] as const) {
  if (documents.some((document) => !document.includes(value))) {
    throw new Error(`PYTHON_SANDBOX_ATTESTATION_BINDING_MISSING:${name}`);
  }
}
process.stdout.write(`${JSON.stringify({ terminal: "VERIFIED", ...expected }, null, 2)}\n`);
