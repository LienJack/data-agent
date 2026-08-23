import type { ContextReceiptBinding } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunBoundResolvedContextResolver } from "../../src/runs/run-bound-resolved-context.js";
import {
  bindEffectiveConfigLease,
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "./support/effective-config-fixture.js";

const scope = {
  app_id: "87000000-0000-4000-8000-000000000001",
  tenant_id: "87000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;
const principalId = "87000000-0000-4000-8000-000000000003";

describe("run-bound resolved context", () => {
  it("derives a RUN request from exact config and worker context authority", async () => {
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: scope.tenant_id,
      principal_id: principalId,
      run_id: "87000000-0000-4000-8000-000000000004",
    });
    const lease = bindEffectiveConfigLease(
      {
        scope,
        principal_id: principalId,
        outbox_id: "87000000-0000-4000-8000-000000000005",
        run_id: config.run_id,
        command_id: "87000000-0000-4000-8000-000000000006",
        command_kind: "START_L2_RESEARCH",
        attempt_id: "87000000-0000-4000-8000-000000000007",
        attempt_no: 1,
        delivery_attempt_no: 1,
        lease_duration_ms: 30_000,
        worker_id: "worker-u12",
        lease_token: 2,
        worker_fence: 3,
        expires_at: "2026-08-17T10:00:00.000Z",
        payload: { kind: "START_L2_RESEARCH" },
      },
      config,
    );
    const loaded = await createEffectiveConfigFixtureLoader(config)(lease);
    if (!loaded.ok) throw new Error("fixture failed");
    const contextReceipt = (loaded.value as { context_receipt: ContextReceiptBinding })
      .context_receipt;
    const service = vi.fn(async (_capability: unknown, request: unknown) => ({
      ok: true as const,
      value: { request } as never,
    }));
    const resolver = createRunBoundResolvedContextResolver({
      capability: { authority: "test" },
      service: { resolve: service },
    });
    await expect(
      resolver.resolve({
        lease,
        effective_config: config,
        context_receipt: contextReceipt,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(service).toHaveBeenCalledWith(
      { authority: "test" },
      expect.objectContaining({
        request_id: contextReceipt.receipt_id,
        request_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        basis: {
          consumer: "RUN",
          run_id: lease.run_id,
          config_ref: contextReceipt.config_ref,
          context_receipt_ref: {
            receipt_id: contextReceipt.receipt_id,
            receipt_hash: contextReceipt.receipt_hash,
          },
        },
      }),
    );
  });

  it("rejects config substitution before invoking the authority service", async () => {
    const service = vi.fn();
    const resolver = createRunBoundResolvedContextResolver({
      capability: {},
      service: { resolve: service },
    });
    const result = await resolver.resolve({
      lease: { run_id: "87000000-0000-4000-8000-000000000010" } as never,
      effective_config: { run_id: "87000000-0000-4000-8000-000000000011" } as never,
      context_receipt: {} as never,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLVED_CONTEXT_WORKER_AUTHORITY_MISMATCH" },
    });
    expect(service).not.toHaveBeenCalled();
  });
});
