import type { ResolutionTrace } from "@data-agent/contracts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ResolutionTracePanel } from "@/components/qa/resolution-trace-view";

// Presentation fixture only: no authority receipt, API, model, or Artifact preview.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const trace: ResolutionTrace = {
  schema_version: "resolution-trace@1.0.0",
  scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
  run_id: id(3),
  conversation_id: id(4),
  config_ref: null,
  trace_hash: `sha256:${"a".repeat(64)}`,
  nodes: [1, 2].map((n) => ({
    node_id: `event:${id(n + 5)}`,
    kind: n === 2 ? "TERMINAL" : "TOOL",
    source_event_id: id(n + 5),
    sequence: n,
    occurred_at: `2026-08-18T12:00:0${n}.000Z`,
    status: "COMPLETED",
    title: `Node ${n}`,
    summary: "public node",
    duration_ms: 1,
    artifact_refs: [],
  })),
  edges: [],
};
const container = document.getElementById("root");
if (!container) throw new Error("FIXTURE_ROOT_REQUIRED");
const root = createRoot(container);
const draw = (sequence: number | null = 2, run = trace.run_id) => {
  const current = {
    ...trace,
    run_id: run,
    trace_hash: `sha256:${(run === trace.run_id ? "a" : "b").repeat(64)}`,
  };
  flushSync(() =>
    root.render(
      <ResolutionTracePanel trace={current} traces={[current]} sql={[]} focusSequence={sequence} />,
    ),
  );
};
const settle = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
  );
const selected = () =>
  document
    .querySelector('[data-testid="resolution-trace-node"][aria-current="step"]')
    ?.getAttribute("data-node-id") ?? null;
const selectFirst = () => {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-testid="resolution-trace-node"][data-node-id="event:${id(6)}"]`,
  );
  if (!button) throw new Error("NODE_CONTROL_MISSING");
  button.click();
};

async function probe() {
  draw();
  await settle();
  const initial = selected();
  selectFirst();
  await settle();
  const clicked = selected();
  draw(); // Fresh objects, same Run/hash/focus: must preserve the user's selection.
  await settle();
  const refreshed = selected();
  draw(1);
  await settle();
  draw(2);
  await settle();
  const refocused = selected();
  selectFirst();
  await settle();
  draw(null);
  await settle();
  const clearedFocus = selected();
  const close = document.querySelector<HTMLButtonElement>('[aria-label="关闭轨迹详情"]');
  if (!close) throw new Error("CLOSE_CONTROL_MISSING");
  close.click();
  await settle();
  draw(null);
  await settle();
  const closed = selected();
  draw(2, id(30));
  await settle();
  const changedRun = selected();
  return {
    initial,
    clicked,
    refreshed,
    refocused,
    clearedFocus,
    closed,
    changedRun,
    pass:
      initial === `event:${id(7)}` &&
      clicked === `event:${id(6)}` &&
      refreshed === clicked &&
      refocused === initial &&
      clearedFocus === clicked &&
      closed === null &&
      changedRun === initial,
  };
}

declare global {
  interface Window {
    probe: typeof probe;
  }
}
window.probe = probe;
draw();
