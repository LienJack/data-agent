import { createHash } from "node:crypto";
import {
  type ModelProviderExecutionBinding,
  PROVIDER_CONFORMANCE_CHECKS,
} from "@data-agent/agent-runtime";
import { canonicalizeJson } from "@data-agent/contracts/common";
import {
  falcon24AuthorityEpochOrdinal,
  falcon24AuthorityEpochSchema,
  type RunProjectionRecord,
  type RunWorkLease,
  type WorkerRunRuntimeEvent,
} from "@data-agent/contracts/runs";
import { loadRuntimeBuildIdentity } from "@data-agent/contracts/server";
import { adaptPgPool, createPostgresRepository } from "@data-agent/platform/persistence";
import { createPostgresRunEventStore, createPostgresRunQueue } from "@data-agent/platform/runs";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import { Pool } from "pg";
import { z } from "zod";
import { runCredentialedProviderCertification } from "../credentialed-provider-certification.js";
import { createPostgresFalcon24ModelCertificationStageStore } from "../postgres-model-certification-receipt-store.js";
import { loadSystemModelExecutionBindingRecords } from "../system-model-execution-bindings.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-00000000e124";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-00000000e125";
const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_E7_LLM_CERTIFICATION";
const WORKER_ID = "falcon24-e7-llm-certification";
const TOOL_NAME = "falcon24.llm-execution-certification@1.0.0";

const configurationSchema = z.strictObject({
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  tenant_id: z.uuid(),
  principal_id: z.uuid(),
  target_authority_epoch: falcon24AuthorityEpochSchema.refine(
    (value) => falcon24AuthorityEpochOrdinal(value) >= 7n,
  ),
  staging_id: z.uuid(),
  stage_id: z.uuid(),
});

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function hold(reasonCode: string, details: Readonly<Record<string, unknown>> = {}): void {
  report({
    schema_version: "falcon24-e7-llm-certification-report@1.0.0",
    terminal: "HOLD",
    reason_code: reasonCode,
    ...details,
  });
  process.exitCode = 2;
}

function requireValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function now(): string {
  return new Date().toISOString();
}

async function appendEvent(input: {
  readonly events: ReturnType<typeof createPostgresRunEventStore>;
  readonly lease: RunWorkLease;
  readonly projection: RunProjectionRecord;
  readonly event: WorkerEventMaterial;
}): Promise<RunProjectionRecord> {
  const appended = requireValue(
    await input.events.append({
      lease: input.lease,
      expected_projection: input.projection,
      event: {
        ...input.event,
        sequence: input.projection.projection.version + 1,
        worker_fence: input.lease.worker_fence,
      } as WorkerRunRuntimeEvent,
    }),
  );
  return { projection: appended.projection, projection_hash: appended.projection_hash };
}

type WorkerEventMaterial = WorkerRunRuntimeEvent extends infer Event
  ? Event extends WorkerRunRuntimeEvent
    ? Omit<Event, "sequence" | "worker_fence">
    : never
  : never;

function exactDeepSeekBinding(
  records: readonly Awaited<ReturnType<typeof loadSystemModelExecutionBindingRecords>>[number][],
): Readonly<{
  binding: ModelProviderExecutionBinding;
  model_resource_hash: `sha256:${string}`;
}> {
  const matching = records.filter(
    ({ binding }) =>
      binding.provider === "deepseek" && binding.default_model_id === "deepseek-v4-flash",
  );
  if (matching.length !== 1 || !matching[0])
    throw new Error("FALCON24_E7_DEEPSEEK_BINDING_INVALID");
  return matching[0];
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    hold("LOCAL_ONLY_COMMAND");
    return;
  }
  loadRuntimeEnvironment();

  // Credential 与全部静态配置必须在任何数据库连接/写入之前通过。
  if (
    process.env[CONFIRMATION_VARIABLE]?.trim() !== "YES" ||
    !process.env.DEEPSEEK_API_KEY?.trim()
  ) {
    hold("FALCON24_E7_LLM_CERTIFICATION_PREFLIGHT_INVALID", {
      confirmation_variable: CONFIRMATION_VARIABLE,
      database_writes: 0,
    });
    return;
  }
  const configuration = configurationSchema.safeParse({
    database_url: process.env.DATA_AGENT_DATABASE_URL ?? process.env.DATABASE_URL,
    deployment_id: process.env.DATA_AGENT_DEPLOYMENT_ID ?? DEFAULT_DEPLOYMENT_ID,
    tenant_id: process.env.FALCON24_WORKSPACE_ID ?? DEFAULT_TENANT_ID,
    principal_id: process.env.FALCON24_PRINCIPAL_ID ?? DEFAULT_PRINCIPAL_ID,
    target_authority_epoch: process.env.FALCON24_AUTHORITY_EPOCH,
    staging_id: process.env.FALCON24_STAGING_ID,
    stage_id: process.env.FALCON24_LLM_EXECUTION_STAGE_ID,
  });
  if (!configuration.success) {
    hold("FALCON24_E7_LLM_CERTIFICATION_CONFIGURATION_INVALID", { database_writes: 0 });
    return;
  }
  let workerBuild: ReturnType<typeof loadRuntimeBuildIdentity>;
  try {
    workerBuild = loadRuntimeBuildIdentity({ expectedRole: "worker", environment: process.env });
  } catch {
    hold("FALCON24_E7_WORKER_BUILD_IDENTITY_INVALID", { database_writes: 0 });
    return;
  }

  const identifiers = Object.freeze({
    run_id: stableUuid(
      `falcon24:${configuration.data.target_authority_epoch}:llm-run:${configuration.data.stage_id}`,
    ),
    command_id: stableUuid(
      `falcon24:${configuration.data.target_authority_epoch}:llm-command:${configuration.data.stage_id}`,
    ),
    event_id: stableUuid(
      `falcon24:${configuration.data.target_authority_epoch}:llm-accepted:${configuration.data.stage_id}`,
    ),
    outbox_id: stableUuid(
      `falcon24:${configuration.data.target_authority_epoch}:llm-outbox:${configuration.data.stage_id}`,
    ),
    audit_id: stableUuid(
      `falcon24:${configuration.data.target_authority_epoch}:llm-audit:${configuration.data.stage_id}`,
    ),
  });
  const pool = new Pool({
    connectionString: configuration.data.database_url,
    max: 2,
    application_name: "data-agent-falcon24-e7-llm-certification",
  });
  try {
    const current = await pool.query<{ authority_epoch: string }>(
      `select authority_epoch from app_data_agent.falcon24_current_authority_epoch
        where app_id=$1::uuid and tenant_id=$2::uuid and environment='local'`,
      [APP_ID, configuration.data.tenant_id],
    );
    const predecessor = current.rows[0]?.authority_epoch;
    if (
      !predecessor ||
      falcon24AuthorityEpochOrdinal(configuration.data.target_authority_epoch) !==
        falcon24AuthorityEpochOrdinal(predecessor) + 1n
    ) {
      throw new Error("FALCON24_E7_LLM_CERTIFICATION_NOT_SUCCESSOR");
    }
    const unrelated = await pool.query<{ pending: boolean }>(
      `select exists(select 1 from app_data_agent.outbox
        where app_id=$1::uuid and tenant_id=$2::uuid and environment='local'
          and status in('PENDING','FAILED','LEASED') and run_id<>$3::uuid) as pending`,
      [APP_ID, configuration.data.tenant_id, identifiers.run_id],
    );
    if (unrelated.rows[0]?.pending) throw new Error("FALCON24_E7_RUN_QUEUE_NOT_DRAINED");

    const sqlPool = adaptPgPool(pool);
    const capabilityAuthority = createPostgresCapabilityAuthority(sqlPool);
    const capability = requireValue(
      await capabilityAuthority.resolveForServerContext({
        deployment_id: configuration.data.deployment_id,
        tenant_id: configuration.data.tenant_id,
        principal_id: configuration.data.principal_id,
        access: "WRITE",
      }),
    );
    const bindingRecord = exactDeepSeekBinding(
      await loadSystemModelExecutionBindingRecords(pool, configuration.data.deployment_id),
    );
    const stageStore = createPostgresFalcon24ModelCertificationStageStore({
      pool: sqlPool,
      authorizer: capabilityAuthority.authorizer,
      capability,
      target_authority_epoch: configuration.data.target_authority_epoch,
      staging_id: configuration.data.staging_id,
      stage_id: configuration.data.stage_id,
      idempotency_key: `falcon24:${configuration.data.target_authority_epoch}:llm-stage:${configuration.data.stage_id}`,
      model_resource_hash: bindingRecord.model_resource_hash,
      worker_build: workerBuild,
    });

    const existingProof = await stageStore.loadStagedProof();
    if (existingProof.ok) {
      const existingRun = await pool.query<{ status: string }>(
        `select status from app_data_agent.runs
          where app_id=$1::uuid and tenant_id=$2::uuid and environment='local' and run_id=$3::uuid`,
        [APP_ID, configuration.data.tenant_id, identifiers.run_id],
      );
      if (existingRun.rows[0]?.status === "SUCCEEDED") {
        report({
          schema_version: "falcon24-e7-llm-certification-report@1.0.0",
          terminal: "PASS",
          replayed: true,
          run_id: identifiers.run_id,
          stage_id: configuration.data.stage_id,
          proof_hash: existingProof.value.proof_hash,
          certification_receipt_ref: existingProof.value.certification_receipt_ref,
        });
        return;
      }
    }

    const repository = createPostgresRepository(sqlPool, capabilityAuthority.authorizer);
    requireValue(
      await repository.acceptCommand(capability, {
        ...identifiers,
        idempotency_key: `falcon24:${configuration.data.target_authority_epoch}:llm-run:${configuration.data.stage_id}`,
        question: "Falcon24 E7 DeepSeek execution profile credential certification",
        payload: { kind: "START_L2_RESEARCH", mode: "L2" },
      }),
    );
    const queue = createPostgresRunQueue(sqlPool, capabilityAuthority.authorizer, capability, {
      lease_duration_ms: 900_000,
    });
    const events = createPostgresRunEventStore(sqlPool, capabilityAuthority.authorizer, capability);
    const lease = requireValue(
      await queue.lease({ scope: capability.scope, worker_id: WORKER_ID }),
    );
    if (!lease || lease.run_id !== identifiers.run_id)
      throw new Error("FALCON24_E7_RUN_LEASE_MISMATCH");
    let projection = requireValue(
      await events.readProjection({ scope: capability.scope, run_id: identifiers.run_id }),
    );
    if (!projection) throw new Error("FALCON24_E7_RUN_PROJECTION_MISSING");
    projection = await appendEvent({
      events,
      lease,
      projection,
      event: {
        schema_version: "1.0.0",
        event_id: stableUuid(`${configuration.data.stage_id}:run-leased`),
        scope: capability.scope,
        run_id: identifiers.run_id,
        idempotency_key: `falcon24:${configuration.data.stage_id}:run-leased`,
        occurred_at: now(),
        event_type: "run.leased",
        payload: {
          command_id: lease.command_id,
          lease_id: lease.attempt_id,
          worker_id: lease.worker_id,
          attempt: lease.attempt_no,
        },
      },
    });
    const callId = `falcon24-${configuration.data.target_authority_epoch.toLowerCase()}-deepseek-certification`;
    const startedAt = Date.now();
    projection = await appendEvent({
      events,
      lease,
      projection,
      event: {
        schema_version: "1.0.0",
        event_id: stableUuid(`${configuration.data.stage_id}:tool-started`),
        scope: capability.scope,
        run_id: identifiers.run_id,
        idempotency_key: `falcon24:${configuration.data.stage_id}:tool-started`,
        occurred_at: now(),
        event_type: "run.tool_started",
        payload: {
          call_id: callId,
          tool_name: TOOL_NAME,
          title: "Certify exact DeepSeek execution profile",
          summary: "Running one credentialed live provider smoke against the staged E7 profile.",
          input: null,
        },
      },
    });

    const certification = await runCredentialedProviderCertification({
      scope: capability.scope,
      run_id: identifiers.run_id,
      worker_fence: lease.worker_fence,
      bindings: [bindingRecord.binding],
      resolve_credential: async (credentialEnvironment) =>
        process.env[credentialEnvironment]?.trim() ?? null,
      receipt_store: stageStore,
    });
    const certified = certification.providers.find(
      ({ provider, model_id }) => provider === "deepseek" && model_id === "deepseek-v4-flash",
    );
    if (certified?.certification_status !== "AVAILABLE" || !certified.receipt_ref) {
      // Expose only the fixed conformance vocabulary, never provider detail or credentials.
      const failedChecks = PROVIDER_CONFORMANCE_CHECKS.filter((check) =>
        certified?.failed_checks?.includes(check),
      );
      projection = await appendEvent({
        events,
        lease,
        projection,
        event: {
          schema_version: "1.0.0",
          event_id: stableUuid(`${configuration.data.stage_id}:tool-failed`),
          scope: capability.scope,
          run_id: identifiers.run_id,
          idempotency_key: `falcon24:${configuration.data.stage_id}:tool-failed`,
          occurred_at: now(),
          event_type: "run.tool_failed",
          payload: {
            call_id: callId,
            tool_name: TOOL_NAME,
            summary:
              failedChecks.length > 0
                ? `DeepSeek credential certification failed closed: ${failedChecks.join(", ")}.`
                : "DeepSeek credential certification failed closed.",
            error_code: certified?.reason_code ?? "FALCON24_E7_LLM_CERTIFICATION_FAILED",
            output: null,
            duration_ms: Math.max(0, Date.now() - startedAt),
          },
        },
      });
      projection = await appendEvent({
        events,
        lease,
        projection,
        event: {
          schema_version: "1.0.0",
          event_id: stableUuid(`${configuration.data.stage_id}:run-failed`),
          scope: capability.scope,
          run_id: identifiers.run_id,
          idempotency_key: `falcon24:${configuration.data.stage_id}:run-failed`,
          occurred_at: now(),
          event_type: "run.failed",
          payload: {
            error_code: "FALCON24_E7_LLM_CERTIFICATION_FAILED",
            retryable: false,
          },
        },
      });
      requireValue(
        await queue.complete({ lease, final_event_sequence: projection.projection.version }),
      );
      hold("FALCON24_E7_LLM_CERTIFICATION_FAILED", {
        run_id: identifiers.run_id,
        provider_reason_code: certified?.reason_code ?? null,
        failed_checks: failedChecks,
      });
      return;
    }
    const proof = requireValue(await stageStore.loadStagedProof());
    projection = await appendEvent({
      events,
      lease,
      projection,
      event: {
        schema_version: "1.0.0",
        event_id: stableUuid(`${configuration.data.stage_id}:tool-completed`),
        scope: capability.scope,
        run_id: identifiers.run_id,
        idempotency_key: `falcon24:${configuration.data.stage_id}:tool-completed`,
        occurred_at: now(),
        event_type: "run.tool_completed",
        payload: {
          call_id: callId,
          tool_name: TOOL_NAME,
          summary:
            "Exact DeepSeek profile passed live credential certification and was staged invisibly.",
          output: canonicalizeJson({
            stage_id: configuration.data.stage_id,
            proof_hash: proof.proof_hash,
          }),
          duration_ms: Math.max(0, Date.now() - startedAt),
        },
      },
    });
    projection = await appendEvent({
      events,
      lease,
      projection,
      event: {
        schema_version: "1.0.0",
        event_id: stableUuid(`${configuration.data.stage_id}:run-completed`),
        scope: capability.scope,
        run_id: identifiers.run_id,
        idempotency_key: `falcon24:${configuration.data.stage_id}:run-completed`,
        occurred_at: now(),
        event_type: "run.completed",
        payload: { completion_kind: "WORKFLOW_EXECUTION_ONLY" },
      },
    });
    requireValue(
      await queue.complete({ lease, final_event_sequence: projection.projection.version }),
    );
    report({
      schema_version: "falcon24-e7-llm-certification-report@1.0.0",
      terminal: "PASS",
      replayed: false,
      run_id: identifiers.run_id,
      stage_id: configuration.data.stage_id,
      proof_hash: proof.proof_hash,
      certification_receipt_ref: proof.certification_receipt_ref,
      worker_build: { build_id: workerBuild.build_id, generation_id: workerBuild.generation_id },
    });
  } catch (error) {
    hold(
      error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.message)
        ? error.message
        : "FALCON24_E7_LLM_CERTIFICATION_EXECUTION_FAILED",
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await main();
