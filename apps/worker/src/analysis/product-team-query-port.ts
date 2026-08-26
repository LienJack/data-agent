import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  type ProductTeamArtifactDocument,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { PortResult } from "@data-agent/contracts/ports";
import { Bool, Float64, Table, tableToIPC, Utf8, type Vector, vectorFromArray } from "apache-arrow";
import type { GovernedAnalysisQueryPort } from "./executor.js";
import {
  type GovernedAnalysisInput,
  verifyProductTeamQueryEvidenceInput,
} from "./governed-analysis-input.js";
import type { AnalysisInputMaterializationCommand } from "./input-materializer.js";

export interface ProductTeamAnalysisInputMaterializer {
  materialize(input: AnalysisInputMaterializationCommand): Promise<GovernedAnalysisInput>;
}

export interface ProductTeamAnalysisArtifactAuthority {
  resolveCommitted(
    capability: unknown,
    reference: ArtifactReference,
  ): Promise<PortResult<ProductTeamArtifactDocument | null>>;
}

function portValue<T>(result: PortResult<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

async function resolveExactDocument(input: {
  readonly authority: ProductTeamAnalysisArtifactAuthority;
  readonly capability: unknown;
  readonly reference: ArtifactReference;
  readonly missing_code: string;
}) {
  const document = portValue(
    await input.authority.resolveCommitted(input.capability, input.reference),
  );
  if (!document) throw new TypeError(input.missing_code);
  const verified = await verifyProductTeamArtifactDocument(document);
  if (
    artifactReferenceIdentity(verified.artifact_ref) !== artifactReferenceIdentity(input.reference)
  ) {
    throw new TypeError(input.missing_code);
  }
  return verified;
}

function materializeProductTeamArrow(
  projection: Extract<ProductTeamArtifactDocument["projection"], { readonly kind: "TABLE" }>,
): Uint8Array {
  const vectors: Record<string, Vector> = {};
  for (const column of projection.columns) {
    const values = projection.rows.map((row) => row[column.key] ?? null);
    if (column.data_type === "STRING") {
      if (values.some((value) => value !== null && typeof value !== "string")) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_COLUMN_TYPE_INVALID");
      }
      vectors[column.key] = vectorFromArray(values as readonly (string | null)[], new Utf8());
      continue;
    }
    if (column.data_type === "NUMBER") {
      if (
        values.some(
          (value) => value !== null && (typeof value !== "number" || !Number.isFinite(value)),
        )
      ) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_COLUMN_TYPE_INVALID");
      }
      vectors[column.key] = vectorFromArray(values as readonly (number | null)[], new Float64());
      continue;
    }
    if (column.data_type === "BOOLEAN") {
      if (values.some((value) => value !== null && typeof value !== "boolean")) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_COLUMN_TYPE_INVALID");
      }
      vectors[column.key] = vectorFromArray(values as readonly (boolean | null)[], new Bool());
      continue;
    }
    throw new TypeError("ANALYSIS_QUERY_EVIDENCE_COLUMN_TYPE_INVALID");
  }
  return tableToIPC(new Table(vectors), "file");
}

export function createProductTeamGovernedAnalysisQueryPort(input: {
  readonly query_evidence_ref: ArtifactReference & { readonly artifact_type: "QueryEvidence" };
  readonly artifact_authority: ProductTeamAnalysisArtifactAuthority;
  readonly artifact_capability: unknown;
  readonly materializer: ProductTeamAnalysisInputMaterializer;
  readonly semantic_context_hash: `sha256:${string}`;
  readonly schema_snapshot_hash: `sha256:${string}`;
}): GovernedAnalysisQueryPort {
  return Object.freeze({
    async execute(request: Parameters<GovernedAnalysisQueryPort["execute"]>[0]) {
      if (
        input.query_evidence_ref.run_id !== request.lease.run_id ||
        input.query_evidence_ref.app_id !== request.lease.scope.app_id ||
        input.query_evidence_ref.tenant_id !== request.lease.scope.tenant_id ||
        input.query_evidence_ref.environment !== request.lease.scope.environment
      ) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_SCOPE_INVALID");
      }
      const evidence = await resolveExactDocument({
        authority: input.artifact_authority,
        capability: input.artifact_capability,
        reference: input.query_evidence_ref,
        missing_code: "ANALYSIS_QUERY_EVIDENCE_AUTHORITY_RESOLUTION_INVALID",
      });
      const evidenceRef = artifactReferenceFor("QueryEvidence").parse(evidence.artifact_ref);
      const evidenceShape = await verifyProductTeamQueryEvidenceInput({
        query_evidence_ref: evidenceRef,
        query_evidence_document: evidence,
      });
      if (evidenceShape.row_count > request.max_rows) {
        throw new TypeError("ANALYSIS_QUERY_ROW_BUDGET_EXCEEDED");
      }
      const sqlRef = artifactReferenceFor("SqlArtifact").parse(evidence.source_refs[0]);
      const sql = await resolveExactDocument({
        authority: input.artifact_authority,
        capability: input.artifact_capability,
        reference: sqlRef,
        missing_code: "ANALYSIS_SQL_ARTIFACT_AUTHORITY_RESOLUTION_INVALID",
      });
      if (
        sql.artifact_ref.artifact_type !== "SqlArtifact" ||
        sql.profile_id !== "governed-text2sql-agent" ||
        sql.projection.kind !== "SQL" ||
        evidence.projection.kind !== "TABLE"
      ) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_AUTHORITY_RESOLUTION_INVALID");
      }
      const arrow = materializeProductTeamArrow(evidence.projection);
      const specHash = await sha256ContentHash({
        schema_version: "product-team-analysis-input-spec@1.0.0",
        semantic_context_hash: input.semantic_context_hash,
        schema_snapshot_hash: input.schema_snapshot_hash,
        query_evidence_ref: evidenceRef,
        sql_artifact_ref: sqlRef,
        result_hash: evidenceShape.result_hash,
        row_count: evidenceShape.row_count,
        ordered_columns: evidenceShape.ordered_columns,
      });
      const governed = await input.materializer.materialize({
        lease: request.lease,
        analysis_program_ref: request.analysis_program_ref,
        node_id: request.node.node_id,
        idempotency_key: request.idempotency_key,
        input_name: "query_evidence",
        format: "ARROW",
        content: arrow,
        row_count: evidenceShape.row_count,
        ordered_columns: evidenceShape.ordered_columns,
        spec_hash: specHash,
        snapshot_receipt_hash: input.schema_snapshot_hash,
        query_evidence_ref: evidenceRef,
      });
      if (
        governed.name !== "query_evidence" ||
        governed.format !== "ARROW" ||
        artifactReferenceIdentity(governed.query_evidence_ref) !==
          artifactReferenceIdentity(input.query_evidence_ref)
      ) {
        throw new TypeError("ANALYSIS_QUERY_MATERIALIZATION_CORRELATION_INVALID");
      }
      return [governed];
    },
  });
}

export const productTeamGovernedQueryInternals = Object.freeze({
  materializeProductTeamArrow,
  resolveExactDocument,
});
