import {
  buildSemanticSuccessorStage,
  type SemanticSuccessorStageEnvelope,
} from "@data-agent/contracts/artifacts";
import {
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
  buildFalcon24FourLayerTerminalReceipt,
} from "@data-agent/contracts/evals";
import type { ModelExecutionCertificationClaims } from "@data-agent/contracts/providers";
import type { Falcon24SemanticAuthorityClosure } from "@data-agent/contracts/runs";
import {
  buildFalcon24LlmExecutionAuthorityProof,
  falcon24ActivationRequestV8Schema,
} from "@data-agent/contracts/runs";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
import type { ProviderExecutionProfile } from "@data-agent/contracts/workspaces";
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
const e7Authority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E7",
  baseline_id: id(20),
  baseline_hash: hash("d"),
  activation_attempt_id: id(21),
} as const;
const e8Authority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E8",
  baseline_id: id(30),
  baseline_hash: hash("e"),
  activation_attempt_id: id(31),
} as const;
const e9Authority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E9",
  baseline_id: id(48),
  baseline_hash: hash("f"),
  activation_attempt_id: id(49),
} as const;
const e10Authority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E10",
  baseline_id: id(58),
  baseline_hash: hash("0"),
  activation_attempt_id: id(59),
} as const;
const e11Authority = {
  schema_version: "falcon24-authority-binding@2.0.0",
  authority_epoch: "E11",
  baseline_id: id(68),
  baseline_hash: hash("a"),
  activation_attempt_id: id(69),
} as const;
const e12Authority = {
  ...e11Authority,
  authority_epoch: "E12",
  baseline_id: id(78),
  baseline_hash: hash("b"),
  activation_attempt_id: id(79),
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
    readonly current:
      | typeof e4Authority
      | typeof e5Authority
      | typeof e6Authority
      | typeof e7Authority
      | typeof e8Authority
      | typeof e9Authority
      | typeof e10Authority
      | typeof e11Authority;
    readonly target:
      | typeof e5Authority
      | typeof e6Authority
      | typeof e7Authority
      | typeof e8Authority
      | typeof e9Authority
      | typeof e10Authority
      | typeof e11Authority
      | typeof e12Authority;
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
  const activateRetainedWithRecovery = vi.fn(async (_capability: unknown, envelope: unknown) => {
    events.push(`activate-recovery-${authorities.target.authority_epoch.toLowerCase()}`);
    const request = (envelope as { request: { command_hash: `sha256:${string}` } }).request;
    return {
      ok: true as const,
      value: {
        schema_version: "falcon24-retained-activation-result@4.0.0" as const,
        activation_command_hash: request.command_hash,
        authority: authorities.target,
        predecessor_diagnostic_receipt: {
          attempt_id: id(22),
          run_id: id(23),
          receipt_hash: hash("e"),
        },
        llm_execution_certification: {
          stage_id: id(24),
          proof_hash: hash("f"),
          certification_receipt_ref: {
            artifact_id: id(25),
            artifact_type: "ModelCertificationReceipt" as const,
            app_id: scope.app_id,
            tenant_id: scope.tenant_id,
            environment: scope.environment,
            run_id: id(26),
            revision: 1,
            content_hash: hash("0"),
          },
          execution_profile_hash: hash("1"),
        },
      },
    };
  });
  const activateRetainedWithClosureRecovery = vi.fn(
    async (_capability: unknown, envelope: unknown) => {
      events.push(`activate-closure-recovery-${authorities.target.authority_epoch.toLowerCase()}`);
      const typed = envelope as {
        request: { command_hash: `sha256:${string}` };
        llm_execution_proof: Awaited<ReturnType<typeof buildFalcon24LlmExecutionAuthorityProof>>;
        predecessor_closure_failure: {
          receipt_id: string;
          receipt_hash: `sha256:${string}`;
          failure_code: "PROVIDER_PROFILE_BINDING_NOT_SELECTED";
        };
      };
      return {
        ok: true as const,
        value: {
          schema_version: "falcon24-retained-activation-result@5.0.0" as const,
          activation_command_hash: typed.request.command_hash,
          authority: authorities.target,
          predecessor_closure_failure_receipt: {
            receipt_id: typed.predecessor_closure_failure.receipt_id,
            receipt_hash: typed.predecessor_closure_failure.receipt_hash,
            failure_code: typed.predecessor_closure_failure.failure_code,
          },
          llm_execution_certification: {
            stage_id: typed.llm_execution_proof.stage_id,
            proof_hash: typed.llm_execution_proof.proof_hash,
            certification_receipt_ref: typed.llm_execution_proof.certification_receipt_ref,
            execution_profile_hash: typed.llm_execution_proof.execution_profile_hash,
          },
        },
      };
    },
  );
  const activateRetainedWithTerminalDiagnosticRecovery = vi.fn(
    async (_capability: unknown, envelope: unknown) => {
      events.push(
        `activate-terminal-diagnostic-recovery-${authorities.target.authority_epoch.toLowerCase()}`,
      );
      const typed = envelope as {
        request: { command_hash: `sha256:${string}` };
        llm_execution_proof: Awaited<ReturnType<typeof buildFalcon24LlmExecutionAuthorityProof>>;
        predecessor_diagnostic_receipt: {
          attempt_id: string;
          run_id: string;
          manifest_hash: `sha256:${string}`;
          receipt_hash: `sha256:${string}`;
          failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED";
          failure_code: string;
        };
      };
      return {
        ok: true as const,
        value: {
          schema_version: "falcon24-retained-activation-result@6.0.0" as const,
          activation_command_hash: typed.request.command_hash,
          authority: authorities.target,
          predecessor_diagnostic_receipt: typed.predecessor_diagnostic_receipt,
          llm_execution_certification: {
            stage_id: typed.llm_execution_proof.stage_id,
            proof_hash: typed.llm_execution_proof.proof_hash,
            certification_receipt_ref: typed.llm_execution_proof.certification_receipt_ref,
            execution_profile_hash: typed.llm_execution_proof.execution_profile_hash,
          },
        },
      };
    },
  );
  const activateRetainedWithFinalizationFailureRecovery = vi.fn(
    async (_capability: unknown, envelope: unknown) => {
      events.push(
        `activate-finalization-failure-recovery-${authorities.target.authority_epoch.toLowerCase()}`,
      );
      const typed = envelope as {
        request: { command_hash: `sha256:${string}` };
        llm_execution_proof: Awaited<ReturnType<typeof buildFalcon24LlmExecutionAuthorityProof>>;
        predecessor_finalization_failure_receipt: {
          receipt_id: string;
          receipt_hash: `sha256:${string}`;
          failure_code: "CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS";
        };
      };
      return {
        ok: true as const,
        value: {
          schema_version: "falcon24-retained-activation-result@7.0.0" as const,
          activation_command_hash: typed.request.command_hash,
          authority: authorities.target,
          predecessor_finalization_failure_receipt: typed.predecessor_finalization_failure_receipt,
          llm_execution_certification: {
            stage_id: typed.llm_execution_proof.stage_id,
            proof_hash: typed.llm_execution_proof.proof_hash,
            certification_receipt_ref: typed.llm_execution_proof.certification_receipt_ref,
            execution_profile_hash: typed.llm_execution_proof.execution_profile_hash,
          },
        },
      };
    },
  );
  const activateRetainedWithFourLayerFailureRecovery = vi.fn(
    async (_capability: unknown, envelope: unknown) => {
      events.push("activate-four-layer-failure-recovery-e12");
      const typed = envelope as {
        request: unknown;
        llm_execution_proof: Awaited<ReturnType<typeof buildFalcon24LlmExecutionAuthorityProof>>;
      };
      const request = falcon24ActivationRequestV8Schema.parse(typed.request);
      return {
        ok: true as const,
        value: {
          schema_version: "falcon24-retained-activation-result@8.0.0" as const,
          activation_command_hash: request.command_hash,
          authority: authorities.target,
          predecessor_four_layer_failure_receipt: request.predecessor_four_layer_failure_receipt,
          llm_execution_certification: {
            stage_id: typed.llm_execution_proof.stage_id,
            proof_hash: typed.llm_execution_proof.proof_hash,
            certification_receipt_ref: typed.llm_execution_proof.certification_receipt_ref,
            execution_profile_hash: typed.llm_execution_proof.execution_profile_hash,
          },
        },
      };
    },
  );
  const loadProviderExecutionProfiles = vi.fn(
    async (): Promise<readonly ProviderExecutionProfile[]> => [],
  );
  const resolveCurrentExecutionCertification = vi.fn(
    async (): Promise<ModelExecutionCertificationClaims> => {
      throw new TypeError("UNCONFIGURED_CURRENT_EXECUTION_CERTIFICATION");
    },
  );
  const resolveCurrentExecutionCertificationV2 = vi.fn(
    async (): Promise<ModelExecutionCertificationClaims> => {
      throw new TypeError("UNCONFIGURED_CURRENT_EXECUTION_CERTIFICATION_V2");
    },
  );
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
      epoch: {
        activateRetained,
        activateRetainedWithRecovery,
        activateRetainedWithClosureRecovery,
        activateRetainedWithTerminalDiagnosticRecovery,
        activateRetainedWithFinalizationFailureRecovery,
        activateRetainedWithFourLayerFailureRecovery,
      },
      readback: { loadCurrentClosure, loadPublishedRelease },
      load_provider_execution_profiles: loadProviderExecutionProfiles,
      resolve_current_execution_certification: resolveCurrentExecutionCertification,
      resolve_current_execution_certification_v2: resolveCurrentExecutionCertificationV2,
      stage_falcon_authority: stageFalconAuthority,
      hold_activation_attempt: holdActivationAttempt,
    },
    calls: {
      loadCurrentClosure,
      loadPublishedRelease,
      stageFalconAuthority,
      activateRetained,
      activateRetainedWithRecovery,
      activateRetainedWithClosureRecovery,
      activateRetainedWithTerminalDiagnosticRecovery,
      activateRetainedWithFinalizationFailureRecovery,
      activateRetainedWithFourLayerFailureRecovery,
      loadProviderExecutionProfiles,
      resolveCurrentExecutionCertification,
      resolveCurrentExecutionCertificationV2,
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

  it("advances E6 to E7 only through request v4 bound to exact failure and LLM stage", async () => {
    const arranged = await arrange({ current: e6Authority, target: e7Authority });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E7",
      staging_id: id(27),
      stage_id: id(24),
      model_profile_id: id(28),
      model_config_version: 2,
      model_resource_hash: hash("2"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(25),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(26),
        revision: 1,
        content_hash: hash("0"),
      },
      execution_profile_hash: hash("1"),
      deployment_id: id(29),
      deployment_hash: hash("3"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: {
        build_id: workerBuild.build_id,
        generation_id: workerBuild.generation_id,
      },
    });

    const result = await finalizeFalcon24RetainedAuthority({
      ...arranged.input,
      recovery: {
        kind: "DIAGNOSTIC",
        llm_execution_proof: llmProof,
        predecessor_diagnostic_failure: {
          attempt_id: id(22),
          run_id: id(23),
          manifest_hash: hash("4"),
          failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED",
          failure_code: "PROVIDER_PROFILE_NOT_AVAILABLE",
        },
      },
    });

    expect(arranged.calls.activateRetained).not.toHaveBeenCalled();
    expect(arranged.calls.activateRetainedWithRecovery).toHaveBeenCalledTimes(1);
    expect(arranged.events).toContain("activate-recovery-e7");
    expect(result.authority).toEqual(e7Authority);
    expect(result.recovery?.llm_execution_proof).toEqual(llmProof);
    expect(arranged.calls.activateRetainedWithRecovery.mock.calls[0]?.[1]).toMatchObject({
      request: {
        schema_version: "falcon24-activation-request@4.0.0",
        predecessor_diagnostic_failure: {
          failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED",
          failure_code: "PROVIDER_PROFILE_NOT_AVAILABLE",
        },
        llm_execution_stage_ref: { stage_id: llmProof.stage_id, proof_hash: llmProof.proof_hash },
      },
    });
  });

  it("advances E7 to E8 through request v5 and requires exact AVAILABLE readback", async () => {
    const arranged = await arrange({ current: e7Authority, target: e8Authority });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E8",
      staging_id: id(32),
      stage_id: id(33),
      model_profile_id: id(34),
      model_config_version: 3,
      model_resource_hash: hash("2"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(35),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(36),
        revision: 1,
        content_hash: hash("3"),
      },
      execution_profile_hash: hash("4"),
      deployment_id: id(37),
      deployment_hash: hash("5"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: {
        build_id: workerBuild.build_id,
        generation_id: workerBuild.generation_id,
      },
    });
    const failure = {
      schema_version: "falcon24-epoch-closure-failure-receipt@1.0.0" as const,
      receipt_id: id(38),
      authority: e7Authority,
      stage_ref: { stage_id: id(39), proof_hash: hash("6") },
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED" as const,
      failure_code: "PROVIDER_PROFILE_BINDING_NOT_SELECTED" as const,
      expected_readiness: "AVAILABLE" as const,
      observed_readiness: "STALE" as const,
      observed_selectable: false as const,
      evidence_hash: hash("7"),
      receipt_hash: hash("8"),
    };
    const availableProfile: ProviderExecutionProfile = {
      model_profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      resource_hash: llmProof.model_resource_hash,
      profile_version: `model-profile@${llmProof.model_config_version}` as const,
      provider: llmProof.provider,
      model_id: llmProof.model_id,
      display_name: "DeepSeek Falcon24",
      adapter_version: "deepseek-adapter@1",
      certification_receipt_ref: {
        ...llmProof.certification_receipt_ref,
        artifact_type: "ModelCertificationReceipt",
      },
      execution_profile_hash: llmProof.execution_profile_hash,
      recovery_capabilities: llmProof.recovery_capabilities,
      connection: {
        kind: "SYSTEM_DEPLOYMENT" as const,
        deployment_id: llmProof.deployment_id,
        deployment_revision: 1,
        deployment_hash: llmProof.deployment_hash,
      },
      effective_context_ceiling_tokens: 32_768,
      effective_output_ceiling_tokens: 8_192,
      readiness: "AVAILABLE" as const,
      selectable: true as const,
      unavailable_reason: null,
    };
    arranged.calls.loadProviderExecutionProfiles.mockResolvedValueOnce([availableProfile]);

    const result = await finalizeFalcon24RetainedAuthority({
      ...arranged.input,
      recovery: {
        kind: "CLOSURE_FAILURE",
        llm_execution_proof: llmProof,
        predecessor_closure_failure: failure,
      },
    });

    expect(arranged.calls.activateRetainedWithRecovery).not.toHaveBeenCalled();
    expect(arranged.calls.activateRetainedWithClosureRecovery).toHaveBeenCalledTimes(1);
    expect(arranged.events).toContain("activate-closure-recovery-e8");
    expect(result.authority).toEqual(e8Authority);
    expect(result.recovery).toMatchObject({
      kind: "CLOSURE_FAILURE",
      predecessor_closure_failure: failure,
      provider_execution_profile: availableProfile,
    });
    expect(arranged.calls.activateRetainedWithClosureRecovery.mock.calls[0]?.[1]).toMatchObject({
      request: {
        schema_version: "falcon24-activation-request@5.0.0",
        predecessor_closure_failure_ref: {
          receipt_id: failure.receipt_id,
          receipt_hash: failure.receipt_hash,
        },
        llm_execution_stage_ref: { stage_id: llmProof.stage_id, proof_hash: llmProof.proof_hash },
      },
    });
  });

  it("advances E8 to E9 through request v6 and proves both current profile readers", async () => {
    const arranged = await arrange({ current: e8Authority, target: e9Authority });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E9",
      staging_id: id(50),
      stage_id: id(51),
      model_profile_id: id(52),
      model_config_version: 4,
      model_resource_hash: hash("1"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(53),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(54),
        revision: 1,
        content_hash: hash("2"),
      },
      execution_profile_hash: hash("3"),
      deployment_id: id(55),
      deployment_hash: hash("4"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: {
        build_id: workerBuild.build_id,
        generation_id: workerBuild.generation_id,
      },
    });
    const failure = {
      attempt_id: id(56),
      run_id: id(57),
      manifest_hash: hash("5"),
      receipt_hash: hash("6"),
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED" as const,
      failure_code: "PROVIDER_TRANSPORT_PROFILE_NOT_AVAILABLE",
    };
    const availableProfile: ProviderExecutionProfile = {
      model_profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      resource_hash: llmProof.model_resource_hash,
      profile_version: `model-profile@${llmProof.model_config_version}` as const,
      provider: llmProof.provider,
      model_id: llmProof.model_id,
      display_name: "DeepSeek Falcon24 E9",
      adapter_version: "deepseek-adapter@1",
      certification_receipt_ref: {
        ...llmProof.certification_receipt_ref,
        artifact_type: "ModelCertificationReceipt" as const,
      },
      execution_profile_hash: llmProof.execution_profile_hash,
      recovery_capabilities: llmProof.recovery_capabilities,
      connection: {
        kind: "SYSTEM_DEPLOYMENT" as const,
        deployment_id: llmProof.deployment_id,
        deployment_revision: 1,
        deployment_hash: llmProof.deployment_hash,
      },
      effective_context_ceiling_tokens: 32_768,
      effective_output_ceiling_tokens: 8_192,
      readiness: "AVAILABLE" as const,
      selectable: true as const,
      unavailable_reason: null,
    };
    const certification = {
      profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      provider: llmProof.provider,
      model_id: llmProof.model_id,
      execution_profile_hash: llmProof.execution_profile_hash,
      receipt_ref: llmProof.certification_receipt_ref,
    } as ModelExecutionCertificationClaims;
    arranged.calls.loadProviderExecutionProfiles.mockResolvedValueOnce([availableProfile]);
    arranged.calls.resolveCurrentExecutionCertification.mockResolvedValueOnce(certification);

    const result = await finalizeFalcon24RetainedAuthority({
      ...arranged.input,
      recovery: {
        kind: "TERMINAL_DIAGNOSTIC",
        llm_execution_proof: llmProof,
        predecessor_diagnostic_receipt: failure,
      },
    });

    expect(arranged.calls.activateRetainedWithClosureRecovery).not.toHaveBeenCalled();
    expect(arranged.calls.activateRetainedWithTerminalDiagnosticRecovery).toHaveBeenCalledTimes(1);
    expect(arranged.events).toContain("activate-terminal-diagnostic-recovery-e9");
    expect(result.authority).toEqual(e9Authority);
    expect(result.recovery).toMatchObject({
      kind: "TERMINAL_DIAGNOSTIC",
      predecessor_diagnostic_receipt: failure,
      provider_execution_profile: availableProfile,
      current_execution_certification: certification,
    });
    expect(
      arranged.calls.activateRetainedWithTerminalDiagnosticRecovery.mock.calls[0]?.[1],
    ).toMatchObject({
      request: {
        schema_version: "falcon24-activation-request@6.0.0",
        predecessor_diagnostic_receipt: failure,
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      },
    });
    expect(arranged.calls.resolveCurrentExecutionCertification).toHaveBeenCalledWith({
      model_profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      certification_receipt_ref: llmProof.certification_receipt_ref,
    });
  });

  it("advances E9 to E10 through request v7 and proves the versioned current reader", async () => {
    const arranged = await arrange({ current: e9Authority, target: e10Authority });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E10",
      staging_id: id(60),
      stage_id: id(61),
      model_profile_id: id(62),
      model_config_version: 5,
      model_resource_hash: hash("1"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(63),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(64),
        revision: 1,
        content_hash: hash("2"),
      },
      execution_profile_hash: hash("3"),
      deployment_id: id(65),
      deployment_hash: hash("4"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: {
        build_id: workerBuild.build_id,
        generation_id: workerBuild.generation_id,
      },
    });
    const failure = {
      schema_version: "falcon24-finalization-failure-receipt@1.0.0" as const,
      receipt_id: id(66),
      authority: e9Authority,
      stage_ref: { stage_id: id(67), proof_hash: hash("5") },
      failed_rpc_identity:
        "app_data_agent.resolve_current_provider_execution_certification(jsonb)" as const,
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED" as const,
      failure_code: "CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS" as const,
      observed_sqlstate: "42702" as const,
      definition_hash: hash("6"),
      evidence_hash: hash("7"),
      receipt_hash: hash("8"),
    };
    const availableProfile: ProviderExecutionProfile = {
      model_profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      resource_hash: llmProof.model_resource_hash,
      profile_version: `model-profile@${llmProof.model_config_version}` as const,
      provider: llmProof.provider,
      model_id: llmProof.model_id,
      display_name: "DeepSeek Falcon24 E10",
      adapter_version: "deepseek-adapter@1",
      certification_receipt_ref: {
        ...llmProof.certification_receipt_ref,
        artifact_type: "ModelCertificationReceipt" as const,
      },
      execution_profile_hash: llmProof.execution_profile_hash,
      recovery_capabilities: llmProof.recovery_capabilities,
      connection: {
        kind: "SYSTEM_DEPLOYMENT" as const,
        deployment_id: llmProof.deployment_id,
        deployment_revision: 1,
        deployment_hash: llmProof.deployment_hash,
      },
      effective_context_ceiling_tokens: 32_768,
      effective_output_ceiling_tokens: 8_192,
      readiness: "AVAILABLE" as const,
      selectable: true as const,
      unavailable_reason: null,
    };
    const certification = {
      profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      provider: llmProof.provider,
      model_id: llmProof.model_id,
      execution_profile_hash: llmProof.execution_profile_hash,
      receipt_ref: llmProof.certification_receipt_ref,
    } as ModelExecutionCertificationClaims;
    arranged.calls.loadProviderExecutionProfiles.mockResolvedValueOnce([availableProfile]);
    arranged.calls.resolveCurrentExecutionCertificationV2.mockResolvedValueOnce(certification);

    const result = await finalizeFalcon24RetainedAuthority({
      ...arranged.input,
      recovery: {
        kind: "FINALIZATION_FAILURE",
        llm_execution_proof: llmProof,
        predecessor_finalization_failure: failure,
      },
    });

    expect(arranged.calls.activateRetainedWithTerminalDiagnosticRecovery).not.toHaveBeenCalled();
    expect(arranged.calls.activateRetainedWithFinalizationFailureRecovery).toHaveBeenCalledTimes(1);
    expect(arranged.events).toContain("activate-finalization-failure-recovery-e10");
    expect(result.authority).toEqual(e10Authority);
    expect(result.recovery).toMatchObject({
      kind: "FINALIZATION_FAILURE",
      predecessor_finalization_failure: failure,
      provider_execution_profile: availableProfile,
      current_execution_certification: certification,
    });
    expect(
      arranged.calls.activateRetainedWithFinalizationFailureRecovery.mock.calls[0]?.[1],
    ).toMatchObject({
      request: {
        schema_version: "falcon24-activation-request@7.0.0",
        predecessor_finalization_failure_receipt: {
          receipt_id: failure.receipt_id,
          receipt_hash: failure.receipt_hash,
          failure_code: failure.failure_code,
        },
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      },
    });
    expect(arranged.calls.resolveCurrentExecutionCertification).not.toHaveBeenCalled();
    expect(arranged.calls.resolveCurrentExecutionCertificationV2).toHaveBeenCalledWith({
      model_profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      certification_receipt_ref: llmProof.certification_receipt_ref,
    });
  });

  it("advances E10 to E11 through terminal diagnostic request v6 and the v2 current reader", async () => {
    const arranged = await arrange({ current: e10Authority, target: e11Authority });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E11",
      staging_id: id(70),
      stage_id: id(71),
      model_profile_id: id(72),
      model_config_version: 6,
      model_resource_hash: hash("1"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(73),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(74),
        revision: 1,
        content_hash: hash("2"),
      },
      execution_profile_hash: hash("3"),
      deployment_id: id(75),
      deployment_hash: hash("4"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: {
        build_id: workerBuild.build_id,
        generation_id: workerBuild.generation_id,
      },
    });
    const failure = {
      attempt_id: id(76),
      run_id: id(77),
      manifest_hash: hash("5"),
      receipt_hash: hash("6"),
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED" as const,
      failure_code: "ROOT_AGENT_TURN_BUDGET_EXHAUSTED",
    };
    const availableProfile: ProviderExecutionProfile = {
      model_profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      resource_hash: llmProof.model_resource_hash,
      profile_version: `model-profile@${llmProof.model_config_version}` as const,
      provider: llmProof.provider,
      model_id: llmProof.model_id,
      display_name: "DeepSeek Falcon24 E11",
      adapter_version: "deepseek-adapter@1",
      certification_receipt_ref: {
        ...llmProof.certification_receipt_ref,
        artifact_type: "ModelCertificationReceipt" as const,
      },
      execution_profile_hash: llmProof.execution_profile_hash,
      recovery_capabilities: llmProof.recovery_capabilities,
      connection: {
        kind: "SYSTEM_DEPLOYMENT" as const,
        deployment_id: llmProof.deployment_id,
        deployment_revision: 1,
        deployment_hash: llmProof.deployment_hash,
      },
      effective_context_ceiling_tokens: 32_768,
      effective_output_ceiling_tokens: 8_192,
      readiness: "AVAILABLE" as const,
      selectable: true as const,
      unavailable_reason: null,
    };
    const certification = {
      profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      provider: llmProof.provider,
      model_id: llmProof.model_id,
      execution_profile_hash: llmProof.execution_profile_hash,
      receipt_ref: llmProof.certification_receipt_ref,
    } as ModelExecutionCertificationClaims;
    arranged.calls.loadProviderExecutionProfiles.mockResolvedValueOnce([availableProfile]);
    arranged.calls.resolveCurrentExecutionCertificationV2.mockResolvedValueOnce(certification);

    const result = await finalizeFalcon24RetainedAuthority({
      ...arranged.input,
      recovery: {
        kind: "TERMINAL_DIAGNOSTIC",
        llm_execution_proof: llmProof,
        predecessor_diagnostic_receipt: failure,
      },
    });

    expect(arranged.calls.activateRetainedWithFinalizationFailureRecovery).not.toHaveBeenCalled();
    expect(arranged.calls.activateRetainedWithTerminalDiagnosticRecovery).toHaveBeenCalledTimes(1);
    expect(arranged.events).toContain("activate-terminal-diagnostic-recovery-e11");
    expect(result.authority).toEqual(e11Authority);
    expect(result.recovery).toMatchObject({
      kind: "TERMINAL_DIAGNOSTIC",
      predecessor_diagnostic_receipt: failure,
      provider_execution_profile: availableProfile,
      current_execution_certification: certification,
    });
    expect(
      arranged.calls.activateRetainedWithTerminalDiagnosticRecovery.mock.calls[0]?.[1],
    ).toMatchObject({
      request: {
        schema_version: "falcon24-activation-request@6.0.0",
        authority_epoch: "E11",
        predecessor_diagnostic_receipt: failure,
      },
    });
    expect(arranged.calls.resolveCurrentExecutionCertification).not.toHaveBeenCalled();
    expect(arranged.calls.resolveCurrentExecutionCertificationV2).toHaveBeenCalledWith({
      model_profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      certification_receipt_ref: llmProof.certification_receipt_ref,
    });
  });

  it("advances E11 to E12 from four-layer failure without a Diagnostic", async () => {
    const arranged = await arrange({ current: e11Authority, target: e12Authority });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E12",
      staging_id: id(70),
      stage_id: id(71),
      model_profile_id: id(72),
      model_config_version: 6,
      model_resource_hash: hash("1"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(73),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(74),
        revision: 1,
        content_hash: hash("2"),
      },
      execution_profile_hash: hash("3"),
      deployment_id: id(75),
      deployment_hash: hash("4"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: {
        build_id: workerBuild.build_id,
        generation_id: workerBuild.generation_id,
      },
    });
    const manifest = await buildFalcon24FourLayerGateManifest({
      schema_version: "falcon24-four-layer-gate-manifest@9.0.0",
      gate_id: "E11-FL1",
      attempt_id: id(76),
      authority_epoch: "E11",
      authority_baseline_id: e11Authority.baseline_id,
      authority_baseline_hash: e11Authority.baseline_hash,
      authority_activation_attempt_id: e11Authority.activation_attempt_id,
      source_commit: "1".repeat(40),
      worker_build_hash: hash("2"),
      worker_generation_hash: hash("3"),
      web_build_hash: hash("4"),
      web_generation_hash: hash("5"),
      semantic_release_hash: release.release_digest,
      datasource_binding_hash: hash("6"),
      model_config_hash: hash("7"),
      runtime_attestation_hash: hash("8"),
      turns: await buildFalcon24FourLayerManifestTurns(),
    });
    const first = manifest.turns[0];
    if (!first) throw new Error("Missing frozen first turn");
    const terminal = await buildFalcon24FourLayerTerminalReceipt({
      schema_version: "falcon24-four-layer-turn-terminal-receipt@1.0.0",
      gate_id: manifest.gate_id,
      attempt_id: manifest.attempt_id,
      manifest_hash: manifest.manifest_hash,
      turn_ordinal: 0,
      turn_id: first.turn_id,
      layer: first.layer,
      scenario_id: first.scenario_id,
      scenario_turn_index: first.scenario_turn_index,
      question_hash: first.question_hash,
      conversation_id: id(80),
      conversation_resource_version: 1,
      run_id: id(77),
      worker_build_hash: manifest.worker_build_hash,
      worker_generation_hash: manifest.worker_generation_hash,
      semantic_release_hash: manifest.semantic_release_hash,
      business_receipt_hash: hash("9"),
      qa_ui_receipt_hash: null,
      trace_ui_receipt_hash: null,
      status: "FAILED",
      failure_code: "FALCON24_RUN_FAILED",
      finalized_at: "2026-08-30T03:38:32.519Z",
    });
    const failure = {
      attempt_id: manifest.attempt_id,
      manifest_hash: manifest.manifest_hash,
      turn_ordinal: 0,
      run_id: terminal.run_id,
      receipt_hash: terminal.receipt_hash,
      failure_code: "FALCON24_RUN_FAILED",
    };
    const availableProfile: ProviderExecutionProfile = {
      model_profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      resource_hash: llmProof.model_resource_hash,
      profile_version: `model-profile@${llmProof.model_config_version}` as const,
      provider: llmProof.provider,
      model_id: llmProof.model_id,
      display_name: "DeepSeek Falcon24 E12",
      adapter_version: "deepseek-adapter@1",
      certification_receipt_ref: {
        ...llmProof.certification_receipt_ref,
        artifact_type: "ModelCertificationReceipt" as const,
      },
      execution_profile_hash: llmProof.execution_profile_hash,
      recovery_capabilities: llmProof.recovery_capabilities,
      connection: {
        kind: "SYSTEM_DEPLOYMENT" as const,
        deployment_id: llmProof.deployment_id,
        deployment_revision: 1,
        deployment_hash: llmProof.deployment_hash,
      },
      effective_context_ceiling_tokens: 32_768,
      effective_output_ceiling_tokens: 8_192,
      readiness: "AVAILABLE" as const,
      selectable: true as const,
      unavailable_reason: null,
    };
    const certification = {
      profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      provider: llmProof.provider,
      model_id: llmProof.model_id,
      execution_profile_hash: llmProof.execution_profile_hash,
      receipt_ref: llmProof.certification_receipt_ref,
    } as ModelExecutionCertificationClaims;
    arranged.calls.loadProviderExecutionProfiles.mockResolvedValueOnce([availableProfile]);
    arranged.calls.resolveCurrentExecutionCertificationV2.mockResolvedValueOnce(certification);

    const result = await finalizeFalcon24RetainedAuthority({
      ...arranged.input,
      recovery: {
        kind: "FOUR_LAYER_FAILURE",
        llm_execution_proof: llmProof,
        predecessor_manifest: manifest,
        predecessor_terminal_receipt: terminal,
      },
    });

    expect(arranged.calls.activateRetainedWithFinalizationFailureRecovery).not.toHaveBeenCalled();
    expect(arranged.calls.activateRetainedWithFourLayerFailureRecovery).toHaveBeenCalledTimes(1);
    expect(arranged.events).toContain("activate-four-layer-failure-recovery-e12");
    expect(result.authority).toEqual(e12Authority);
    expect(result.recovery).toMatchObject({
      kind: "FOUR_LAYER_FAILURE",
      predecessor_four_layer_failure_receipt: failure,
      provider_execution_profile: availableProfile,
      current_execution_certification: certification,
    });
    expect(
      arranged.calls.activateRetainedWithFourLayerFailureRecovery.mock.calls[0]?.[1],
    ).toMatchObject({
      request: {
        schema_version: "falcon24-activation-request@8.0.0",
        authority_epoch: "E12",
        predecessor_four_layer_failure_receipt: failure,
      },
    });
    expect(arranged.calls.resolveCurrentExecutionCertification).not.toHaveBeenCalled();
    expect(arranged.calls.resolveCurrentExecutionCertificationV2).toHaveBeenCalledWith({
      model_profile_id: llmProof.model_profile_id,
      model_config_version: llmProof.model_config_version,
      certification_receipt_ref: llmProof.certification_receipt_ref,
    });

    expect(arranged.calls.activateRetainedWithTerminalDiagnosticRecovery).not.toHaveBeenCalled();
    for (const patch of [{ run_id: id(99) }, { worker_build_hash: hash("f") }]) {
      const invalid = await arrange({ current: e11Authority, target: e12Authority });
      await expect(
        finalizeFalcon24RetainedAuthority({
          ...invalid.input,
          recovery: {
            kind: "FOUR_LAYER_FAILURE",
            llm_execution_proof: llmProof,
            predecessor_manifest: manifest,
            predecessor_terminal_receipt: { ...terminal, ...patch },
          },
        }),
      ).rejects.toThrow("FALCON24_FOUR_LAYER_RECEIPT_HASH_INVALID");
      expect(invalid.calls.activateRetainedWithFourLayerFailureRecovery).not.toHaveBeenCalled();
    }
  });

  it("freezes after E8 commit when the production provider reader is not exact AVAILABLE", async () => {
    const arranged = await arrange({ current: e7Authority, target: e8Authority });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E8",
      staging_id: id(40),
      stage_id: id(41),
      model_profile_id: id(42),
      model_config_version: 3,
      model_resource_hash: hash("9"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(43),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(44),
        revision: 1,
        content_hash: hash("a"),
      },
      execution_profile_hash: hash("b"),
      deployment_id: id(45),
      deployment_hash: hash("c"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: {
        build_id: workerBuild.build_id,
        generation_id: workerBuild.generation_id,
      },
    });
    const failure = {
      schema_version: "falcon24-epoch-closure-failure-receipt@1.0.0" as const,
      receipt_id: id(46),
      authority: e7Authority,
      stage_ref: { stage_id: id(47), proof_hash: hash("d") },
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED" as const,
      failure_code: "PROVIDER_PROFILE_BINDING_NOT_SELECTED" as const,
      expected_readiness: "AVAILABLE" as const,
      observed_readiness: "STALE" as const,
      observed_selectable: false as const,
      evidence_hash: hash("e"),
      receipt_hash: hash("f"),
    };

    await expect(
      finalizeFalcon24RetainedAuthority({
        ...arranged.input,
        recovery: {
          kind: "CLOSURE_FAILURE",
          llm_execution_proof: llmProof,
          predecessor_closure_failure: failure,
        },
      }),
    ).rejects.toThrow("FALCON24_RETAINED_POST_ACTIVATION_PROVIDER_PROFILE_MISMATCH");
    expect(arranged.calls.activateRetainedWithClosureRecovery).toHaveBeenCalledTimes(1);
    expect(arranged.calls.holdActivationAttempt).not.toHaveBeenCalled();
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
