import { describe, expect, it } from "vitest";
import {
  buildSensitiveExecutionArtifactReceipt,
  loadSensitiveExecutionArtifactCommandSchema,
  sensitiveExecutionArtifactReceiptSchema,
  verifySensitiveExecutionArtifactReceipt,
} from "../src/artifacts/index.js";

const scope = {
  app_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;

const draft = {
  schema_version: "sensitive-execution-artifact@2.0.0",
  artifact_ref: {
    artifact_id: "00000000-0000-4000-8000-000000000003",
    artifact_type: "SensitiveExecutionArtifact",
    ...scope,
    run_id: "00000000-0000-4000-8000-000000000004",
    revision: 1,
    content_hash: `sha256:${"2".repeat(64)}`,
  },
  content_kind: "ANALYSIS_INPUT",
  plaintext_hash: `sha256:${"2".repeat(64)}`,
  ciphertext_hash: `sha256:${"3".repeat(64)}`,
  storage_key_hash: `sha256:${"4".repeat(64)}`,
  encryption: {
    algorithm: "AES-256-GCM",
    key_id: "kms/team-context-v1",
  },
  lifecycle: {
    status: "ACTIVE",
    expires_at: "2026-08-18T00:00:00.000Z",
    legal_hold: false,
    ref_count: 1,
    tombstoned_at: null,
    backup_expires_at: "2026-08-25T00:00:00.000Z",
  },
  committed_at: "2026-08-17T00:00:00.000Z",
} as const;

describe("SensitiveExecutionArtifact", () => {
  it("builds and verifies a hash-covered private artifact receipt", async () => {
    const receipt = await buildSensitiveExecutionArtifactReceipt(draft);
    expect(await verifySensitiveExecutionArtifactReceipt(receipt)).toEqual(receipt);
    expect(receipt.artifact_ref.artifact_type).toBe("SensitiveExecutionArtifact");
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("rejects public preview fields, raw payloads and cross-scope splices", async () => {
    const receipt = await buildSensitiveExecutionArtifactReceipt(draft);
    expect(
      sensitiveExecutionArtifactReceiptSchema.safeParse({ ...receipt, public_preview: true })
        .success,
    ).toBe(false);
    expect(
      sensitiveExecutionArtifactReceiptSchema.safeParse({ ...receipt, plaintext: "secret" })
        .success,
    ).toBe(false);
    await expect(
      verifySensitiveExecutionArtifactReceipt({
        ...receipt,
        artifact_ref: { ...receipt.artifact_ref, tenant_id: scope.app_id },
      }),
    ).rejects.toThrow("SENSITIVE_EXECUTION_ARTIFACT_HASH_MISMATCH");
  });

  it("enforces lifecycle truth tables and canonical UTC timestamps", async () => {
    expect(
      sensitiveExecutionArtifactReceiptSchema.safeParse({
        ...(await buildSensitiveExecutionArtifactReceipt(draft)),
        lifecycle: { ...draft.lifecycle, ref_count: 0 },
      }).success,
    ).toBe(false);
    expect(
      sensitiveExecutionArtifactReceiptSchema.safeParse({
        ...(await buildSensitiveExecutionArtifactReceipt(draft)),
        lifecycle: {
          status: "TOMBSTONED",
          expires_at: draft.lifecycle.expires_at,
          legal_hold: false,
          ref_count: 0,
          tombstoned_at: null,
          backup_expires_at: draft.lifecycle.backup_expires_at,
        },
      }).success,
    ).toBe(false);
  });

  it("requires exact run-scoped ciphertext identity for private loads", () => {
    const command = {
      schema_version: "sensitive-execution-artifact-load@2.0.0",
      artifact_ref: draft.artifact_ref,
      ciphertext_hash: draft.ciphertext_hash,
    } as const;
    expect(loadSensitiveExecutionArtifactCommandSchema.safeParse(command).success).toBe(true);
    const { ciphertext_hash: _missing, ...withoutCiphertextHash } = command;
    expect(
      loadSensitiveExecutionArtifactCommandSchema.safeParse(withoutCiphertextHash).success,
    ).toBe(false);
  });
});
