import { describe, expect, it } from "vitest";
import {
  applyQAInspectorTargetToUrl,
  parseQAInspectorTarget,
  qaConversationHref,
} from "@/lib/qa-inspector-target";

const target = {
  kind: "subagent" as const,
  run_id: "10000000-0000-4000-8000-000000000001",
  profile_id: "report-writing-agent" as const,
  task_id: "10000000-0000-4000-8000-000000000002",
  anchor_sequence: 19,
};

describe("QA Inspector URL target", () => {
  it("round-trips a strict target without changing unrelated URL state", () => {
    const url = new URL("https://example.test/w/workspace/qa?tab=conversation&run=run-1");
    applyQAInspectorTargetToUrl(url, target);
    expect(parseQAInspectorTarget(url.searchParams)).toEqual(target);
    expect(url.searchParams.get("tab")).toBe("conversation");
    expect(url.searchParams.get("run")).toBe("run-1");
  });

  it("keeps a conversation replay locator beside the Inspector target", () => {
    const url = new URL("https://example.test/w/workspace/qa");
    applyQAInspectorTargetToUrl(url, target);
    url.searchParams.set("conversation", "10000000-0000-4000-8000-000000000099");
    expect(parseQAInspectorTarget(url.searchParams)).toEqual(target);
    expect(url.searchParams.get("conversation")).toBe("10000000-0000-4000-8000-000000000099");
  });

  it("rejects malformed and private-shaped targets, and removes selection on close", () => {
    const invalid = new URLSearchParams({
      inspector: JSON.stringify({ ...target, reasoning_content: "private" }),
    });
    expect(parseQAInspectorTarget(invalid)).toBeNull();
    const url = new URL("https://example.test/w/workspace/qa");
    applyQAInspectorTargetToUrl(url, target);
    applyQAInspectorTargetToUrl(url, null);
    expect(url.searchParams.has("inspector")).toBe(false);
  });

  it("keeps the global Sidebar navigation on a reloadable conversation route", () => {
    expect(
      qaConversationHref(
        "/w/10000000-0000-4000-8000-000000000001/qa",
        "10000000-0000-4000-8000-000000000002",
      ),
    ).toBe(
      "/w/10000000-0000-4000-8000-000000000001/qa?conversation=10000000-0000-4000-8000-000000000002",
    );
  });
});
