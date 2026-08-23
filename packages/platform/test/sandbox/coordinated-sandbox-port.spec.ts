import type { SandboxExecutionReceipt, SandboxExecutionRequest } from "@data-agent/contracts";
import type {
  ExecutionGrant,
  SandboxExecutionOutcome,
  SandboxExecutionTransitionResult,
  SandboxServerAuthority,
} from "@data-agent/contracts/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorityMocks = vi.hoisted(() => ({
  authorizeSandboxExecutionReceipt: vi.fn(),
  cancelSandboxExecution: vi.fn(),
  failSandboxExecution: vi.fn(),
  finalizeSandboxExecution: vi.fn(),
  prepareSandboxExecution: vi.fn(),
}));

vi.mock("@data-agent/contracts/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@data-agent/contracts/server")>()),
  ...authorityMocks,
}));

import { createCoordinatedSandboxPort } from "../../src/sandbox/coordinated-sandbox-port.js";

const executionId = "00000000-0000-4000-8000-00000000e101";
const grant = {
  identity: {
    execution_id: executionId,
  },
  cancel_epoch: 0,
} as unknown as ExecutionGrant;
const request = {
  language: "sql",
} as unknown as SandboxExecutionRequest;
const authority = Object.freeze(Object.create(null)) as SandboxServerAuthority;
const receipt = {
  execution_id: executionId,
  terminal: "COMPLETED",
} as unknown as SandboxExecutionReceipt;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function acceptedPreparation() {
  return {
    disposition: "ACCEPTED",
    reason_code: "SANDBOX_EXECUTION_IN_PROGRESS",
    grant,
    claim: { state: "EXECUTING" },
  };
}

describe("coordinated Sandbox port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drives prepare -> datasource -> finalize -> authoritative receipt", async () => {
    authorityMocks.prepareSandboxExecution.mockResolvedValue(acceptedPreparation());
    authorityMocks.finalizeSandboxExecution.mockResolvedValue({
      disposition: "ACCEPTED",
      reason_code: "SANDBOX_EXECUTION_COMPLETED",
      claim: {
        state: "COMPLETED",
        receipt_ref: { artifact_type: "SandboxExecutionReceipt" },
      },
    });
    authorityMocks.authorizeSandboxExecutionReceipt.mockResolvedValue(receipt);
    const start = vi.fn().mockResolvedValue({
      grant,
      outcome: Promise.resolve({
        terminal: "COMPLETED",
      } as unknown as SandboxExecutionOutcome),
      cancel: vi.fn(),
      terminate: vi.fn(),
    });
    const port = createCoordinatedSandboxPort({
      authority,
      python: { start },
      resolve_operation: () => ({ sql: "bound-operation" }),
    });

    await expect(port.execute(request)).resolves.toEqual({ ok: true, value: receipt });
    expect(start).toHaveBeenCalledWith({
      grant,
      sql: "bound-operation",
    });
    expect(authorityMocks.finalizeSandboxExecution).toHaveBeenCalledOnce();
    expect(authorityMocks.failSandboxExecution).not.toHaveBeenCalled();
  });

  it("persists Authority cancel before routing the monotonic epoch to Python", async () => {
    const outcome = deferred<SandboxExecutionOutcome>();
    const cancel = vi.fn(() =>
      outcome.resolve({
        terminal: "CANCELLED",
      } as unknown as SandboxExecutionOutcome),
    );
    authorityMocks.prepareSandboxExecution.mockResolvedValue(acceptedPreparation());
    authorityMocks.cancelSandboxExecution.mockResolvedValue({
      disposition: "CANCEL_ACCEPTED",
      reason_code: "SANDBOX_CANCELLED",
      claim: { state: "CANCEL_REQUESTED", cancel_epoch: 1 },
    });
    authorityMocks.finalizeSandboxExecution.mockResolvedValue({
      disposition: "CANCEL_ACCEPTED",
      reason_code: "SANDBOX_CANCELLED",
      claim: { state: "CANCELLED", receipt_ref: null },
    } as unknown as SandboxExecutionTransitionResult);
    const start = vi.fn().mockResolvedValue({
      grant,
      outcome: outcome.promise,
      cancel,
      terminate: vi.fn(),
    });
    const port = createCoordinatedSandboxPort({
      authority,
      python: { start },
      resolve_operation: () => ({}),
    });

    const execution = port.execute(request);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    await expect(
      port.cancelActive({
        execution_id: executionId,
        requested_at: "2026-07-27T00:00:01.000Z",
        reason_code: "USER_CANCELLED",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        disposition: "CANCEL_ACCEPTED",
        claim: { cancel_epoch: 1 },
      },
    });
    await expect(execution).resolves.toMatchObject({
      ok: false,
      error: { code: "SANDBOX_CANCELLED", retryable: false },
    });
    expect(cancel).toHaveBeenCalledWith({
      cancel_epoch: 1,
      requested_at: "2026-07-27T00:00:01.000Z",
      reason_code: "USER_CANCELLED",
    });
    expect(authorityMocks.finalizeSandboxExecution).toHaveBeenCalledOnce();
    expect(authorityMocks.failSandboxExecution).not.toHaveBeenCalled();
  });

  it("keeps process loss outcome-unknown so Lease Recovery remains authoritative", async () => {
    authorityMocks.prepareSandboxExecution.mockResolvedValue(acceptedPreparation());
    const port = createCoordinatedSandboxPort({
      authority,
      python: {
        start: vi.fn().mockResolvedValue({
          grant,
          outcome: Promise.reject(new Error("worker exited before OUTCOME")),
          cancel: vi.fn(),
          terminate: vi.fn(),
        }),
      },
      resolve_operation: () => ({}),
    });

    await expect(port.execute(request)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "SANDBOX_EXECUTION_OUTCOME_UNKNOWN",
        retryable: true,
      },
    });
    expect(authorityMocks.finalizeSandboxExecution).not.toHaveBeenCalled();
    expect(authorityMocks.failSandboxExecution).not.toHaveBeenCalled();
  });

  it("replays an already committed receipt without starting a datasource process", async () => {
    authorityMocks.prepareSandboxExecution.mockResolvedValue({
      disposition: "REPLAYED",
      reason_code: "SANDBOX_EXECUTION_COMPLETED",
      grant: null,
      claim: {
        state: "COMPLETED",
        receipt_ref: { artifact_type: "SandboxExecutionReceipt" },
      },
    });
    authorityMocks.authorizeSandboxExecutionReceipt.mockResolvedValue(receipt);
    const start = vi.fn();
    const port = createCoordinatedSandboxPort({
      authority,
      python: { start },
      resolve_operation: () => ({}),
    });

    await expect(port.execute(request)).resolves.toEqual({ ok: true, value: receipt });
    expect(start).not.toHaveBeenCalled();
  });
});
