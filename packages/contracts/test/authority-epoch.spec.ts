import { describe, expect, it } from "vitest";
import {
  buildFalcon24E1StagingReceipt,
  falcon24AuthorityBindingSchema,
  falcon24AuthorityPersistenceBindingSchema,
  falcon24E1ActivationAttemptSchema,
  verifyFalcon24E1StagingReceipt,
} from "../src/runs/authority-epoch.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Falcon24 E1 authority epoch contracts", () => {
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
