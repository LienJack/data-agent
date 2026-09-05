import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  FALCON24_FOUR_LAYER_TABLE_SELECTOR,
  falcon24QaObservationScript,
} from "../src/cli/falcon24-four-layer-browser-gate";

const runId = "98200000-0000-4000-8000-000000000022";
const entrySelector = `[data-testid="qa-result-trace-entry"][data-run-id="${runId}"][data-terminal-status="COMPLETED"]`;
const webBuild = { build_id: "build", generation_id: "generation" };
type Frame = {
  table?: boolean;
  chart?: "LOADING" | "READY";
  loading?: boolean;
  answerMissing?: boolean;
  runMissing?: boolean;
  tableHidden?: boolean;
  error?: string;
};

async function observe(
  frames: Frame[],
  requirements = { table_required: true, chart_required: false },
) {
  let now = 0;
  let samples = 0;
  const current = () => frames[Math.min(samples, frames.length - 1)] ?? {};
  const visible = { getBoundingClientRect: () => ({ width: 100, height: 100 }) };
  const table = {
    getBoundingClientRect: () => ({ width: current().tableHidden ? 0 : 100, height: 100 }),
  };
  const entry = { getAttribute: (key: string) => (key === "data-run-id" ? runId : "COMPLETED") };
  const document = {
    documentElement: { scrollWidth: 1440, clientWidth: 1440 },
    // Other Runs may already have tables; only the exact Run's subtree may satisfy readiness.
    querySelector: vi.fn((selector: string) => (selector === entrySelector ? entry : table)),
    getElementById: vi.fn((id: string) => {
      expect(id).toBe(`chat-run-${runId}`);
      return current().runMissing
        ? null
        : {
            querySelector: (selector: string) => {
              if (selector === ".agent-answer") {
                return current().answerMissing ? null : { ...visible, textContent: "answer" };
              }
              if (selector === FALCON24_FOUR_LAYER_TABLE_SELECTOR) {
                return current().table ? table : null;
              }
              if (selector === '[data-testid="governed-chart"]') {
                return current().chart ? { ...visible, getAttribute: () => current().chart } : null;
              }
              if (selector === '[aria-busy="true"],[data-streaming="true"]') {
                return current().loading ? {} : null;
              }
              throw new Error(`unexpected selector: ${selector}`);
            },
            querySelectorAll: () => [],
          };
    }),
    querySelectorAll: (selector: string) =>
      selector === '[role="alert"]'
        ? current().error
          ? [{ textContent: current().error }]
          : []
        : [entry],
  };
  const fetch = vi.fn(async () => ({ json: async () => webBuild }));
  const result = await new Script(
    falcon24QaObservationScript({
      run_id: runId,
      conversation_run_ids: [runId],
      ...requirements,
    }),
  ).runInNewContext({
    document,
    fetch,
    performance: { now: () => now },
    requestAnimationFrame: (callback: () => void) =>
      queueMicrotask(() => {
        now += 16;
        samples += 1;
        callback();
      }),
  });
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/ready", { cache: "no-store" });
  expect(document.querySelector.mock.calls.every(([selector]) => selector === entrySelector)).toBe(
    true,
  );
  return { result, now, samples };
}

describe("Falcon QA Artifact readiness", () => {
  it("waits beyond a terminal entry for the exact Run's asynchronous table", async () => {
    const observed = await observe([{}, {}, { table: true }]);
    expect(observed.result.table_visible).toBe(true);
    expect(observed.samples).toBe(2);
  });

  it("waits for a required chart's READY state, not just its element", async () => {
    const observed = await observe(
      [{ table: true }, { table: true, chart: "LOADING" }, { table: true, chart: "READY" }],
      { table_required: true, chart_required: true },
    );
    expect(observed.result.chart_rendered).toBe(true);
    expect(observed.samples).toBe(2);
  });

  it.each([
    { table: true, loading: true },
    { table: true, answerMissing: true },
    { table: true, runMissing: true },
    { table: true, tableHidden: true },
  ])("waits for transient answer/render readiness: %j", async (frame) => {
    const observed = await observe([frame, { table: true }]);
    expect(observed.result).toMatchObject({
      answer_visible: true,
      table_visible: true,
      loading_visible: false,
    });
    expect(observed.samples).toBe(1);
  });

  it.each([
    {},
    { table: true, chart: "LOADING" },
    { table: true, chart: "READY", loading: true },
  ] satisfies Frame[])(
    "bounds persistent incompleteness and preserves failure evidence: %j",
    async (frame) => {
      const observed = await observe([frame], { table_required: true, chart_required: true });
      expect(observed.now).toBeGreaterThanOrEqual(25000);
      expect(observed.samples).toBeLessThan(1600);
      expect(observed.result.table_visible).toBe(frame.table ?? false);
      expect(observed.result.chart_rendered).toBe(frame.chart === "READY");
      expect(observed.result.loading_visible).toBe(frame.loading ?? false);
    },
  );

  it("does not wait for optional charts or tables on definition-only turns", async () => {
    const observed = await observe([{}], { table_required: false, chart_required: false });
    expect(observed.samples).toBe(0);
    expect(observed.result).toMatchObject({ table_visible: false, chart_rendered: false });
  });

  it("does not wait away an observed error banner", async () => {
    const observed = await observe([{ error: "Artifact unavailable" }, { table: true }]);
    expect(observed.samples).toBe(0);
    expect(observed.result.error_banners).toEqual(["Artifact unavailable"]);
  });
});
