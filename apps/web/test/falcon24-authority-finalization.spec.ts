import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type BuiltinTeamMaterializationInput,
  buildBuiltinTeamMaterialization,
  DATA_AGENT_SPECIALIST_PROFILE_IDS,
} from "@data-agent/agent-runtime";
import {
  buildFalcon24E1StagingReceipt,
  buildFalcon24StagingReceiptV2,
} from "@data-agent/contracts/runs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildFalcon24AcceptanceContractHashes,
  buildFalcon24AgentProfileAuthorityProof,
  buildFalcon24SuccessorSmokeIdempotencyKey,
  resolveFalcon24PredecessorDatasetSubjectHash,
  resolveFalcon24RetainedRecoveryKind,
  runFalcon24AuthorityFinalization,
  verifyFalcon24PredecessorStagingReceipt,
} from "../src/cli/finalize-falcon24-authority.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const oracleHash = `sha256:${"a".repeat(64)}` as const;

function resourceReferences(prefix: string) {
  return Object.fromEntries(
    DATA_AGENT_SPECIALIST_PROFILE_IDS.map((profileId, index) => [
      profileId,
      {
        resource_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, prefix)}`,
        resource_revision: 1,
        resource_hash: `sha256:${String(index + 1)
          .repeat(64)
          .slice(0, 64)}`,
      },
    ]),
  ) as BuiltinTeamMaterializationInput["model_profile_refs"];
}

describe("Falcon24 versioned authority finalization", () => {
  it("refuses activation without the destructive confirmation", async () => {
    await expect(runFalcon24AuthorityFinalization({ NODE_ENV: "test" })).resolves.toEqual({
      schema_version: "falcon24-authority-finalization-result@2.0.0",
      authority_epoch: "E4",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_AUTHORITY_ACTIVATION_CONFIRMATION_REQUIRED",
    });
  });

  it.each(["E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12"])(
    "recognizes %s as an explicit retained-authority target before confirmation",
    async (authorityEpoch) => {
      await expect(
        runFalcon24AuthorityFinalization({
          NODE_ENV: "test",
          FALCON24_AUTHORITY_EPOCH: authorityEpoch,
        }),
      ).resolves.toEqual({
        schema_version: "falcon24-authority-finalization-result@2.0.0",
        authority_epoch: authorityEpoch,
        terminal: "NOT_RUN",
        reason_code: "FALCON24_AUTHORITY_ACTIVATION_CONFIRMATION_REQUIRED",
      });
    },
  );

  it("rejects unsupported activation targets before confirmation", async () => {
    await expect(
      runFalcon24AuthorityFinalization({
        NODE_ENV: "test",
        FALCON24_AUTHORITY_EPOCH: "E3",
      }),
    ).rejects.toThrow();
  });

  it("selects terminal diagnostic evidence for E11 and finalization evidence for E10", () => {
    expect(
      resolveFalcon24RetainedRecoveryKind({
        authority_epoch: "E11",
        llm_execution_stage_id: "00000000-0000-4000-8000-000000000001",
        predecessor_diagnostic_attempt_id: "00000000-0000-4000-8000-000000000002",
      }),
    ).toBe("TERMINAL_DIAGNOSTIC");
    expect(
      resolveFalcon24RetainedRecoveryKind({
        authority_epoch: "E10",
        llm_execution_stage_id: "00000000-0000-4000-8000-000000000001",
        predecessor_finalization_failure_receipt_id: "00000000-0000-4000-8000-000000000003",
      }),
    ).toBe("FINALIZATION_FAILURE");
  });

  it("rejects ambiguous or missing E11 predecessor evidence", () => {
    expect(() =>
      resolveFalcon24RetainedRecoveryKind({
        authority_epoch: "E11",
        llm_execution_stage_id: "00000000-0000-4000-8000-000000000001",
        predecessor_diagnostic_attempt_id: "00000000-0000-4000-8000-000000000002",
        predecessor_finalization_failure_receipt_id: "00000000-0000-4000-8000-000000000003",
      }),
    ).toThrow("FALCON24_TERMINAL_RECOVERY_CONFIGURATION_REQUIRED");
    expect(() =>
      resolveFalcon24RetainedRecoveryKind({
        authority_epoch: "E11",
        llm_execution_stage_id: "00000000-0000-4000-8000-000000000001",
      }),
    ).toThrow("FALCON24_TERMINAL_RECOVERY_CONFIGURATION_REQUIRED");
  });

  it("selects only an explicit, exclusive four-layer predecessor for E12+", () => {
    const candidate = {
      authority_epoch: "E12",
      llm_execution_stage_id: "00000000-0000-4000-8000-000000000001",
      predecessor_four_layer_attempt_id: "00000000-0000-4000-8000-000000000002",
    };
    expect(resolveFalcon24RetainedRecoveryKind(candidate)).toBe("FOUR_LAYER_FAILURE");
    expect(() =>
      resolveFalcon24RetainedRecoveryKind({
        authority_epoch: "E12",
        llm_execution_stage_id: candidate.llm_execution_stage_id,
        predecessor_diagnostic_attempt_id: candidate.predecessor_four_layer_attempt_id,
      }),
    ).toThrow("FALCON24_FOUR_LAYER_RECOVERY_CONFIGURATION_REQUIRED");
    for (const authority_epoch of ["E6", "E7", "E8", "E9", "E10", "E11"]) {
      expect(() =>
        resolveFalcon24RetainedRecoveryKind({ ...candidate, authority_epoch }),
      ).toThrow();
    }
    for (const patch of [
      { llm_execution_stage_id: undefined },
      { predecessor_diagnostic_attempt_id: candidate.predecessor_four_layer_attempt_id },
      { predecessor_closure_failure_receipt_id: candidate.predecessor_four_layer_attempt_id },
      { predecessor_finalization_failure_receipt_id: candidate.predecessor_four_layer_attempt_id },
    ]) {
      expect(() => resolveFalcon24RetainedRecoveryKind({ ...candidate, ...patch })).toThrow();
    }
  });

  it("imports only the generation-2 combined activation path", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/cli/finalize-falcon24-authority.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("finalizeFalcon24SemanticSuccessor");
    expect(source).toContain("stageFalcon24E4SuccessorAuthority");
    expect(source).toContain("finalizeFalcon24RetainedAuthority");
    expect(source).toContain("stageFalcon24RetainedAuthority");
    expect(source).toContain("FALCON24_PREDECESSOR_CLOSURE_FAILURE_RECEIPT_ID");
    expect(source).toContain("loadEpochClosureFailure");
    expect(source).toContain("FALCON24_PREDECESSOR_FINALIZATION_FAILURE_RECEIPT_ID");
    expect(source).toContain("loadFinalizationFailure");
    expect(source).toContain("resolveCurrentExecutionCertificationV2");
    expect(source).toContain("createPostgresProviderInvocationStore");
    expect(source).toContain("createPostgresSemanticPublicationAuthority");
    expect(source).toContain("buildFalcon24SuccessorChangeSet");
    expect(source).toContain("prepareSuccessorReview");
    expect(source).toContain("prepareApprovedSuccessor");
    expect(source).toContain("createFalcon24SuccessorSmokeProcess");
    expect(source).not.toContain("FALCON24_SUCCESSOR_CHANGE_SET_ID");
    expect(source).not.toContain("FALCON24_SUCCESSOR_CHANGE_SET_HASH");
    expect(source).not.toContain("FALCON24_SUCCESSOR_REVIEW_ID");
    expect(source).not.toContain("FALCON24_SUCCESSOR_REVIEW_HASH");
    expect(source).not.toContain("prepareWorkspaceAuthority");
    expect(source).not.toContain("stageSemanticReleaseReceipt");
    expect(source).not.toContain("createPostgresGreenfieldBootstrapReleaseAuthority");
    expect(source).not.toContain("buildFalcon24SemanticReleaseAuthorityProof");
    expect(source).not.toMatch(/\.activate\s*\(/u);
    expect(source).not.toContain("updateWorkspaceDefaults");
  });

  it("branches to retained E5 finalization before any successor publication work", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/cli/finalize-falcon24-authority.ts", import.meta.url)),
      "utf8",
    );
    const retainedIndex = source.indexOf("await finalizeFalcon24RetainedAuthority");
    const publicationIndex = source.indexOf("await semanticPublicationCompilerBundleDigest");

    expect(retainedIndex).toBeGreaterThan(0);
    expect(publicationIndex).toBeGreaterThan(retainedIndex);
    expect(source.slice(0, publicationIndex)).not.toContain("prepareSuccessorReview({");
    expect(source.slice(0, publicationIndex)).not.toContain("prepareApprovedSuccessor({");
  });

  it("requires the server-built ChangeSet and exact human approval before staging", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/cli/finalize-falcon24-authority.ts", import.meta.url)),
      "utf8",
    );
    const buildIndex = source.indexOf("await buildFalcon24SuccessorChangeSet");
    const reviewIndex = source.indexOf("await publicationAuthority.prepareSuccessorReview");
    const approvalIndex = source.indexOf("await publicationAuthority.prepareApprovedSuccessor");
    const stageIndex = source.indexOf("await finalizeFalcon24SemanticSuccessor");

    expect(buildIndex).toBeGreaterThan(0);
    expect(reviewIndex).toBeGreaterThan(buildIndex);
    expect(approvalIndex).toBeGreaterThan(reviewIndex);
    expect(stageIndex).toBeGreaterThan(approvalIndex);
    expect(source).toContain("change_set_ref: approvedSuccessor.change_set_ref");
    expect(source).toContain("review_ref: approvedSuccessor.review_ref");
  });

  it("content-addresses every final acceptance contract from its frozen source closure", async () => {
    const left = await buildFalcon24AcceptanceContractHashes({
      repository_root: repositoryRoot,
      oracle_contract_hash: oracleHash,
    });
    const right = await buildFalcon24AcceptanceContractHashes({
      repository_root: repositoryRoot,
      oracle_contract_hash: oracleHash,
    });

    expect(right).toEqual(left);
    expect(left.oracle).toBe(oracleHash);
    expect(Object.values(left)).toHaveLength(6);
    expect(new Set(Object.values(left)).size).toBe(6);
    expect(Object.values(left).every((hash) => /^sha256:[a-f0-9]{64}$/u.test(hash))).toBe(true);
  });

  it("binds the Worker build identity into the Agent Profile staging evidence", async () => {
    const materializationInput: BuiltinTeamMaterializationInput = {
      scope: {
        app_id: "00000000-0000-4000-8000-000000000001",
        tenant_id: "00000000-0000-4000-8000-000000000002",
        environment: "test",
      },
      model_profile_refs: resourceReferences("0"),
      context_policy_refs: resourceReferences("1"),
      execution_safety_policy_refs: resourceReferences("2"),
    };
    const built = await buildBuiltinTeamMaterialization(materializationInput);
    const workerBuild = {
      schema_version: "runtime-build-identity@1.0.0" as const,
      consumer_role: "worker" as const,
      generation_id: `sha256:${"a".repeat(64)}` as const,
      build_id: `sha256:${"b".repeat(64)}` as const,
      built_at: "2026-08-27T00:00:00.000Z",
      git_commit: "1".repeat(40),
      git_dirty: false,
    };
    const left = await buildFalcon24AgentProfileAuthorityProof({
      authority_epoch: "E2",
      built,
      materialization_input: materializationInput,
      worker_build: workerBuild,
    });
    const right = await buildFalcon24AgentProfileAuthorityProof({
      authority_epoch: "E2",
      built,
      materialization_input: materializationInput,
      worker_build: {
        ...workerBuild,
        build_id: `sha256:${"c".repeat(64)}`,
      },
    });

    expect(right.subject_hash).toBe(left.subject_hash);
    expect(right.evidence_hash).not.toBe(left.evidence_hash);
    expect(left.evidence.worker_build).toEqual({
      build_id: workerBuild.build_id,
      generation_id: workerBuild.generation_id,
    });
  });

  it("uses a build-bound idempotency key for successor smoke revalidation", async () => {
    const workerBuild = {
      schema_version: "runtime-build-identity@1.0.0" as const,
      consumer_role: "worker" as const,
      generation_id: `sha256:${"a".repeat(64)}` as const,
      build_id: `sha256:${"b".repeat(64)}` as const,
      built_at: "2026-08-28T00:00:00.000Z",
      git_commit: "1".repeat(40),
      git_dirty: false,
    };
    const stageIdentity = `sha256:${"c".repeat(64)}` as const;

    const original = await buildFalcon24SuccessorSmokeIdempotencyKey({
      stage_identity: stageIdentity,
      worker_build_identity: workerBuild,
    });
    const replay = await buildFalcon24SuccessorSmokeIdempotencyKey({
      stage_identity: stageIdentity,
      worker_build_identity: workerBuild,
    });
    const successorBuild = await buildFalcon24SuccessorSmokeIdempotencyKey({
      stage_identity: stageIdentity,
      worker_build_identity: {
        ...workerBuild,
        generation_id: `sha256:${"d".repeat(64)}`,
        build_id: `sha256:${"e".repeat(64)}`,
        git_commit: "2".repeat(40),
      },
    });

    expect(replay).toBe(original);
    expect(successorBuild).not.toBe(original);
    expect(original).toMatch(/^[0-9a-f-]{36}$/u);
    expect(successorBuild).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("verifies E1 and versioned successor receipts for the exact predecessor epoch", async () => {
    const material = {
      staging_id: "00000000-0000-4000-8000-000000000001",
      component: "DATASET" as const,
      subject_hash: `sha256:${"a".repeat(64)}` as const,
      evidence_hash: `sha256:${"b".repeat(64)}` as const,
      production_isolation_proven: false,
    };
    const e1 = await buildFalcon24E1StagingReceipt({
      schema_version: "falcon24-e1-staging-receipt@1.0.0",
      ...material,
    });
    const e2 = await buildFalcon24StagingReceiptV2({
      schema_version: "falcon24-staging-receipt@2.0.0",
      authority_epoch: "E2",
      ...material,
    });

    await expect(
      verifyFalcon24PredecessorStagingReceipt({
        authority_epoch: "E1",
        receipt_document: e1,
      }),
    ).resolves.toEqual(e1);
    await expect(
      verifyFalcon24PredecessorStagingReceipt({
        authority_epoch: "E2",
        receipt_document: e2,
      }),
    ).resolves.toEqual(e2);
    await expect(
      verifyFalcon24PredecessorStagingReceipt({
        authority_epoch: "E3",
        receipt_document: e2,
      }),
    ).rejects.toThrow("FALCON24_AUTHORITY_PREDECESSOR_RECEIPT_EPOCH_MISMATCH");
    expect(
      resolveFalcon24PredecessorDatasetSubjectHash({
        predecessor_receipt: e1,
        e1_import_receipt_hash: material.subject_hash,
        versioned_verification_receipt_hash: material.evidence_hash,
      }),
    ).toBe(material.subject_hash);
    expect(
      resolveFalcon24PredecessorDatasetSubjectHash({
        predecessor_receipt: e2,
        e1_import_receipt_hash: material.subject_hash,
        versioned_verification_receipt_hash: material.evidence_hash,
      }),
    ).toBe(material.evidence_hash);
  });
});
