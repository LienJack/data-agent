import { createHash } from "node:crypto";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  computeL2ResearchEnvelopeContentHash,
  type QueryEvidenceRef,
  queryEvidenceV2PayloadSchema,
  verifyAnalysisInputMaterializationReceipt,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";

export interface GovernedAnalysisInput {
  readonly name: string;
  readonly format: "ARROW" | "CSV" | "JSON";
  readonly query_evidence_ref: QueryEvidenceRef;
  readonly query_evidence_document: unknown;
  readonly input_ref: ArtifactReference;
  readonly materialization_receipt_ref: ArtifactReference;
  readonly materialization_receipt_document: unknown;
  readonly content: Uint8Array;
}

function bytesHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactRef(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

export async function verifyGovernedAnalysisInputs(input: {
  readonly analysis_program_ref: ArtifactReference;
  readonly governed_inputs: readonly GovernedAnalysisInput[];
}): Promise<void> {
  if (input.governed_inputs.length === 0 || input.governed_inputs.length > 64) {
    throw new TypeError("ANALYSIS_QUERY_EVIDENCE_MATERIALIZATION_INVALID");
  }
  const names = new Set<string>();
  for (const governed of input.governed_inputs) {
    const document = governed.query_evidence_document as {
      readonly envelope?: ArtifactReference & {
        readonly schema_version?: string;
        readonly status?: string;
        readonly created_at?: string;
      };
      readonly payload?: unknown;
    };
    const payload = queryEvidenceV2PayloadSchema.parse(document.payload);
    const materialization = await verifyAnalysisInputMaterializationReceipt(
      governed.materialization_receipt_document,
    );
    const materializationReference = artifactReferenceFor(
      "AnalysisInputMaterializationReceipt",
    ).parse(governed.materialization_receipt_ref);
    if (
      names.has(governed.name) ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u.test(governed.name) ||
      !document.envelope ||
      !exactRef(document.envelope, governed.query_evidence_ref) ||
      (await computeL2ResearchEnvelopeContentHash(governed.query_evidence_document)) !==
        governed.query_evidence_ref.content_hash ||
      !exactRef(materialization.query_evidence_ref, governed.query_evidence_ref) ||
      !exactRef(materialization.query_result_ref, payload.sandbox_result_ref) ||
      materialization.source_result_hash !== payload.observation.result_hash ||
      !exactRef(materialization.input_ref, governed.input_ref) ||
      !exactRef(materializationReference, governed.materialization_receipt_ref) ||
      materializationReference.content_hash !== (await sha256ContentHash(materialization)) ||
      bytesHash(governed.content) !== governed.input_ref.content_hash ||
      governed.input_ref.tenant_id !== input.analysis_program_ref.tenant_id ||
      governed.input_ref.run_id !== input.analysis_program_ref.run_id ||
      governed.query_evidence_ref.tenant_id !== input.analysis_program_ref.tenant_id ||
      governed.query_evidence_ref.run_id !== input.analysis_program_ref.run_id
    ) {
      throw new TypeError("ANALYSIS_QUERY_EVIDENCE_MATERIALIZATION_INVALID");
    }
    names.add(governed.name);
  }
}

export const governedAnalysisInputInternals = Object.freeze({ bytesHash, exactRef });
