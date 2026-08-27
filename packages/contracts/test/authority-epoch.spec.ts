import { describe, expect, it } from "vitest";
import {
  buildFalcon24E1StagingReceipt,
  buildFalcon24QaE2eReceiptV2,
  buildFalcon24StagingReceiptV2,
  falcon24ActivationAttemptV2Schema,
  falcon24AuthorityBindingSchema,
  falcon24AuthorityBindingV2Schema,
  falcon24AuthorityEpochSchema,
  falcon24AuthorityPersistenceBindingSchema,
  falcon24E1ActivationAttemptSchema,
  falcon24StagingSessionRequestV2Schema,
  verifyFalcon24E1StagingReceipt,
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
});
