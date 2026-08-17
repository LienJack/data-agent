import type { RunInterruption } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClarificationDialogView } from "../src/components/workbench/clarification-dialog";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const interruption = {
  schema_version: "run-interruption@1.0.0",
  scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
  interruption_id: id(3),
  run_id: id(4),
  kind: "CLARIFICATION",
  question: "应使用预订收入还是已确认收入？",
  options: [
    { option_id: "booked", label: "预订收入" },
    { option_id: "recognized", label: "已确认收入" },
  ],
  checkpoint_ref: { snapshot_id: id(5), snapshot_version: 3, snapshot_hash: hash("1") },
  worker_fence: 8,
  state: "OPEN",
  version: 1,
  opened_at: "2026-08-17T12:00:00.000Z",
  answered_at: null,
  interruption_hash: hash("2"),
} satisfies RunInterruption;

const actions = {
  onTextChange: vi.fn(),
  onOptionChange: vi.fn(),
  onClose: vi.fn(),
  onRetry: vi.fn(),
  onSubmit: vi.fn(),
};

describe("durable clarification dialog", () => {
  it("renders the exact interruption version, fence, checkpoint and options", () => {
    const html = renderToStaticMarkup(
      <ClarificationDialogView
        state={{ kind: "open", interruption }}
        text=""
        selectedOption=""
        {...actions}
      />,
    );
    expect(html).toContain("应使用预订收入还是已确认收入？");
    expect(html).toContain("预订收入");
    expect(html).toContain("VERSION 1 · FENCE 8 · CHECKPOINT 3");
    expect(html).toContain("提交并恢复 Run");
  });

  it("renders stale and permission states without a submit command", () => {
    const stale = renderToStaticMarkup(
      <ClarificationDialogView
        state={{ kind: "stale", message: "当前版本已被回复。" }}
        text=""
        selectedOption=""
        {...actions}
      />,
    );
    const denied = renderToStaticMarkup(
      <ClarificationDialogView
        state={{ kind: "permission-denied" }}
        text=""
        selectedOption=""
        {...actions}
      />,
    );
    expect(stale).toContain("澄清状态已更新");
    expect(stale).not.toContain("提交并恢复 Run");
    expect(denied).toContain("无权回复澄清");
    expect(denied).not.toContain("提交并恢复 Run");
  });
});
