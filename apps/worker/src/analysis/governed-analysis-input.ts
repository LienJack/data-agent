import { createHash } from "node:crypto";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  verifyAnalysisInputMaterializationReceipt,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import { tableFromIPC } from "apache-arrow";

type ProductTeamQueryEvidenceRef = ArtifactReference & {
  readonly artifact_type: "QueryEvidence";
};

export interface GovernedAnalysisInput {
  readonly name: string;
  readonly format: "ARROW" | "CSV" | "JSON";
  readonly query_evidence_ref: ProductTeamQueryEvidenceRef;
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

function sameScopeAndRun(left: ArtifactReference, right: ArtifactReference): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id
  );
}

function sameOrderedColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

function normalizeArrowValue(expected: string | number | boolean | null, observed: unknown) {
  if (expected === null) return observed === null ? null : undefined;
  if (typeof expected === "number") {
    return typeof observed === "number" && Number.isFinite(observed) ? observed : undefined;
  }
  if (typeof expected === "boolean") {
    return typeof observed === "boolean" ? observed : undefined;
  }
  if (typeof observed === "string") return observed;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(expected)) {
    if (observed instanceof Date && !Number.isNaN(observed.valueOf())) {
      return observed.toISOString().slice(0, 10);
    }
    if (typeof observed === "number" && Number.isFinite(observed)) {
      return new Date(observed).toISOString().slice(0, 10);
    }
  }
  return undefined;
}

function verifyArrowProjection(input: {
  readonly content: Uint8Array;
  readonly ordered_columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, string | number | boolean | null>>[];
}): void {
  let table: ReturnType<typeof tableFromIPC>;
  try {
    table = tableFromIPC(input.content);
  } catch {
    throw new TypeError("ANALYSIS_INPUT_ARROW_CONTENT_INVALID");
  }
  const observedColumns = table.schema.fields.map(({ name }) => name);
  if (
    table.numRows !== input.rows.length ||
    !sameOrderedColumns(observedColumns, input.ordered_columns)
  ) {
    throw new TypeError("ANALYSIS_INPUT_ARROW_CONTENT_INVALID");
  }
  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    const expectedRow = input.rows[rowIndex];
    if (!expectedRow) throw new TypeError("ANALYSIS_INPUT_ARROW_CONTENT_INVALID");
    for (const column of input.ordered_columns) {
      const vector = table.getChild(column);
      if (!vector) throw new TypeError("ANALYSIS_INPUT_ARROW_CONTENT_INVALID");
      const expected = expectedRow[column];
      if (expected === undefined) throw new TypeError("ANALYSIS_INPUT_ARROW_CONTENT_INVALID");
      const observed = normalizeArrowValue(expected, vector.get(rowIndex));
      if (observed === undefined || canonicalizeJson(observed) !== canonicalizeJson(expected)) {
        throw new TypeError("ANALYSIS_INPUT_ARROW_CONTENT_MISMATCH");
      }
    }
  }
}

export async function verifyProductTeamQueryEvidenceInput(input: {
  readonly query_evidence_ref: ProductTeamQueryEvidenceRef;
  readonly query_evidence_document: unknown;
  readonly arrow_content?: Uint8Array;
  readonly expected_row_count?: number;
  readonly expected_ordered_columns?: readonly string[];
}): Promise<{
  readonly result_hash: string;
  readonly row_count: number;
  readonly ordered_columns: readonly string[];
}> {
  try {
    const document = await verifyProductTeamArtifactDocument(input.query_evidence_document);
    if (
      document.artifact_ref.artifact_type !== "QueryEvidence" ||
      !exactRef(document.artifact_ref, input.query_evidence_ref) ||
      document.source_refs.length !== 1 ||
      document.source_refs[0]?.artifact_type !== "SqlArtifact" ||
      document.projection.kind !== "TABLE" ||
      document.provenance?.kind !== "GOVERNED_QUERY_RESULT" ||
      document.provenance.row_count !== document.projection.total_rows ||
      document.projection.rows.length !== document.provenance.row_count
    ) {
      throw new TypeError("ANALYSIS_INPUT_QUERY_EVIDENCE_INVALID");
    }
    const orderedColumns = document.projection.columns.map(({ key }) => key);
    if (input.arrow_content) {
      verifyArrowProjection({
        content: input.arrow_content,
        ordered_columns: orderedColumns,
        rows: document.projection.rows,
      });
    }
    if (
      (input.expected_row_count !== undefined &&
        input.expected_row_count !== document.provenance.row_count) ||
      (input.expected_ordered_columns !== undefined &&
        !sameOrderedColumns(input.expected_ordered_columns, orderedColumns))
    ) {
      throw new TypeError("ANALYSIS_INPUT_QUERY_EVIDENCE_INVALID");
    }
    return Object.freeze({
      result_hash: document.provenance.result_hash,
      row_count: document.provenance.row_count,
      ordered_columns: Object.freeze(orderedColumns),
    });
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("ANALYSIS_INPUT_")) {
      throw error;
    }
    throw new TypeError("ANALYSIS_INPUT_QUERY_EVIDENCE_INVALID");
  }
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
    const evidence = await verifyProductTeamQueryEvidenceInput({
      query_evidence_ref: governed.query_evidence_ref,
      query_evidence_document: governed.query_evidence_document,
      arrow_content: governed.content,
    });
    const materialization = await verifyAnalysisInputMaterializationReceipt(
      governed.materialization_receipt_document,
    );
    const materializationReference = artifactReferenceFor(
      "AnalysisInputMaterializationReceipt",
    ).parse(governed.materialization_receipt_ref);
    if (
      names.has(governed.name) ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u.test(governed.name) ||
      !exactRef(materialization.query_evidence_ref, governed.query_evidence_ref) ||
      materialization.source_result_hash !== evidence.result_hash ||
      materialization.row_count !== evidence.row_count ||
      !sameOrderedColumns(materialization.ordered_columns, evidence.ordered_columns) ||
      materialization.input_format !== governed.format ||
      !exactRef(materialization.input_ref, governed.input_ref) ||
      !exactRef(materializationReference, governed.materialization_receipt_ref) ||
      materializationReference.content_hash !== (await sha256ContentHash(materialization)) ||
      governed.content.byteLength === 0 ||
      bytesHash(governed.content) !== governed.input_ref.content_hash ||
      !sameScopeAndRun(governed.input_ref, input.analysis_program_ref) ||
      !sameScopeAndRun(governed.query_evidence_ref, input.analysis_program_ref) ||
      !sameScopeAndRun(governed.materialization_receipt_ref, input.analysis_program_ref)
    ) {
      throw new TypeError("ANALYSIS_QUERY_EVIDENCE_MATERIALIZATION_INVALID");
    }
    names.add(governed.name);
  }
}

export const governedAnalysisInputInternals = Object.freeze({
  bytesHash,
  exactRef,
  normalizeArrowValue,
  sameOrderedColumns,
  sameScopeAndRun,
  verifyArrowProjection,
});
