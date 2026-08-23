import { createHash } from "node:crypto";
import {
  type AnalysisProgramPayload,
  type AnalysisSandboxProgramPayload,
  type ArtifactReference,
  analysisProgramPayloadSchema,
  analysisSandboxProgramPayloadSchema,
  artifactReferenceIdentity,
  canonicalizeJson,
  sha256ContentHash,
} from "@data-agent/contracts";

export type ProgramVerificationFailure =
  | "PROGRAM_SCHEMA_INVALID"
  | "PROGRAM_NODE_NOT_FOUND"
  | "PROGRAM_PLAN_BINDING_MISMATCH"
  | "PROGRAM_SOURCE_HASH_MISMATCH"
  | "PROGRAM_OUTPUT_CONTRACT_MISMATCH"
  | "PROGRAM_OUTPUT_SENSITIVE"
  | "PROGRAM_PROFILE_NOT_ALLOWED"
  | "PROGRAM_RANDOM_SEED_UNBOUND"
  | "PROGRAM_HASH_MISMATCH";

export type ProgramVerification =
  | { ok: true; program: AnalysisSandboxProgramPayload }
  | { ok: false; failures: readonly ProgramVerificationFailure[] };

export async function computeAnalysisSandboxProgramHash(
  program: Omit<AnalysisSandboxProgramPayload, "program_hash">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    hash_domain: "analysis-sandbox-program@2.0.0",
    value: program,
  });
}

export async function verifyAnalysisSandboxProgram(input: {
  analysisProgram: AnalysisProgramPayload;
  analysisProgramRef: ArtifactReference;
  program: AnalysisSandboxProgramPayload;
  sourceText: string;
  allowedProfiles: readonly AnalysisSandboxProgramPayload["import_profile"][];
}): Promise<ProgramVerification> {
  const parsedPlan = analysisProgramPayloadSchema.safeParse(input.analysisProgram);
  const parsedProgram = analysisSandboxProgramPayloadSchema.safeParse(input.program);
  if (!parsedPlan.success || !parsedProgram.success) {
    return { ok: false, failures: ["PROGRAM_SCHEMA_INVALID"] };
  }
  const plan = parsedPlan.data;
  const program = parsedProgram.data;
  const failures: ProgramVerificationFailure[] = [];
  const node = plan.nodes.find(({ node_id }) => node_id === program.node_id);
  if (!node) failures.push("PROGRAM_NODE_NOT_FOUND");
  if (
    artifactReferenceIdentity(program.analysis_program_ref) !==
    artifactReferenceIdentity(input.analysisProgramRef)
  ) {
    failures.push("PROGRAM_PLAN_BINDING_MISMATCH");
  }
  const sourceHash = `sha256:${createHash("sha256").update(input.sourceText, "utf8").digest("hex")}`;
  if (sourceHash !== program.source_sha256) failures.push("PROGRAM_SOURCE_HASH_MISMATCH");
  if (
    node &&
    node.output_contract !== null &&
    canonicalizeJson(node.output_contract) !== canonicalizeJson(program.output_contract)
  ) {
    failures.push("PROGRAM_OUTPUT_CONTRACT_MISMATCH");
  }
  const sensitiveOutputNames = new Set(["raw_rows", "source_rows", "stdout", "stderr", "secrets"]);
  if (
    program.output_contract.outputs.some(({ name }) => sensitiveOutputNames.has(name.toLowerCase()))
  ) {
    failures.push("PROGRAM_OUTPUT_SENSITIVE");
  }
  if (!input.allowedProfiles.includes(program.import_profile)) {
    failures.push("PROGRAM_PROFILE_NOT_ALLOWED");
  }
  const numpyAliases = new Set(["numpy"]);
  for (const match of input.sourceText.matchAll(
    /(?:^|\n)\s*import\s+numpy(?:\s+as\s+([A-Za-z_]\w*))?/gu,
  )) {
    numpyAliases.add(match[1] ?? "numpy");
  }
  const aliases = [...numpyAliases].join("|");
  const globalRandomCall = new RegExp(
    `\\b(?:${aliases})\\.random\\.(?!default_rng\\b)[A-Za-z_]\\w*\\s*\\(`,
    "u",
  ).test(input.sourceText);
  const importedRandomModule = /(?:^|\n)\s*from\s+numpy\s+import\s+[^\n]*\brandom\b/gu.test(
    input.sourceText,
  );
  const seeded = [...input.sourceText.matchAll(/default_rng\(\s*(\d+)\s*\)/gu)].map((match) =>
    Number(match[1]),
  );
  const randomMethodCall = /\.(?:random|rand|randn|choice|shuffle)\s*\(/u.test(input.sourceText);
  if (seeded.length > 0 || randomMethodCall || globalRandomCall || importedRandomModule) {
    if (
      seeded.length !== 1 ||
      seeded[0] !== program.random_seed ||
      globalRandomCall ||
      importedRandomModule
    ) {
      failures.push("PROGRAM_RANDOM_SEED_UNBOUND");
    }
  }
  const { program_hash: observedHash, ...material } = program;
  if ((await computeAnalysisSandboxProgramHash(material)) !== observedHash) {
    failures.push("PROGRAM_HASH_MISMATCH");
  }
  return failures.length === 0 ? { ok: true, program } : { ok: false, failures };
}
