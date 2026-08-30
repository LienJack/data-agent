import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  type ProductTeamArtifactDocument,
  type QueryEvidenceSemanticBinding,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import type { PortResult } from "@data-agent/contracts/ports";
import {
  Bool,
  DateDay,
  Float64,
  Table,
  TimestampMillisecond,
  tableToIPC,
  Utf8,
  type Vector,
  vectorFromArray,
} from "apache-arrow";
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
  bindings: QueryEvidenceSemanticBinding["columns"],
): Uint8Array {
  const vectors: Record<string, Vector> = {};
  for (const binding of bindings) {
    const values = projection.rows.map((row) => row[binding.output_name] ?? null);
    if (values.some((value) => value === null && !binding.nullable)) {
      throw new TypeError("ANALYSIS_QUERY_EVIDENCE_NULLABILITY_INVALID");
    }
    if (binding.logical_type === "STRING") {
      if (values.some((value) => value !== null && typeof value !== "string")) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_COLUMN_TYPE_INVALID");
      }
      vectors[binding.output_name] = vectorFromArray(
        values as readonly (string | null)[],
        new Utf8(),
      );
      continue;
    }
    if (binding.logical_type === "NUMBER") {
      if (
        values.some(
          (value) => value !== null && (typeof value !== "number" || !Number.isFinite(value)),
        )
      ) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_COLUMN_TYPE_INVALID");
      }
      vectors[binding.output_name] = vectorFromArray(
        values as readonly (number | null)[],
        new Float64(),
      );
      continue;
    }
    if (binding.logical_type === "BOOLEAN") {
      if (values.some((value) => value !== null && typeof value !== "boolean")) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_COLUMN_TYPE_INVALID");
      }
      vectors[binding.output_name] = vectorFromArray(
        values as readonly (boolean | null)[],
        new Bool(),
      );
      continue;
    }
    if (
      values.some(
        (value) =>
          value !== null &&
          (typeof value !== "string" ||
            (binding.logical_type === "DATE" && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) ||
            !Number.isFinite(
              Date.parse(
                binding.logical_type === "DATE" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
                  ? `${value}T00:00:00.000Z`
                  : value,
              ),
            )),
      )
    ) {
      throw new TypeError("ANALYSIS_QUERY_EVIDENCE_COLUMN_TYPE_INVALID");
    }
    const dates = (values as readonly (string | null)[]).map((value) =>
      value === null
        ? null
        : new Date(binding.logical_type === "DATE" ? `${value}T00:00:00.000Z` : value),
    );
    vectors[binding.output_name] =
      binding.logical_type === "DATE"
        ? vectorFromArray(dates, new DateDay())
        : vectorFromArray(dates, new TimestampMillisecond());
  }
  return tableToIPC(new Table(vectors), "file");
}

export function createProductTeamGovernedAnalysisQueryPort(input: {
  readonly query_evidence_ref: ArtifactReference & { readonly artifact_type: "QueryEvidence" };
  readonly artifact_authority: ProductTeamAnalysisArtifactAuthority;
  readonly artifact_capability: unknown;
  readonly materializer: ProductTeamAnalysisInputMaterializer;
  readonly expected_authority: Pick<
    QueryEvidenceSemanticBinding,
    | "semantic_release_ref"
    | "semantic_context_ref"
    | "schema_snapshot_ref"
    | "datasource_ref"
    | "target_binding_hash"
  >;
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
      const binding = evidenceShape.semantic_binding;
      const analysisColumns = binding.columns.filter(
        (column): column is typeof column & { readonly semantic_role: "METRIC" | "DIMENSION" } =>
          column.semantic_role !== "PHYSICAL_COLUMN",
      );
      if (analysisColumns.length !== binding.columns.length) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_PHYSICAL_COLUMN_UNSUPPORTED");
      }
      if (
        canonicalizeJson({
          semantic_release_ref: binding.semantic_release_ref,
          semantic_context_ref: binding.semantic_context_ref,
          schema_snapshot_ref: binding.schema_snapshot_ref,
          datasource_ref: binding.datasource_ref,
          target_binding_hash: binding.target_binding_hash,
        }) !== canonicalizeJson(input.expected_authority)
      ) {
        throw new TypeError("ANALYSIS_QUERY_EVIDENCE_AUTHORITY_BINDING_INVALID");
      }
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
      const arrow = materializeProductTeamArrow(evidence.projection, analysisColumns);
      const specHash = await sha256ContentHash({
        schema_version: "product-team-analysis-input-spec@2.0.0",
        semantic_binding_hash: binding.binding_hash,
        query_evidence_ref: evidenceRef,
        sql_artifact_ref: sqlRef,
        result_hash: evidenceShape.result_hash,
        row_count: evidenceShape.row_count,
        columns: analysisColumns,
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
        columns: analysisColumns.map((column) => ({
          name: column.output_name,
          arrow_type:
            column.logical_type === "NUMBER"
              ? ("FLOAT64" as const)
              : column.logical_type === "BOOLEAN"
                ? ("BOOL" as const)
                : column.logical_type === "DATE"
                  ? ("DATE32" as const)
                  : column.logical_type === "DATETIME"
                    ? ("TIMESTAMP_MS" as const)
                    : ("UTF8" as const),
          nullable: column.nullable,
          semantic_role: column.semantic_role,
          semantic_object_id: column.semantic_object_id,
        })),
        source_binding_hash: binding.binding_hash as `sha256:${string}`,
        spec_hash: specHash,
        snapshot_receipt_hash: binding.schema_snapshot_ref.resource_hash as `sha256:${string}`,
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
