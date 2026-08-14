import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let resolveTestCenterRuntimeConfig: typeof import("../src/lib/test-center-runtime").resolveTestCenterRuntimeConfig;

beforeAll(async () => {
  ({ resolveTestCenterRuntimeConfig } = await import("../src/lib/test-center-runtime"));
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
});
