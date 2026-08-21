import {
  buildJobSubmissionCommand,
  buildJobSubmissionReceipt,
  buildJobWorkLease,
  jobInputSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPostgresJobQueue } from "../../src/jobs/postgres-job-queue.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  tenant: "00000000-0000-4000-8000-000000000011",
  principal: "00000000-0000-4000-8000-000000000101",
  deployment: "00000000-0000-4000-8000-0000000000d1",
  job: "00000000-0000-4000-8000-000000000201",
  attempt: "00000000-0000-4000-8000-000000000301",
} as const;
const scope = { app_id: ids.app, tenant_id: ids.tenant, environment: "test" } as const;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const capability = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function poolWith(responses: Map<string, unknown>) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      for (const [marker, value] of responses) {
        if (text.includes(marker))
          return { rows: [{ value }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

function poolThrowing(message: string) {
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string) {
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      if (text.includes("enqueue_job")) throw new Error(message);
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { connect: async () => client } satisfies SqlPool;
}

describe("PostgreSQL Job Queue", () => {
  it("verifies DB-owned submission and exact fenced lease receipts", async () => {
    const input = jobInputSchema.parse({
      schema_version: "job-input@1.0.0",
      kind: "ARTIFACT_EXPORT",
      resource_refs: [],
      parameters: { format: "CSV" },
    });
    const command = await buildJobSubmissionCommand({
      schema_version: "job-submit@1.0.0",
      scope,
      kind: "ARTIFACT_EXPORT",
      idempotency_key: "artifact-export-test-1",
      input,
      priority: 50,
      max_attempts: 3,
      cancel_policy: "COOPERATIVE",
    });
    const receipt = await buildJobSubmissionReceipt({
      schema_version: "job-submission-receipt@1.0.0",
      disposition: "CREATED",
      scope,
      principal_id: ids.principal,
      job_id: ids.job,
      kind: "ARTIFACT_EXPORT",
      request_hash: command.request_hash,
      status: "QUEUED",
      accepted_at: "2026-08-17T12:00:00.000Z",
    });
    const lease = await buildJobWorkLease({
      schema_version: "job-work-lease@1.0.0",
      scope,
      principal_id: ids.principal,
      job_id: ids.job,
      kind: "ARTIFACT_EXPORT",
      request_hash: command.request_hash,
      input,
      attempt_id: ids.attempt,
      attempt_no: 1,
      delivery_attempt_no: 1,
      worker_id: "job-worker-a",
      lease_token: 1,
      worker_fence: 1,
      lease_duration_ms: 30_000,
      expires_at: "2026-08-17T12:00:30.000Z",
      handler_revision: "artifact-export-handler@1.0.0",
    });
    const scripted = poolWith(
      new Map<string, unknown>([
        ["enqueue_job", receipt],
        ["claim_job_work", lease],
      ]),
    );
    const auth = authority();
    const queue = createPostgresJobQueue(scripted.pool, auth.authorizer, auth.capability, {
      lease_duration_ms: 30_000,
    });

    await expect(queue.enqueue(command)).resolves.toEqual({ ok: true, value: receipt });
    await expect(
      queue.claim({
        scope,
        worker_id: "job-worker-a",
        handlers: [{ kind: "ARTIFACT_EXPORT", handler_revision: "artifact-export-handler@1.0.0" }],
      }),
    ).resolves.toEqual({ ok: true, value: lease });
    expect(scripted.calls.find(({ text }) => text.includes("claim_job_work"))?.values).toEqual([
      "job-worker-a",
      JSON.stringify([
        { kind: "ARTIFACT_EXPORT", handler_revision: "artifact-export-handler@1.0.0" },
      ]),
      30_000,
    ]);
  });

  it("rejects a stale DB receipt hash", async () => {
    const input = jobInputSchema.parse({
      schema_version: "job-input@1.0.0",
      kind: "ARTIFACT_EXPORT",
      resource_refs: [],
      parameters: {},
    });
    const command = await buildJobSubmissionCommand({
      schema_version: "job-submit@1.0.0",
      scope,
      kind: "ARTIFACT_EXPORT",
      idempotency_key: "artifact-export-test-2",
      input,
      priority: 50,
      max_attempts: 3,
      cancel_policy: "COOPERATIVE",
    });
    const scripted = poolWith(
      new Map<string, unknown>([
        [
          "enqueue_job",
          {
            schema_version: "job-submission-receipt@1.0.0",
            disposition: "CREATED",
            scope,
            principal_id: ids.principal,
            job_id: ids.job,
            kind: "ARTIFACT_EXPORT",
            request_hash: command.request_hash,
            status: "QUEUED",
            accepted_at: "2026-08-17T12:00:00.000Z",
            receipt_hash: `sha256:${"0".repeat(64)}`,
          },
        ],
      ]),
    );
    const auth = authority();
    const queue = createPostgresJobQueue(scripted.pool, auth.authorizer, auth.capability, {
      lease_duration_ms: 30_000,
    });
    const result = await queue.enqueue(command);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "JOB_SUBMISSION_RECEIPT_HASH_MISMATCH", retryable: false },
    });
  });

  it("maps Job Authority markers without collapsing retry semantics", async () => {
    const input = jobInputSchema.parse({
      schema_version: "job-input@1.0.0",
      kind: "ARTIFACT_EXPORT",
      resource_refs: [],
      parameters: {},
    });
    const command = await buildJobSubmissionCommand({
      schema_version: "job-submit@1.0.0",
      scope,
      kind: "ARTIFACT_EXPORT",
      idempotency_key: "artifact-export-conflict",
      input,
      priority: 50,
      max_attempts: 3,
      cancel_policy: "COOPERATIVE",
    });
    const auth = authority();
    const queue = createPostgresJobQueue(
      poolThrowing("JOB_IDEMPOTENCY_CONFLICT"),
      auth.authorizer,
      auth.capability,
      { lease_duration_ms: 30_000 },
    );

    await expect(queue.enqueue(command)).resolves.toEqual({
      ok: false,
      error: {
        code: "JOB_IDEMPOTENCY_CONFLICT",
        message: "同一 Job Idempotency Key 已绑定不同请求。",
        retryable: false,
      },
    });
  });
});
