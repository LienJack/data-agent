import { ECOMMERCE_DIRECT_QA_CAPABILITY } from "@data-agent/evals/ecommerce-direct-qa";
import { describe, expect, it, vi } from "vitest";
import { createEcommerceDirectQaRegistry } from "../../src/evals/ecommerce-direct-qa-registry.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";

function execution(overrides: {
  readonly workspace_id?: string;
  readonly datasource_id?: string;
  readonly semantic_release_id?: string;
}) {
  return {
    lease: { scope: { tenant_id: overrides.workspace_id ?? workspaceId } },
    context: {
      getEffectiveConfig: () => ({
        datasource: {
          resource_id: overrides.datasource_id ?? ECOMMERCE_DIRECT_QA_CAPABILITY.datasource_id,
        },
        semantic_release: {
          resource_id:
            overrides.semantic_release_id ?? ECOMMERCE_DIRECT_QA_CAPABILITY.semantic_release_id,
        },
      }),
    },
  } as never;
}

describe("E-commerce direct Q&A registry", () => {
  it("selects the adapter only for an applicable registration and propagates its result", async () => {
    const adapter = {
      execute: vi.fn(async () => ({ kind: "FAILED" as const, error_code: "ADAPTER_FAILURE" })),
    };
    const fallback = { execute: vi.fn(async () => ({ kind: "COMPLETED" as const })) };
    const registry = createEcommerceDirectQaRegistry({
      fallback,
      registrations: [
        {
          registration: {
            workspace_id: workspaceId,
            benchmark_profile_id: ECOMMERCE_DIRECT_QA_CAPABILITY.benchmark_profile_id,
          },
          executor: adapter,
        },
      ],
    });

    await expect(registry.execute(execution({}))).resolves.toEqual({
      kind: "FAILED",
      error_code: "ADAPTER_FAILURE",
    });
    expect(adapter.execute).toHaveBeenCalledOnce();
    expect(fallback.execute).not.toHaveBeenCalled();
  });

  it.each([
    { workspace_id: "00000000-0000-4000-8000-000000000002" },
    { datasource_id: "00000000-0000-4000-8000-000000000003" },
    { semantic_release_id: "00000000-0000-4000-8000-000000000004" },
  ])("uses the generic fallback when the binding is not applicable: %o", async (binding) => {
    const adapter = { execute: vi.fn() };
    const fallback = { execute: vi.fn(async () => ({ kind: "COMPLETED" as const })) };
    const registry = createEcommerceDirectQaRegistry({
      fallback,
      registrations: [
        {
          registration: {
            workspace_id: workspaceId,
            benchmark_profile_id: ECOMMERCE_DIRECT_QA_CAPABILITY.benchmark_profile_id,
          },
          executor: adapter,
        },
      ],
    });
    await expect(registry.execute(execution(binding))).resolves.toEqual({ kind: "COMPLETED" });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("fails startup on duplicate registration and leaves an empty registry on the fallback", async () => {
    const fallback = { execute: vi.fn(async () => ({ kind: "COMPLETED" as const })) };
    const registration = {
      workspace_id: workspaceId,
      benchmark_profile_id: ECOMMERCE_DIRECT_QA_CAPABILITY.benchmark_profile_id,
    };
    expect(() =>
      createEcommerceDirectQaRegistry({
        fallback,
        registrations: [
          { registration, executor: fallback },
          { registration, executor: fallback },
        ],
      }),
    ).toThrow("ECOMMERCE_DIRECT_QA_REGISTRATION_DUPLICATE");
    await expect(
      createEcommerceDirectQaRegistry({ fallback, registrations: [] }).execute(execution({})),
    ).resolves.toEqual({ kind: "COMPLETED" });
  });
});
