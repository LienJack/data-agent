import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { falcon24QaStartUrl } from "@/cli/falcon24-browser-trace-gate";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("Falcon24 E1 browser trace gate", () => {
  it("starts from the selected Q&A conversation without a prebuilt Run or trace URL", () => {
    const url = falcon24QaStartUrl({
      web_base_url: "http://127.0.0.1:3000",
      workspace_id: id(1),
      conversation_id: id(2),
    });
    expect(url.pathname).toBe(`/w/${id(1)}/qa`);
    expect(url.searchParams.get("conversation")).toBe(id(2));
    expect(url.searchParams.get("tab")).toBe("conversation");
    expect(url.searchParams.has("run")).toBe(false);
    expect(url.searchParams.has("event")).toBe(false);
  });

  it("keeps the browser workflow ordered as Q&A submit, result trace entry, trace interaction and return", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/cli/falcon24-browser-trace-gate.ts", import.meta.url)),
      "utf8",
    );
    const submit = source.indexOf('["click", \'[data-testid="qa-submit-question"]\']');
    const resultEntry = source.indexOf('["wait", resultTraceSelector]', submit);
    const traceReady = source.indexOf("resolution-trace-ready");
    const returnToResult = source.indexOf("resolution-trace-return-to-result");
    expect(submit).toBeGreaterThan(0);
    expect(resultEntry).toBeGreaterThan(submit);
    expect(traceReady).toBeGreaterThan(resultEntry);
    expect(returnToResult).toBeGreaterThan(traceReady);
    expect(source).toContain('["set", "viewport"');
    expect(source).toContain("FALCON24_BROWSER_PREEXISTING_TARGET_RUN_FORBIDDEN");
    expect(source).not.toContain('searchParams.set("run"');
    expect(source).not.toContain('searchParams.set("event"');
    expect(source).not.toContain('searchParams.set("tab", "trajectory"');
  });
});
