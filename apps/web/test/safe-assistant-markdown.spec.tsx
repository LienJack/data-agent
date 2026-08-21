import type { ArtifactReference } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  artifactMarkdownHref,
  resolveAuthorizedMarkdownArtifact,
  SafeAssistantMarkdown,
  safeMarkdownUrlTransform,
} from "@/components/qa/safe-assistant-markdown";

const runId = "10000000-0000-4000-8000-000000000001";
const reference: ArtifactReference = {
  artifact_id: "20000000-0000-4000-8000-000000000001",
  artifact_type: "AnalysisReport",
  app_id: "30000000-0000-4000-8000-000000000001",
  tenant_id: "40000000-0000-4000-8000-000000000001",
  environment: "test",
  run_id: runId,
  revision: 2,
  content_hash: `sha256:${"a".repeat(64)}`,
};

describe("SafeAssistantMarkdown", () => {
  it("renders structured CJK Markdown with accessible hierarchy and GFM", () => {
    const html = renderToStaticMarkup(
      <SafeAssistantMarkdown
        content={`# 核心结论\n\n**订单下降**，需要继续验证。\n\n- [x] 已核验\n- [ ] 待核验\n\n> 仅展示公开证据。\n\n| 指标 | 数值 |\n| --- | ---: |\n| 订单 | 42 |\n\n\`\`\`sql\nselect 42;\n\`\`\`\n\n[官方资料](https://example.com/docs)`}
      />,
    );

    expect(html).toContain("<h2");
    expect(html).toContain("核心结论</h2>");
    expect(html).toContain('class="font-semibold">订单下降</strong>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
    expect(html).toContain("<blockquote");
    expect(html).toContain('aria-label="Markdown 表格"');
    expect(html).toContain('data-language="sql"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("drops raw HTML and blocks executable links and all Markdown images", () => {
    const html = renderToStaticMarkup(
      <SafeAssistantMarkdown
        content={`<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))\n\n![远程图](https://example.com/tracker.png)`}
      />,
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).toContain('data-blocked-image="true"');
    expect(html).toContain("图片已阻止：远程图");
  });

  it("authorizes only the exact prior ArtifactReference tuple", () => {
    const href = artifactMarkdownHref(reference);
    expect(resolveAuthorizedMarkdownArtifact(href, [reference], runId)).toEqual(reference);
    expect(resolveAuthorizedMarkdownArtifact(href, [reference], reference.app_id)).toBeNull();
    expect(
      resolveAuthorizedMarkdownArtifact(
        href.replace("revision=2", "revision=3"),
        [reference],
        runId,
      ),
    ).toBeNull();
    expect(safeMarkdownUrlTransform(href, "href", null as never)).toBe(href);
    expect(safeMarkdownUrlTransform("javascript:alert(1)", "href", null as never)).toBe("");

    const html = renderToStaticMarkup(
      <SafeAssistantMarkdown
        runId={runId}
        sequence={12}
        artifactReferences={[reference]}
        content={`[打开报告](${href}) [伪造报告](${href.replace("revision=2", "revision=3")})`}
      />,
    );
    expect(html).toContain("qa-markdown-artifact");
    expect(html).toContain("打开报告</button>");
    expect(html).toContain('data-blocked-link="true"');
  });

  it("marks a partial answer as busy without adding an extra heading level", () => {
    const html = renderToStaticMarkup(<SafeAssistantMarkdown content="正在生成" streaming />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("<h1");
  });
});
