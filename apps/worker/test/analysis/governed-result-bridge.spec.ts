import type { GovernedOperatorResultRef } from "@data-agent/contracts/ports";
import { describe, expect, it, vi } from "vitest";
import {
  type AnalysisGovernedResultAuthorityPort,
  createGovernedResultBridge,
} from "../../src/analysis/governed-result-bridge.js";
import type { OpenSandboxAnalysisSession } from "../../src/runs/opensandbox-analysis-runtime.js";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const result: GovernedOperatorResultRef = {
  schema_version: "governed-operator-result-ref@1.0.0",
  scope: {
    app_id: "019d2d97-110c-7735-8fbb-000000000001",
    tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
    environment: "test",
  },
  run_id: "019d2d97-110c-7735-8fbb-000000000003",
  node_id: "node-1",
  attempt_id: "019d2d97-110c-7735-8fbb-000000000004",
  context_generation: 1,
  call_id: "bh",
  operator_id: "multiple-testing.bh-fdr@1",
  program_hash: hash("a"),
  request_sha256: hash("b"),
  result_artifact_ref: {
    artifact_id: "019d2d97-110c-7735-8fbb-000000000005",
    artifact_type: "SandboxResult",
    app_id: "019d2d97-110c-7735-8fbb-000000000001",
    tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
    environment: "test",
    run_id: "019d2d97-110c-7735-8fbb-000000000003",
    revision: 1,
    content_hash: hash("c"),
  },
  result_sha256: hash("c"),
  result_bytes: 2,
  shape: { kind: "MAPPING", keys: 0, bounded_summary: "" },
  receipt_ref: {
    artifact_id: "019d2d97-110c-7735-8fbb-000000000006",
    artifact_type: "SandboxExecutionReceipt",
    app_id: "019d2d97-110c-7735-8fbb-000000000001",
    tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
    environment: "test",
    run_id: "019d2d97-110c-7735-8fbb-000000000003",
    revision: 1,
    content_hash: hash("d"),
  },
  worker_fence: 1,
};

describe("Governed Result Bridge recovery", () => {
  it("replays the exact ordered MODEL_CELL and SERVER_BINDING Journal after a generation restart", async () => {
    const actions = [
      {
        action_type: "MODEL_CELL" as const,
        journal_seq: 1,
        cell_id: "prepare",
        source: "operator_inputs = {'p_values': [0.01]}",
        source_sha256: hash("1"),
        timeout_ms: 1_000,
      },
      {
        action_type: "SERVER_BINDING" as const,
        journal_seq: 4,
        governed_result: result,
        authoritative_content: new TextEncoder().encode("{}"),
        expected_symbol: "__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
        expected_binding_id: "binding-aaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ];
    const recoveredResult = {
      result,
      request_content: new TextEncoder().encode('{"request":true}'),
      receipt_payload: { receipt: true },
      binding: {
        binding_id: "binding-aaaaaaaaaaaaaaaaaaaaaaaa",
        result_symbol: "__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
        result_sha256: result.result_sha256 as `sha256:${string}`,
        journal_seq: 4,
      },
    };
    const authority: AnalysisGovernedResultAuthorityPort = {
      commitModelCell: vi.fn(),
      commitOperatorIntent: vi.fn(),
      commit: vi.fn(),
      load: vi.fn(),
      commitBinding: vi.fn(),
      replay: vi.fn(async () => ({
        actions,
        pending_results: [],
        recovered_results: [recoveredResult],
      })),
    };
    const recoverAgentContext = vi.fn();
    const session = { recoverAgentContext } as unknown as OpenSandboxAnalysisSession;
    const bridge = createGovernedResultBridge({
      authority,
      lease: {
        scope: result.scope,
        run_id: result.run_id,
        attempt_id: result.attempt_id,
        principal_id: "019d2d97-110c-7735-8fbb-000000000007",
        worker_fence: 1,
      } as never,
      analysis_program_ref: {} as never,
      analysis_program: {} as never,
      program_hash: result.program_hash as `sha256:${string}`,
      node_id: result.node_id,
      context_generation: result.context_generation,
      runtime_digest: hash("e"),
      policy_version: "analysis-cell-policy@1.0.0",
      operator_registry_digest: hash("f"),
    });

    await expect(bridge.recover({ session })).resolves.toEqual([recoveredResult]);
    expect(recoverAgentContext).toHaveBeenCalledWith({ replay: actions });
  });

  it("binds a committed pending result exactly once without rerunning its operator", async () => {
    const requestContent = new TextEncoder().encode('{"request":true}');
    const resultContent = new TextEncoder().encode("{}");
    const authority: AnalysisGovernedResultAuthorityPort = {
      commitModelCell: vi.fn(),
      commitOperatorIntent: vi.fn(),
      commit: vi.fn(),
      load: vi.fn(async () => ({
        result_content: resultContent,
        request_content: requestContent,
        receipt_payload: { receipt: true },
      })),
      commitBinding: vi.fn(async () => ({ journal_seq: 3 })),
      replay: vi.fn(async () => ({
        actions: [],
        pending_results: [result],
        recovered_results: [],
      })),
    };
    const runOperator = vi.fn();
    const bindGovernedResult = vi.fn(async () => ({
      binding_id: "binding-aaaaaaaaaaaaaaaaaaaaaaaa",
      result_symbol: "__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
      result_sha256: result.result_sha256 as `sha256:${string}`,
    }));
    const session = {
      recoverAgentContext: vi.fn(),
      bindGovernedResult,
      runOperator,
    } as unknown as OpenSandboxAnalysisSession;
    const bridge = createGovernedResultBridge({
      authority,
      lease: {
        scope: result.scope,
        run_id: result.run_id,
        attempt_id: result.attempt_id,
        principal_id: "019d2d97-110c-7735-8fbb-000000000007",
        worker_fence: 1,
      } as never,
      analysis_program_ref: {} as never,
      analysis_program: {} as never,
      program_hash: result.program_hash as `sha256:${string}`,
      node_id: result.node_id,
      context_generation: result.context_generation,
      runtime_digest: hash("e"),
      policy_version: "analysis-cell-policy@1.0.0",
      operator_registry_digest: hash("f"),
    });

    const recovered = await bridge.recover({ session });

    expect(runOperator).not.toHaveBeenCalled();
    expect(bindGovernedResult).toHaveBeenCalledOnce();
    expect(authority.commitBinding).toHaveBeenCalledOnce();
    expect(recovered).toEqual([
      expect.objectContaining({
        result,
        request_content: requestContent,
        receipt_payload: { receipt: true },
        binding: expect.objectContaining({ journal_seq: 3 }),
      }),
    ]);
  });

  it("rejects a pending-result Binding hash substitution before committing the Journal entry", async () => {
    const authority: AnalysisGovernedResultAuthorityPort = {
      commitModelCell: vi.fn(),
      commitOperatorIntent: vi.fn(),
      commit: vi.fn(),
      load: vi.fn(async () => ({
        result_content: new TextEncoder().encode("{}"),
        request_content: new TextEncoder().encode('{"request":true}'),
        receipt_payload: { receipt: true },
      })),
      commitBinding: vi.fn(),
      replay: vi.fn(async () => ({
        actions: [],
        pending_results: [result],
        recovered_results: [],
      })),
    };
    const session = {
      recoverAgentContext: vi.fn(),
      bindGovernedResult: vi.fn(async () => ({
        binding_id: "binding-aaaaaaaaaaaaaaaaaaaaaaaa",
        result_symbol: "__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
        result_sha256: hash("f"),
      })),
    } as unknown as OpenSandboxAnalysisSession;
    const bridge = createGovernedResultBridge({
      authority,
      lease: {
        scope: result.scope,
        run_id: result.run_id,
        attempt_id: result.attempt_id,
        principal_id: "019d2d97-110c-7735-8fbb-000000000007",
        worker_fence: 1,
      } as never,
      analysis_program_ref: {} as never,
      analysis_program: {} as never,
      program_hash: result.program_hash as `sha256:${string}`,
      node_id: result.node_id,
      context_generation: result.context_generation,
      runtime_digest: hash("e"),
      policy_version: "analysis-cell-policy@1.0.0",
      operator_registry_digest: hash("f"),
    });

    await expect(bridge.recover({ session })).rejects.toThrow(
      "ANALYSIS_GOVERNED_RESULT_BINDING_HASH_MISMATCH",
    );
    expect(authority.commitBinding).not.toHaveBeenCalled();
  });

  it("rejects an operator result larger than 16 MiB before PostgreSQL persistence", async () => {
    const authority: AnalysisGovernedResultAuthorityPort = {
      commitModelCell: vi.fn(),
      commitOperatorIntent: vi.fn(),
      commit: vi.fn(),
      load: vi.fn(),
      commitBinding: vi.fn(),
      replay: vi.fn(),
    };
    const bridge = createGovernedResultBridge({
      authority,
      lease: {
        scope: result.scope,
        run_id: result.run_id,
        attempt_id: result.attempt_id,
        principal_id: "019d2d97-110c-7735-8fbb-000000000007",
        worker_fence: 1,
      } as never,
      analysis_program_ref: {} as never,
      analysis_program: {} as never,
      program_hash: result.program_hash as `sha256:${string}`,
      node_id: result.node_id,
      context_generation: result.context_generation,
      runtime_digest: hash("e"),
      policy_version: "analysis-cell-policy@1.0.0",
      operator_registry_digest: hash("f"),
    });

    await expect(
      bridge.persist({
        call_id: "oversized",
        operator_id: "multiple-testing.bh-fdr@1",
        request_sha256: result.request_sha256 as `sha256:${string}`,
        operator_registry_digest: hash("f"),
        request_content: new TextEncoder().encode("{}"),
        output: { payload: "x".repeat(16 * 1024 * 1024 + 1) },
        execution_evidence: {},
      }),
    ).rejects.toThrow("ANALYSIS_GOVERNED_OPERATOR_RESULT_SIZE_EXCEEDED");
    expect(authority.commit).not.toHaveBeenCalled();
  });
});
