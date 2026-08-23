import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  resolveWorkspaceId: () => "00000000-0000-4000-8000-000000006601",
}));

describe("FileAttachmentSelector", () => {
  it("renders an accessible attachment control with the selected READY count", async () => {
    const { FileAttachmentSelector } = await import(
      "../src/components/qa/file-attachment-selector"
    );
    const markup = renderToStaticMarkup(
      createElement(FileAttachmentSelector, {
        sessionId: "00000000-0000-4000-8000-000000006604",
        disabled: false,
        selected: [
          {
            file_id: "00000000-0000-4000-8000-000000006603",
            revision: 2,
            revision_hash: `sha256:${"a".repeat(64)}`,
          },
        ],
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('aria-label="选择工作空间附件"');
    expect(markup).toContain("附件 1");
    expect(markup).toContain("上传后需等待扫描完成");
    expect(markup).toContain('accept=".pdf,.docx,.txt,.md,.csv,.json"');
  });
});
