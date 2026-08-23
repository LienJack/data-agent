import { modelRequestPerformanceSchema, publicRunEventSchema } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  contextWindowOccupancy,
  latestExactContextUsage,
  orderedConversationRunIds,
  readModelRequestPerformances,
} from "@/lib/model-request-performance";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function performance(profileId = id(8)) {
  return modelRequestPerformanceSchema.parse({
    schema_version: "model-request-performance@1.0.0",
    request_id: id(7),
    provider: "deepseek",
    profile_id: profileId,
    model_id: "deepseek-v4-flash",
    status: "COMPLETED",
    attempt_count: 1,
    duration_ms: 240,
    context_window_tokens: 262_144,
    reserved_output_tokens: 2_048,
    usage: {
      availability: "AVAILABLE",
      source: "PROVIDER_REPORTED",
      input_tokens: 162_000,
      output_tokens: 1_000,
      total_tokens: 163_000,
      tool_calls: 0,
      unavailable_reason: null,
    },
  });
}

function event(output: string, callId = id(7)) {
  return publicRunEventSchema.parse({
    schema_version: "public-run-event@2.0.0",
    event_id: id(9),
    run_id: id(6),
    sequence: 4,
    occurred_at: "2026-08-23T10:00:00.000Z",
    type: "tool",
    payload: {
      call_id: callId,
      tool_name: "model.request@1.0.0",
      title: "model.request@1.0.0",
      summary: "模型请求完成",
      status: "COMPLETED",
      input: null,
      output,
      duration_ms: 240,
      error_code: null,
      profile_id: null,
      task_id: null,
      artifact_refs: [],
    },
  });
}

describe("model request performance projection", () => {
  it("reads only exact model request output bound to the public call identity", () => {
    const exact = performance();
    expect(readModelRequestPerformances([event(JSON.stringify(exact))])).toMatchObject([
      { run_id: id(6), sequence: 4, performance: exact },
    ]);
    expect(readModelRequestPerformances([event(JSON.stringify(exact), id(99))])).toEqual([]);
    expect(readModelRequestPerformances([event("not-json")])).toEqual([]);
  });

  it("uses exact input tokens for occupancy, clamps display percent, and rejects stale profiles", () => {
    const exact = performance();
    expect(contextWindowOccupancy(exact)).toMatchObject({
      used: 162_000,
      capacity: 262_144,
      percent: 62,
    });
    const observed = event(JSON.stringify(exact));
    expect(latestExactContextUsage([observed], id(8))?.performance).toEqual(exact);
    expect(latestExactContextUsage([observed], id(88))).toBeNull();
  });

  it("orders conversation Turns by their earliest event instead of UUID or replay array order", () => {
    const later = {
      ...event(JSON.stringify(performance())),
      run_id: id(60),
      occurred_at: "2026-08-23T10:00:02.000Z",
    };
    const earlier = {
      ...event(JSON.stringify(performance())),
      run_id: id(90),
      occurred_at: "2026-08-23T10:00:01.000Z",
    };
    expect(orderedConversationRunIds([later, earlier])).toEqual([id(90), id(60)]);
  });
});
