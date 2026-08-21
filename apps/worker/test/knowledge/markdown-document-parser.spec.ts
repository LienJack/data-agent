import { describe, expect, it } from "vitest";
import { parseMarkdownKnowledgeDocument } from "../../src/knowledge/markdown-document-parser.js";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const input = {
  scope: {
    app_id: "00000000-0000-4000-8000-00000000a001",
    tenant_id: "00000000-0000-4000-8000-00000000b001",
    environment: "local",
  },
  knowledge_base_ref: {
    knowledge_base_id: "00000000-0000-4000-8000-00000000c001",
    revision: 1,
    revision_hash: hash("1"),
  },
  source_file_ref: {
    file_id: "00000000-0000-4000-8000-00000000f001",
    revision: 1,
    revision_hash: hash("2"),
  },
  document_revision: 1,
  parent_document_ref: null,
  parser_version: "knowledge-markdown-parser@1.0.0",
  policy_version: "knowledge-document-policy@1.0.0",
  created_by_principal_id: "00000000-0000-4000-8000-00000000a101",
  created_at: "2026-08-21T00:00:00.000Z",
};

describe("Markdown knowledge document parser", () => {
  it("creates selectable Chinese heading, paragraph, list, table and code blocks", async () => {
    const markdown = [
      "# 交易指标",
      "",
      "支付 GMV 不含退款订单。",
      "",
      "- 时间字段：paid_at",
      "- 粒度：订单",
      "",
      "| 字段 | 含义 |",
      "| --- | --- |",
      "| paid_at | 支付时间 |",
      "",
      "```sql",
      "sum(case when refunded = false then amount end)",
      "```",
      "",
    ].join("\r\n");

    const result = await parseMarkdownKnowledgeDocument({ ...input, markdown });
    expect(result.document.status).toBe("READY");
    expect(result.document.block_count).toBe(5);
    expect(result.blocks.map((block) => block.kind)).toEqual([
      "HEADING",
      "PARAGRAPH",
      "LIST",
      "TABLE",
      "CODE",
    ]);
    expect(result.blocks[1]?.heading_ancestry).toEqual(["交易指标"]);
    expect(result.blocks[3]?.canonical_text).toContain("paid_at");
    expect(result.blocks[4]?.canonical_text).toContain("sum(case");
    expect(result.blocks.every((block) => block.end_byte > block.start_byte)).toBe(true);
  });

  it("normalizes CRLF/NFC and derives stable identities across retries", async () => {
    const first = await parseMarkdownKnowledgeDocument({
      ...input,
      markdown: "# Cafe\u0301\r\n\r\n定义\r\n",
    });
    const replay = await parseMarkdownKnowledgeDocument({ ...input, markdown: "# Café\n\n定义\n" });
    expect(replay.document).toEqual(first.document);
    expect(replay.blocks).toEqual(first.blocks);
  });

  it("fails closed for an unterminated fenced code block", async () => {
    await expect(
      parseMarkdownKnowledgeDocument({ ...input, markdown: "# 指标\n\n```sql\nselect 1" }),
    ).rejects.toThrow("KNOWLEDGE_MARKDOWN_FENCE_UNTERMINATED");
  });
});
