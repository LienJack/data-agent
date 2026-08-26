import {
  buildFalcon24QualificationManifest,
  FALCON24_QUALIFICATION_EXPECTED_PATH,
  falcon24AnalysisCaseIdSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresFalcon24QualificationAuthority } from "../../src/runs/postgres-falcon24-qualification.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const now = "2026-08-26T08:00:00.000Z";
const ids = { app: id(1), tenant: id(2), analyst: id(3), deployment: id(4), run: id(5) };
const qualificationId = "falcon24-root-qualification-v1-final";

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

function qualification(overrides: Record<string, unknown> = {}) {
  return {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    principal_id: ids.analyst,
    qualification_id: qualificationId,
    qualification_version: 1,
    source_commit: "a".repeat(40),
    source_fingerprint: hash("1"),
    frozen_contract_hash: hash("2"),
    semantic_release_hash: hash("3"),
    schema_snapshot_hash: hash("4"),
    operator_registry_digest: hash("5"),
    model_provider: "deepseek",
    model_id: "deepseek-v4-flash",
    model_config_hash: hash("6"),
    web_build_hash: hash("7"),
    runtime_attestation_hash: hash("8"),
    manifest_hash: hash("9"),
    slot_count: 16,
    next_slot_ordinal: 0,
    status: "READY",
    first_failure_run_id: null,
    first_failure_layer: null,
    first_failure_code: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function slot(overrides: Record<string, unknown> = {}) {
  return {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    principal_id: ids.analyst,
    qualification_id: qualificationId,
    ordinal: 0,
    slot_id: "G1-01",
    stage: "G1",
    run_id: ids.run,
    case_id: falcon24AnalysisCaseIdSchema.options[0],
    prompt: "trend prompt",
    prompt_hash: hash("a"),
    run_variant: "WARM",
    expected_path: [...FALCON24_QUALIFICATION_EXPECTED_PATH],
    status: "PLANNED",
    claim_fence_hash: null,
    claim_fence_consumed_at: null,
    trace_closure_hash: null,
    trace_gate_receipt_hash: null,
    trace_gate_receipt: null,
    ui_trace_gate_receipt_hash: null,
    ui_trace_gate_receipt: null,
    result_hash: null,
    result_document: null,
    sandbox_reclamation_claim_hash: null,
    sandbox_reclamation_claim_consumed_at: null,
    sandbox_reclamation_hash: null,
    sandbox_reclamation_receipt: null,
    forced_cleanup_claim_hash: null,
    forced_cleanup_claimed_at: null,
    forced_cleanup_resolved_at: null,
    forced_cleanup_receipt_hash: null,
    forced_cleanup_receipt: null,
    secondary_failure_layer: null,
    secondary_failure_code: null,
    claimed_at: null,
    completed_at: null,
    ...overrides,
  };
}

async function manifest() {
  const stages = [
    "G1",
    ...Array(5).fill("G2"),
    ...Array(5).fill("G3"),
    ...Array(5).fill("G4"),
  ] as const;
  const slots = await Promise.all(
    stages.map(async (stage, ordinal) => {
      const start = stage === "G1" ? 0 : stage === "G2" ? 1 : stage === "G3" ? 6 : 11;
      const position = ordinal - start;
      const prompt = `${stage} prompt ${position}`;
      return {
        ordinal,
        run_id: id(100 + ordinal),
        slot_id: `${stage}-${String(position + 1).padStart(2, "0")}`,
        stage,
        case_id: falcon24AnalysisCaseIdSchema.options[stage === "G1" ? 0 : position],
        prompt,
        prompt_hash: await sha256ContentHash(prompt),
        run_variant: stage === "G4" ? ("COLD" as const) : ("WARM" as const),
        expected_path: [...FALCON24_QUALIFICATION_EXPECTED_PATH],
      };
    }),
  );
  return buildFalcon24QualificationManifest({
    schema_version: "falcon24-qualification-manifest@1.0.0",
    qualification_id: qualificationId,
    qualification_version: 1,
    source_commit: "a".repeat(40),
    source_fingerprint: hash("1"),
    frozen_contract_hash: hash("2"),
    semantic_release_hash: hash("3"),
    schema_snapshot_hash: hash("4"),
    operator_registry_digest: hash("5"),
    model_provider: "deepseek",
    model_id: "deepseek-v4-flash",
    model_config_hash: hash("6"),
    web_build_hash: hash("7"),
    runtime_attestation_hash: hash("8"),
    slots,
  });
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

describe("PostgreSQL Falcon24 qualification authority", () => {
  it("begins one exact 16-slot Qualification manifest", async () => {
    const auth = authority();
    const candidate = await manifest();
    const scripted = scriptedPool((text) =>
      text.includes("begin_falcon24_qualification")
        ? qualification({ manifest_hash: candidate.manifest_hash })
        : undefined,
    );
    const result = await createPostgresFalcon24QualificationAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).begin(auth.capability, candidate);

    expect(result).toMatchObject({ ok: true, value: { qualification_id: qualificationId } });
    expect(
      scripted.calls.find(({ text }) => text.includes("begin_falcon24_qualification"))?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-qualification-begin@1.0.0",
        manifest: candidate,
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("claims only the exact next slot with a hashed one-shot submit fence", async () => {
    const auth = authority();
    const token = id(20);
    const fenceHash = await sha256ContentHash({ claim_fence_token: token });
    const scripted = scriptedPool((text) =>
      text.includes("claim_falcon24_qualification_slot")
        ? slot({ status: "CLAIMED", claim_fence_hash: fenceHash, claimed_at: now })
        : undefined,
    );
    const result = await createPostgresFalcon24QualificationAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).claim(auth.capability, {
      qualification_id: qualificationId,
      ordinal: 0,
      slot_id: "G1-01",
      stage: "G1",
      run_id: ids.run,
      case_id: falcon24AnalysisCaseIdSchema.options[0],
      run_variant: "WARM",
      claim_fence_token: token,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { status: "CLAIMED", claim_fence_hash: fenceHash },
    });
  });

  it("loads the exact failed qualification run that still needs HOLD reconciliation", async () => {
    const auth = authority();
    const scripted = scriptedPool((text) =>
      text.includes("load_falcon24_qualification_pending_failed_run")
        ? { qualification_id: qualificationId, run_id: ids.run }
        : undefined,
    );
    const result = await createPostgresFalcon24QualificationAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).loadPendingFailedRun(auth.capability);

    expect(result).toEqual({
      ok: true,
      value: { qualification_id: qualificationId, run_id: ids.run },
    });
  });

  it("rejects an ambiguous forced cleanup outcome before touching PostgreSQL", async () => {
    const auth = authority();
    const scripted = scriptedPool(() => undefined);
    const port = createPostgresFalcon24QualificationAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      port.resolveForcedCleanup(auth.capability, {
        qualification_id: qualificationId,
        run_id: ids.run,
        forced_cleanup_token: id(21),
        receipt: null,
        secondary_failure_code: null,
      }),
    ).rejects.toThrow("FALCON24_QUALIFICATION_FORCED_CLEANUP_OUTCOME_INVALID");
    expect(scripted.calls).toHaveLength(0);
  });
});
