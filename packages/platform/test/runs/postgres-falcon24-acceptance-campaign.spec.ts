import {
  buildFalcon24AcceptanceRunManifest,
  buildFalcon24SandboxReclamationReceipt,
  falcon24AnalysisCaseIdSchema,
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresFalcon24AcceptanceCampaignAuthority } from "../../src/runs/postgres-falcon24-acceptance-campaign.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const now = "2026-08-25T08:00:00.000Z";
const ids = {
  app: id(1),
  tenant: id(2),
  analyst: id(3),
  deployment: id(4),
  run: id(5),
};

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

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    principal_id: ids.analyst,
    campaign_id: "falcon24-root-v13-final",
    campaign_version: 13,
    source_fingerprint: hash("a"),
    frozen_contract_hash: hash("b"),
    runtime_attestation_hash: hash("e"),
    manifest_hash: hash("c"),
    policy_id: "falcon24-strict-zero-retry@1.0.0",
    run_count: 30,
    next_run_ordinal: 0,
    status: "READY",
    first_failure_run_id: null,
    first_failure_layer: null,
    first_failure_code: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    principal_id: ids.analyst,
    campaign_id: "falcon24-root-v13-final",
    run_ordinal: 0,
    run_id: ids.run,
    case_id: "falcon24-q1",
    run_variant: "COLD",
    repetition: 1,
    status: "CLAIMED",
    trace_closure_hash: null,
    result_hash: null,
    result_document: null,
    sandbox_reclamation_hash: null,
    sandbox_reclamation_receipt: null,
    claimed_at: now,
    completed_at: null,
    ...overrides,
  };
}

function reference(
  artifactType:
    | "AnalysisProgram"
    | "SensitiveExecutionArtifact"
    | "SandboxExecutionReceipt"
    | "ArtifactWorkspaceDocument",
  suffix: number,
) {
  return {
    artifact_id: id(suffix),
    artifact_type: artifactType,
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    run_id: ids.run,
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  } as const;
}

async function falconResult() {
  const operatorReceipt = {
    schema_version: "statistical-operator-call-receipt@1.0.0" as const,
    call_id: "q4_marketing_priority",
    operator_id: "descriptive.marketing-lag-priority@1" as const,
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    implementation_digest: hash("f"),
    resolved_parameters: {},
    resolved_parameters_hash: hash("1"),
    input_hash: hash("2"),
    output_hash: hash("3"),
    result_binding_hash: hash("4"),
    sample_size: 1,
    group_count: 1,
    family_size: null,
    rank: null,
    applicability: "PASS" as const,
    limitation_codes: [],
  };
  const oracleMaterial = {
    schema_version: "falcon24-analysis-oracle@4.0.0" as const,
    oracle_kind: "ARROW_INPUT_RECOMPUTE" as const,
    case_id: "falcon24-marketing-lag-effect" as const,
    verdict: "PASS" as const,
    input_hash: hash("5"),
    input_materialization_receipt_hash: hash("6"),
    query_evidence_hash: hash("7"),
    output_hash: hash("8"),
    chart_dataset_hash: hash("9"),
    verification_hash: hash("a"),
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    operator_receipt_closure_hash: hash("b"),
    operator_receipts: [operatorReceipt],
    method_receipts: [
      {
        method_id: "distributed-lag-0-4",
        status: "PASS" as const,
        evidence_hash: hash("c"),
        operator_call_ids: [operatorReceipt.call_id],
      },
    ],
    disclosures: ["STATISTICAL_ASSOCIATION_NOT_CAUSATION"],
    quality_findings: [],
    terminal: "PASS" as const,
  };
  const oracleReceipt = {
    ...oracleMaterial,
    receipt_hash: await sha256ContentHash(oracleMaterial),
  };
  return {
    schema_version: "falcon24-agent-analysis-run@4.0.0" as const,
    case_id: "falcon24-marketing-lag-effect" as const,
    run_id: ids.run,
    run_variant: "COLD" as const,
    repetition: 1,
    provider: "deepseek" as const,
    model_id: "deepseek-v4-flash" as const,
    model_override_attempted: false as const,
    provider_invocation_refs: [
      { resource_id: id(20), resource_revision: 1, resource_hash: hash("d") },
    ],
    semantic_context_ref: {
      package_id: id(21),
      package_revision: 1 as const,
      package_hash: hash("e"),
    },
    analysis_program_ref: reference("AnalysisProgram", 22),
    generated_python_refs: [reference("SensitiveExecutionArtifact", 23)],
    sandbox_receipt_refs: [reference("SandboxExecutionReceipt", 24)],
    model_generated_node_count: 1,
    oracle_receipt: oracleReceipt,
    sandbox_status: "SUCCEEDED" as const,
    answer_hash: oracleReceipt.output_hash,
    chart_ref: reference("ArtifactWorkspaceDocument", 25),
    chart_dataset_hash: oracleReceipt.chart_dataset_hash,
    completed_at: now,
  };
}

async function reclamationReceipt() {
  const managementObservationMaterial = {
    management_observation_schema_version:
      "opensandbox-management-reclamation-observation@1.0.0" as const,
    management_operation_id: id(6),
    observation_source: "OPENSANDBOX_MANAGEMENT_API" as const,
    target_metadata_hash: hash("f"),
    before_observation: { active_count: 2, observation_hash: hash("a") },
    killed: 2,
    after_observation: { active_count: 0 as const, observation_hash: hash("b") },
    residual: 0 as const,
    completed_at: now,
  };
  return buildFalcon24SandboxReclamationReceipt({
    schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0" as const,
    campaign_id: "falcon24-root-v13-final",
    run_id: ids.run,
    runtime_attestation_hash: hash("e"),
    ...managementObservationMaterial,
    management_observation_hash: await sha256ContentHash(managementObservationMaterial),
  });
}

async function manifest() {
  return buildFalcon24AcceptanceRunManifest({
    schema_version: "falcon24-analysis-run-manifest@2.0.0",
    campaign_id: "falcon24-root-v13-final",
    campaign_version: 13,
    source_fingerprint: hash("a"),
    frozen_contract_hash: hash("b"),
    runtime_attestation_hash: hash("e"),
    runs: falcon24AnalysisCaseIdSchema.options.flatMap((caseId, caseIndex) =>
      (["COLD", "WARM"] as const).flatMap((runVariant, variantIndex) =>
        [1, 2, 3].map((repetition) => ({
          run_id: id(100 + caseIndex * 10 + variantIndex * 3 + repetition),
          case_id: caseId,
          run_variant: runVariant,
          repetition,
        })),
      ),
    ),
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

describe("PostgreSQL Falcon24 acceptance campaign authority", () => {
  it("begins a frozen 30-run zero-retry campaign with a canonical command hash", async () => {
    const auth = authority();
    const frozenManifest = await manifest();
    const scripted = scriptedPool((text) =>
      text.includes("begin_falcon24_acceptance_campaign")
        ? campaign({ manifest_hash: frozenManifest.manifest_hash })
        : undefined,
    );
    const port = createPostgresFalcon24AcceptanceCampaignAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(port.begin(auth.capability, frozenManifest)).resolves.toMatchObject({
      ok: true,
      value: { status: "READY", run_count: 30 },
    });

    const rpc = scripted.calls.find(({ text }) =>
      text.includes("begin_falcon24_acceptance_campaign"),
    );
    expect(rpc?.values?.[0]).toMatchObject({
      schema_version: "falcon24-acceptance-campaign-begin@1.0.0",
      policy_id: "falcon24-strict-zero-retry@1.0.0",
      manifest: expect.objectContaining({
        schema_version: "falcon24-analysis-run-manifest@2.0.0",
        campaign_id: "falcon24-root-v13-final",
        runs: expect.arrayContaining([expect.objectContaining({ case_id: expect.any(String) })]),
      }),
      command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it("claims only the exact requested ordinal and run identity", async () => {
    const auth = authority();
    const scripted = scriptedPool((text) =>
      text.includes("claim_falcon24_acceptance_run") ? run() : undefined,
    );
    const port = createPostgresFalcon24AcceptanceCampaignAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      port.claim(auth.capability, {
        campaign_id: "falcon24-root-v13-final",
        run_ordinal: 0,
        run_id: ids.run,
        case_id: "falcon24-q1",
        run_variant: "COLD",
        repetition: 1,
      }),
    ).resolves.toMatchObject({ ok: true, value: { status: "CLAIMED", run_id: ids.run } });
  });

  it("freezes the first classified failure and rejects a substituted receipt", async () => {
    const auth = authority();
    const scripted = scriptedPool((text) =>
      text.includes("hold_falcon24_acceptance_campaign")
        ? campaign({
            status: "HOLD",
            first_failure_run_id: ids.run,
            first_failure_layer: "ORACLE",
            first_failure_code: "FALCON24_ORACLE_FAILED",
          })
        : undefined,
    );
    const port = createPostgresFalcon24AcceptanceCampaignAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      port.hold(auth.capability, {
        campaign_id: "falcon24-root-v13-final",
        run_id: ids.run,
        failure_layer: "PUBLISHER",
        failure_code: "FALCON24_PUBLISHER_FAILED",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID", retryable: false },
    });
  });

  it("durably stages the exact result while the run remains claimed", async () => {
    const auth = authority();
    const resultDocument = await falconResult();
    const resultHash = await sha256ContentHash(resultDocument);
    const scripted = scriptedPool((text) =>
      text.includes("stage_falcon24_acceptance_result")
        ? run({ result_hash: resultHash, result_document: resultDocument })
        : undefined,
    );
    const port = createPostgresFalcon24AcceptanceCampaignAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      port.stage(auth.capability, {
        campaign_id: "falcon24-root-v13-final",
        run_id: ids.run,
        result_document: resultDocument,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: "CLAIMED", result_hash: resultHash, result_document: resultDocument },
    });
  });

  it("records and reloads the exact management-plane reclamation receipt", async () => {
    const auth = authority();
    const receipt = await reclamationReceipt();
    const scripted = scriptedPool((text) =>
      text.includes("record_falcon24_sandbox_reclamation")
        ? run({
            sandbox_reclamation_hash: receipt.receipt_hash,
            sandbox_reclamation_receipt: receipt,
          })
        : text.includes("load_falcon24_sandbox_reclamation")
          ? receipt
          : undefined,
    );
    const port = createPostgresFalcon24AcceptanceCampaignAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      port.recordSandboxReclamation(auth.capability, {
        campaign_id: "falcon24-root-v13-final",
        run_id: ids.run,
        receipt,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { sandbox_reclamation_hash: receipt.receipt_hash },
    });
    await expect(
      port.loadSandboxReclamation(auth.capability, {
        campaign_id: "falcon24-root-v13-final",
        run_id: ids.run,
      }),
    ).resolves.toEqual({ ok: true, value: receipt });
  });

  it("completes only after trace/result hashes and a DB-recorded reclamation hash are supplied", async () => {
    const auth = authority();
    const scripted = scriptedPool((text) =>
      text.includes("complete_falcon24_acceptance_run")
        ? campaign({ next_run_ordinal: 1, status: "READY" })
        : undefined,
    );
    const port = createPostgresFalcon24AcceptanceCampaignAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      port.complete(auth.capability, {
        campaign_id: "falcon24-root-v13-final",
        run_id: ids.run,
        trace_closure_hash: hash("d"),
        result_document: await falconResult(),
        sandbox_reclamation_hash: (await reclamationReceipt()).receipt_hash,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: "READY", next_run_ordinal: 1 },
    });
    const rpc = scripted.calls.find(({ text }) =>
      text.includes("complete_falcon24_acceptance_run"),
    );
    expect(rpc?.values?.[0]).toMatchObject({
      expected_result_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      sandbox_reclamation_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(rpc?.values?.[0]).not.toHaveProperty("result_document");
    expect(rpc?.values?.[0]).not.toHaveProperty("sandbox_reclamation_receipt");
  });

  it("maps a stable HOLD database error without making it retryable", async () => {
    const auth = authority();
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>(text: string) {
        if (text.includes("backend_context_matches")) {
          return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
        }
        if (text.includes("claim_falcon24_acceptance_run")) {
          throw Object.assign(new Error("FALCON24_CAMPAIGN_HOLD"), { code: "55000" });
        }
        return { rows: [], rowCount: 0 } as unknown as SqlQueryResult<Row>;
      },
      release() {},
    };
    const port = createPostgresFalcon24AcceptanceCampaignAuthority({
      pool: { connect: async () => client },
      authorizer: auth.authorizer,
    });

    await expect(
      port.claim(auth.capability, {
        campaign_id: "falcon24-root-v13-final",
        run_ordinal: 0,
        run_id: ids.run,
        case_id: "falcon24-q1",
        run_variant: "COLD",
        repetition: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "FALCON24_CAMPAIGN_HOLD", retryable: false },
    });
  });
});
