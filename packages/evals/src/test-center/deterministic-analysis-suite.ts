import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const frontierSchema = z.strictObject({
  semantic_release_id: z.uuid(),
  semantic_release_hash: hashSchema,
  schema_snapshot_hash: hashSchema,
  policy_receipt_hash: hashSchema,
});
const publicCaseSchema = z.strictObject({
  case_id: z.uuid(),
  slug: z.string().min(1),
  title: z.string().min(1),
  question: z.string().min(1),
  required_skills: z.array(z.string().min(1)).min(1),
  expected_evidence_level: z.enum(["L2_OBSERVATION", "L4_DISCOVERY", "L5_CERTIFIED"]),
  semantic_frontier: frontierSchema,
  dataset_version: z.literal("adb-ecommerce-bounded-v1"),
  public_case_hash: hashSchema,
});
const sealedCaseSchema = z.strictObject({
  public_case_hash: hashSchema,
  query_evidence_hashes: z.array(hashSchema).min(1),
  golden_result_hashes: z.array(hashSchema).min(1),
  hard_failures: z.array(z.string().min(1)).min(1),
  adversarial_cases: z.array(z.string().min(1)).min(1),
  expected_terminal: z.enum(["READY", "L4_DISCOVERY", "L5_CERTIFIED"]),
  sealed_case_hash: hashSchema,
});
const manifestSchema = z.strictObject({
  schema_version: z.literal("ecommerce-deterministic-analysis-suite@1.0.0"),
  suite_version: z.literal("1.0.0"),
  algorithm_versions: z.record(z.string(), z.string().min(1)),
  case_count: z.literal(8),
  public_cases_hash: hashSchema,
  sealed_cases_hash: hashSchema,
  minimum_score: z.literal(100),
  hard_fail_on_any_case: z.literal(true),
  readiness: z.literal("HOLD"),
  readiness_reason: z.string().min(1),
  manifest_hash: hashSchema,
});

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadEcommerceDeterministicAnalysisSuite(
  directory = [
    resolve("infra/agenticdatabench/ecommerce-v1/deterministic-analysis-suite"),
    resolve("../../infra/agenticdatabench/ecommerce-v1/deterministic-analysis-suite"),
  ].find(existsSync) ?? resolve("infra/agenticdatabench/ecommerce-v1/deterministic-analysis-suite"),
) {
  const [manifestRaw, publicRaw, sealedRaw] = await Promise.all([
    readFile(resolve(directory, "manifest.json"), "utf8"),
    readFile(resolve(directory, "public-cases.json"), "utf8"),
    readFile(resolve(directory, "sealed/sealed-cases.json"), "utf8"),
  ]);
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw));
  const publicCases = z.array(publicCaseSchema).length(8).parse(JSON.parse(publicRaw));
  const sealedCases = z.array(sealedCaseSchema).length(8).parse(JSON.parse(sealedRaw));
  const { manifest_hash: _manifestHash, ...manifestMaterial } = manifest;
  if (
    digest(publicCases) !== manifest.public_cases_hash ||
    digest(sealedCases) !== manifest.sealed_cases_hash ||
    digest(manifestMaterial) !== manifest.manifest_hash ||
    publicCases.some(
      ({ public_case_hash, ...material }) => digest(material) !== public_case_hash,
    ) ||
    sealedCases.some(
      ({ sealed_case_hash, ...material }) => digest(material) !== sealed_case_hash,
    ) ||
    publicCases.some(
      ({ public_case_hash }) =>
        !sealedCases.some((sealedCase) => sealedCase.public_case_hash === public_case_hash),
    )
  ) {
    throw new TypeError("ECOMMERCE_DETERMINISTIC_ANALYSIS_SUITE_DIGEST_MISMATCH");
  }
  return Object.freeze({ manifest, public_cases: publicCases, sealed_cases: sealedCases });
}
