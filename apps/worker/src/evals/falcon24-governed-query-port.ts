import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  type ProductTeamArtifactDocument,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { PortResult } from "@data-agent/contracts/ports";
import type { GovernedAnalysisQueryPort } from "../analysis/executor.js";
import {
  type GovernedAnalysisInput,
  verifyProductTeamQueryEvidenceInput,
} from "../analysis/governed-analysis-input.js";
import type { AnalysisInputMaterializationCommand } from "../analysis/input-materializer.js";
import type { Falcon24AnalysisDataOracleReceipt } from "./falcon24-analysis-data-oracle.js";
import {
  FALCON24_ANALYSIS_QUERY_SPECS,
  type Falcon24AnalysisQuerySpec,
  materializeFalcon24Arrow,
} from "./falcon24-analysis-queries.js";

export interface Falcon24AnalysisInputMaterializer {
  materialize(input: AnalysisInputMaterializationCommand): Promise<GovernedAnalysisInput>;
}

export interface Falcon24AnalysisSnapshotAuthority {
  inspect(): Promise<Falcon24AnalysisDataOracleReceipt>;
}

export interface Falcon24ProductArtifactAuthority {
  resolveCommitted(
    capability: unknown,
    reference: ArtifactReference,
  ): Promise<PortResult<ProductTeamArtifactDocument | null>>;
}

function portValue<T>(result: PortResult<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

async function specHash(spec: Falcon24AnalysisQuerySpec): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    protocol_version: "falcon24-analysis-input-contract@1.0.0",
    case_id: spec.case_id,
    input_name: spec.input_name,
    columns: spec.columns,
    expected_rows: spec.expected_rows,
    semantic_contract: spec.semantic_contract,
  });
}

async function resolveExactDocument(input: {
  readonly authority: Falcon24ProductArtifactAuthority;
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

export function createFalcon24GovernedAnalysisQueryPort(input: {
  readonly query_evidence_ref: ArtifactReference & { readonly artifact_type: "QueryEvidence" };
  readonly artifact_authority: Falcon24ProductArtifactAuthority;
  readonly artifact_capability: unknown;
  readonly snapshot_authority: Falcon24AnalysisSnapshotAuthority;
  readonly materializer: Falcon24AnalysisInputMaterializer;
}): GovernedAnalysisQueryPort {
  return Object.freeze({
    async execute(request: Parameters<GovernedAnalysisQueryPort["execute"]>[0]) {
      const spec =
        FALCON24_ANALYSIS_QUERY_SPECS[
          request.node.node_id as keyof typeof FALCON24_ANALYSIS_QUERY_SPECS
        ];
      if (!spec || spec.case_id !== request.node.node_id) {
        throw new TypeError("FALCON24_QUERY_CASE_NOT_REGISTERED");
      }
      if (request.max_rows < spec.expected_rows) {
        throw new TypeError("FALCON24_QUERY_ROW_BUDGET_EXCEEDED");
      }
      if (
        input.query_evidence_ref.run_id !== request.lease.run_id ||
        input.query_evidence_ref.app_id !== request.lease.scope.app_id ||
        input.query_evidence_ref.tenant_id !== request.lease.scope.tenant_id ||
        input.query_evidence_ref.environment !== request.lease.scope.environment
      ) {
        throw new TypeError("FALCON24_QUERY_EVIDENCE_SCOPE_INVALID");
      }
      const evidence = await resolveExactDocument({
        authority: input.artifact_authority,
        capability: input.artifact_capability,
        reference: input.query_evidence_ref,
        missing_code: "FALCON24_QUERY_EVIDENCE_AUTHORITY_RESOLUTION_INVALID",
      });
      const evidenceRef = artifactReferenceFor("QueryEvidence").parse(evidence.artifact_ref);
      const evidenceShape = await verifyProductTeamQueryEvidenceInput({
        query_evidence_ref: evidenceRef,
        query_evidence_document: evidence,
        expected_row_count: spec.expected_rows,
        expected_ordered_columns: spec.columns.map(({ name }) => name),
      });
      const sqlRef = artifactReferenceFor("SqlArtifact").parse(evidence.source_refs[0]);
      const sql = await resolveExactDocument({
        authority: input.artifact_authority,
        capability: input.artifact_capability,
        reference: sqlRef,
        missing_code: "FALCON24_SQL_ARTIFACT_AUTHORITY_RESOLUTION_INVALID",
      });
      if (
        sql.artifact_ref.artifact_type !== "SqlArtifact" ||
        sql.profile_id !== "governed-text2sql-agent" ||
        sql.projection.kind !== "SQL"
      ) {
        throw new TypeError("FALCON24_SQL_ARTIFACT_AUTHORITY_RESOLUTION_INVALID");
      }
      if (evidence.projection.kind !== "TABLE") {
        throw new TypeError("FALCON24_QUERY_EVIDENCE_SHAPE_INVALID");
      }
      const dataOracleReceipt = await input.snapshot_authority.inspect();
      const arrow = materializeFalcon24Arrow(spec, evidence.projection.rows);
      const governed = await input.materializer.materialize({
        lease: request.lease,
        analysis_program_ref: request.analysis_program_ref,
        node_id: request.node.node_id,
        idempotency_key: request.idempotency_key,
        input_name: spec.input_name,
        format: "ARROW",
        content: arrow,
        row_count: evidenceShape.row_count,
        ordered_columns: evidenceShape.ordered_columns,
        spec_hash: await specHash(spec),
        snapshot_receipt_hash: dataOracleReceipt.receipt_hash as `sha256:${string}`,
        query_evidence_ref: evidenceRef,
      });
      if (
        governed.name !== spec.input_name ||
        governed.format !== "ARROW" ||
        artifactReferenceIdentity(governed.query_evidence_ref) !==
          artifactReferenceIdentity(input.query_evidence_ref)
      ) {
        throw new TypeError("FALCON24_QUERY_MATERIALIZATION_CORRELATION_INVALID");
      }
      return [governed];
    },
  });
}

export const falcon24GovernedQueryInternals = Object.freeze({
  resolveExactDocument,
  specHash,
});
