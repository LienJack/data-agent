import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Apple blue Q&A and analysis surfaces", () => {
  it("keeps the answer stream narrow and the composer in shared floating material", () => {
    const chatArea = source("../src/components/qa/chat-area.tsx");
    const chatInput = source("../src/components/qa/chat-input.tsx");

    expect(chatArea).toContain("max-w-[840px]");
    expect(chatInput).toContain("max-w-[840px]");
    expect(chatInput).toContain("surface-floating-strong");
    expect(chatInput).toContain("qa-composer-stage");
  });

  it("uses progressive disclosure without moving run event geometry", () => {
    const disclosure = source("../src/components/qa/process-disclosure.tsx");
    const qaPage = source("../src/app/qa/page.tsx");

    expect(disclosure).toContain("aria-expanded={expanded}");
    expect(disclosure).toContain("control-pressable");
    expect(qaPage).toContain("qa-page-frame");
    expect(qaPage).toContain("<QAInspector />");
  });

  it("removes the former green theme from Test Center and uses layout skeletons for jobs", () => {
    const tests = source("../src/app/tests/page.tsx");
    const jobs = source("../src/components/jobs/job-center-view.tsx");

    expect(tests).not.toMatch(/#(?:6a8e81|527c70|9bb3aa|f2f6f4|42685e|bfd0ca|cfddd8)/i);
    expect(tests).toContain("bg-[var(--color-accent)]");
    expect(jobs).toContain("skeleton-shimmer");
    expect(jobs).not.toContain("animate-pulse");
  });
});
