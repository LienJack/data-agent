import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import type { SqlPool } from "@data-agent/platform/persistence";
import type { GovernedAnalysisQueryPort } from "../analysis/executor.js";
import type { AnalysisInputMaterializationCommand } from "../analysis/input-materializer.js";
import type { GovernedPythonInput } from "../analysis/sandbox-executor.js";
import type { Falcon24AnalysisDataOracleReceipt } from "./falcon24-analysis-data-oracle.js";
import {
  FALCON24_ANALYSIS_QUERY_SPECS,
  type Falcon24AnalysisQuerySpec,
  materializeFalcon24Arrow,
} from "./falcon24-analysis-queries.js";

export interface Falcon24ExactQueryEvidenceAuthority {
  issue(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program_ref: ArtifactReference;
    readonly node_id: string;
    readonly idempotency_key: string;
    readonly spec: Falcon24AnalysisQuerySpec;
    readonly spec_hash: `sha256:${string}`;
    readonly data_oracle_receipt: Falcon24AnalysisDataOracleReceipt;
    readonly rows: readonly Readonly<Record<string, unknown>>[];
  }): Promise<{
    readonly query_evidence_ref: ArtifactReference & {
      readonly artifact_type: "QueryEvidence";
    };
    readonly query_evidence_document: unknown;
  }>;
}

export interface Falcon24AnalysisInputMaterializer {
  materialize(input: AnalysisInputMaterializationCommand): Promise<GovernedPythonInput>;
}

export interface Falcon24AnalysisSnapshotAuthority {
  inspect(): Promise<Falcon24AnalysisDataOracleReceipt>;
}

function statementTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) {
    throw new TypeError("FALCON24_QUERY_TIMEOUT_INVALID");
  }
  return value;
}

async function specHash(spec: Falcon24AnalysisQuerySpec): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    protocol_version: "falcon24-analysis-query@1.0.0",
    case_id: spec.case_id,
    input_name: spec.input_name,
    sql: spec.sql,
    columns: spec.columns,
    expected_rows: spec.expected_rows,
  });
}

export function createFalcon24GovernedAnalysisQueryPort(input: {
  readonly pool: SqlPool;
  readonly snapshot_authority: Falcon24AnalysisSnapshotAuthority;
  readonly evidence_authority: Falcon24ExactQueryEvidenceAuthority;
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
      const timeoutMs = statementTimeout(request.timeout_ms);
      const dataOracleReceipt = await input.snapshot_authority.inspect();
      const querySpecHash = await specHash(spec);
      const client = await input.pool.connect();
      try {
        await client.query("begin transaction isolation level repeatable read read only");
        await client.query(`set local statement_timeout = ${timeoutMs}`);
        const result = await client.query<Readonly<Record<string, unknown>>>(spec.sql);
        const arrow = materializeFalcon24Arrow(spec, result.rows);
        await client.query("commit");
        const evidence = await input.evidence_authority.issue({
          lease: request.lease,
          analysis_program_ref: request.analysis_program_ref,
          node_id: request.node.node_id,
          idempotency_key: request.idempotency_key,
          spec,
          spec_hash: querySpecHash,
          data_oracle_receipt: dataOracleReceipt,
          rows: result.rows,
        });
        const governed = await input.materializer.materialize({
          lease: request.lease,
          analysis_program_ref: request.analysis_program_ref,
          node_id: request.node.node_id,
          idempotency_key: request.idempotency_key,
          input_name: spec.input_name,
          format: "ARROW",
          content: arrow,
          row_count: spec.expected_rows,
          ordered_columns: spec.columns.map(({ name }) => name),
          spec_hash: querySpecHash,
          snapshot_receipt_hash: dataOracleReceipt.receipt_hash as `sha256:${string}`,
          query_evidence_ref: evidence.query_evidence_ref,
          query_evidence_document: evidence.query_evidence_document,
        });
        if (governed.name !== spec.input_name || governed.format !== "ARROW") {
          throw new TypeError("FALCON24_QUERY_MATERIALIZATION_CORRELATION_INVALID");
        }
        return [governed];
      } catch (error) {
        try {
          await client.query("rollback");
        } catch {
          // Preserve the authority failure that caused the transaction to abort.
        }
        throw error;
      } finally {
        client.release();
      }
    },
  });
}

export const falcon24GovernedQueryInternals = Object.freeze({ specHash });
