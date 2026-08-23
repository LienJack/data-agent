import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let executeTestCenterRun: typeof import("../src/lib/test-center-runtime").executeTestCenterRun;

beforeAll(async () => {
  ({ executeTestCenterRun } = await import("../src/lib/test-center-runtime"));
});

describe("Falcon Agent Gate Web boundary", () => {
  it("rejects the legacy inline evaluator before persistence or Provider work", async () => {
    await expect(
      executeTestCenterRun(
        {
          suite_id: "falcon",
          suite_version: "1.0.0",
          case_ids: ["bbffcf99-f4f4-520a-b86b-536f5bcd75e4"],
          agent_id: "8bb0cb75-1209-51b7-a668-017155d4f486",
          reflection_enabled: false,
          seed: 42,
          budget: {
            max_cases: 1,
            max_attempts_per_case: 1,
            max_case_duration_ms: 10_000,
            max_batch_duration_ms: 10_000,
            max_output_tokens_per_attempt: 1_024,
            concurrency: 1,
          },
          submitted_answers: {},
        },
        "00000000-0000-4000-8000-000000000018",
      ),
    ).rejects.toMatchObject({ code: "TEST_CENTER_WORKER_REQUIRED", status: 409 });
  });
});
