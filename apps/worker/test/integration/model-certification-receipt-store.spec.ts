import { randomUUID } from "node:crypto";
import { type ArtifactReference, workerRunRuntimeEventSchema } from "@data-agent/contracts";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

const DEPLOYMENT_ID = "00000000-0000-4000-8000-00000000de01";
const CREDENTIAL_MARKER = "integration-test-credential";

const databaseUrl = process.env.DATA_AGENT_TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.DATA_AGENT_TEST_ADMIN_DATABASE_URL;

function openAIUsage() {
  return {
    input_tokens: 4,
    output_tokens: 2,
  };
}

function openAIResponse(modelId: string, content: readonly unknown[]) {
  return {
    id: "resp-worker-integration",
    created_at: 1,
    model: modelId,
    output: content,
    usage: openAIUsage(),
  };
}

function eventStream(events: readonly unknown[]): Response {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function modelIdFrom(body: Record<string, unknown>): string {
  if (typeof body.model !== "string" || body.model.length === 0) {
    throw new Error("OpenAI smoke request did not include a model ID.");
  }
  return body.model;
}

function createNoNetworkOpenAITransport() {
  const bodies: unknown[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const body = JSON.parse(
      typeof init?.body === "string"
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : "{}",
    ) as Record<string, unknown>;
    bodies.push(body);
    const modelId = modelIdFrom(body);

    switch (bodies.length) {
      case 1:
        return new Response(
          JSON.stringify(
            openAIResponse(modelId, [
              {
                type: "message",
                role: "assistant",
                id: "msg-request",
                content: [
                  {
                    type: "output_text",
                    text: "CREDENTIAL_SMOKE_REQUEST_OK",
                    annotations: [],
                  },
                ],
              },
            ]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      case 2:
        return new Response(
          JSON.stringify(
            openAIResponse(modelId, [
              {
                type: "message",
                role: "assistant",
                id: "msg-structured",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ credentialed_smoke: "structured-ok" }),
                    annotations: [],
                  },
                ],
              },
            ]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      case 3:
        return new Response(
          JSON.stringify(
            openAIResponse(modelId, [
              {
                type: "function_call",
                call_id: "call-worker-integration",
                name: "credentialed_smoke_tool",
                arguments: JSON.stringify({ probe: "tool-ok" }),
                id: "fc-worker-integration",
              },
            ]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      case 4:
        return eventStream([
          {
            type: "response.output_text.delta",
            item_id: "msg-stream",
            delta: "CREDENTIAL_STREAM_",
          },
          {
            type: "response.output_text.delta",
            item_id: "msg-stream",
            delta: "OK",
          },
          {
            type: "response.completed",
            response: {
              id: "resp-stream",
              created_at: 1,
              model: modelId,
              output: [],
              usage: openAIUsage(),
            },
          },
        ]);
      case 5:
        return new Response(
          JSON.stringify({
            error: {
              message: "credentialed-smoke-remote-secret-marker",
              type: "authentication_error",
              code: "invalid_api_key",
            },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      default:
        throw new Error("Unexpected provider request.");
    }
  });

  return { fetch, bodies };
}

describe.skipIf(!databaseUrl || !adminDatabaseUrl)(
  "PostgreSQL Model Certification Receipt Store",
  () => {
    const backendPool = new Pool({ connectionString: databaseUrl });
    const adminPool = new Pool({ connectionString: adminDatabaseUrl });

    afterAll(async () => {
      await Promise.all([backendPool.end(), adminPool.end()]);
    });

    it("commits and replays only the genuine credentialed-smoke draft", async () => {
      const transport = createNoNetworkOpenAITransport();
      vi.stubGlobal("fetch", transport.fetch);
      vi.resetModules();

      try {
        const runtime = await import("@data-agent/agent-runtime");
        const platform = await import("@data-agent/platform");
        const { createPostgresModelCertificationReceiptStore } = await import(
          "../../src/postgres-model-certification-receipt-store.js"
        );
        const sqlPool = platform.adaptPgPool(backendPool);
        const authority = platform.createPostgresCapabilityAuthority(sqlPool);
        const tenantId = randomUUID();
        const principalId = randomUUID();
        await adminPool.query(
          "select platform.provision_membership($1::uuid, $2::uuid, $3::uuid, 'owner')",
          [DEPLOYMENT_ID, tenantId, principalId],
        );
        await adminPool.query(
          `select test_support.activate_falcon24_e1_fixture(
             $1::uuid, 'test', $2::uuid, $3::uuid, false, 1
           )`,
          [tenantId, principalId, DEPLOYMENT_ID],
        );
        const capabilityResult = await authority.resolveForServerContext({
          deployment_id: DEPLOYMENT_ID,
          tenant_id: tenantId,
          principal_id: principalId,
          access: "WRITE",
        });
        if (!capabilityResult.ok) {
          throw new Error(`${capabilityResult.error.code}: ${capabilityResult.error.message}`);
        }
        const capability = capabilityResult.value;
        const repository = platform.createPostgresRepository(sqlPool, authority.authorizer);
        const runId = randomUUID();
        const accepted = await repository.acceptCommand(capability, {
          run_id: runId,
          command_id: randomUUID(),
          event_id: randomUUID(),
          outbox_id: randomUUID(),
          audit_id: randomUUID(),
          idempotency_key: `model-certification-${randomUUID()}`,
          question: "验证 Model Certification Receipt 的 PostgreSQL 权威提交。",
          payload: { kind: "START_L2_RESEARCH", mode: "L2" },
        });
        expect(accepted).toMatchObject({
          ok: true,
          value: { created: true, run_id: runId },
        });
        if (!accepted.ok) {
          throw new Error(`${accepted.error.code}: ${accepted.error.message}`);
        }

        const queue = platform.createPostgresRunQueue(sqlPool, authority.authorizer, capability, {
          lease_duration_ms: 30_000,
        });
        const eventStore = platform.createPostgresRunEventStore(
          sqlPool,
          authority.authorizer,
          capability,
        );
        const leased = await queue.lease({
          scope: capability.scope,
          worker_id: "model-certification-worker",
        });
        if (!leased.ok || !leased.value) {
          throw new Error(
            leased.ok
              ? "Model Certification Run 未取得权威 Lease。"
              : `${leased.error.code}: ${leased.error.message}`,
          );
        }
        expect(leased.value.run_id).toBe(runId);

        const queuedProjection = await eventStore.readProjection({
          scope: capability.scope,
          run_id: runId,
        });
        if (!queuedProjection.ok || !queuedProjection.value) {
          throw new Error(
            queuedProjection.ok
              ? "Model Certification Run 缺少初始 Projection。"
              : `${queuedProjection.error.code}: ${queuedProjection.error.message}`,
          );
        }
        const leaseEvent = workerRunRuntimeEventSchema.parse({
          schema_version: "1.0.0",
          event_id: randomUUID(),
          event_type: "run.leased",
          scope: capability.scope,
          run_id: runId,
          sequence: queuedProjection.value.projection.version + 1,
          worker_fence: leased.value.worker_fence,
          idempotency_key: `model-certification-leased-${leased.value.attempt_id}`,
          occurred_at: new Date().toISOString(),
          payload: {
            command_id: leased.value.command_id,
            lease_id: leased.value.attempt_id,
            worker_id: leased.value.worker_id,
            attempt: leased.value.attempt_no,
          },
        });
        const projectedLease = await eventStore.append({
          lease: leased.value,
          event: leaseEvent,
          expected_projection: queuedProjection.value,
        });
        expect(projectedLease).toMatchObject({
          ok: true,
          value: {
            projection: {
              status: "RUNNING",
              worker_fence: leased.value.worker_fence,
            },
          },
        });
        if (!projectedLease.ok) {
          throw new Error(`${projectedLease.error.code}: ${projectedLease.error.message}`);
        }

        const binding = runtime.getModelProviderBinding("openai");
        const probe = await runtime.probeModelProvider({
          binding,
          scope: capability.scope,
          resolve_credential: async () => CREDENTIAL_MARKER,
          smoke: runtime.createLiveProviderCredentialedSmoke(),
        });
        expect(probe.certification_status).toBe("PENDING_RECEIPT_COMMIT");
        if (probe.certification_status !== "PENDING_RECEIPT_COMMIT") {
          throw new Error(`Credentialed smoke did not pass: ${probe.reason_code}`);
        }
        expect(transport.fetch).toHaveBeenCalledTimes(5);

        const receiptReference: ArtifactReference = {
          artifact_id: randomUUID(),
          artifact_type: "ModelCertificationReceipt",
          ...capability.scope,
          run_id: runId,
          revision: 1,
          content_hash: probe.probe_hash,
        };
        const claims = await runtime.createModelCertificationReceiptDraft({
          profile: probe.profile,
          probe,
          receipt_ref: receiptReference,
        });
        expect(runtime.isAuthoritativeModelCertificationReceiptDraft(claims)).toBe(true);

        const store = createPostgresModelCertificationReceiptStore({
          pool: sqlPool,
          authorizer: authority.authorizer,
          capability,
        });
        expect(await store.commit(claims, { worker_fence: leased.value.worker_fence })).toEqual({
          ok: true,
          value: receiptReference,
        });
        expect(await store.commit(claims, { worker_fence: leased.value.worker_fence })).toEqual({
          ok: true,
          value: receiptReference,
        });
        expect(await store.resolve(receiptReference)).toEqual({
          ok: true,
          value: claims,
        });
        expect(await store.verify(receiptReference)).toEqual({
          ok: true,
          value: true,
        });

        const copiedClaims = { ...claims };
        expect(runtime.isAuthoritativeModelCertificationReceiptDraft(copiedClaims)).toBe(false);
        expect(
          await store.commit(copiedClaims, { worker_fence: leased.value.worker_fence }),
        ).toMatchObject({
          ok: false,
          error: {
            code: "PERSISTENCE_INPUT_INVALID",
            retryable: false,
          },
        });
      } finally {
        vi.unstubAllGlobals();
        vi.resetModules();
      }
    });
  },
);
