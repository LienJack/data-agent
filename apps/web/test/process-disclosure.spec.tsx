import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProcessDisclosure } from "../src/components/qa/process-disclosure";

describe("ProcessDisclosure", () => {
  it("renders Think and tool details collapsed by default with native button semantics", () => {
    const html = renderToStaticMarkup(
      <ProcessDisclosure
        row={{
          id: "run:1",
          runId: "10000000-0000-4000-8000-000000000001",
          sequence: 1,
          kind: "tool",
          title: "Research Kernel",
          summary: "执行研究协议",
          status: "RUNNING",
          input: "dataset=orders",
          output: null,
          durationMs: null,
          toolName: "research.kernel",
        }}
      />,
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("research.kernel");
    expect(html).not.toContain("dataset=orders");
  });
});
