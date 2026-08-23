import { z } from "zod";
import { artifactReferenceFor } from "../artifacts/envelope.js";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

export const FALCON24_AGENT_ANALYSIS_SUITE_VERSION = "falcon24-agent-analysis-suite@1.0.0" as const;
export const FALCON24_AGENT_ANALYSIS_GATE_VERSION = "falcon24-agent-analysis-gate@1.0.0" as const;
export const FALCON24_DEEPSEEK_MODEL = "deepseek-v4-flash" as const;

export const falcon24AnalysisCaseIdSchema = z.enum([
  "falcon24-business-review-18m",
  "falcon24-delivery-experience-12m",
  "falcon24-inventory-damage-12m",
  "falcon24-marketing-lag-effect",
  "falcon24-cohort-retention-m0-m6",
]);

const canonicalMethodsSchema = z
  .array(versionIdentifierSchema)
  .min(1)
  .max(32)
  .superRefine((values, context) => {
    for (let index = 1; index < values.length; index += 1) {
      if ((values[index - 1] ?? "") >= (values[index] ?? "")) {
        context.addIssue({
          code: "custom",
          message: "Methods must be unique and canonically sorted.",
          path: [index],
        });
      }
    }
  });

export const falcon24AgentAnalysisCaseSchema = z.strictObject({
  case_id: falcon24AnalysisCaseIdSchema,
  question: z.string().trim().min(1).max(8_000),
  required_semantic_keys: z.array(z.string().trim().min(1).max(512)).min(1).max(256),
  required_methods: canonicalMethodsSchema,
  required_disclosures: z.array(versionIdentifierSchema).max(32),
  required_quality_findings: z.array(versionIdentifierSchema).max(32),
  expected_terminal: z.enum(["PASS", "HOLD_WITH_SENSITIVITY"]),
  minimum_model_generated_nodes: z.number().int().min(1).max(16),
});

const falcon24AgentAnalysisSuiteMaterialSchema = z.strictObject({
  schema_version: z.literal(FALCON24_AGENT_ANALYSIS_SUITE_VERSION),
  dataset_id: z.literal("falcon_db_24"),
  model_provider: z.literal("deepseek"),
  model_id: z.literal(FALCON24_DEEPSEEK_MODEL),
  execution_surface: z.literal("AGENT"),
  cases: z.array(falcon24AgentAnalysisCaseSchema).length(5),
});

export const falcon24AgentAnalysisSuiteSchema = falcon24AgentAnalysisSuiteMaterialSchema.extend({
  suite_hash: contentHashSchema,
});

export async function buildFalcon24AgentAnalysisSuite(input: unknown) {
  const material = falcon24AgentAnalysisSuiteMaterialSchema.parse(input);
  const ids = new Set(material.cases.map(({ case_id: caseId }) => caseId));
  if (ids.size !== 5) throw new TypeError("FALCON24_ANALYSIS_CASE_DUPLICATE");
  return falcon24AgentAnalysisSuiteSchema.parse({
    ...material,
    suite_hash: await sha256ContentHash(material),
  });
}

const falcon24MethodReceiptSchema = z.strictObject({
  method_id: versionIdentifierSchema,
  status: z.literal("PASS"),
  evidence_hash: contentHashSchema,
});

export const falcon24AnalysisOracleReceiptSchema = z.strictObject({
  schema_version: z.literal("falcon24-analysis-oracle@2.0.0"),
  oracle_kind: z.literal("ARROW_INPUT_RECOMPUTE"),
  case_id: falcon24AnalysisCaseIdSchema,
  verdict: z.literal("PASS"),
  input_hash: contentHashSchema,
  input_materialization_receipt_hash: contentHashSchema,
  query_evidence_hash: contentHashSchema,
  output_hash: contentHashSchema,
  verification_hash: contentHashSchema,
  method_receipts: z.array(falcon24MethodReceiptSchema).min(1).max(32),
  disclosures: z.array(versionIdentifierSchema).max(32),
  quality_findings: z.array(versionIdentifierSchema).max(32),
  terminal: z.enum(["PASS", "HOLD_WITH_SENSITIVITY"]),
  receipt_hash: contentHashSchema,
});

export async function verifyFalcon24AnalysisOracleReceipt(input: unknown) {
  const receipt = falcon24AnalysisOracleReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_ANALYSIS_ORACLE_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export const falcon24AgentAnalysisRunResultSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-agent-analysis-run@2.0.0"),
    case_id: falcon24AnalysisCaseIdSchema,
    run_id: immutableIdSchema,
    run_variant: z.enum(["COLD", "WARM"]),
    repetition: z.number().int().min(1).max(3),
    provider: z.literal("deepseek"),
    model_id: z.literal(FALCON24_DEEPSEEK_MODEL),
    model_override_attempted: z.literal(false),
    provider_invocation_ref: z.strictObject({
      resource_id: immutableIdSchema,
      resource_revision: z.number().int().positive(),
      resource_hash: contentHashSchema,
    }),
    semantic_context_ref: z.strictObject({
      package_id: immutableIdSchema,
      package_revision: z.literal(1),
      package_hash: contentHashSchema,
    }),
    analysis_program_ref: artifactReferenceFor("AnalysisProgram"),
    generated_python_refs: z
      .array(artifactReferenceFor("SensitiveExecutionArtifact"))
      .min(1)
      .max(16),
    sandbox_receipt_refs: z.array(artifactReferenceFor("SandboxExecutionReceipt")).min(1).max(16),
    model_generated_node_count: z.number().int().min(1).max(16),
    oracle_receipt: falcon24AnalysisOracleReceiptSchema,
    sandbox_status: z.literal("SUCCEEDED"),
    answer_hash: contentHashSchema,
    completed_at: timestampSchema,
  })
  .superRefine((result, context) => {
    const authority = result.analysis_program_ref;
    const executionRefs = [...result.generated_python_refs, ...result.sandbox_receipt_refs];
    if (
      authority.run_id !== result.run_id ||
      executionRefs.some(
        (reference) =>
          reference.run_id !== result.run_id ||
          reference.app_id !== authority.app_id ||
          reference.tenant_id !== authority.tenant_id ||
          reference.environment !== authority.environment,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 execution evidence must bind the exact analysis run and scope.",
        path: ["analysis_program_ref"],
      });
    }
    if (
      result.generated_python_refs.length !== result.model_generated_node_count ||
      result.sandbox_receipt_refs.length !== result.model_generated_node_count
    ) {
      context.addIssue({
        code: "custom",
        message: "Every model-generated node requires one source and sandbox receipt.",
        path: ["model_generated_node_count"],
      });
    }
  });

const falcon24AgentAnalysisGateMaterialSchema = z.strictObject({
  schema_version: z.literal(FALCON24_AGENT_ANALYSIS_GATE_VERSION),
  gate_id: immutableIdSchema,
  suite_hash: contentHashSchema,
  provider: z.literal("deepseek"),
  model_id: z.literal(FALCON24_DEEPSEEK_MODEL),
  case_count: z.literal(5),
  accepted_case_count: z.literal(5),
  generated_python_case_count: z.literal(5),
  run_count: z.literal(30),
  cold_repetitions: z.literal(3),
  warm_repetitions: z.literal(3),
  flake_count: z.literal(0),
  model_override_count: z.literal(0),
  result: z.literal("GO"),
  completed_at: timestampSchema,
});

export const falcon24AgentAnalysisGateSchema = falcon24AgentAnalysisGateMaterialSchema.extend({
  gate_hash: contentHashSchema,
});

export async function buildFalcon24AgentAnalysisGate(input: {
  readonly gate_id: string;
  readonly suite: unknown;
  readonly results: readonly unknown[];
  readonly completed_at: string;
}) {
  const suite = falcon24AgentAnalysisSuiteSchema.parse(input.suite);
  const results = input.results.map((result) => falcon24AgentAnalysisRunResultSchema.parse(result));
  await Promise.all(
    results.map(({ oracle_receipt: receipt }) => verifyFalcon24AnalysisOracleReceipt(receipt)),
  );
  if (results.length !== 30) throw new TypeError("FALCON24_ANALYSIS_RUN_SET_INCOMPLETE");
  const cases = new Map(suite.cases.map((testCase) => [testCase.case_id, testCase]));
  for (const testCase of suite.cases) {
    const caseRuns = results.filter(({ case_id: caseId }) => caseId === testCase.case_id);
    if (caseRuns.length !== 6) throw new TypeError("FALCON24_ANALYSIS_CASE_RUN_SET_INCOMPLETE");
    for (const variant of ["COLD", "WARM"] as const) {
      const repetitions = caseRuns
        .filter(({ run_variant: runVariant }) => runVariant === variant)
        .map(({ repetition }) => repetition)
        .sort();
      if (JSON.stringify(repetitions) !== JSON.stringify([1, 2, 3])) {
        throw new TypeError("FALCON24_ANALYSIS_REPETITION_SET_INVALID");
      }
    }
    if (new Set(caseRuns.map(({ answer_hash: answerHash }) => answerHash)).size !== 1) {
      throw new TypeError("FALCON24_ANALYSIS_RESULT_FLAKE");
    }
    for (const result of caseRuns) {
      if (
        result.oracle_receipt.case_id !== result.case_id ||
        result.oracle_receipt.output_hash !== result.answer_hash ||
        result.oracle_receipt.method_receipts.some(
          ({ evidence_hash: evidenceHash }) =>
            evidenceHash !== result.oracle_receipt.verification_hash,
        )
      ) {
        throw new TypeError("FALCON24_ANALYSIS_ORACLE_BINDING_INVALID");
      }
      const methodIds = [
        ...new Set(
          result.oracle_receipt.method_receipts.map(({ method_id: methodId }) => methodId),
        ),
      ].sort();
      if (
        result.provider !== suite.model_provider ||
        result.model_id !== suite.model_id ||
        result.oracle_receipt.terminal !== testCase.expected_terminal ||
        result.model_generated_node_count < testCase.minimum_model_generated_nodes ||
        result.generated_python_refs.length < testCase.minimum_model_generated_nodes ||
        JSON.stringify(methodIds) !== JSON.stringify(testCase.required_methods) ||
        testCase.required_disclosures.some(
          (code) => !result.oracle_receipt.disclosures.includes(code),
        ) ||
        testCase.required_quality_findings.some(
          (code) => !result.oracle_receipt.quality_findings.includes(code),
        )
      ) {
        throw new TypeError("FALCON24_ANALYSIS_CASE_ACCEPTANCE_FAILED");
      }
    }
  }
  if (results.some(({ case_id: caseId }) => !cases.has(caseId))) {
    throw new TypeError("FALCON24_ANALYSIS_CASE_UNKNOWN");
  }
  const material = falcon24AgentAnalysisGateMaterialSchema.parse({
    schema_version: FALCON24_AGENT_ANALYSIS_GATE_VERSION,
    gate_id: input.gate_id,
    suite_hash: suite.suite_hash,
    provider: "deepseek",
    model_id: FALCON24_DEEPSEEK_MODEL,
    case_count: 5,
    accepted_case_count: 5,
    generated_python_case_count: 5,
    run_count: 30,
    cold_repetitions: 3,
    warm_repetitions: 3,
    flake_count: 0,
    model_override_count: 0,
    result: "GO",
    completed_at: input.completed_at,
  });
  return falcon24AgentAnalysisGateSchema.parse({
    ...material,
    gate_hash: await sha256ContentHash(material),
  });
}

export type Falcon24AgentAnalysisCase = z.infer<typeof falcon24AgentAnalysisCaseSchema>;
export type Falcon24AgentAnalysisRunResult = z.infer<typeof falcon24AgentAnalysisRunResultSchema>;
