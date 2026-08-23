import { describe, expect, it, vi } from "vitest";
import { resolveSemanticAuthoringProviderAttempt } from "../src/semantic/authoring-model-runtime.js";

const runId = "00000000-0000-4000-8000-000000000011";
const requestId = "00000000-0000-4000-8000-000000000012";
const persistedAttemptId = "00000000-0000-4000-8000-000000000013";

describe("semantic authoring model runtime", () => {
  it("reuses an intent attempt recorded before dispatch when recovering a turn", async () => {
    const loadPendingIntentAttempt = vi.fn(async () => persistedAttemptId);

    await expect(
      resolveSemanticAuthoringProviderAttempt({
        lifecycle: { loadPendingIntentAttempt },
        authoring_run_id: runId,
        turn_index: 3,
        request_id: requestId,
        new_id: () => "00000000-0000-4000-8000-000000000014",
      }),
    ).resolves.toBe(persistedAttemptId);
    expect(loadPendingIntentAttempt).toHaveBeenCalledWith({
      run_id: runId,
      turn_index: 3,
      request_id: requestId,
    });
  });

  it("creates an attempt only when no pending intent exists", async () => {
    await expect(
      resolveSemanticAuthoringProviderAttempt({
        lifecycle: { loadPendingIntentAttempt: vi.fn(async () => null) },
        authoring_run_id: runId,
        turn_index: 1,
        request_id: requestId,
        new_id: () => persistedAttemptId,
      }),
    ).resolves.toBe(persistedAttemptId);
  });
});
