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
  resolveFalcon24PredecessorDatasetSubjectHash,
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
      authority_epoch: "E2",
      terminal: "NOT_RUN",
      reason_code: "FALCON24_AUTHORITY_ACTIVATION_CONFIRMATION_REQUIRED",
    });
  });

  it("rejects E1 as a v2 activation target before confirmation", async () => {
    await expect(
      runFalcon24AuthorityFinalization({
        NODE_ENV: "test",
        FALCON24_AUTHORITY_EPOCH: "E1",
      }),
    ).rejects.toThrow();
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
