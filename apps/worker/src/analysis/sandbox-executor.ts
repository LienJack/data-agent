import { createHash } from "node:crypto";
import {
  type AnalysisSandboxProgramPayload,
  type ArtifactReference,
  artifactReferenceIdentity,
  computeL2ResearchEnvelopeContentHash,
  type PythonExecutionBudgetsV1,
  type PythonExecutionEnvelopeV1,
  type PythonSandboxTransportOutcomeV1,
  pythonExecutionEnvelopeSchema,
  queryEvidenceV2PayloadSchema,
} from "@data-agent/contracts";
import type { PythonSandboxClient } from "../runs/python-sandbox-client.js";
import { ANALYSIS_RUNTIME_ATTESTATIONS, type AnalysisSkillDescriptor } from "./skill-catalog.js";

export interface GovernedPythonInput {
  readonly name: string;
  readonly format: "ARROW" | "CSV" | "JSON";
  readonly query_evidence_ref: ArtifactReference;
  readonly query_evidence_document: unknown;
  readonly input_ref: ArtifactReference;
  readonly content: Uint8Array;
}

export interface ExpectedPythonOutput {
  readonly name: string;
  readonly type: "JSON" | "ARROW" | "CSV" | "PNG" | "SVG";
  readonly content: Uint8Array;
}

export interface AnalysisFenceGuard {
  isCurrent(input: {
    readonly run_id: string;
    readonly attempt_id: string;
    readonly worker_fence: number;
    readonly fence_token: string;
  }): Promise<boolean>;
}

export interface AnalysisOutputReferenceFactory {
  create(input: {
    readonly name: string;
    readonly type: ExpectedPythonOutput["type"];
    readonly content_hash: `sha256:${string}`;
    readonly program: AnalysisSandboxProgramPayload;
  }): ArtifactReference;
}

export type AnalysisSandboxExecution =
  | {
      readonly status: "SUCCEEDED";
      readonly outcome: PythonSandboxTransportOutcomeV1;
      readonly output_refs: readonly ArtifactReference[];
    }
  | {
      readonly status: "FAILED" | "CANCELLED" | "STALE_FENCE";
      readonly reason_code: string;
      readonly outcome: PythonSandboxTransportOutcomeV1 | null;
      readonly output_refs: readonly [];
    };

function bytesHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactRef(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

async function verifyGovernedInput(
  input: GovernedPythonInput,
  program: AnalysisSandboxProgramPayload,
): Promise<void> {
  const document = input.query_evidence_document as {
    readonly envelope?: ArtifactReference & {
      readonly schema_version?: string;
      readonly status?: string;
      readonly created_at?: string;
    };
    readonly payload?: unknown;
  };
  const payload = queryEvidenceV2PayloadSchema.parse(document.payload);
  if (
    !document.envelope ||
    !exactRef(document.envelope, input.query_evidence_ref) ||
    (await computeL2ResearchEnvelopeContentHash(input.query_evidence_document)) !==
      input.query_evidence_ref.content_hash ||
    !exactRef(payload.sandbox_result_ref, input.input_ref) ||
    payload.observation.result_hash !== input.input_ref.content_hash ||
    bytesHash(input.content) !== input.input_ref.content_hash ||
    !program.query_evidence_refs.some((reference) =>
      exactRef(reference, input.query_evidence_ref),
    ) ||
    !program.input_refs.some((reference) => exactRef(reference, input.input_ref))
  ) {
    throw new TypeError("ANALYSIS_QUERY_EVIDENCE_MATERIALIZATION_INVALID");
  }
}

function executionBudgets(
  descriptor: AnalysisSkillDescriptor,
  maximum: Partial<PythonExecutionBudgetsV1> = {},
): PythonExecutionBudgetsV1 {
  return {
    wall_time_ms: Math.min(descriptor.hard_limits.wall_time_ms, maximum.wall_time_ms ?? 600_000),
    cpu_seconds: Math.min(120, maximum.cpu_seconds ?? 600),
    memory_bytes: Math.min(
      descriptor.hard_limits.memory_bytes,
      maximum.memory_bytes ?? 2_147_483_648,
    ),
    input_bytes: Math.min(128 * 1024 * 1024, maximum.input_bytes ?? 536_870_912),
    output_bytes: Math.min(64 * 1024 * 1024, maximum.output_bytes ?? 268_435_456),
    max_pids: Math.min(16, maximum.max_pids ?? 64),
    max_open_files: Math.min(64, maximum.max_open_files ?? 256),
    stdout_bytes: Math.min(4_096, maximum.stdout_bytes ?? 1_048_576),
    stderr_bytes: Math.min(16_384, maximum.stderr_bytes ?? 1_048_576),
  };
}

export async function executeAnalysisSandbox(input: {
  readonly program: AnalysisSandboxProgramPayload;
  readonly descriptor: AnalysisSkillDescriptor;
  readonly source_text: string;
  readonly governed_inputs: readonly GovernedPythonInput[];
  readonly expected_outputs: readonly ExpectedPythonOutput[];
  readonly client: PythonSandboxClient;
  readonly authorization: string;
  readonly attempt: 0 | 1;
  readonly attempt_id: string;
  readonly worker_fence: number;
  readonly fence_token: string;
  readonly idempotency_key: string;
  readonly fence_guard: AnalysisFenceGuard;
  readonly output_references: AnalysisOutputReferenceFactory;
  readonly signal?: AbortSignal;
  readonly maximum_budgets?: Partial<PythonExecutionBudgetsV1>;
}): Promise<AnalysisSandboxExecution> {
  const fence = {
    run_id: input.program.analysis_program_ref.run_id,
    attempt_id: input.attempt_id,
    worker_fence: input.worker_fence,
    fence_token: input.fence_token,
  };
  if (!(await input.fence_guard.isCurrent(fence))) {
    return {
      status: "STALE_FENCE",
      reason_code: "SANDBOX_FENCE_STALE",
      outcome: null,
      output_refs: [],
    };
  }
  if (
    input.descriptor.python_import_profile !== input.program.import_profile ||
    input.program.runtime_digest !==
      ANALYSIS_RUNTIME_ATTESTATIONS[input.program.import_profile].runtime_digest ||
    input.program.dependency_lock_digest !==
      ANALYSIS_RUNTIME_ATTESTATIONS[input.program.import_profile].dependency_lock_digest
  ) {
    throw new TypeError("ANALYSIS_PROGRAM_RUNTIME_ATTESTATION_MISMATCH");
  }
  if (
    input.governed_inputs.length !== input.program.input_refs.length ||
    input.expected_outputs.length !== input.program.output_contract.outputs.length
  ) {
    throw new TypeError("ANALYSIS_SANDBOX_REFERENCE_CLOSURE_INVALID");
  }
  await Promise.all(
    input.governed_inputs.map((governedInput) => verifyGovernedInput(governedInput, input.program)),
  );
  const orderedInputs = input.program.input_refs.map((reference) => {
    const materialized = input.governed_inputs.find(({ input_ref: inputRef }) =>
      exactRef(inputRef, reference),
    );
    if (!materialized) throw new TypeError("ANALYSIS_SANDBOX_INPUT_ORDER_INVALID");
    return materialized;
  });
  const outputReferences = input.program.output_contract.outputs.map((output) => {
    const expected = input.expected_outputs.find(({ name }) => name === output.name);
    if (
      !expected ||
      expected.type !== output.type ||
      expected.content.byteLength > output.max_bytes
    ) {
      throw new TypeError("ANALYSIS_EXPECTED_OUTPUT_INVALID");
    }
    return {
      name: output.name,
      reference: input.output_references.create({
        name: output.name,
        type: expected.type,
        content_hash: bytesHash(expected.content),
        program: input.program,
      }),
    };
  });
  const envelope: PythonExecutionEnvelopeV1 = pythonExecutionEnvelopeSchema.parse({
    protocol_version: "data-agent-python-sandbox-ipc@1.0.0",
    authorization: input.authorization,
    request: {
      schema_version: "1.0.0",
      workspace_id: input.program.analysis_program_ref.tenant_id,
      run_id: input.program.analysis_program_ref.run_id,
      attempt: input.attempt,
      fence_token: input.fence_token,
      idempotency_key: input.idempotency_key,
      source_ref: input.program.source_text_ref,
      source_sha256: input.program.source_sha256,
      entrypoint: "main",
      input_refs: input.program.input_refs,
      output_contract: input.program.output_contract,
      runtime_digest: input.program.runtime_digest,
      dependency_lock_digest: input.program.dependency_lock_digest,
      policy_version: input.program.policy_version,
      budgets: executionBudgets(input.descriptor, input.maximum_budgets),
    },
    source_code_base64: Buffer.from(input.source_text, "utf8").toString("base64"),
    inputs: orderedInputs.map((materialized) => ({
      name: materialized.name,
      format: materialized.format,
      reference: materialized.input_ref,
      content_base64: Buffer.from(materialized.content).toString("base64"),
    })),
    output_references: outputReferences,
  });
  const outcome = await input.client.execute(envelope, input.signal);
  if (!(await input.fence_guard.isCurrent(fence))) {
    return {
      status: "STALE_FENCE",
      reason_code: "SANDBOX_FENCE_STALE",
      outcome,
      output_refs: [],
    };
  }
  if (outcome.receipt.status !== "SUCCEEDED") {
    return {
      status: outcome.receipt.status === "CANCELLED" ? "CANCELLED" : "FAILED",
      reason_code: outcome.receipt.failure_code ?? "SANDBOX_EXECUTION_FAILED",
      outcome,
      output_refs: [],
    };
  }
  const attestation = ANALYSIS_RUNTIME_ATTESTATIONS[input.program.import_profile];
  if (
    outcome.receipt.sandbox_image_digest !== attestation.image_attestation_digest ||
    outcome.receipt.dependency_lock_digest !== input.program.dependency_lock_digest ||
    outcome.receipt.policy_version !== input.program.policy_version ||
    Object.values(outcome.receipt.hard_controls).some((value) => !value) ||
    outcome.outputs.length !== outputReferences.length ||
    outcome.outputs.some((output) => {
      const binding = outputReferences.find(({ name }) => name === output.name);
      const expected = input.expected_outputs.find(({ name }) => name === output.name);
      return (
        !binding ||
        !expected ||
        output.content_sha256 !== binding.reference.content_hash ||
        bytesHash(Buffer.from(output.content_base64, "base64")) !== output.content_sha256 ||
        Buffer.compare(
          Buffer.from(output.content_base64, "base64"),
          Buffer.from(expected.content),
        ) !== 0
      );
    })
  ) {
    return {
      status: "FAILED",
      reason_code: "PROGRAM_OUTPUT_CONTRACT_FAILED",
      outcome,
      output_refs: [],
    };
  }
  return {
    status: "SUCCEEDED",
    outcome,
    output_refs: Object.freeze(outputReferences.map(({ reference }) => reference)),
  };
}
