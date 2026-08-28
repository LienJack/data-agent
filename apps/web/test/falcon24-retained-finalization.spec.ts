import {
  buildSemanticSuccessorStage,
  type SemanticSuccessorStageEnvelope,
} from "@data-agent/contracts/artifacts";
import type { Falcon24SemanticAuthorityClosure } from "@data-agent/contracts/runs";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const semanticMocks = vi.hoisted(() => ({
  verifyEnvelope: vi.fn(async (value: unknown) => value),
  validateClosure: vi.fn(async () => ({ outcome: "PASS" })),
}));

vi.mock("@data-agent/semantic/production", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@data-agent/semantic/production")>();
  return {
    ...actual,
    verifySemanticReleaseEnvelope: semanticMocks.verifyEnvelope,
    validateSemanticRuntimeClosure: semanticMocks.validateClosure,
  };
});

import { finalizeFalcon24RetainedAuthority } from "../src/lib/falcon24-retained-finalization";

const id = (suffix: number) => `91000000-0000-5000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

const scope = {
  app_id: id(1),
  tenant_id: id(2),
  environment: "test",
  semantic_domain: "falcon24_retained",
} as const;
const release = {
  release_id: id(3),
  generation: 2,
  release_digest: hash("1"),
  datasource_id: id(4),
} as const;
const projectionRefs = {
  executable: { projection_id: id(5), projection_digest: hash("2") },
  relationship: { projection_id: id(6), projection_digest: hash("3") },
  runtime_restriction: { projection_id: id(7), projection_digest: hash("4") },
  graph: { projection_id: id(8), projection_digest: hash("5") },
} as const;
const e4Authority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E4",
  baseline_id: id(9),
  baseline_hash: hash("6"),
  activation_attempt_id: id(10),
} as const;
const e5Authority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E5",
  baseline_id: id(11),
  baseline_hash: hash("7"),
  activation_attempt_id: id(12),
} as const;
const e6Authority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E6",
  baseline_id: id(18),
  baseline_hash: hash("c"),
  activation_attempt_id: id(19),
} as const;
const versions = {
  semantic_pointer: 3,
  semantic_runtime: 3,
  workspace_defaults: 4,
} as const;
const webBuild: RuntimeBuildIdentity = {
  schema_version: "runtime-build-identity@1.0.0",
  consumer_role: "web",
  generation_id: hash("8"),
  build_id: hash("9"),
  built_at: "2026-08-29T00:00:00.000Z",
  git_commit: "5272b48f",
  git_dirty: false,
};
const workerBuild: RuntimeBuildIdentity = {
  ...webBuild,
  consumer_role: "worker",
  generation_id: hash("a"),
  build_id: hash("b"),
};

async function promotedEnvelope(): Promise<SemanticSuccessorStageEnvelope> {
  const stage = await buildSemanticSuccessorStage({
    schema_version: "semantic-successor-stage@1.0.0",
    stage_id: id(13),
    scope,
    predecessor_release: {
      release_id: id(14),
      generation: 1,
      release_digest: hash("c"),
    },
    expected_pointer_version: 2,
    target_generation: 2,
    change_set_ref: { change_set_id: id(15), change_set_hash: hash("d") },
    review_ref: { review_id: id(16), review_hash: hash("e") },
    source_snapshot_ref: {
      snapshot_id: id(17),
      snapshot_revision: 1,
      snapshot_hash: hash("f"),
    },
    compiler_bundle_ref: {
      compiler_version: "semantic-change-set-publication@2",
      compiler_bundle_hash: hash("0"),
    },
    candidate_release: release,
    projection_refs: projectionRefs,
    status: "PROMOTED",
  });
  return {
    stage,
    projections: {
      executable: {
        projection_kind: "EXECUTABLE",
        ...projectionRefs.executable,
        projection_payload: { server_compiled: "executable" },
      },
      relationship: {
        projection_kind: "RELATIONSHIP",
        ...projectionRefs.relationship,
        projection_payload: { server_compiled: "relationship" },
      },
      runtime_restriction: {
        projection_kind: "RUNTIME_RESTRICTION",
        ...projectionRefs.runtime_restriction,
        projection_payload: { server_compiled: "runtime-restriction" },
      },
      graph: {
        projection_kind: "GRAPH",
        ...projectionRefs.graph,
        projection_payload: { server_compiled: "graph" },
      },
    },
  };
}

async function arrange(
  authorities: {
    readonly current: typeof e4Authority | typeof e5Authority;
    readonly target: typeof e5Authority | typeof e6Authority;
  } = { current: e4Authority, target: e5Authority },
) {
  const published = await promotedEnvelope();
  const before: Falcon24SemanticAuthorityClosure = {
    schema_version: "falcon24-semantic-authority-closure@1.0.0",
    scope,
    authority: authorities.current,
    semantic_pointer: { version: versions.semantic_pointer, release },
    semantic_runtime: { version: versions.semantic_runtime, release },
    workspace_defaults: { version: versions.workspace_defaults, release },
  };
  const after: Falcon24SemanticAuthorityClosure = {
    ...before,
    authority: authorities.target,
  };
  const events: string[] = [];
  const loadCurrentClosure = vi
    .fn()
    .mockImplementationOnce(async () => {
      events.push("load-current");
      return before;
    })
    .mockImplementationOnce(async () => {
      events.push("load-current-readback");
      return after;
    });
  const loadPublishedRelease = vi.fn(async () => {
    events.push("load-published");
    return published;
  });
  const stageFalconAuthority = vi.fn(async () => {
    events.push(`stage-${authorities.target.authority_epoch.toLowerCase()}`);
    return {
      baseline_ref: {
        baseline_id: authorities.target.baseline_id,
        baseline_hash: authorities.target.baseline_hash,
      },
      activation_attempt_ref: {
        activation_attempt_id: authorities.target.activation_attempt_id,
      },
    };
  });
  const activateRetained = vi.fn(async () => {
    events.push(`activate-${authorities.target.authority_epoch.toLowerCase()}`);
    return { ok: true as const, value: authorities.target };
  });
  const holdActivationAttempt = vi.fn(async () => {
    events.push(`hold-${authorities.target.authority_epoch.toLowerCase()}`);
  });
  return {
    published,
    before,
    after,
    events,
    input: {
      capability: { authority: `falcon24-${authorities.target.authority_epoch.toLowerCase()}` },
      authority_epoch: authorities.target.authority_epoch,
      web_build_identity: webBuild,
      worker_build_identity: workerBuild,
      epoch: { activateRetained },
      readback: { loadCurrentClosure, loadPublishedRelease },
      stage_falcon_authority: stageFalconAuthority,
      hold_activation_attempt: holdActivationAttempt,
    },
    calls: {
      loadCurrentClosure,
      loadPublishedRelease,
      stageFalconAuthority,
      activateRetained,
      holdActivationAttempt,
    },
  };
}

describe("Falcon24 retained semantic finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    semanticMocks.validateClosure.mockResolvedValue({ outcome: "PASS" });
  });

  it("advances E4 to E5 while retaining the exact gen2 closure and versions", async () => {
    const arranged = await arrange();

    const result = await finalizeFalcon24RetainedAuthority(arranged.input);

    expect(arranged.events).toEqual([
      "load-current",
      "load-published",
      "stage-e5",
      "activate-e5",
      "load-current-readback",
      "load-published",
    ]);
    expect(result.authority).toEqual(e5Authority);
    expect(result.readback.semantic_pointer).toEqual(arranged.before.semantic_pointer);
    expect(result.readback.semantic_runtime).toEqual(arranged.before.semantic_runtime);
    expect(result.readback.workspace_defaults).toEqual(arranged.before.workspace_defaults);
    expect(result.semantic_proof.semantic_release).toEqual(release);
    expect(result.semantic_proof.projections).toEqual(projectionRefs);
    expect(result.semantic_proof.web_build).toEqual({
      build_id: webBuild.build_id,
      generation_id: webBuild.generation_id,
    });
    expect(result.semantic_proof.worker_build).toEqual({
      build_id: workerBuild.build_id,
      generation_id: workerBuild.generation_id,
    });
    expect(JSON.stringify(arranged.calls.activateRetained.mock.calls[0])).not.toContain(
      "projection_payload",
    );
    expect(arranged.calls.holdActivationAttempt).not.toHaveBeenCalled();
  });

  it("advances E5 to E6 through the same retained semantic authority", async () => {
    const arranged = await arrange({ current: e5Authority, target: e6Authority });

    const result = await finalizeFalcon24RetainedAuthority(arranged.input);

    expect(arranged.events).toEqual([
      "load-current",
      "load-published",
      "stage-e6",
      "activate-e6",
      "load-current-readback",
      "load-published",
    ]);
    expect(result.authority).toEqual(e6Authority);
    expect(result.readback.semantic_pointer).toEqual(arranged.before.semantic_pointer);
    expect(result.readback.semantic_runtime).toEqual(arranged.before.semantic_runtime);
    expect(result.readback.workspace_defaults).toEqual(arranged.before.workspace_defaults);
  });

  it("holds the exact E5 attempt once when retained activation fails", async () => {
    const arranged = await arrange();
    const failure = new TypeError("FALCON24_RETAINED_ACTIVATION_BASELINE_MISMATCH");
    arranged.calls.activateRetained.mockRejectedValueOnce(failure);

    await expect(finalizeFalcon24RetainedAuthority(arranged.input)).rejects.toBe(failure);
    expect(arranged.calls.holdActivationAttempt).toHaveBeenCalledWith({
      schema_version: "falcon24-activation-request@2.0.0",
      authority_epoch: "E5",
      attempt_id: e5Authority.activation_attempt_id,
      baseline_id: e5Authority.baseline_id,
      expected_baseline_hash: e5Authority.baseline_hash,
      failure_code: "FALCON24_RETAINED_ACTIVATION_BASELINE_MISMATCH",
    });
    expect(arranged.calls.loadCurrentClosure).toHaveBeenCalledTimes(1);
  });

  it("reports a severe incident after commit when any retained version drifts", async () => {
    const arranged = await arrange();
    arranged.calls.loadCurrentClosure.mockReset();
    arranged.calls.loadCurrentClosure.mockResolvedValueOnce(arranged.before).mockResolvedValueOnce({
      ...arranged.after,
      semantic_pointer: {
        version: arranged.after.semantic_pointer.version + 1,
        release,
      },
    });

    await expect(finalizeFalcon24RetainedAuthority(arranged.input)).rejects.toThrow(
      "FALCON24_RETAINED_POST_ACTIVATION_READBACK_MISMATCH",
    );
    expect(arranged.calls.activateRetained).toHaveBeenCalledTimes(1);
    expect(arranged.calls.holdActivationAttempt).not.toHaveBeenCalled();
    expect(arranged.calls.loadPublishedRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-E4 or non-gen2 preflight before staging", async () => {
    const arranged = await arrange();
    arranged.calls.loadCurrentClosure.mockReset();
    arranged.calls.loadCurrentClosure.mockResolvedValueOnce({
      ...arranged.before,
      semantic_pointer: {
        ...arranged.before.semantic_pointer,
        release: { ...release, generation: 1 },
      },
    });

    await expect(finalizeFalcon24RetainedAuthority(arranged.input)).rejects.toThrow(
      "FALCON24_RETAINED_SEMANTIC_CLOSURE_MISMATCH",
    );
    expect(arranged.calls.stageFalconAuthority).not.toHaveBeenCalled();
    expect(arranged.calls.activateRetained).not.toHaveBeenCalled();
  });
});
