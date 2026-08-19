import type {
  AuthoritativeModelProviderInvocation,
  ModelBillingAuthorizationReceipt,
  ModelProviderEvent,
  ModelProviderPort,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBillingGatedModelProvider } from "../../src/billing/billing-gated-model-provider.js";

const request = {
  request_id: "00000000-0000-4000-8000-000000008001",
  run_id: "00000000-0000-4000-8000-000000008002",
} as unknown as AuthoritativeModelProviderInvocation;

const authorization = {
  operation_id: "00000000-0000-4000-8000-000000008003",
  provider_call_allowed: true,
  bill: { bill_id: "00000000-0000-4000-8000-000000008004" },
  hold: null,
  account: null,
} as unknown as ModelBillingAuthorizationReceipt;

const started = {
  event_type: "STARTED",
  request_id: request.request_id,
} as unknown as ModelProviderEvent;
const completed = {
  event_type: "COMPLETED",
  request_id: request.request_id,
  usage: { input_tokens: 12, output_tokens: 3, tool_calls: 0 },
} as unknown as ModelProviderEvent;

function lifecycle() {
  return {
    prepare: vi.fn().mockResolvedValue({
      ok: true,
      value: { billing_context: { principal_id: "user-a" }, authorize_command: { run: "r1" } },
    }),
    commitTerminal: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        billing_context: { principal_id: "user-a" },
        finalize_command: { bill_id: "b1" },
      },
    }),
  };
}

async function collect(provider: ModelProviderPort): Promise<readonly ModelProviderEvent[]> {
  const events: ModelProviderEvent[] = [];
  for await (const event of provider.stream(request)) events.push(event);
  return events;
}

describe("Billing-gated Model Provider", () => {
  it("never creates the Provider stream when PostgreSQL billing denies authorization", async () => {
    const delegateStream = vi.fn();
    const provider = createBillingGatedModelProvider({
      delegate: { stream: delegateStream },
      billing: {
        authorize: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "CREDIT_AVAILABLE_INSUFFICIENT", message: "denied", retryable: false },
        }),
        finalize: vi.fn(),
      },
      lifecycle: lifecycle(),
    });

    await expect(collect(provider)).rejects.toMatchObject({
      code: "CREDIT_AVAILABLE_INSUFFICIENT",
    });
    expect(delegateStream).not.toHaveBeenCalled();
  });

  it("publishes COMPLETED only after immutable usage and billing settlement commit", async () => {
    const order: string[] = [];
    const terminalLifecycle = lifecycle();
    terminalLifecycle.commitTerminal.mockImplementation(async () => {
      order.push("usage");
      return {
        ok: true,
        value: { billing_context: {}, finalize_command: { bill_id: "b1" } },
      };
    });
    const finalize = vi.fn().mockImplementation(async () => {
      order.push("billing");
      return { ok: true, value: { bill: {} } };
    });
    const provider = createBillingGatedModelProvider({
      delegate: {
        async *stream() {
          order.push("provider");
          yield started;
          yield completed;
        },
      },
      billing: {
        authorize: vi.fn().mockResolvedValue({ ok: true, value: authorization }),
        finalize,
      },
      lifecycle: terminalLifecycle,
    });

    const events = await collect(provider);
    order.push("consumer");
    expect(events.map((event) => event.event_type)).toEqual(["STARTED", "COMPLETED"]);
    expect(order).toEqual(["provider", "usage", "billing", "consumer"]);
    expect(terminalLifecycle.commitTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ terminal_kind: "COMPLETED", provider_event: completed }),
    );
  });

  it("marks a started stream OUTCOME_UNKNOWN when the consumer abandons it", async () => {
    const terminalLifecycle = lifecycle();
    const provider = createBillingGatedModelProvider({
      delegate: {
        async *stream() {
          yield started;
          await new Promise(() => undefined);
        },
      },
      billing: {
        authorize: vi.fn().mockResolvedValue({ ok: true, value: authorization }),
        finalize: vi.fn().mockResolvedValue({ ok: true, value: { bill: {} } }),
      },
      lifecycle: terminalLifecycle,
    });

    const iterator = provider.stream(request)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: started, done: false });
    await iterator.return?.();
    expect(terminalLifecycle.commitTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ terminal_kind: "OUTCOME_UNKNOWN", provider_event: null }),
    );
  });
});
