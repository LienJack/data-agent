import type { AnalysisProgramPayload, ArtifactReference } from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import type {
  GovernedOperatorResultRef,
  GovernedResultShapeSummary,
} from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import {
  AnalysisSandboxRuntimeError,
  type OpenSandboxAnalysisSession,
} from "../runs/opensandbox-analysis-runtime.js";
import type { ProviderInvocationResourceRef } from "./executor.js";

const encoder = new TextEncoder();

export interface AnalysisGovernedResultAuthorityPort {
  commitModelCell(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program_ref: ArtifactReference;
    readonly analysis_program: AnalysisProgramPayload;
    readonly program_hash: `sha256:${string}`;
    readonly node_id: string;
    readonly context_generation: number;
    readonly cell_id: string;
    readonly source: string;
    readonly source_sha256: `sha256:${string}`;
    readonly timeout_ms: number;
    readonly provider_invocation_ref: ProviderInvocationResourceRef;
    readonly runtime_digest: `sha256:${string}`;
    readonly policy_version: string;
    readonly operator_registry_digest: `sha256:${string}`;
  }): Promise<{ readonly journal_seq: number; readonly source_ref: ArtifactReference }>;
  commitOperatorIntent(input: {
    readonly lease: RunWorkLease;
    readonly program_hash: `sha256:${string}`;
    readonly node_id: string;
    readonly context_generation: number;
    readonly call_id: string;
    readonly operator_id: string;
    readonly request_sha256: `sha256:${string}`;
    readonly runtime_digest: `sha256:${string}`;
    readonly policy_version: string;
    readonly operator_registry_digest: `sha256:${string}`;
  }): Promise<{ readonly journal_seq: number }>;
  commit(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program_ref: ArtifactReference;
    readonly program_hash: `sha256:${string}`;
    readonly node_id: string;
    readonly context_generation: number;
    readonly call_id: string;
    readonly operator_id: string;
    readonly request_sha256: `sha256:${string}`;
    readonly operator_registry_digest: `sha256:${string}`;
    readonly request_content: Uint8Array;
    readonly result_content: Uint8Array;
    readonly result_sha256: `sha256:${string}`;
    readonly shape: GovernedResultShapeSummary;
    readonly receipt_payload: Readonly<Record<string, unknown>>;
  }): Promise<GovernedOperatorResultRef>;
  load(input: {
    readonly lease: RunWorkLease;
    readonly result: GovernedOperatorResultRef;
  }): Promise<{
    readonly result_content: Uint8Array;
    readonly request_content: Uint8Array;
    readonly receipt_payload: Readonly<Record<string, unknown>>;
  }>;
  commitBinding(input: {
    readonly lease: RunWorkLease;
    readonly result: GovernedOperatorResultRef;
    readonly binding_id: string;
    readonly result_symbol: string;
    readonly result_sha256: `sha256:${string}`;
    readonly binding_template_version: "governed-result-binding@1.0.0";
  }): Promise<{ readonly journal_seq: number }>;
  replay(input: {
    readonly lease: RunWorkLease;
    readonly node_id: string;
    readonly context_generation: number;
  }): Promise<{
    readonly actions: readonly AnalysisContextReplayAction[];
    readonly pending_results: readonly GovernedOperatorResultRef[];
    readonly recovered_results: readonly RecoveredGovernedOperatorResult[];
  }>;
}

export interface RecoveredGovernedOperatorResult {
  readonly result: GovernedOperatorResultRef;
  readonly result_content: Uint8Array;
  readonly request_content: Uint8Array;
  readonly receipt_payload: Readonly<Record<string, unknown>>;
  readonly binding: {
    readonly binding_id: string;
    readonly result_symbol: string;
    readonly result_sha256: `sha256:${string}`;
    readonly journal_seq: number;
  };
}

export type AnalysisContextReplayAction =
  | {
      readonly action_type: "MODEL_CELL";
      readonly journal_seq: number;
      readonly cell_id: string;
      readonly source: string;
      readonly source_sha256: `sha256:${string}`;
      readonly timeout_ms: number;
    }
  | {
      readonly action_type: "SERVER_BINDING";
      readonly journal_seq: number;
      readonly governed_result: GovernedOperatorResultRef;
      readonly authoritative_content: Uint8Array;
      readonly expected_symbol: string;
      readonly expected_binding_id: string;
    };

export interface GovernedResultBridge {
  recordModelCell(input: {
    readonly cell_id: string;
    readonly source: string;
    readonly source_sha256: `sha256:${string}`;
    readonly timeout_ms: number;
    readonly provider_invocation_ref: ProviderInvocationResourceRef;
  }): Promise<{ readonly journal_seq: number; readonly source_ref: ArtifactReference }>;
  recordOperatorIntent(input: {
    readonly call_id: string;
    readonly operator_id: string;
    readonly request_sha256: `sha256:${string}`;
  }): Promise<{ readonly journal_seq: number }>;
  persist(input: {
    readonly call_id: string;
    readonly operator_id: string;
    readonly request_sha256: `sha256:${string}`;
    readonly operator_registry_digest: `sha256:${string}`;
    readonly request_content: Uint8Array;
    readonly output: unknown;
    readonly execution_evidence: Readonly<Record<string, unknown>>;
  }): Promise<GovernedOperatorResultRef>;
  bind(input: {
    readonly session: OpenSandboxAnalysisSession;
    readonly result: GovernedOperatorResultRef;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly binding_id: string;
    readonly result_symbol: string;
    readonly result_sha256: `sha256:${string}`;
    readonly journal_seq: number;
  }>;
  recover(input: {
    readonly session: OpenSandboxAnalysisSession;
    readonly signal?: AbortSignal;
  }): Promise<readonly RecoveredGovernedOperatorResult[]>;
}

function shapeSummary(output: unknown): GovernedResultShapeSummary {
  if (Array.isArray(output)) {
    if (
      output.length > 100_000 ||
      output.some((row) => typeof row !== "object" || row === null || Array.isArray(row))
    ) {
      throw new TypeError("ANALYSIS_GOVERNED_OPERATOR_RESULT_TABLE_INVALID");
    }
    const columnNames = [
      ...new Set(output.flatMap((row) => Object.keys(row as Readonly<Record<string, unknown>>))),
    ].sort();
    if (columnNames.length === 0 || columnNames.length > 256) {
      throw new TypeError("ANALYSIS_GOVERNED_OPERATOR_RESULT_SHAPE_EXCEEDED");
    }
    const expected = columnNames.join("\0");
    if (
      output.some(
        (row) =>
          Object.keys(row as Readonly<Record<string, unknown>>)
            .sort()
            .join("\0") !== expected,
      )
    ) {
      throw new TypeError("ANALYSIS_GOVERNED_OPERATOR_RESULT_TABLE_COLUMNS_MISMATCH");
    }
    return Object.freeze({
      kind: "TABLE" as const,
      rows: output.length,
      columns: columnNames.length,
      bounded_summary: columnNames.slice(0, 32).join(",").slice(0, 1_024),
    });
  }
  if (typeof output !== "object" || output === null) {
    throw new TypeError("ANALYSIS_GOVERNED_OPERATOR_RESULT_MAPPING_REQUIRED");
  }
  const keys = Object.keys(output);
  if (keys.length > 2_048) {
    throw new TypeError("ANALYSIS_GOVERNED_OPERATOR_RESULT_SHAPE_EXCEEDED");
  }
  return Object.freeze({
    kind: "MAPPING" as const,
    keys: keys.length,
    bounded_summary: keys.sort().slice(0, 32).join(",").slice(0, 1_024),
  });
}

export function createGovernedResultBridge(input: {
  readonly authority: AnalysisGovernedResultAuthorityPort;
  readonly lease: RunWorkLease;
  readonly analysis_program_ref: ArtifactReference;
  readonly analysis_program: AnalysisProgramPayload;
  readonly program_hash: `sha256:${string}`;
  readonly node_id: string;
  readonly context_generation: number;
  readonly runtime_digest: `sha256:${string}`;
  readonly policy_version: string;
  readonly operator_registry_digest: `sha256:${string}`;
}): GovernedResultBridge {
  const recoverSession = async (
    recoveryInput: Parameters<GovernedResultBridge["recover"]>[0],
  ): Promise<readonly RecoveredGovernedOperatorResult[]> => {
    const replay = await input.authority.replay({
      lease: input.lease,
      node_id: input.node_id,
      context_generation: input.context_generation,
    });
    if (replay.actions.length > 0) {
      await recoveryInput.session.recoverAgentContext({
        replay: replay.actions,
        ...(recoveryInput.signal ? { signal: recoveryInput.signal } : {}),
      });
    }
    const recovered = [...replay.recovered_results];
    for (const result of replay.pending_results) {
      const loaded = await input.authority.load({ lease: input.lease, result });
      const binding = await recoveryInput.session.bindGovernedResult({
        governed_result: result,
        authoritative_content: loaded.result_content,
        timeout_ms: 30_000,
        ...(recoveryInput.signal ? { signal: recoveryInput.signal } : {}),
      });
      if (binding.result_sha256 !== result.result_sha256) {
        throw new TypeError("ANALYSIS_GOVERNED_RESULT_BINDING_HASH_MISMATCH");
      }
      const committed = await input.authority.commitBinding({
        lease: input.lease,
        result,
        ...binding,
        binding_template_version: "governed-result-binding@1.0.0",
      });
      recovered.push({
        result,
        result_content: loaded.result_content.slice(),
        request_content: loaded.request_content,
        receipt_payload: loaded.receipt_payload,
        binding: { ...binding, journal_seq: committed.journal_seq },
      });
    }
    return Object.freeze(recovered);
  };

  return Object.freeze({
    recordModelCell(recordInput: Parameters<GovernedResultBridge["recordModelCell"]>[0]) {
      return input.authority.commitModelCell({
        lease: input.lease,
        analysis_program_ref: input.analysis_program_ref,
        analysis_program: input.analysis_program,
        program_hash: input.program_hash,
        node_id: input.node_id,
        context_generation: input.context_generation,
        runtime_digest: input.runtime_digest,
        policy_version: input.policy_version,
        operator_registry_digest: input.operator_registry_digest,
        ...recordInput,
      });
    },
    recordOperatorIntent(recordInput: Parameters<GovernedResultBridge["recordOperatorIntent"]>[0]) {
      return input.authority.commitOperatorIntent({
        lease: input.lease,
        program_hash: input.program_hash,
        node_id: input.node_id,
        context_generation: input.context_generation,
        runtime_digest: input.runtime_digest,
        policy_version: input.policy_version,
        operator_registry_digest: input.operator_registry_digest,
        ...recordInput,
      });
    },
    async persist(persistInput: Parameters<GovernedResultBridge["persist"]>[0]) {
      const resultContent = encoder.encode(canonicalizeJson(persistInput.output));
      if (resultContent.byteLength > 16 * 1024 * 1024) {
        throw new TypeError("ANALYSIS_GOVERNED_OPERATOR_RESULT_SIZE_EXCEEDED");
      }
      const resultSha256 = await sha256ContentHash(persistInput.output);
      return input.authority.commit({
        lease: input.lease,
        analysis_program_ref: input.analysis_program_ref,
        program_hash: input.program_hash,
        node_id: input.node_id,
        context_generation: input.context_generation,
        call_id: persistInput.call_id,
        operator_id: persistInput.operator_id,
        request_sha256: persistInput.request_sha256,
        operator_registry_digest: persistInput.operator_registry_digest,
        request_content: persistInput.request_content,
        result_content: resultContent,
        result_sha256: resultSha256,
        shape: shapeSummary(persistInput.output),
        receipt_payload: Object.freeze({
          schema_version: "governed-operator-result-receipt@1.0.0",
          call_id: persistInput.call_id,
          operator_id: persistInput.operator_id,
          request_sha256: persistInput.request_sha256,
          result_sha256: resultSha256,
          execution_evidence: persistInput.execution_evidence,
        }),
      });
    },
    async bind(bindInput: Parameters<GovernedResultBridge["bind"]>[0]) {
      const loaded = await input.authority.load({ lease: input.lease, result: bindInput.result });
      let binding: Awaited<ReturnType<OpenSandboxAnalysisSession["bindGovernedResult"]>>;
      try {
        binding = await bindInput.session.bindGovernedResult({
          governed_result: bindInput.result,
          authoritative_content: loaded.result_content,
          timeout_ms: 30_000,
          ...(bindInput.signal ? { signal: bindInput.signal } : {}),
        });
      } catch (error) {
        if (
          !(error instanceof AnalysisSandboxRuntimeError) ||
          error.code !== "ANALYSIS_SANDBOX_CELL_TIMEOUT"
        ) {
          throw error;
        }
        const recovered = await recoverSession({
          session: bindInput.session,
          ...(bindInput.signal ? { signal: bindInput.signal } : {}),
        });
        const current = recovered.find(
          ({ result }) =>
            result.result_artifact_ref.artifact_id ===
            bindInput.result.result_artifact_ref.artifact_id,
        );
        if (!current) {
          throw new TypeError("ANALYSIS_GOVERNED_RESULT_PENDING_RECOVERY_MISSING");
        }
        return current.binding;
      }
      if (binding.result_sha256 !== bindInput.result.result_sha256) {
        throw new TypeError("ANALYSIS_GOVERNED_RESULT_BINDING_HASH_MISMATCH");
      }
      const journal = await input.authority.commitBinding({
        lease: input.lease,
        result: bindInput.result,
        ...binding,
        binding_template_version: "governed-result-binding@1.0.0",
      });
      return Object.freeze({ ...binding, journal_seq: journal.journal_seq });
    },
    recover: recoverSession,
  });
}

export const governedResultBridgeInternals = Object.freeze({ shapeSummary });
