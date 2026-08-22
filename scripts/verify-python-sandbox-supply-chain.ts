import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const profileNames = ["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"] as const;
const profileSchema = z.strictObject({
  lock_path: z.string().min(1),
  lock_digest: digestSchema,
  image_attestation_digest: digestSchema,
  package_count: z.number().int().positive(),
  cve_scan: z.strictObject({
    status: z.literal("PASS"),
    known_vulnerability_count: z.literal(0),
  }),
  license_scan: z.strictObject({
    status: z.literal("REVIEW_REQUIRED"),
    unresolved_packages: z.array(z.string().min(1)).min(1),
  }),
});
const schema = z.strictObject({
  schema_version: z.literal("python-sandbox-supply-chain@1.0.0"),
  generated_at: z.iso.datetime(),
  base_image_digest: digestSchema,
  target_platform: z.literal("linux/arm64"),
  scanner: z.strictObject({
    name: z.literal("pip-audit"),
    version: z.literal("2.10.1"),
    mode: z.literal("locked-requirements,no-deps,disable-pip"),
  }),
  profiles: z.strictObject({
    CORE_ANALYSIS: profileSchema,
    ML_DIAGNOSTIC: profileSchema,
    CAUSAL_L5: profileSchema,
  }),
  sbom_hash: digestSchema,
  attestation_hash: digestSchema,
});

const hash = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("unsupported canonical JSON value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const root = resolve(process.cwd());
const path = resolve(root, "infra/docker/python-sandbox-supply-chain-attestation.json");
const attestation = schema.parse(JSON.parse(await readFile(path, "utf8")));
const sbomRows: string[] = [];
for (const profileName of profileNames) {
  const profile = attestation.profiles[profileName];
  const lock = await readFile(resolve(root, profile.lock_path));
  const lockDigest = hash(lock);
  const packageCount = (lock.toString("utf8").match(/^[a-z0-9][a-z0-9._-]*==/gimu) ?? []).length;
  if (profile.lock_digest !== lockDigest || profile.package_count !== packageCount) {
    throw new Error(`PYTHON_SUPPLY_CHAIN_SBOM_MISMATCH:${profileName}`);
  }
  if (!lock.toString("utf8").includes("pyarrow==23.0.1")) {
    throw new Error(`PYTHON_SUPPLY_CHAIN_PYARROW_REMEDIATION_MISSING:${profileName}`);
  }
  sbomRows.push(`${profile.lock_path}:${lockDigest}`);
}
const sbomHash = hash(sbomRows.join("\n"));
const { attestation_hash: _attestationHash, ...facts } = attestation;
const attestationHash = hash(canonicalJson(facts));
if (attestation.sbom_hash !== sbomHash || attestation.attestation_hash !== attestationHash) {
  throw new Error(
    `PYTHON_SUPPLY_CHAIN_ATTESTATION_MISMATCH:${JSON.stringify({ sbomHash, attestationHash })}`,
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      terminal: "VERIFIED_WITH_LICENSE_REVIEW",
      schema_version: attestation.schema_version,
      sbom_hash: sbomHash,
      attestation_hash: attestationHash,
      cve_scan_status: "PASS",
      license_scan_status: "REVIEW_REQUIRED",
    },
    null,
    2,
  )}\n`,
);
