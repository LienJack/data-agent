import type {
  SemanticAuthoringClaim,
  SemanticAuthoringQueuePort,
  SemanticAuthoringState,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createSemanticAuthoringWorkerCycleRunner } from "../src/semantic/authoring-worker-runner.js";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;
const runId = "00000000-0000-4000-8000-000000000011";
const principalId = "00000000-0000-4000-8000-000000000012";
const leaseToken = "00000000-0000-4000-8000-000000000013";

function claim(
  status: SemanticAuthoringState["run"]["status"] = "RUNNING",
): SemanticAuthoringClaim {
  const graph = {
    metadata: {
      graph_version: "semantic-graph-source@2" as const,
      graph_id: "00000000-0000-4000-8000-000000000014",
      domain_id: "ecommerce",
      base_release_id: null,
      capability_profile: "U5_EXECUTABLE_SUBSET" as const,
      scope,
      producer: { kind: "deterministic" as const, id: "worker-test" },
      authority: {
        kind: "deterministic" as const,
        id: "semantic-authority",
        policy_version: "semantic-authority@2.0.0",
      },
      created_at: "2026-08-15T00:00:00.000Z",
    },
    node_type_registry: [],
    edge_type_registry: [],
    evidence: [],
    nodes: [],
    edges: [],
  };
  return {
    lease: {
      schema_version: "semantic-authoring-lease@1.0.0",
      scope,
      semantic_domain: "ecommerce",
      authoring_run_id: runId,
      principal_id: principalId,
      worker_id: "semantic-worker-test",
      lease_token: leaseToken,
      writer_fence: 2,
      claimed_at: "2026-08-15T00:00:00.000Z",
      expires_at: "2026-08-15T00:05:00.000Z",
    },
    state: {
      run: {
        schema_version: "semantic-authoring-run@1.0.0",
        authority: "POSTGRESQL",
        scope,
        semantic_domain: "ecommerce",
        authoring_run_id: runId,
        candidate_id: "00000000-0000-4000-8000-000000000015",
        graph_id: graph.metadata.graph_id,
        base_release_id: null,
        principal_id: principalId,
        policy_version: "semantic-authoring-policy@1.0.0",
        status,
        working_revision: 1,
        graph_digest: `sha256:${"a".repeat(64)}`,
        writer_fence: 2,
        current_turn: 1,
        pending_request_digest: null,
        used_tool_calls: 1,
        budget: { max_turns: 8, max_tool_calls: 32 },
        validation_receipt_digest: null,
        clarification: null,
        created_at: "2026-08-15T00:00:00.000Z",
        updated_at: "2026-08-15T00:00:01.000Z",
      },
      working_graph: graph,
      checkpoint: {
        checkpoint_version: "semantic-authoring-checkpoint@1.0.0",
        messages: [{ role: "user", content: "新增成交商品数" }],
        pending_agent_request: null,
        read_node_ids: [],
        read_edge_ids: [],
        searches: [],
        pending_tool_calls: [],
        last_validation: null,
      },
      event_sequence: 3,
    },
  };
}

function queueFor(claimed: SemanticAuthoringClaim | null): {
  readonly queue: SemanticAuthoringQueuePort;
  readonly heartbeat: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
} {
  const heartbeat = vi.fn(async ({ lease }: { lease: SemanticAuthoringClaim["lease"] }) => ({
    ok: true as const,
    value: lease,
  }));
  const release = vi.fn(async () => ({ ok: true as const, value: null }));
  return {
    heartbeat,
    release,
    queue: {
      claimNext: vi.fn(async () => ({ ok: true as const, value: claimed })),
      heartbeat,
      release,
    },
  };
}

describe("Semantic authoring Worker cycle", () => {
  it("returns IDLE without constructing a model runner when no run is claimable", async () => {
    const fixture = queueFor(null);
    const createRunner = vi.fn();
    const runner = createSemanticAuthoringWorkerCycleRunner({
      queue: fixture.queue,
      create_runner: createRunner,
    });

    await expect(
      runner.runOnce({ scope, worker_id: "semantic-worker-test", lease_duration_ms: 300_000 }),
    ).resolves.toEqual({ ok: true, value: { kind: "IDLE" } });
    expect(createRunner).not.toHaveBeenCalled();
  });

  it("heartbeats before steps, recovers the checkpoint, and releases after review-ready", async () => {
    const claimed = claim();
    const completed = {
      ...claimed.state,
      run: { ...claimed.state.run, status: "READY_FOR_REVIEW" as const },
    };
    const fixture = queueFor(claimed);
    const recover = vi.fn(async (_state: SemanticAuthoringState) => ({
      ok: true as const,
      value: completed,
    }));
    const runner = createSemanticAuthoringWorkerCycleRunner({
      queue: fixture.queue,
      create_runner: (heartbeat) => ({
        start: vi.fn(),
        resume: vi.fn(),
        recover: async (state) => {
          await heartbeat();
          return recover(state);
        },
      }),
    });

    await expect(
      runner.runOnce({ scope, worker_id: "semantic-worker-test", lease_duration_ms: 300_000 }),
    ).resolves.toEqual({
      ok: true,
      value: {
        kind: "PROCESSED",
        authoring_run_id: runId,
        terminal_status: "READY_FOR_REVIEW",
        working_revision: 1,
        event_sequence: 3,
      },
    });
    expect(fixture.heartbeat).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith(claimed.state);
    expect(fixture.release).toHaveBeenCalledWith({ lease: claimed.lease });
  });

  it("releases a retryable checkpoint after provider failure", async () => {
    const claimed = claim();
    const fixture = queueFor(claimed);
    const runner = createSemanticAuthoringWorkerCycleRunner({
      queue: fixture.queue,
      create_runner: () => ({
        start: vi.fn(),
        resume: vi.fn(),
        recover: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: "SEMANTIC_AGENT_PROVIDER_FAILED",
            message: "retry",
            retryable: true,
          },
        })),
      }),
    });

    await expect(
      runner.runOnce({ scope, worker_id: "semantic-worker-test", lease_duration_ms: 300_000 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_AGENT_PROVIDER_FAILED", retryable: true },
    });
    expect(fixture.release).toHaveBeenCalledTimes(1);
  });
});
