import {
  buildFalcon24E1StagingReceipt,
  buildFalcon24LlmExecutionAuthorityProof,
  buildFalcon24RetainedSemanticReleaseAuthorityProof,
  buildFalcon24StagingReceiptV2,
} from "@data-agent/contracts/runs";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresFalcon24AuthorityEpoch } from "../../src/runs/postgres-authority-epoch.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const ids = { app: id(1), tenant: id(2), analyst: id(3), deployment: id(4) };

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.analyst,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const capability = registry.resolveForDeployment(ids.deployment, { subject: ids.analyst });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(handler: (text: string, values?: readonly unknown[]) => unknown) {
  const calls: { readonly text: string; readonly values?: readonly unknown[] }[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ) {
      calls.push({ text, ...(values ? { values } : {}) });
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      const value = handler(text, values);
      return {
        rows: value === undefined ? [] : [{ value }],
        rowCount: value === undefined ? 0 : 1,
      } as unknown as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

describe("PostgreSQL Falcon24 versioned authority epoch", () => {
  it("begins an E2 staging session with a content-addressed generic command", async () => {
    const auth = authority();
    const stagingId = id(10);
    const scripted = scriptedPool((text) =>
      text.includes("begin_falcon24_authority_staging_session")
        ? {
            schema_version: "falcon24-staging-session@2.0.0",
            authority_epoch: "E2",
            staging_id: stagingId,
            retained_assets_hash: hash("a"),
            status: "STAGED",
          }
        : undefined,
    );
    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).beginStaging(auth.capability, {
      schema_version: "falcon24-staging-session@2.0.0",
      authority_epoch: "E2",
      staging_id: stagingId,
      retained_assets_hash: hash("a"),
    });

    expect(result).toMatchObject({ ok: true, value: { staging_id: stagingId } });
    expect(
      scripted.calls.find(({ text }) => text.includes("begin_falcon24_authority_staging_session"))
        ?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-staging-session@2.0.0",
        authority_epoch: "E2",
        staging_id: stagingId,
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("verifies an E2 staging receipt before PostgreSQL I/O", async () => {
    const auth = authority();
    const scripted = scriptedPool(() => undefined);
    const port = createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    const receipt = await buildFalcon24StagingReceiptV2({
      schema_version: "falcon24-staging-receipt@2.0.0",
      authority_epoch: "E2",
      staging_id: id(11),
      component: "DATASET",
      subject_hash: hash("b"),
      evidence_hash: hash("c"),
      production_isolation_proven: false,
    });

    await expect(
      port.recordReceipt(auth.capability, { ...receipt, subject_hash: hash("d") }),
    ).rejects.toThrow("FALCON24_STAGING_RECEIPT_HASH_INVALID");
    expect(scripted.calls).toHaveLength(0);
  });

  it("holds an exact pre-baseline E4 staging session with a content-addressed command", async () => {
    const auth = authority();
    const stagingId = id(12);
    const scripted = scriptedPool((text) =>
      text.includes("hold_falcon24_authority_staging_session")
        ? {
            schema_version: "falcon24-staging-hold@2.0.0",
            authority_epoch: "E4",
            staging_id: stagingId,
            retained_assets_hash: hash("a"),
            status: "HOLD",
            failure_code: "BUILTIN_TEAM_SKILL_REVISION_CONFLICT",
          }
        : undefined,
    );
    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).holdStagingSession(auth.capability, {
      schema_version: "falcon24-staging-hold-request@2.0.0",
      authority_epoch: "E4",
      staging_id: stagingId,
      expected_retained_assets_hash: hash("a"),
      failure_code: "BUILTIN_TEAM_SKILL_REVISION_CONFLICT",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { staging_id: stagingId, status: "HOLD" },
    });
    expect(
      scripted.calls.find(({ text }) => text.includes("hold_falcon24_authority_staging_session"))
        ?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-staging-hold-request@2.0.0",
        authority_epoch: "E4",
        staging_id: stagingId,
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("loads the exact current E2 binding", async () => {
    const auth = authority();
    const binding = {
      schema_version: "falcon24-authority-binding@2.0.0",
      authority_epoch: "E2",
      baseline_id: id(20),
      baseline_hash: hash("e"),
      activation_attempt_id: id(21),
    };
    const scripted = scriptedPool((text) =>
      text.includes("load_falcon24_current_authority_epoch") ? binding : undefined,
    );
    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).loadCurrent(auth.capability);

    expect(result).toEqual({ ok: true, value: binding });
  });

  it("loads an exact historical E1 Run through the versioned read RPC", async () => {
    const auth = authority();
    const binding = {
      schema_version: "falcon24-authority-binding@1.0.0",
      authority_epoch: "E1",
      baseline_id: id(30),
      baseline_hash: hash("f"),
      activation_attempt_id: id(31),
    };
    const scripted = scriptedPool((text) =>
      text.includes("load_falcon24_run_authority_binding") ? binding : undefined,
    );
    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).loadRunBinding(auth.capability, { run_id: id(32) });

    expect(result).toEqual({ ok: true, value: binding });
    expect(
      scripted.calls.find(({ text }) => text.includes("load_falcon24_run_authority_binding"))
        ?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-run-authority-load@2.0.0",
        run_id: id(32),
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("rejects an E1 staging write before PostgreSQL I/O", async () => {
    const auth = authority();
    const scripted = scriptedPool(() => undefined);
    const receipt = await buildFalcon24E1StagingReceipt({
      schema_version: "falcon24-e1-staging-receipt@1.0.0",
      staging_id: id(40),
      component: "DATASET",
      subject_hash: hash("a"),
      evidence_hash: hash("b"),
      production_isolation_proven: false,
    });

    await expect(
      createPostgresFalcon24AuthorityEpoch({
        pool: scripted.pool,
        authorizer: auth.authorizer,
      }).recordReceipt(auth.capability, receipt),
    ).rejects.toThrow();
    expect(scripted.calls).toHaveLength(0);
  });

  it("rejects non-atomic E4 activation before PostgreSQL I/O", async () => {
    const auth = authority();
    const scripted = scriptedPool(() => undefined);

    await expect(
      createPostgresFalcon24AuthorityEpoch({
        pool: scripted.pool,
        authorizer: auth.authorizer,
      }).activate(auth.capability, {
        schema_version: "falcon24-activation-request@2.0.0",
        authority_epoch: "E4",
        attempt_id: id(50),
        baseline_id: id(51),
        expected_baseline_hash: hash("e"),
      }),
    ).rejects.toThrow("FALCON24_COMBINED_SEMANTIC_ACTIVATION_REQUIRED");
    expect(scripted.calls).toHaveLength(0);
  });

  it("activates retained E5 authority through request v3 and the existing RPC", async () => {
    const auth = authority();
    const current = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E4",
      baseline_id: id(60),
      baseline_hash: hash("a"),
      activation_attempt_id: id(61),
    };
    const release = {
      release_id: id(62),
      generation: 2,
      release_digest: hash("b"),
      datasource_id: id(63),
    };
    const proof = await buildFalcon24RetainedSemanticReleaseAuthorityProof({
      schema_version: "falcon24-retained-semantic-release-authority-proof@1.0.0",
      scope: {
        app_id: ids.app,
        tenant_id: ids.tenant,
        environment: "test",
        semantic_domain: "falcon24",
      },
      authority_epoch: "E5",
      expected_current_authority: current,
      semantic_release: release,
      projections: {
        executable: { projection_id: id(64), projection_digest: hash("c") },
        relationship: { projection_id: id(65), projection_digest: hash("d") },
        runtime_restriction: { projection_id: id(66), projection_digest: hash("e") },
        graph: { projection_id: id(67), projection_digest: hash("f") },
      },
      expected_versions: { semantic_pointer: 2, semantic_runtime: 2, workspace_defaults: 3 },
      web_build: { build_id: hash("1"), generation_id: hash("2") },
      worker_build: { build_id: hash("3"), generation_id: hash("4") },
    });
    const binding = {
      schema_version: "falcon24-authority-binding@2.0.0",
      authority_epoch: "E5",
      baseline_id: id(68),
      baseline_hash: hash("5"),
      activation_attempt_id: id(69),
    };
    const scripted = scriptedPool((text) =>
      text.includes("activate_falcon24_authority") ? binding : undefined,
    );
    const port = createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    const result = await port.activateRetained(auth.capability, {
      request: {
        schema_version: "falcon24-activation-request@3.0.0",
        scope: proof.scope,
        authority_epoch: "E5",
        attempt_id: binding.activation_attempt_id,
        baseline_id: binding.baseline_id,
        expected_baseline_hash: binding.baseline_hash,
        expected_current_authority: current,
        expected_semantic_release: release,
        expected_versions: proof.expected_versions,
        retained_semantic_proof_hash: proof.proof_hash,
      },
      retained_semantic_proof: proof,
    });
    expect(result).toEqual({ ok: true, value: binding });
    expect(
      scripted.calls.find(({ text }) => text.includes("activate_falcon24_authority"))?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-activation-request@3.0.0",
        authority_epoch: "E5",
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);

    const mismatch = scriptedPool(() => undefined);
    await expect(
      createPostgresFalcon24AuthorityEpoch({
        pool: mismatch.pool,
        authorizer: auth.authorizer,
      }).activateRetained(auth.capability, {
        request: {
          schema_version: "falcon24-activation-request@3.0.0",
          scope: proof.scope,
          authority_epoch: "E5",
          attempt_id: id(70),
          baseline_id: id(71),
          expected_baseline_hash: hash("6"),
          expected_current_authority: current,
          expected_semantic_release: release,
          expected_versions: proof.expected_versions,
          retained_semantic_proof_hash: hash("7"),
        },
        retained_semantic_proof: proof,
      }),
    ).rejects.toThrow("FALCON24_RETAINED_ACTIVATION_PROOF_MISMATCH");
    expect(mismatch.calls).toHaveLength(0);
  });

  it("activates E7 recovery through request v4 and the existing RPC", async () => {
    const auth = authority();
    const scope = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      semantic_domain: "falcon24",
    } as const;
    const current = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E6",
      baseline_id: id(80),
      baseline_hash: hash("a"),
      activation_attempt_id: id(81),
    };
    const release = {
      release_id: id(82),
      generation: 2,
      release_digest: hash("b"),
      datasource_id: id(83),
    } as const;
    const semanticProof = await buildFalcon24RetainedSemanticReleaseAuthorityProof({
      schema_version: "falcon24-retained-semantic-release-authority-proof@1.0.0",
      scope,
      authority_epoch: "E7",
      expected_current_authority: current,
      semantic_release: release,
      projections: {
        executable: { projection_id: id(84), projection_digest: hash("c") },
        relationship: { projection_id: id(85), projection_digest: hash("d") },
        runtime_restriction: { projection_id: id(86), projection_digest: hash("e") },
        graph: { projection_id: id(87), projection_digest: hash("f") },
      },
      expected_versions: { semantic_pointer: 3, semantic_runtime: 3, workspace_defaults: 4 },
      web_build: { build_id: hash("1"), generation_id: hash("2") },
      worker_build: { build_id: hash("3"), generation_id: hash("4") },
    });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E7",
      staging_id: id(88),
      stage_id: id(89),
      model_profile_id: id(90),
      model_config_version: 2,
      model_resource_hash: hash("5"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(91),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(92),
        revision: 1,
        content_hash: hash("6"),
      },
      execution_profile_hash: hash("7"),
      deployment_id: ids.deployment,
      deployment_hash: hash("8"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: semanticProof.worker_build,
    });
    const binding = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E7",
      baseline_id: id(93),
      baseline_hash: hash("9"),
      activation_attempt_id: id(94),
    };
    const activationResult = {
      schema_version: "falcon24-retained-activation-result@4.0.0",
      activation_command_hash: hash("0"),
      authority: binding,
      predecessor_diagnostic_receipt: {
        attempt_id: id(95),
        run_id: id(96),
        receipt_hash: hash("a"),
      },
      llm_execution_certification: {
        stage_id: llmProof.stage_id,
        proof_hash: llmProof.proof_hash,
        certification_receipt_ref: llmProof.certification_receipt_ref,
        execution_profile_hash: llmProof.execution_profile_hash,
      },
    };
    const scripted = scriptedPool((text, values) => {
      if (!text.includes("activate_falcon24_authority")) return undefined;
      const command = values?.[0] as { readonly command_hash?: string } | undefined;
      return { ...activationResult, activation_command_hash: command?.command_hash };
    });
    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).activateRetainedWithRecovery(auth.capability, {
      request: {
        schema_version: "falcon24-activation-request@4.0.0",
        scope,
        authority_epoch: "E7",
        attempt_id: binding.activation_attempt_id,
        baseline_id: binding.baseline_id,
        expected_baseline_hash: binding.baseline_hash,
        expected_current_authority: current,
        expected_semantic_release: release,
        expected_versions: semanticProof.expected_versions,
        retained_semantic_proof_hash: semanticProof.proof_hash,
        predecessor_diagnostic_failure: {
          attempt_id: id(95),
          run_id: id(96),
          manifest_hash: hash("b"),
          failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED",
          failure_code: "PROVIDER_PROFILE_NOT_AVAILABLE",
        },
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      },
      retained_semantic_proof: semanticProof,
      llm_execution_proof: llmProof,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        authority: binding,
        predecessor_diagnostic_receipt: { attempt_id: id(95) },
      },
    });
    expect(
      scripted.calls.find(({ text }) => text.includes("set_config('app.semantic_domain'"))?.values,
    ).toEqual(["falcon24"]);
  });

  it("records and loads the exact server-owned E7 closure failure receipt", async () => {
    const auth = authority();
    const receipt = {
      schema_version: "falcon24-epoch-closure-failure-receipt@1.0.0" as const,
      receipt_id: id(120),
      authority: {
        schema_version: "falcon24-authority-binding@2.0.0" as const,
        authority_epoch: "E7",
        baseline_id: id(121),
        baseline_hash: hash("a"),
        activation_attempt_id: id(122),
      },
      stage_ref: { stage_id: id(123), proof_hash: hash("b") },
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED" as const,
      failure_code: "PROVIDER_PROFILE_BINDING_NOT_SELECTED" as const,
      expected_readiness: "AVAILABLE" as const,
      observed_readiness: "STALE" as const,
      observed_selectable: false as const,
      evidence_hash: hash("c"),
      receipt_hash: hash("d"),
    };
    const scripted = scriptedPool((text) =>
      text.includes("falcon24_epoch_closure_failure") ? receipt : undefined,
    );
    const port = createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      port.recordEpochClosureFailure(auth.capability, {
        receipt_id: receipt.receipt_id,
        idempotency_key: "falcon24:e7:provider-binding-not-selected",
        expected_authority: receipt.authority,
        stage_ref: receipt.stage_ref,
      }),
    ).resolves.toEqual({ ok: true, value: receipt });
    await expect(
      port.loadEpochClosureFailure(auth.capability, { receipt_id: receipt.receipt_id }),
    ).resolves.toEqual({ ok: true, value: receipt });

    const recordCall = scripted.calls.find(({ text }) =>
      text.includes("record_falcon24_epoch_closure_failure"),
    );
    expect(recordCall?.values).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-epoch-closure-failure-record@1.0.0",
        receipt_id: receipt.receipt_id,
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      }),
    ]);
    expect(
      scripted.calls.find(({ text }) => text.includes("load_falcon24_epoch_closure_failure"))
        ?.values,
    ).toEqual([receipt.receipt_id]);
  });

  it("activates E8 closure recovery through request v5 and the existing RPC", async () => {
    const auth = authority();
    const scope = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      semantic_domain: "falcon24",
    } as const;
    const current = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E7",
      baseline_id: id(130),
      baseline_hash: hash("a"),
      activation_attempt_id: id(131),
    };
    const release = {
      release_id: id(132),
      generation: 2,
      release_digest: hash("b"),
      datasource_id: id(133),
    } as const;
    const semanticProof = await buildFalcon24RetainedSemanticReleaseAuthorityProof({
      schema_version: "falcon24-retained-semantic-release-authority-proof@1.0.0",
      scope,
      authority_epoch: "E8",
      expected_current_authority: current,
      semantic_release: release,
      projections: {
        executable: { projection_id: id(134), projection_digest: hash("c") },
        relationship: { projection_id: id(135), projection_digest: hash("d") },
        runtime_restriction: { projection_id: id(136), projection_digest: hash("e") },
        graph: { projection_id: id(137), projection_digest: hash("f") },
      },
      expected_versions: { semantic_pointer: 3, semantic_runtime: 3, workspace_defaults: 4 },
      web_build: { build_id: hash("1"), generation_id: hash("2") },
      worker_build: { build_id: hash("3"), generation_id: hash("4") },
    });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E8",
      staging_id: id(138),
      stage_id: id(139),
      model_profile_id: id(140),
      model_config_version: 3,
      model_resource_hash: hash("5"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(141),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(142),
        revision: 1,
        content_hash: hash("6"),
      },
      execution_profile_hash: hash("7"),
      deployment_id: ids.deployment,
      deployment_hash: hash("8"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: semanticProof.worker_build,
    });
    const failure = {
      schema_version: "falcon24-epoch-closure-failure-receipt@1.0.0" as const,
      receipt_id: id(143),
      authority: current,
      stage_ref: { stage_id: id(144), proof_hash: hash("9") },
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED" as const,
      failure_code: "PROVIDER_PROFILE_BINDING_NOT_SELECTED" as const,
      expected_readiness: "AVAILABLE" as const,
      observed_readiness: "STALE" as const,
      observed_selectable: false as const,
      evidence_hash: hash("0"),
      receipt_hash: hash("a"),
    };
    const binding = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E8",
      baseline_id: id(145),
      baseline_hash: hash("b"),
      activation_attempt_id: id(146),
    };
    const scripted = scriptedPool((text, values) => {
      if (!text.includes("activate_falcon24_authority")) return undefined;
      const command = values?.[0] as { readonly command_hash?: string } | undefined;
      return {
        schema_version: "falcon24-retained-activation-result@5.0.0",
        activation_command_hash: command?.command_hash,
        authority: binding,
        predecessor_closure_failure_receipt: {
          receipt_id: failure.receipt_id,
          receipt_hash: failure.receipt_hash,
          failure_code: failure.failure_code,
        },
        llm_execution_certification: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
          certification_receipt_ref: llmProof.certification_receipt_ref,
          execution_profile_hash: llmProof.execution_profile_hash,
        },
      };
    });

    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).activateRetainedWithClosureRecovery(auth.capability, {
      request: {
        schema_version: "falcon24-activation-request@5.0.0",
        scope,
        authority_epoch: "E8",
        attempt_id: binding.activation_attempt_id,
        baseline_id: binding.baseline_id,
        expected_baseline_hash: binding.baseline_hash,
        expected_current_authority: current,
        expected_semantic_release: release,
        expected_versions: semanticProof.expected_versions,
        retained_semantic_proof_hash: semanticProof.proof_hash,
        predecessor_closure_failure_ref: {
          receipt_id: failure.receipt_id,
          receipt_hash: failure.receipt_hash,
          failure_code: failure.failure_code,
        },
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      },
      retained_semantic_proof: semanticProof,
      llm_execution_proof: llmProof,
      predecessor_closure_failure: failure,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        authority: binding,
        predecessor_closure_failure_receipt: { receipt_id: failure.receipt_id },
      },
    });
    expect(
      scripted.calls.find(({ text }) => text.includes("set_config('app.semantic_domain'"))?.values,
    ).toEqual(["falcon24"]);
  });

  it("activates E9 terminal diagnostic recovery through request v6 and the existing RPC", async () => {
    const auth = authority();
    const scope = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      semantic_domain: "falcon24",
    } as const;
    const current = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E8",
      baseline_id: id(150),
      baseline_hash: hash("a"),
      activation_attempt_id: id(151),
    };
    const release = {
      release_id: id(152),
      generation: 2,
      release_digest: hash("b"),
      datasource_id: id(153),
    } as const;
    const semanticProof = await buildFalcon24RetainedSemanticReleaseAuthorityProof({
      schema_version: "falcon24-retained-semantic-release-authority-proof@1.0.0",
      scope,
      authority_epoch: "E9",
      expected_current_authority: current,
      semantic_release: release,
      projections: {
        executable: { projection_id: id(154), projection_digest: hash("c") },
        relationship: { projection_id: id(155), projection_digest: hash("d") },
        runtime_restriction: { projection_id: id(156), projection_digest: hash("e") },
        graph: { projection_id: id(157), projection_digest: hash("f") },
      },
      expected_versions: { semantic_pointer: 3, semantic_runtime: 3, workspace_defaults: 4 },
      web_build: { build_id: hash("1"), generation_id: hash("2") },
      worker_build: { build_id: hash("3"), generation_id: hash("4") },
    });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E9",
      staging_id: id(158),
      stage_id: id(159),
      model_profile_id: id(160),
      model_config_version: 4,
      model_resource_hash: hash("5"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(161),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(162),
        revision: 1,
        content_hash: hash("6"),
      },
      execution_profile_hash: hash("7"),
      deployment_id: ids.deployment,
      deployment_hash: hash("8"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: semanticProof.worker_build,
    });
    const failure = {
      attempt_id: id(163),
      run_id: id(164),
      manifest_hash: hash("9"),
      receipt_hash: hash("0"),
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED" as const,
      failure_code: "PROVIDER_TRANSPORT_PROFILE_NOT_AVAILABLE",
    };
    const binding = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E9",
      baseline_id: id(165),
      baseline_hash: hash("b"),
      activation_attempt_id: id(166),
    };
    const scripted = scriptedPool((text, values) => {
      if (!text.includes("activate_falcon24_authority")) return undefined;
      const command = values?.[0] as { readonly command_hash?: string } | undefined;
      return {
        schema_version: "falcon24-retained-activation-result@6.0.0",
        activation_command_hash: command?.command_hash,
        authority: binding,
        predecessor_diagnostic_receipt: failure,
        llm_execution_certification: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
          certification_receipt_ref: llmProof.certification_receipt_ref,
          execution_profile_hash: llmProof.execution_profile_hash,
        },
      };
    });

    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).activateRetainedWithTerminalDiagnosticRecovery(auth.capability, {
      request: {
        schema_version: "falcon24-activation-request@6.0.0",
        scope,
        authority_epoch: "E9",
        attempt_id: binding.activation_attempt_id,
        baseline_id: binding.baseline_id,
        expected_baseline_hash: binding.baseline_hash,
        expected_current_authority: current,
        expected_semantic_release: release,
        expected_versions: semanticProof.expected_versions,
        retained_semantic_proof_hash: semanticProof.proof_hash,
        predecessor_diagnostic_receipt: failure,
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      },
      retained_semantic_proof: semanticProof,
      llm_execution_proof: llmProof,
      predecessor_diagnostic_receipt: failure,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        authority: binding,
        predecessor_diagnostic_receipt: { attempt_id: failure.attempt_id },
      },
    });
    expect(
      scripted.calls.find(({ text }) => text.includes("set_config('app.semantic_domain'"))?.values,
    ).toEqual(["falcon24"]);
  });

  it("records and loads the server-observed E9 finalization failure", async () => {
    const auth = authority();
    const current = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E9",
      baseline_id: id(167),
      baseline_hash: hash("c"),
      activation_attempt_id: id(168),
    };
    const receipt = {
      schema_version: "falcon24-finalization-failure-receipt@1.0.0" as const,
      receipt_id: id(169),
      authority: current,
      stage_ref: { stage_id: id(170), proof_hash: hash("d") },
      failed_rpc_identity:
        "app_data_agent.resolve_current_provider_execution_certification(jsonb)" as const,
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED" as const,
      failure_code: "CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS" as const,
      observed_sqlstate: "42702" as const,
      definition_hash: hash("e"),
      evidence_hash: hash("f"),
      receipt_hash: hash("1"),
    };
    const scripted = scriptedPool((text) =>
      text.includes("falcon24_finalization_failure") ? receipt : undefined,
    );
    const port = createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      port.recordFinalizationFailure(auth.capability, {
        receipt_id: receipt.receipt_id,
        idempotency_key: `falcon24:E9:finalization-failure:${receipt.receipt_id}`,
        expected_authority: current,
        stage_ref: receipt.stage_ref,
      }),
    ).resolves.toEqual({ ok: true, value: receipt });
    await expect(
      port.loadFinalizationFailure(auth.capability, { receipt_id: receipt.receipt_id }),
    ).resolves.toEqual({ ok: true, value: receipt });
    const recordCommand = scripted.calls.find(({ text }) =>
      text.includes("record_falcon24_finalization_failure"),
    )?.values?.[0] as Record<string, unknown> | undefined;
    expect(recordCommand).toMatchObject({
      schema_version: "falcon24-finalization-failure-record@1.0.0",
      receipt_id: receipt.receipt_id,
      expected_authority: current,
      stage_ref: receipt.stage_ref,
    });
    expect(recordCommand?.command_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("activates E10 finalization failure recovery through request v7", async () => {
    const auth = authority();
    const scope = {
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      semantic_domain: "falcon24",
    } as const;
    const current = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E9",
      baseline_id: id(171),
      baseline_hash: hash("2"),
      activation_attempt_id: id(172),
    };
    const release = {
      release_id: id(173),
      generation: 2,
      release_digest: hash("3"),
      datasource_id: id(174),
    } as const;
    const semanticProof = await buildFalcon24RetainedSemanticReleaseAuthorityProof({
      schema_version: "falcon24-retained-semantic-release-authority-proof@1.0.0",
      scope,
      authority_epoch: "E10",
      expected_current_authority: current,
      semantic_release: release,
      projections: {
        executable: { projection_id: id(175), projection_digest: hash("4") },
        relationship: { projection_id: id(176), projection_digest: hash("5") },
        runtime_restriction: { projection_id: id(177), projection_digest: hash("6") },
        graph: { projection_id: id(178), projection_digest: hash("7") },
      },
      expected_versions: { semantic_pointer: 3, semantic_runtime: 3, workspace_defaults: 4 },
      web_build: { build_id: hash("8"), generation_id: hash("9") },
      worker_build: { build_id: hash("a"), generation_id: hash("b") },
    });
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E10",
      staging_id: id(179),
      stage_id: id(180),
      model_profile_id: id(181),
      model_config_version: 5,
      model_resource_hash: hash("c"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(182),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(183),
        revision: 1,
        content_hash: hash("d"),
      },
      execution_profile_hash: hash("e"),
      deployment_id: ids.deployment,
      deployment_hash: hash("f"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: semanticProof.worker_build,
    });
    const failure = {
      receipt_id: id(184),
      receipt_hash: hash("1"),
      failure_code: "CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS" as const,
    };
    const binding = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E10",
      baseline_id: id(185),
      baseline_hash: hash("2"),
      activation_attempt_id: id(186),
    };
    const scripted = scriptedPool((text, values) => {
      if (!text.includes("activate_falcon24_authority")) return undefined;
      const command = values?.[0] as { readonly command_hash?: string } | undefined;
      return {
        schema_version: "falcon24-retained-activation-result@7.0.0",
        activation_command_hash: command?.command_hash,
        authority: binding,
        predecessor_finalization_failure_receipt: failure,
        llm_execution_certification: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
          certification_receipt_ref: llmProof.certification_receipt_ref,
          execution_profile_hash: llmProof.execution_profile_hash,
        },
      };
    });

    const result = await createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).activateRetainedWithFinalizationFailureRecovery(auth.capability, {
      request: {
        schema_version: "falcon24-activation-request@7.0.0",
        scope,
        authority_epoch: "E10",
        attempt_id: binding.activation_attempt_id,
        baseline_id: binding.baseline_id,
        expected_baseline_hash: binding.baseline_hash,
        expected_current_authority: current,
        expected_semantic_release: release,
        expected_versions: semanticProof.expected_versions,
        retained_semantic_proof_hash: semanticProof.proof_hash,
        predecessor_finalization_failure_receipt: failure,
        llm_execution_stage_ref: {
          stage_id: llmProof.stage_id,
          proof_hash: llmProof.proof_hash,
        },
      },
      retained_semantic_proof: semanticProof,
      llm_execution_proof: llmProof,
      predecessor_finalization_failure_receipt: failure,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        authority: binding,
        predecessor_finalization_failure_receipt: failure,
      },
    });
    expect(
      scripted.calls.find(({ text }) => text.includes("set_config('app.semantic_domain'"))?.values,
    ).toEqual(["falcon24"]);
  });

  it("loads the exact staged E7 LLM proof and eligible predecessor failure", async () => {
    const auth = authority();
    const stageId = id(100);
    const diagnosticAttemptId = id(101);
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope: { ...auth.capability.scope, semantic_domain: "falcon24" },
      target_authority_epoch: "E7",
      staging_id: id(102),
      stage_id: stageId,
      model_profile_id: id(103),
      model_config_version: 2,
      model_resource_hash: hash("1"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(104),
        artifact_type: "ModelCertificationReceipt",
        ...auth.capability.scope,
        run_id: id(105),
        revision: 1,
        content_hash: hash("2"),
      },
      execution_profile_hash: hash("3"),
      deployment_id: ids.deployment,
      deployment_hash: hash("4"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: { build_id: hash("5"), generation_id: hash("6") },
    });
    const recovery = {
      attempt_id: diagnosticAttemptId,
      run_id: id(106),
      manifest_hash: hash("7"),
      failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED",
      failure_code: "PROVIDER_PROFILE_NOT_AVAILABLE",
    } as const;
    const scripted = scriptedPool((text) => {
      if (text.includes("load_falcon24_llm_execution_certification_stage")) {
        return {
          schema_version: "falcon24-llm-execution-stage@1.0.0",
          status: "STAGED",
          proof_document: llmProof,
          certification_claims: { server_validated: true },
          certification_is_active: false,
          staging_command_hash: hash("8"),
          activation_attempt_id: null,
          rejection_reason_code: null,
          rejection_command_hash: null,
        };
      }
      if (text.includes("load_falcon24_e7_recovery_context")) return recovery;
      return undefined;
    });
    const port = createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      port.loadLlmExecutionStage(auth.capability, { stage_id: stageId }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({ status: "STAGED", proof_document: llmProof }),
    });
    await expect(
      port.loadRecoveryContext(auth.capability, { attempt_id: diagnosticAttemptId }),
    ).resolves.toEqual({ ok: true, value: recovery });
    expect(
      scripted.calls.find(({ text }) =>
        text.includes("load_falcon24_llm_execution_certification_stage"),
      )?.values,
    ).toEqual([stageId]);
  });

  it("rejects a staged E7 LLM candidate through the narrow hashed command", async () => {
    const auth = authority();
    const stageId = id(107);
    const llmProof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope: { ...auth.capability.scope, semantic_domain: "falcon24" },
      target_authority_epoch: "E7",
      staging_id: id(108),
      stage_id: stageId,
      model_profile_id: id(109),
      model_config_version: 2,
      model_resource_hash: hash("a"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(110),
        artifact_type: "ModelCertificationReceipt",
        ...auth.capability.scope,
        run_id: id(111),
        revision: 1,
        content_hash: hash("b"),
      },
      execution_profile_hash: hash("c"),
      deployment_id: ids.deployment,
      deployment_hash: hash("d"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: { build_id: hash("e"), generation_id: hash("f") },
    });
    const proofHash = llmProof.proof_hash;
    const scripted = scriptedPool((text, values) => {
      if (!text.includes("reject_falcon24_llm_execution_certification_stage")) return undefined;
      const command = values?.[0];
      if (typeof command !== "object" || command === null) {
        throw new Error("Reject command fixture is missing.");
      }
      const rejectCommand = command as Record<string, unknown>;
      return {
        schema_version: "falcon24-llm-execution-stage@1.0.0",
        status: "REJECTED",
        proof_document: llmProof,
        certification_claims: { server_validated: true },
        certification_is_active: false,
        staging_command_hash: hash("1"),
        activation_attempt_id: null,
        rejection_reason_code: "ACTIVATION_ATTEMPT_HELD",
        rejection_command_hash: rejectCommand.command_hash,
      };
    });
    const port = createPostgresFalcon24AuthorityEpoch({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    const result = await port.rejectLlmExecutionStage(auth.capability, {
      stage_id: stageId,
      proof_hash: proofHash,
      reason_code: "ACTIVATION_ATTEMPT_HELD",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { status: "REJECTED", rejection_reason_code: "ACTIVATION_ATTEMPT_HELD" },
    });
    const command = scripted.calls.find(({ text }) =>
      text.includes("reject_falcon24_llm_execution_certification_stage"),
    )?.values?.[0];
    if (typeof command !== "object" || command === null) {
      throw new Error("Reject command was not issued.");
    }
    const rejectCommand = command as Record<string, unknown>;
    expect(rejectCommand).toMatchObject({
      schema_version: "falcon24-llm-execution-stage-reject@1.0.0",
      stage_id: stageId,
      proof_hash: proofHash,
      reason_code: "ACTIVATION_ATTEMPT_HELD",
    });
    expect(rejectCommand.command_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
