import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let resolveTestCenterRuntimeConfig: typeof import("../src/lib/test-center-runtime").resolveTestCenterRuntimeConfig;
let executeTestCenterRun: typeof import("../src/lib/test-center-runtime").executeTestCenterRun;

beforeAll(async () => {
  ({ executeTestCenterRun, resolveTestCenterRuntimeConfig } = await import(
    "../src/lib/test-center-runtime"
  ));
});

describe("Test Center runtime configuration", () => {
  it("uses the fixed local scope in development when PostgreSQL is configured", () => {
    expect(
      resolveTestCenterRuntimeConfig({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost/data_agent",
      }),
    ).toEqual({
      connectionString: "postgresql://localhost/data_agent",
      tenantId: "00000000-0000-4000-8000-000000000002",
      principalId: "00000000-0000-4000-8000-000000000003",
      environment: "local",
    });
  });

  it("keeps production fail-closed when the server scope is incomplete", () => {
    expect(() =>
      resolveTestCenterRuntimeConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://db/data_agent",
      }),
    ).toThrow("能力测试持久化尚未配置。");
  });

  it("rejects direct execution of a preview-only E-commerce suite before persistence", async () => {
    await expect(
      executeTestCenterRun(
        {
          suite_id: "ecommerce-production",
          suite_version: "1.0.0",
          case_ids: ["ec100000-0000-4000-8000-000000000001"],
          agent_id: "8bb0cb75-1209-51b7-a668-017155d4f486",
          reflection_enabled: false,
          seed: 42,
          budget: {
            max_cases: 1,
            max_attempts_per_case: 1,
            max_case_duration_ms: 10_000,
            max_batch_duration_ms: 10_000,
            max_output_tokens_per_attempt: 1_024,
            max_cost_micros: 0,
            concurrency: 1,
          },
          submitted_answers: {
            "ec100000-0000-4000-8000-000000000001": "select 1",
          },
        },
        "preview-only-test",
      ),
    ).rejects.toMatchObject({ code: "TEST_CENTER_SUITE_NOT_READY", status: 409 });
  });
});
