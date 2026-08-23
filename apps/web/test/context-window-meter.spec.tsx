import { modelRequestPerformanceSchema } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextWindowMeter } from "@/components/qa/context-window-meter";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("ContextWindowMeter", () => {
  it("renders an exact provider-reported occupancy trigger and hides without evidence", () => {
    const performance = modelRequestPerformanceSchema.parse({
      schema_version: "model-request-performance@1.0.0",
      request_id: id(1),
      provider: "deepseek",
      profile_id: id(2),
      model_id: "deepseek-v4-flash",
      status: "COMPLETED",
      attempt_count: 1,
      duration_ms: 200,
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
    const html = renderToStaticMarkup(<ContextWindowMeter performance={performance} />);
    expect(html).toContain("最近一次请求上下文已用 62%");
    expect(html).toContain('aria-expanded="false"');
    expect(renderToStaticMarkup(<ContextWindowMeter performance={null} />)).toBe("");
  });
});
