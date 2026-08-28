import { buildSemanticSuccessorStage } from "@data-agent/contracts/artifacts";
import { buildFalcon24SemanticReleaseAuthorityProofV2 } from "@data-agent/contracts/evals";
import {
  buildFalcon24StagingReceiptV2,
  type Falcon24StagingReceiptV2,
} from "@data-agent/contracts/runs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { stageFalcon24E4SuccessorAuthority } from "../src/lib/falcon24-successor-authority-staging";

const id = (suffix: number) => `90000000-0000-5000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

const predecessor = {
  release_id: id(1),
  generation: 1,
  release_digest: hash("1"),
} as const;
const candidate = {
  release_id: id(2),
  generation: 2,
  release_digest: hash("2"),
  datasource_id: id(3),
} as const;
const projectionRefs = {
  executable: { projection_id: id(4), projection_digest: hash("3") },
  relationship: { projection_id: id(5), projection_digest: hash("4") },
  runtime_restriction: { projection_id: id(6), projection_digest: hash("5") },
  graph: { projection_id: id(7), projection_digest: hash("6") },
} as const;
const stageMaterial = {
  schema_version: "semantic-successor-stage@1.0.0",
  scope: {
    app_id: id(8),
    tenant_id: id(9),
    environment: "test",
    semantic_domain: "falcon24",
  },
  stage_id: id(10),
  predecessor_release: predecessor,
  expected_pointer_version: 7,
  target_generation: 2,
  change_set_ref: { change_set_id: id(11), change_set_hash: hash("8") },
  review_ref: { review_id: id(12), review_hash: hash("9") },
  source_snapshot_ref: {
    snapshot_id: id(13),
    snapshot_revision: 3,
    snapshot_hash: hash("a"),
  },
  compiler_bundle_ref: { compiler_version: "1.0.0", compiler_bundle_hash: hash("b") },
  candidate_release: candidate,
  projection_refs: projectionRefs,
  status: "SMOKE_PASSED",
} as const;

const acceptanceContracts = {
  oracle: hash("1"),
  qualification: hash("2"),
  campaign: hash("3"),
  qa_e2e: hash("4"),
  trace_ui: hash("5"),
  reclamation: hash("6"),
} as const;

const supportingComponents = [
  "DATASET",
  "LLM_CONFIGURATION",
  "AGENT_PROFILES",
  "OPERATOR_REGISTRY",
  "SANDBOX_RUNTIME",
] as const;

async function proof(stageValue: Awaited<ReturnType<typeof buildSemanticSuccessorStage>>) {
  return buildFalcon24SemanticReleaseAuthorityProofV2({
    schema_version: "falcon24-semantic-release-authority-proof@2.0.0",
    authority_epoch: "E4",
    predecessor_release: { ...predecessor, datasource_id: candidate.datasource_id },
    candidate_release: candidate,
    projections: projectionRefs,
    change_set_ref: stageValue.change_set_ref,
    review_ref: stageValue.review_ref,
    source_snapshot_ref: stageValue.source_snapshot_ref,
    compiler_bundle_ref: stageValue.compiler_bundle_ref,
    validation_receipt_ref: {
      schema_version: "semantic-runtime-closure-validation-receipt@1.0.0",
      receipt_id: id(14),
      validation_receipt_hash: hash("c"),
    },
    smoke_receipt_ref: {
      schema_version: "semantic-runtime-smoke-receipt@1.0.0",
      receipt_id: id(15),
      smoke_receipt_hash: hash("e"),
    },
    expected_versions: {
      semantic_pointer: stageValue.expected_pointer_version,
      semantic_runtime: 9,
      workspace_defaults: 11,
    },
  });
}

async function supportingReceipts(stagingId = id(16)) {
  return Promise.all(
    supportingComponents.map((component, index) =>
      buildFalcon24StagingReceiptV2({
        schema_version: "falcon24-staging-receipt@2.0.0",
        authority_epoch: "E4",
        staging_id: stagingId,
        component,
        subject_hash: hash(String((index + 3) % 10)),
        evidence_hash: hash(String((index + 4) % 10)),
        production_isolation_proven: false,
      }),
    ),
  );
}

function successfulEpoch(calls: string[]) {
  return {
    beginStaging: vi.fn(async (_capability: unknown, request: Record<string, unknown>) => {
      calls.push("begin-staging");
      return { ok: true as const, value: { ...request, status: "STAGED" } };
    }),
    holdStagingSession: vi.fn(async (_capability: unknown, request: Record<string, unknown>) => {
      calls.push("hold-staging");
      return {
        ok: true as const,
        value: {
          schema_version: "falcon24-staging-hold@2.0.0",
          authority_epoch: request.authority_epoch,
          staging_id: request.staging_id,
          retained_assets_hash: request.expected_retained_assets_hash,
          status: "HOLD",
          failure_code: request.failure_code,
        },
      };
    }),
    recordReceipt: vi.fn(
      async (_capability: unknown, receipt: unknown): Promise<{ ok: true; value: unknown }> => {
        calls.push("semantic-receipt");
        return { ok: true as const, value: receipt };
      },
    ),
    stageBaseline: vi.fn(async (_capability: unknown, request: { baseline: unknown }) => {
      calls.push("baseline");
      return { ok: true as const, value: request.baseline };
    }),
    beginActivationAttempt: vi.fn(
      async (
        _capability: unknown,
        request: Record<string, unknown>,
      ): Promise<{ ok: true; value: unknown }> => {
        calls.push("activation-attempt");
        return {
          ok: true as const,
          value: {
            schema_version: "falcon24-activation-attempt@2.0.0",
            authority_epoch: request.authority_epoch,
            attempt_id: request.attempt_id,
            baseline_id: request.baseline_id,
            expected_baseline_hash: request.expected_baseline_hash,
            status: "OPEN",
            failure_code: null,
          },
        };
      },
    ),
  };
}

async function arranged() {
  const calls: string[] = [];
  const epoch = successfulEpoch(calls);
  const receipts = await supportingReceipts();
  const stage = await buildSemanticSuccessorStage(stageMaterial);
  const semanticProof = await proof(stage);
  const stageSupportingReceipts = vi.fn(async () => {
    calls.push("supporting-receipts");
    return receipts;
  });
  return { calls, epoch, receipts, semanticProof, stage, stageSupportingReceipts };
}

function input(
  arrangedValue: Awaited<ReturnType<typeof arranged>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    capability: { role: "owner" },
    epoch: arrangedValue.epoch,
    stage: arrangedValue.stage,
    semantic_proof: arrangedValue.semanticProof,
    staging_id: id(16),
    retained_assets_hash: hash("f"),
    source_commit: "a".repeat(40),
    web_build_hash: hash("a"),
    acceptance_contracts: acceptanceContracts,
    production_isolation_proven: false,
    production_gate: "HOLD" as const,
    stage_supporting_receipts: arrangedValue.stageSupportingReceipts,
    ...overrides,
  };
}

describe("Falcon24 E4 successor authority staging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stages supporting receipts, proof-v2 receipt, baseline and open attempt in order", async () => {
    const arrangedValue = await arranged();

    const result = await stageFalcon24E4SuccessorAuthority(input(arrangedValue));

    expect(arrangedValue.calls).toEqual([
      "begin-staging",
      "supporting-receipts",
      "semantic-receipt",
      "baseline",
      "activation-attempt",
    ]);
    const semanticReceipt = arrangedValue.epoch.recordReceipt.mock.calls[0]?.[1] as
      | Falcon24StagingReceiptV2
      | undefined;
    expect(semanticReceipt).toMatchObject({
      authority_epoch: "E4",
      staging_id: id(16),
      component: "SEMANTIC_RELEASE",
      subject_hash: candidate.release_digest,
      evidence_hash: arrangedValue.semanticProof.proof_hash,
      production_isolation_proven: false,
    });
    const baselineRequest = arrangedValue.epoch.stageBaseline.mock.calls[0]?.[1] as
      | { baseline: { staging_receipts: { semantic_release: string } } }
      | undefined;
    expect(baselineRequest?.baseline.staging_receipts.semantic_release).toBe(
      semanticReceipt?.receipt_hash,
    );
    expect(result).toEqual({
      baseline_ref: {
        baseline_id: expect.any(String),
        baseline_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
      activation_attempt_ref: { activation_attempt_id: expect.any(String) },
    });
  });

  it("is deterministic across a replay with the same frozen material", async () => {
    const first = await arranged();
    const second = await arranged();

    await expect(stageFalcon24E4SuccessorAuthority(input(first))).resolves.toEqual(
      await stageFalcon24E4SuccessorAuthority(input(second)),
    );
  });

  it("rejects a proof-stage mismatch before beginning the staging session", async () => {
    const arrangedValue = await arranged();
    const mismatchedProof = await buildFalcon24SemanticReleaseAuthorityProofV2({
      ...arrangedValue.semanticProof,
      candidate_release: {
        ...arrangedValue.semanticProof.candidate_release,
        release_id: id(99),
      },
    });

    await expect(
      stageFalcon24E4SuccessorAuthority(input(arrangedValue, { semantic_proof: mismatchedProof })),
    ).rejects.toThrow("FALCON24_E4_SUCCESSOR_STAGE_PROOF_MISMATCH");
    expect(arrangedValue.epoch.beginStaging).not.toHaveBeenCalled();
  });

  it("rejects an incomplete supporting receipt set before writing semantic evidence", async () => {
    const arrangedValue = await arranged();
    arrangedValue.stageSupportingReceipts.mockResolvedValue(arrangedValue.receipts.slice(1));

    await expect(stageFalcon24E4SuccessorAuthority(input(arrangedValue))).rejects.toThrow(
      "FALCON24_E4_SUPPORTING_RECEIPTS_INVALID",
    );
    expect(arrangedValue.epoch.recordReceipt).not.toHaveBeenCalled();
    expect(arrangedValue.epoch.stageBaseline).not.toHaveBeenCalled();
    expect(arrangedValue.epoch.holdStagingSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        schema_version: "falcon24-staging-hold-request@2.0.0",
        authority_epoch: "E4",
        staging_id: id(16),
        expected_retained_assets_hash: hash("f"),
        failure_code: "FALCON24_E4_SUPPORTING_RECEIPTS_INVALID",
      }),
    );
  });

  it("holds a pre-baseline session when supporting Team materialization fails", async () => {
    const arrangedValue = await arranged();
    arrangedValue.stageSupportingReceipts.mockRejectedValueOnce(
      new TypeError("BUILTIN_TEAM_SKILL_REVISION_CONFLICT"),
    );

    await expect(stageFalcon24E4SuccessorAuthority(input(arrangedValue))).rejects.toThrow(
      "BUILTIN_TEAM_SKILL_REVISION_CONFLICT",
    );
    expect(arrangedValue.calls).toEqual(["begin-staging", "hold-staging"]);
    expect(arrangedValue.epoch.stageBaseline).not.toHaveBeenCalled();
  });

  it("requires the sandbox receipt to prove the baseline isolation claim", async () => {
    const arrangedValue = await arranged();

    await expect(
      stageFalcon24E4SuccessorAuthority(
        input(arrangedValue, {
          production_isolation_proven: true,
          production_gate: "GO",
        }),
      ),
    ).rejects.toThrow("FALCON24_E4_SUPPORTING_RECEIPTS_INVALID");
    expect(arrangedValue.epoch.recordReceipt).not.toHaveBeenCalled();
  });

  it("fails closed when the authority returns a substituted semantic receipt", async () => {
    const arrangedValue = await arranged();
    arrangedValue.epoch.recordReceipt.mockImplementationOnce(
      async (_capability: unknown, candidateReceipt: unknown) => {
        const receipt = candidateReceipt as Falcon24StagingReceiptV2;
        const { receipt_hash: _receiptHash, ...material } = receipt;
        return {
          ok: true as const,
          value: await buildFalcon24StagingReceiptV2({
            ...material,
            evidence_hash: hash("0"),
          }),
        };
      },
    );

    await expect(stageFalcon24E4SuccessorAuthority(input(arrangedValue))).rejects.toThrow(
      "FALCON24_E4_SEMANTIC_RECEIPT_MISMATCH",
    );
    expect(arrangedValue.epoch.stageBaseline).not.toHaveBeenCalled();
  });

  it("fails closed when the activation attempt is not the exact open attempt", async () => {
    const arrangedValue = await arranged();
    arrangedValue.epoch.beginActivationAttempt.mockImplementationOnce(
      async (_capability: unknown, request: Record<string, unknown>) => ({
        ok: true as const,
        value: {
          schema_version: "falcon24-activation-attempt@2.0.0",
          authority_epoch: "E4",
          attempt_id: request.attempt_id,
          baseline_id: request.baseline_id,
          expected_baseline_hash: request.expected_baseline_hash,
          status: "HOLD",
          failure_code: "FALCON24_TEST_HOLD",
        },
      }),
    );

    await expect(stageFalcon24E4SuccessorAuthority(input(arrangedValue))).rejects.toThrow(
      "FALCON24_E4_ACTIVATION_ATTEMPT_MISMATCH",
    );
  });
});
