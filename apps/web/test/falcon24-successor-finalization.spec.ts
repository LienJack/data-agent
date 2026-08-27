import {
  buildSemanticRuntimeClosureValidationReceipt,
  buildSemanticRuntimeSmokeReceipt,
  buildSemanticSuccessorStage,
  type SemanticSuccessorStageEnvelope,
  type StageReviewedSemanticSuccessorCommand,
} from "@data-agent/contracts/artifacts";
import {
  buildCombinedFalcon24SemanticActivationReceipt,
  type CombinedFalcon24SemanticActivationCommand,
} from "@data-agent/contracts/runs";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const semanticMocks = vi.hoisted(() => ({
  verifyEnvelope: vi.fn(async (value: unknown) => value),
  validateClosure: vi.fn(),
}));

vi.mock("@data-agent/semantic/production", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@data-agent/semantic/production")>();
  return {
    ...actual,
    verifySemanticReleaseEnvelope: semanticMocks.verifyEnvelope,
    validateSemanticRuntimeClosure: semanticMocks.validateClosure,
  };
});

import {
  type Falcon24SuccessorSmokePort,
  finalizeFalcon24SemanticSuccessor,
} from "../src/lib/falcon24-successor-finalization";

const id = (suffix: number) => `90000000-0000-5000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

const scope = {
  app_id: id(1),
  tenant_id: id(2),
  environment: "test",
  semantic_domain: "falcon24_successor",
} as const;
const predecessor = {
  release_id: id(3),
  generation: 1,
  release_digest: hash("1"),
  datasource_id: id(4),
} as const;
const candidate = {
  release_id: id(5),
  generation: 2,
  release_digest: hash("2"),
  datasource_id: predecessor.datasource_id,
} as const;
const projectionRefs = {
  executable: { projection_id: id(6), projection_digest: hash("3") },
  relationship: { projection_id: id(7), projection_digest: hash("4") },
  runtime_restriction: { projection_id: id(8), projection_digest: hash("5") },
  graph: { projection_id: id(9), projection_digest: hash("6") },
} as const;
const expectedVersions = {
  semantic_pointer: 7,
  semantic_runtime: 9,
  workspace_defaults: 11,
} as const;
const expectedAuthority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E3",
  baseline_id: id(10),
  baseline_hash: hash("7"),
  activation_attempt_id: id(11),
} as const;
const activatedAuthority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E4",
  baseline_id: id(12),
  baseline_hash: hash("8"),
  activation_attempt_id: id(13),
} as const;
const buildIdentity: RuntimeBuildIdentity = {
  schema_version: "runtime-build-identity@1.0.0",
  consumer_role: "worker",
  generation_id: hash("9"),
  build_id: hash("a"),
  built_at: "2026-08-28T00:00:00.000Z",
  git_commit: "a26b976e",
  git_dirty: false,
};

async function arrange() {
  const command: StageReviewedSemanticSuccessorCommand = {
    schema_version: "stage-reviewed-semantic-successor-command@1.0.0",
    command_id: id(14),
    idempotency_key: "falcon24-generation-2",
    scope,
    change_set_ref: { change_set_id: id(15), change_set_hash: hash("b") },
    review_ref: { review_id: id(16), review_hash: hash("c") },
    source_snapshot_ref: {
      snapshot_id: id(17),
      snapshot_revision: 1,
      snapshot_hash: hash("d"),
    },
    compiler_bundle_ref: {
      compiler_version: "semantic-change-set-publication@2",
      compiler_bundle_hash: hash("e"),
    },
    expected_predecessor: {
      release_id: predecessor.release_id,
      generation: predecessor.generation,
      release_digest: predecessor.release_digest,
    },
    expected_pointer_version: expectedVersions.semantic_pointer,
    target_generation: candidate.generation,
  };
  const stageBase = {
    schema_version: "semantic-successor-stage@1.0.0" as const,
    stage_id: id(18),
    scope,
    predecessor_release: command.expected_predecessor,
    expected_pointer_version: command.expected_pointer_version,
    target_generation: command.target_generation,
    change_set_ref: command.change_set_ref,
    review_ref: command.review_ref,
    source_snapshot_ref: command.source_snapshot_ref,
    compiler_bundle_ref: command.compiler_bundle_ref,
    candidate_release: candidate,
    projection_refs: projectionRefs,
  };
  const staged = await buildSemanticSuccessorStage({ ...stageBase, status: "STAGED" });
  const smokePassed = await buildSemanticSuccessorStage({
    ...stageBase,
    status: "SMOKE_PASSED",
  });
  const promoted = await buildSemanticSuccessorStage({ ...stageBase, status: "PROMOTED" });
  const projections = {
    executable: {
      projection_kind: "EXECUTABLE" as const,
      ...projectionRefs.executable,
      projection_payload: { server_compiled: "executable" },
    },
    relationship: {
      projection_kind: "RELATIONSHIP" as const,
      ...projectionRefs.relationship,
      projection_payload: { server_compiled: "relationship" },
    },
    runtime_restriction: {
      projection_kind: "RUNTIME_RESTRICTION" as const,
      ...projectionRefs.runtime_restriction,
      projection_payload: { server_compiled: "runtime-restriction" },
    },
    graph: {
      projection_kind: "GRAPH" as const,
      ...projectionRefs.graph,
      projection_payload: { server_compiled: "graph" },
    },
  };
  const stagedEnvelope: SemanticSuccessorStageEnvelope = { stage: staged, projections };
  const smokePassedEnvelope: SemanticSuccessorStageEnvelope = {
    stage: smokePassed,
    projections,
  };
  const promotedEnvelope: SemanticSuccessorStageEnvelope = { stage: promoted, projections };
  const validation = await buildSemanticRuntimeClosureValidationReceipt({
    schema_version: "semantic-runtime-closure-validation-receipt@1.0.0",
    receipt_id: id(19),
    stage_id: staged.stage_id,
    stage_digest: staged.stage_digest,
    candidate_release: candidate,
    projection_refs: projectionRefs,
    validator_identity: {
      validator_version: "semantic-runtime-closure-validator@1.0.0",
      validator_hash: hash("f"),
    },
    outcome: "PASS",
    reason_codes: [],
  });
  const smoke = await buildSemanticRuntimeSmokeReceipt({
    schema_version: "semantic-runtime-smoke-receipt@1.0.0",
    receipt_id: id(20),
    stage_id: staged.stage_id,
    stage_digest: staged.stage_digest,
    candidate_release: candidate,
    projection_refs: projectionRefs,
    resolved_metric_id: "metric.order_revenue",
    resolved_dimension_id: "dimension.order_month",
    resolved_binding_hash: hash("0"),
    plan_hash: hash("1"),
    calendar_timezone: "Asia/Shanghai",
    window_start: "2023-11-01T00:00:00.000Z",
    window_end_exclusive: "2024-11-01T00:00:00.000Z",
    validator_identity: validation.validator_identity,
    worker_build_identity: buildIdentity,
    outcome: "PASS",
    failure_code: null,
  });
  semanticMocks.verifyEnvelope.mockImplementation(async (value: unknown) => value);
  semanticMocks.validateClosure.mockResolvedValue(validation);

  const events: string[] = [];
  const preActivation = {
    scope,
    authority: expectedAuthority,
    semantic_pointer: { version: expectedVersions.semantic_pointer, release: predecessor },
    semantic_runtime: { version: expectedVersions.semantic_runtime, release: predecessor },
    workspace_defaults: { version: expectedVersions.workspace_defaults, release: predecessor },
  } as const;
  const postActivation = {
    scope,
    authority: activatedAuthority,
    semantic_pointer: { version: expectedVersions.semantic_pointer + 1, release: candidate },
    semantic_runtime: { version: expectedVersions.semantic_runtime + 1, release: candidate },
    workspace_defaults: { version: expectedVersions.workspace_defaults + 1, release: candidate },
  } as const;
  const loadCurrentClosure = vi
    .fn()
    .mockImplementationOnce(async () => {
      events.push("load-preflight");
      return preActivation;
    })
    .mockImplementationOnce(async () => {
      events.push("load-readback");
      return postActivation;
    });
  const loadPublishedRelease = vi.fn(async () => {
    events.push("load-published-release");
    return promotedEnvelope;
  });
  const stageReviewedSuccessor = vi.fn(async () => {
    events.push("stage-successor");
    return stagedEnvelope;
  });
  const loadStagedSuccessor = vi.fn(async () => {
    events.push("load-smoke-passed-stage");
    return smokePassedEnvelope;
  });
  const runSmoke = vi.fn<Falcon24SuccessorSmokePort["run"]>(async () => {
    events.push("run-smoke");
    return { ok: true as const, value: smoke };
  });
  const stageFalconAuthority = vi.fn(async () => {
    events.push("stage-e4-authority");
    return {
      baseline_ref: {
        baseline_id: activatedAuthority.baseline_id,
        baseline_hash: activatedAuthority.baseline_hash,
      },
      activation_attempt_ref: {
        activation_attempt_id: activatedAuthority.activation_attempt_id,
      },
    };
  });
  let combinedCommand: CombinedFalcon24SemanticActivationCommand | null = null;
  const promoteStagedSuccessor = vi.fn(
    async (received: CombinedFalcon24SemanticActivationCommand) => {
      events.push("promote-combined");
      combinedCommand = received;
      return buildCombinedFalcon24SemanticActivationReceipt({
        schema_version: "combined-falcon24-semantic-activation-receipt@1.0.0",
        command_id: received.command_id,
        command_hash: received.command_hash,
        scope,
        authority: activatedAuthority,
        semantic_release: candidate,
        workspace_defaults: {
          version: expectedVersions.workspace_defaults + 1,
          semantic_release: candidate,
        },
        stage_ref: received.stage_ref,
        smoke_receipt_ref: received.smoke_receipt_ref,
        outbox_event_id: id(21),
        transaction_id: "xid:9001",
      });
    },
  );

  return {
    command,
    events,
    validation,
    smoke,
    stagedEnvelope,
    smokePassedEnvelope,
    promotedEnvelope,
    preActivation,
    postActivation,
    ports: {
      publication_authority: {
        stageReviewedSuccessor,
        loadStagedSuccessor,
        promoteStagedSuccessor,
        publishAtomically: vi.fn(),
      },
      smoke: { run: runSmoke },
      stage_falcon_authority: stageFalconAuthority,
      readback: { loadCurrentClosure, loadPublishedRelease },
    },
    calls: {
      stageReviewedSuccessor,
      loadStagedSuccessor,
      runSmoke,
      stageFalconAuthority,
      promoteStagedSuccessor,
      loadCurrentClosure,
      loadPublishedRelease,
    },
    combinedCommand: () => combinedCommand,
  };
}

function finalizationInput(arranged: Awaited<ReturnType<typeof arrange>>) {
  return {
    stage_command: arranged.command,
    smoke_idempotency_key: "falcon24-generation-2-smoke",
    worker_build_identity: buildIdentity,
    smoke_capability: { authority: "worker-smoke" },
    activation: { command_id: id(22), idempotency_key: "falcon24-e4-activation" },
    ...arranged.ports,
  } as const;
}

describe("Falcon24 semantic successor finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stages, smokes, proves, atomically promotes, then verifies production readback", async () => {
    const arranged = await arrange();

    const result = await finalizeFalcon24SemanticSuccessor(finalizationInput(arranged));

    expect(arranged.events).toEqual([
      "load-preflight",
      "stage-successor",
      "run-smoke",
      "load-smoke-passed-stage",
      "stage-e4-authority",
      "promote-combined",
      "load-readback",
      "load-published-release",
    ]);
    expect(result.semantic_proof.predecessor_release).toEqual(predecessor);
    expect(result.semantic_proof.candidate_release).toEqual(candidate);
    expect(result.activation_receipt.authority).toEqual(activatedAuthority);
    expect(result.published_release.stage.status).toBe("PROMOTED");
    expect(arranged.calls.runSmoke).toHaveBeenCalledWith(
      expect.objectContaining({ capability: { authority: "worker-smoke" } }),
    );

    const combined = arranged.combinedCommand();
    expect(combined).not.toBeNull();
    expect(Object.keys(combined ?? {}).sort()).toEqual(
      [
        "activation_attempt_ref",
        "authority_epoch",
        "baseline_ref",
        "command_hash",
        "command_id",
        "expected_current_authority",
        "expected_semantic_predecessor",
        "expected_versions",
        "idempotency_key",
        "schema_version",
        "scope",
        "smoke_receipt_ref",
        "stage_ref",
      ].sort(),
    );
    expect(JSON.stringify(combined)).not.toContain("projection_payload");
    expect(JSON.stringify(combined)).not.toContain("projection_digest");
  });

  it("fails closed before E4 staging when deterministic smoke fails", async () => {
    const arranged = await arrange();
    arranged.calls.runSmoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "SEMANTIC_RUNTIME_SMOKE_PLAN_INVALID",
        message: "Smoke failed.",
        retryable: false,
      },
    });

    await expect(finalizeFalcon24SemanticSuccessor(finalizationInput(arranged))).rejects.toThrow(
      "SEMANTIC_RUNTIME_SMOKE_PLAN_INVALID",
    );
    expect(arranged.calls.stageFalconAuthority).not.toHaveBeenCalled();
    expect(arranged.calls.promoteStagedSuccessor).not.toHaveBeenCalled();
    expect(arranged.calls.loadCurrentClosure).toHaveBeenCalledTimes(1);
  });

  it("rejects a smoke receipt produced by a different Worker build", async () => {
    const arranged = await arrange();
    const { smoke_receipt_hash: _receiptHash, ...smokeMaterial } = arranged.smoke;
    const wrongBuildSmoke = await buildSemanticRuntimeSmokeReceipt({
      ...smokeMaterial,
      worker_build_identity: {
        ...buildIdentity,
        generation_id: hash("b"),
        build_id: hash("c"),
      },
    });
    arranged.calls.runSmoke.mockResolvedValueOnce({ ok: true, value: wrongBuildSmoke });

    await expect(finalizeFalcon24SemanticSuccessor(finalizationInput(arranged))).rejects.toThrow(
      "FALCON24_SEMANTIC_SUCCESSOR_SMOKE_BUILD_MISMATCH",
    );
    expect(arranged.calls.stageFalconAuthority).not.toHaveBeenCalled();
    expect(arranged.calls.promoteStagedSuccessor).not.toHaveBeenCalled();
  });

  it("rejects a rejected successor before running smoke", async () => {
    const arranged = await arrange();
    const rejected = await buildSemanticSuccessorStage({
      ...arranged.stagedEnvelope.stage,
      status: "REJECTED",
    });
    arranged.calls.stageReviewedSuccessor.mockResolvedValueOnce({
      ...arranged.stagedEnvelope,
      stage: rejected,
    });

    await expect(finalizeFalcon24SemanticSuccessor(finalizationInput(arranged))).rejects.toThrow(
      "FALCON24_SEMANTIC_SUCCESSOR_STAGE_NOT_SMOKEABLE",
    );
    expect(arranged.calls.runSmoke).not.toHaveBeenCalled();
    expect(arranged.calls.stageFalconAuthority).not.toHaveBeenCalled();
  });

  it("reports a severe incident after commit when any production readback is mixed", async () => {
    const arranged = await arrange();
    arranged.calls.loadCurrentClosure.mockReset();
    arranged.calls.loadCurrentClosure
      .mockResolvedValueOnce(arranged.preActivation)
      .mockResolvedValueOnce({
        ...arranged.postActivation,
        semantic_runtime: {
          version: expectedVersions.semantic_runtime + 1,
          release: predecessor,
        },
      });

    await expect(finalizeFalcon24SemanticSuccessor(finalizationInput(arranged))).rejects.toThrow(
      "FALCON24_POST_ACTIVATION_READBACK_MISMATCH",
    );
    expect(arranged.calls.promoteStagedSuccessor).toHaveBeenCalledTimes(1);
    expect(arranged.calls.loadPublishedRelease).not.toHaveBeenCalled();
  });

  it("rejects a combined receipt that does not bind the staged baseline and attempt", async () => {
    const arranged = await arrange();
    arranged.calls.promoteStagedSuccessor.mockImplementationOnce(async (received) =>
      buildCombinedFalcon24SemanticActivationReceipt({
        schema_version: "combined-falcon24-semantic-activation-receipt@1.0.0",
        command_id: received.command_id,
        command_hash: received.command_hash,
        scope,
        authority: {
          ...activatedAuthority,
          baseline_id: id(30),
          baseline_hash: hash("3"),
          activation_attempt_id: id(31),
        },
        semantic_release: candidate,
        workspace_defaults: {
          version: expectedVersions.workspace_defaults + 1,
          semantic_release: candidate,
        },
        stage_ref: received.stage_ref,
        smoke_receipt_ref: received.smoke_receipt_ref,
        outbox_event_id: id(32),
        transaction_id: "xid:9002",
      }),
    );

    await expect(finalizeFalcon24SemanticSuccessor(finalizationInput(arranged))).rejects.toThrow(
      "FALCON24_COMBINED_ACTIVATION_RECEIPT_MISMATCH",
    );
    expect(arranged.calls.loadCurrentClosure).toHaveBeenCalledTimes(1);
  });

  it("turns a post-commit read failure into a stable severe incident", async () => {
    const arranged = await arrange();
    arranged.calls.loadCurrentClosure.mockReset();
    arranged.calls.loadCurrentClosure
      .mockResolvedValueOnce(arranged.preActivation)
      .mockRejectedValueOnce(new Error("connection reset by peer"));

    await expect(finalizeFalcon24SemanticSuccessor(finalizationInput(arranged))).rejects.toThrow(
      "FALCON24_POST_ACTIVATION_READBACK_FAILED",
    );
    expect(arranged.calls.promoteStagedSuccessor).toHaveBeenCalledTimes(1);
  });

  it("rejects stale predecessor CAS before creating a successor stage", async () => {
    const arranged = await arrange();
    arranged.calls.loadCurrentClosure.mockReset();
    arranged.calls.loadCurrentClosure.mockResolvedValueOnce({
      ...arranged.preActivation,
      semantic_pointer: {
        version: expectedVersions.semantic_pointer + 1,
        release: predecessor,
      },
    });

    await expect(finalizeFalcon24SemanticSuccessor(finalizationInput(arranged))).rejects.toThrow(
      "FALCON24_SEMANTIC_SUCCESSOR_PREFLIGHT_MISMATCH",
    );
    expect(arranged.calls.stageReviewedSuccessor).not.toHaveBeenCalled();
  });
});
