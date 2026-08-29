import { describe, expect, it } from "vitest";
import {
  buildCombinedFalcon24SemanticActivationCommand,
  buildCombinedFalcon24SemanticActivationReceipt,
  buildFalcon24ActivationRequestV3,
  buildFalcon24ActivationRequestV4,
  buildFalcon24E1StagingReceipt,
  buildFalcon24LlmExecutionAuthorityProof,
  buildFalcon24QaE2eReceiptV2,
  buildFalcon24RetainedSemanticReleaseAuthorityProof,
  buildFalcon24SemanticAuthorityClosureLoadCommand,
  buildFalcon24StagingReceiptV2,
  falcon24ActivationAttemptV2Schema,
  falcon24AuthorityBindingSchema,
  falcon24AuthorityBindingV2Schema,
  falcon24AuthorityEpochSchema,
  falcon24AuthorityPersistenceBindingSchema,
  falcon24E1ActivationAttemptSchema,
  falcon24SemanticAuthorityClosureSchema,
  falcon24StagingHoldRequestV2Schema,
  falcon24StagingSessionRequestV2Schema,
  verifyCombinedFalcon24SemanticActivationCommand,
  verifyCombinedFalcon24SemanticActivationReceipt,
  verifyFalcon24ActivationRequestV3,
  verifyFalcon24ActivationRequestV4,
  verifyFalcon24E1StagingReceipt,
  verifyFalcon24LlmExecutionAuthorityProof,
  verifyFalcon24RetainedSemanticReleaseAuthorityProof,
  verifyFalcon24SemanticAuthorityClosureLoadCommand,
  verifyFalcon24StagingReceiptV2,
  verifyFalcon24UiReceiptDocument,
} from "../src/runs/authority-epoch.js";
import {
  compareFalcon24AuthorityEpochs,
  FALCON24_TARGET_AUTHORITY_EPOCH,
  falcon24AuthorityEpochOrdinal,
} from "../src/runs/falcon24-authority-identity.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Falcon24 E1 authority epoch contracts", () => {
  it("parses canonical epochs and compares their ordinals without lexical drift", () => {
    expect(FALCON24_TARGET_AUTHORITY_EPOCH).toBe("E2");
    expect(falcon24AuthorityEpochSchema.parse("E10")).toBe("E10");
    expect(falcon24AuthorityEpochOrdinal("E10")).toBe(10n);
    expect(compareFalcon24AuthorityEpochs("E2", "E10")).toBe(-1);
    expect(compareFalcon24AuthorityEpochs("E10", "E2")).toBe(1);
    expect(compareFalcon24AuthorityEpochs("E2", "E2")).toBe(0);
    for (const invalid of ["E0", "E01", "e2", "E2 ", "epoch-2"]) {
      expect(() => falcon24AuthorityEpochSchema.parse(invalid)).toThrow();
    }
  });

  it("builds and verifies a strict content-addressed staging receipt", async () => {
    const receipt = await buildFalcon24E1StagingReceipt({
      schema_version: "falcon24-e1-staging-receipt@1.0.0",
      staging_id: id(1),
      component: "SEMANTIC_RELEASE",
      subject_hash: hash("a"),
      evidence_hash: hash("b"),
      production_isolation_proven: false,
    });

    await expect(verifyFalcon24E1StagingReceipt(receipt)).resolves.toEqual(receipt);
    await expect(
      verifyFalcon24E1StagingReceipt({ ...receipt, evidence_hash: hash("c") }),
    ).rejects.toThrow("FALCON24_E1_STAGING_RECEIPT_HASH_INVALID");
  });

  it("rejects historical identity and unknown authority fields", () => {
    expect(() =>
      falcon24AuthorityBindingSchema.parse({
        schema_version: "falcon24-authority-binding@1.0.0",
        authority_epoch: "E1",
        baseline_id: id(2),
        baseline_hash: hash("d"),
        activation_attempt_id: id(3),
        old_release_id: id(4),
      }),
    ).toThrow();
    expect(
      falcon24AuthorityPersistenceBindingSchema.parse({
        authority_epoch: "E1",
        authority_baseline_id: id(2),
        authority_baseline_hash: hash("d"),
        authority_activation_attempt_id: id(3),
      }),
    ).toEqual({
      authority_epoch: "E1",
      authority_baseline_id: id(2),
      authority_baseline_hash: hash("d"),
      authority_activation_attempt_id: id(3),
    });
    expect(() =>
      falcon24AuthorityPersistenceBindingSchema.parse({
        authority_epoch: "E0",
        authority_baseline_id: id(2),
        authority_baseline_hash: hash("d"),
        authority_activation_attempt_id: id(3),
      }),
    ).toThrow();
    expect(() =>
      falcon24AuthorityBindingSchema.parse({
        schema_version: "falcon24-authority-binding@1.0.0",
        authority_epoch: "E2",
        baseline_id: id(2),
        baseline_hash: hash("d"),
        activation_attempt_id: id(3),
      }),
    ).toThrow();
    expect(
      falcon24AuthorityBindingV2Schema.parse({
        schema_version: "falcon24-authority-binding@2.0.0",
        authority_epoch: "E2",
        baseline_id: id(2),
        baseline_hash: hash("d"),
        activation_attempt_id: id(3),
      }),
    ).toMatchObject({ authority_epoch: "E2" });
  });

  it("builds E2 staging receipts only with the versioned epoch-bound contract", async () => {
    const receipt = await buildFalcon24StagingReceiptV2({
      schema_version: "falcon24-staging-receipt@2.0.0",
      authority_epoch: "E2",
      staging_id: id(6),
      component: "OPERATOR_REGISTRY",
      subject_hash: hash("e"),
      evidence_hash: hash("f"),
      production_isolation_proven: false,
    });

    await expect(verifyFalcon24StagingReceiptV2(receipt)).resolves.toEqual(receipt);
    await expect(
      buildFalcon24StagingReceiptV2({
        ...receipt,
        schema_version: "falcon24-e1-staging-receipt@1.0.0",
      }),
    ).rejects.toThrow();
  });

  it("binds E2 staging, activation, and browser receipts to one exact epoch", async () => {
    expect(
      falcon24StagingSessionRequestV2Schema.parse({
        schema_version: "falcon24-staging-session@2.0.0",
        authority_epoch: "E2",
        staging_id: id(7),
        retained_assets_hash: hash("1"),
      }),
    ).toMatchObject({ authority_epoch: "E2" });
    expect(
      falcon24StagingHoldRequestV2Schema.parse({
        schema_version: "falcon24-staging-hold-request@2.0.0",
        authority_epoch: "E4",
        staging_id: id(70),
        expected_retained_assets_hash: hash("7"),
        failure_code: "BUILTIN_TEAM_SKILL_REVISION_CONFLICT",
      }),
    ).toMatchObject({
      authority_epoch: "E4",
      failure_code: "BUILTIN_TEAM_SKILL_REVISION_CONFLICT",
    });
    expect(
      falcon24ActivationAttemptV2Schema.parse({
        schema_version: "falcon24-activation-attempt@2.0.0",
        authority_epoch: "E2",
        attempt_id: id(8),
        baseline_id: id(9),
        expected_baseline_hash: hash("2"),
        status: "OPEN",
        failure_code: null,
      }),
    ).toMatchObject({ authority_epoch: "E2" });

    const receipt = await buildFalcon24QaE2eReceiptV2({
      schema_version: "falcon24-qa-e2e-receipt@2.0.0",
      run_id: id(10),
      conversation_id: id(11),
      authority: {
        schema_version: "falcon24-authority-binding@2.0.0",
        authority_epoch: "E2",
        baseline_id: id(9),
        baseline_hash: hash("2"),
        activation_attempt_id: id(8),
      },
      web_build: { build_id: hash("3"), generation_id: hash("4") },
      browser_harness_version: "falcon24-agent-browser-trace-gate@2.0.0",
      viewport: { width: 1440, height: 900 },
      error_banner: null,
      dom_snapshot_hash: hash("5"),
      screenshot_hash: hash("6"),
      observed_at: "2026-08-27T00:00:00.000+08:00",
      entry_path: "QUESTION_COMPOSER_SUBMIT_TO_RESULT",
      question_hash: hash("7"),
      terminal_status: "COMPLETED",
      answer_visible: true,
      table_visible: true,
      chart_rendered: true,
      report_visible: true,
    });

    await expect(verifyFalcon24UiReceiptDocument(receipt)).resolves.toEqual(receipt);
    await expect(
      buildFalcon24QaE2eReceiptV2({
        ...receipt,
        authority: {
          ...receipt.authority,
          schema_version: "falcon24-authority-binding@1.0.0",
          authority_epoch: "E1",
        },
      }),
    ).rejects.toThrow();
  });

  it("makes HOLD activation attempts terminal and self-consistent", () => {
    expect(
      falcon24E1ActivationAttemptSchema.parse({
        schema_version: "falcon24-e1-activation-attempt@1.0.0",
        attempt_id: id(5),
        baseline_id: id(2),
        expected_baseline_hash: hash("d"),
        status: "HOLD",
        failure_code: "FALCON24_E1_STAGING_INCOMPLETE",
      }),
    ).toMatchObject({ status: "HOLD" });
    expect(() =>
      falcon24E1ActivationAttemptSchema.parse({
        schema_version: "falcon24-e1-activation-attempt@1.0.0",
        attempt_id: id(5),
        baseline_id: id(2),
        expected_baseline_hash: hash("d"),
        status: "OPEN",
        failure_code: "FALCON24_E1_STAGING_INCOMPLETE",
      }),
    ).toThrow("failure_code");
  });

  it("content-addresses refs-only combined E4 activation commands and receipts", async () => {
    const scope = {
      app_id: id(20),
      tenant_id: id(21),
      environment: "test" as const,
      semantic_domain: "falcon24",
    };
    const command = await buildCombinedFalcon24SemanticActivationCommand({
      schema_version: "combined-falcon24-semantic-activation-command@1.0.0",
      command_id: id(22),
      idempotency_key: "falcon24-e4-activate-gen2",
      scope,
      authority_epoch: "E4",
      expected_current_authority: {
        schema_version: "falcon24-authority-binding@2.0.0",
        authority_epoch: "E3",
        baseline_id: id(23),
        baseline_hash: hash("1"),
        activation_attempt_id: id(24),
      },
      expected_semantic_predecessor: {
        release_id: id(25),
        generation: 1,
        release_digest: hash("2"),
        datasource_id: id(26),
      },
      stage_ref: { stage_id: id(27), stage_digest: hash("3") },
      smoke_receipt_ref: {
        schema_version: "semantic-runtime-smoke-receipt@1.0.0",
        receipt_id: id(28),
        smoke_receipt_hash: hash("4"),
      },
      baseline_ref: { baseline_id: id(29), baseline_hash: hash("5") },
      activation_attempt_ref: { activation_attempt_id: id(30) },
      expected_versions: {
        semantic_pointer: 3,
        semantic_runtime: 3,
        workspace_defaults: 9,
      },
    });
    await expect(verifyCombinedFalcon24SemanticActivationCommand(command)).resolves.toEqual(
      command,
    );
    await expect(
      buildCombinedFalcon24SemanticActivationCommand({
        ...command,
        projection_payload: { executable: {} },
      }),
    ).rejects.toThrow();

    const receipt = await buildCombinedFalcon24SemanticActivationReceipt({
      schema_version: "combined-falcon24-semantic-activation-receipt@1.0.0",
      command_id: command.command_id,
      command_hash: command.command_hash,
      scope,
      authority: {
        schema_version: "falcon24-authority-binding@2.0.0",
        authority_epoch: "E4",
        baseline_id: id(29),
        baseline_hash: hash("5"),
        activation_attempt_id: id(30),
      },
      semantic_release: {
        release_id: id(31),
        generation: 2,
        release_digest: hash("6"),
        datasource_id: id(26),
      },
      workspace_defaults: {
        version: 10,
        semantic_release: {
          release_id: id(31),
          generation: 2,
          release_digest: hash("6"),
          datasource_id: id(26),
        },
      },
      stage_ref: command.stage_ref,
      smoke_receipt_ref: command.smoke_receipt_ref,
      outbox_event_id: id(32),
      transaction_id: "pg:xid:12345",
    });
    await expect(verifyCombinedFalcon24SemanticActivationReceipt(receipt)).resolves.toEqual(
      receipt,
    );
    await expect(
      verifyCombinedFalcon24SemanticActivationReceipt({
        ...receipt,
        outbox_event_id: id(33),
      }),
    ).rejects.toThrow("COMBINED_FALCON24_SEMANTIC_ACTIVATION_RECEIPT_HASH_INVALID");
  });

  it("defines one exact production readback closure for E3/gen1 and E4/gen2", async () => {
    const scope = {
      app_id: id(40),
      tenant_id: id(41),
      environment: "test" as const,
      semantic_domain: "falcon24",
    };
    const release = {
      release_id: id(42),
      generation: 2,
      release_digest: hash("7"),
      datasource_id: id(43),
    };
    const closure = {
      schema_version: "falcon24-semantic-authority-closure@1.0.0",
      scope,
      authority: {
        schema_version: "falcon24-authority-binding@2.0.0",
        authority_epoch: "E4",
        baseline_id: id(44),
        baseline_hash: hash("8"),
        activation_attempt_id: id(45),
      },
      semantic_pointer: { version: 8, release },
      semantic_runtime: { version: 10, release },
      workspace_defaults: { version: 12, release },
    } as const;
    expect(falcon24SemanticAuthorityClosureSchema.parse(closure)).toEqual(closure);
    expect(() =>
      falcon24SemanticAuthorityClosureSchema.parse({
        ...closure,
        semantic_runtime: {
          ...closure.semantic_runtime,
          release: { ...release, release_id: id(46) },
        },
      }),
    ).toThrow("FALCON24_SEMANTIC_AUTHORITY_CLOSURE_MIXED");

    const command = await buildFalcon24SemanticAuthorityClosureLoadCommand({
      schema_version: "falcon24-semantic-authority-closure-load@1.0.0",
      semantic_domain: scope.semantic_domain,
    });
    await expect(verifyFalcon24SemanticAuthorityClosureLoadCommand(command)).resolves.toEqual(
      command,
    );
    await expect(
      verifyFalcon24SemanticAuthorityClosureLoadCommand({
        ...command,
        semantic_domain: "other_domain",
      }),
    ).rejects.toThrow("FALCON24_SEMANTIC_AUTHORITY_CLOSURE_LOAD_HASH_INVALID");
  });

  it("binds retained semantic E5 activation to exact E4/gen2 closure", async () => {
    const current = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E4",
      baseline_id: id(80),
      baseline_hash: hash("8"),
      activation_attempt_id: id(81),
    };
    const release = {
      release_id: id(82),
      generation: 2,
      release_digest: hash("9"),
      datasource_id: id(83),
    };
    const proof = await buildFalcon24RetainedSemanticReleaseAuthorityProof({
      schema_version: "falcon24-retained-semantic-release-authority-proof@1.0.0",
      scope: {
        app_id: id(76),
        tenant_id: id(77),
        environment: "test",
        semantic_domain: "falcon24",
      },
      authority_epoch: "E5",
      expected_current_authority: current,
      semantic_release: release,
      projections: {
        executable: { projection_id: id(84), projection_digest: hash("a") },
        relationship: { projection_id: id(85), projection_digest: hash("b") },
        runtime_restriction: { projection_id: id(86), projection_digest: hash("c") },
        graph: { projection_id: id(87), projection_digest: hash("d") },
      },
      expected_versions: { semantic_pointer: 2, semantic_runtime: 2, workspace_defaults: 3 },
      web_build: { build_id: hash("e"), generation_id: hash("f") },
      worker_build: { build_id: hash("1"), generation_id: hash("2") },
    });
    await expect(verifyFalcon24RetainedSemanticReleaseAuthorityProof(proof)).resolves.toEqual(
      proof,
    );

    const command = await buildFalcon24ActivationRequestV3({
      schema_version: "falcon24-activation-request@3.0.0",
      scope: proof.scope,
      authority_epoch: "E5",
      attempt_id: id(88),
      baseline_id: id(89),
      expected_baseline_hash: hash("3"),
      expected_current_authority: current,
      expected_semantic_release: release,
      expected_versions: proof.expected_versions,
      retained_semantic_proof_hash: proof.proof_hash,
    });
    await expect(verifyFalcon24ActivationRequestV3(command)).resolves.toEqual(command);
    await expect(
      verifyFalcon24ActivationRequestV3({ ...command, retained_semantic_proof_hash: hash("4") }),
    ).rejects.toThrow("FALCON24_RETAINED_ACTIVATION_COMMAND_HASH_INVALID");
  });

  it("rejects retained activation before E5, non-successor epochs, and gen3 injection", async () => {
    const base = {
      schema_version: "falcon24-activation-request@3.0.0" as const,
      scope: {
        app_id: id(96),
        tenant_id: id(97),
        environment: "test",
        semantic_domain: "falcon24",
      },
      authority_epoch: "E5",
      attempt_id: id(90),
      baseline_id: id(91),
      expected_baseline_hash: hash("5"),
      expected_current_authority: {
        schema_version: "falcon24-authority-binding@2.0.0" as const,
        authority_epoch: "E4",
        baseline_id: id(92),
        baseline_hash: hash("6"),
        activation_attempt_id: id(93),
      },
      expected_semantic_release: {
        release_id: id(94),
        generation: 2,
        release_digest: hash("7"),
        datasource_id: id(95),
      },
      expected_versions: { semantic_pointer: 2, semantic_runtime: 2, workspace_defaults: 3 },
      retained_semantic_proof_hash: hash("8"),
    };
    await expect(
      buildFalcon24ActivationRequestV3({ ...base, authority_epoch: "E4" }),
    ).rejects.toThrow();
    await expect(
      buildFalcon24ActivationRequestV3({
        ...base,
        expected_current_authority: { ...base.expected_current_authority, authority_epoch: "E3" },
      }),
    ).rejects.toThrow();
    await expect(
      buildFalcon24ActivationRequestV3({
        ...base,
        expected_semantic_release: { ...base.expected_semantic_release, generation: 3 },
      }),
    ).rejects.toThrow();
  });

  it("binds E7 recovery to one exact E6 failure and staged execution certification", async () => {
    const scope = {
      app_id: id(100),
      tenant_id: id(101),
      environment: "test",
      semantic_domain: "falcon24",
    } as const;
    const current = {
      schema_version: "falcon24-authority-binding@2.0.0" as const,
      authority_epoch: "E6",
      baseline_id: id(102),
      baseline_hash: hash("a"),
      activation_attempt_id: id(103),
    };
    const release = {
      release_id: id(104),
      generation: 2,
      release_digest: hash("b"),
      datasource_id: id(105),
    } as const;
    const proof = await buildFalcon24LlmExecutionAuthorityProof({
      schema_version: "falcon24-llm-execution-authority-proof@1.0.0",
      scope,
      target_authority_epoch: "E7",
      staging_id: id(106),
      stage_id: id(107),
      model_profile_id: id(108),
      model_config_version: 2,
      model_resource_hash: hash("c"),
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      certification_receipt_ref: {
        artifact_id: id(109),
        artifact_type: "ModelCertificationReceipt",
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(110),
        revision: 1,
        content_hash: hash("d"),
      },
      execution_profile_hash: hash("e"),
      deployment_id: id(111),
      deployment_hash: hash("f"),
      recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
      worker_build: { build_id: hash("1"), generation_id: hash("2") },
    });
    await expect(verifyFalcon24LlmExecutionAuthorityProof(proof)).resolves.toEqual(proof);

    const command = await buildFalcon24ActivationRequestV4({
      schema_version: "falcon24-activation-request@4.0.0",
      scope,
      authority_epoch: "E7",
      attempt_id: id(112),
      baseline_id: id(113),
      expected_baseline_hash: hash("3"),
      expected_current_authority: current,
      expected_semantic_release: release,
      expected_versions: { semantic_pointer: 3, semantic_runtime: 3, workspace_defaults: 4 },
      retained_semantic_proof_hash: hash("4"),
      predecessor_diagnostic_failure: {
        attempt_id: id(114),
        run_id: id(115),
        manifest_hash: hash("5"),
        failure_class: "FROZEN_CLOSURE_CHANGE_REQUIRED",
        failure_code: "PROVIDER_PROFILE_NOT_AVAILABLE",
      },
      llm_execution_stage_ref: { stage_id: proof.stage_id, proof_hash: proof.proof_hash },
    });
    await expect(verifyFalcon24ActivationRequestV4(command)).resolves.toEqual(command);
    await expect(
      verifyFalcon24ActivationRequestV4({
        ...command,
        predecessor_diagnostic_failure: {
          ...command.predecessor_diagnostic_failure,
          failure_code: "PROVIDER_UNAVAILABLE",
        },
      }),
    ).rejects.toThrow();
    await expect(
      buildFalcon24ActivationRequestV4({ ...command, authority_epoch: "E6" }),
    ).rejects.toThrow();
    await expect(
      buildFalcon24LlmExecutionAuthorityProof({
        ...proof,
        certification_receipt_ref: {
          ...proof.certification_receipt_ref,
          artifact_type: "QueryEvidence",
        },
      }),
    ).rejects.toThrow();
  });
});
