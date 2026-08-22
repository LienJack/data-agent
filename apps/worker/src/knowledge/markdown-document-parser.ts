import {
  appScopeSchema,
  buildKnowledgeDocumentBlock,
  buildKnowledgeDocumentRevision,
  deriveKnowledgeDocumentUuid,
  type KnowledgeDocumentBlock,
  type KnowledgeDocumentBlockKind,
  type KnowledgeDocumentRevision,
  knowledgeBaseReferenceSchema,
  knowledgeDocumentReferenceSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
  workspaceFileReferenceSchema,
} from "@data-agent/contracts";
import { z } from "zod";

const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

const parseMarkdownKnowledgeDocumentInputSchema = z.strictObject({
  scope: appScopeSchema,
  knowledge_base_ref: knowledgeBaseReferenceSchema,
  source_file_ref: workspaceFileReferenceSchema,
  document_revision: z.number().int().positive().safe(),
  parent_document_ref: knowledgeDocumentReferenceSchema.nullable(),
  parser_version: versionIdentifierSchema,
  policy_version: versionIdentifierSchema,
  markdown: z.string(),
  created_by_principal_id: z.uuid(),
  created_at: timestampSchema,
});

type LineRecord = Readonly<{
  text: string;
  number: number;
  startByte: number;
  endByte: number;
}>;

type ParsedBlock = Readonly<{
  kind: KnowledgeDocumentBlockKind;
  lines: readonly LineRecord[];
  headingAncestry: readonly string[];
}>;

function canonicalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n").normalize("NFC");
}

function indexLines(markdown: string): readonly LineRecord[] {
  const encoder = new TextEncoder();
  let startByte = 0;
  return markdown.split("\n").map((text, index, lines) => {
    const endByte = startByte + encoder.encode(text).byteLength;
    const line = Object.freeze({ text, number: index + 1, startByte, endByte });
    startByte = endByte + (index < lines.length - 1 ? 1 : 0);
    return line;
  });
}

function headingMatch(text: string): RegExpMatchArray | null {
  return text.match(/^ {0,3}(#{1,6})[\t ]+(.+?)[\t ]*#*[\t ]*$/);
}

function fenceMatch(text: string): RegExpMatchArray | null {
  return text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
}

function listItem(text: string): boolean {
  return /^\s{0,3}(?:[-+*]|\d{1,9}[.)])[\t ]+\S/.test(text);
}

function tableDelimiter(text: string): boolean {
  const cells = text.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length >= 2 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function tableStart(lines: readonly LineRecord[], index: number): boolean {
  const header = lines[index]?.text ?? "";
  const delimiter = lines[index + 1]?.text ?? "";
  return header.includes("|") && tableDelimiter(delimiter);
}

function startsStructuralBlock(lines: readonly LineRecord[], index: number): boolean {
  const text = lines[index]?.text ?? "";
  return (
    text.trim().length === 0 ||
    headingMatch(text) !== null ||
    fenceMatch(text) !== null ||
    listItem(text) ||
    tableStart(lines, index)
  );
}

function parseBlocks(lines: readonly LineRecord[]): readonly ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const headings: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.text.trim().length === 0) {
      index += 1;
      continue;
    }

    const heading = headingMatch(line.text);
    if (heading) {
      const marker = heading[1] ?? "#";
      const title = (heading[2] ?? "").trim().normalize("NFC");
      const level = marker.length;
      const ancestry = headings.slice(0, Math.max(0, level - 1));
      blocks.push({ kind: "HEADING", lines: [line], headingAncestry: ancestry });
      headings.length = Math.max(0, level - 1);
      headings[level - 1] = title;
      index += 1;
      continue;
    }

    const openingFence = fenceMatch(line.text);
    if (openingFence) {
      const marker = openingFence[1] ?? "```";
      const markerCharacter = marker[0] ?? "`";
      const minimumLength = marker.length;
      let cursor = index + 1;
      let closed = false;
      while (cursor < lines.length) {
        const candidate = lines[cursor]?.text ?? "";
        const closing = candidate.match(/^ {0,3}(`+|~+)[\t ]*$/)?.[1];
        if (closing && closing[0] === markerCharacter && closing.length >= minimumLength) {
          closed = true;
          break;
        }
        cursor += 1;
      }
      if (!closed) throw new TypeError("KNOWLEDGE_MARKDOWN_FENCE_UNTERMINATED");
      blocks.push({
        kind: "CODE",
        lines: lines.slice(index, cursor + 1),
        headingAncestry: [...headings],
      });
      index = cursor + 1;
      continue;
    }

    if (tableStart(lines, index)) {
      let cursor = index + 2;
      while (cursor < lines.length) {
        const candidate = lines[cursor]?.text ?? "";
        if (candidate.trim().length === 0 || !candidate.includes("|")) break;
        cursor += 1;
      }
      blocks.push({
        kind: "TABLE",
        lines: lines.slice(index, cursor),
        headingAncestry: [...headings],
      });
      index = cursor;
      continue;
    }

    if (listItem(line.text)) {
      let cursor = index + 1;
      while (cursor < lines.length) {
        const candidate = lines[cursor]?.text ?? "";
        if (candidate.trim().length === 0) break;
        if (headingMatch(candidate) || fenceMatch(candidate) || tableStart(lines, cursor)) break;
        if (!listItem(candidate) && !/^\s{2,}\S/.test(candidate)) break;
        cursor += 1;
      }
      blocks.push({
        kind: "LIST",
        lines: lines.slice(index, cursor),
        headingAncestry: [...headings],
      });
      index = cursor;
      continue;
    }

    let cursor = index + 1;
    while (cursor < lines.length && !startsStructuralBlock(lines, cursor)) cursor += 1;
    blocks.push({
      kind: "PARAGRAPH",
      lines: lines.slice(index, cursor),
      headingAncestry: [...headings],
    });
    index = cursor;
  }

  return blocks;
}

export async function parseMarkdownKnowledgeDocument(input: unknown): Promise<
  Readonly<{
    document: KnowledgeDocumentRevision;
    blocks: readonly KnowledgeDocumentBlock[];
  }>
> {
  const parsed = parseMarkdownKnowledgeDocumentInputSchema.parse(input);
  const canonicalMarkdown = canonicalizeMarkdown(parsed.markdown);
  const byteLength = new TextEncoder().encode(canonicalMarkdown).byteLength;
  if (byteLength > MAX_MARKDOWN_BYTES) {
    throw new TypeError("KNOWLEDGE_MARKDOWN_TOO_LARGE");
  }

  const canonicalMarkdownHash = await sha256ContentHash(canonicalMarkdown);
  const documentId = await deriveKnowledgeDocumentUuid({
    namespace: "knowledge-document@1.0.0",
    scope: parsed.scope,
    knowledge_base_id: parsed.knowledge_base_ref.knowledge_base_id,
    source_file_id: parsed.source_file_ref.file_id,
  });
  const documentRef = {
    document_id: documentId,
    revision: parsed.document_revision,
    canonical_markdown_hash: canonicalMarkdownHash,
  } as const;
  const parsedBlocks = parseBlocks(indexLines(canonicalMarkdown));
  if (parsedBlocks.length === 0) throw new TypeError("KNOWLEDGE_MARKDOWN_EMPTY");
  const blocks: KnowledgeDocumentBlock[] = [];

  for (const [ordinal, block] of parsedBlocks.entries()) {
    const firstLine = block.lines[0];
    const lastLine = block.lines.at(-1);
    if (!firstLine || !lastLine) throw new TypeError("KNOWLEDGE_MARKDOWN_BLOCK_EMPTY");
    const canonicalText = block.lines.map((line) => line.text).join("\n");
    const normalizedTextHash = await sha256ContentHash(canonicalText);
    const blockId = await deriveKnowledgeDocumentUuid({
      namespace: "knowledge-document-block@1.0.0",
      document_ref: documentRef,
      kind: block.kind,
      heading_ancestry: block.headingAncestry,
      start_byte: firstLine.startByte,
      end_byte: lastLine.endByte,
      normalized_text_hash: normalizedTextHash,
      parser_version: parsed.parser_version,
    });
    blocks.push(
      await buildKnowledgeDocumentBlock({
        schema_version: "knowledge-document-block@1.0.0",
        scope: parsed.scope,
        knowledge_base_ref: parsed.knowledge_base_ref,
        document_ref: documentRef,
        source_file_ref: parsed.source_file_ref,
        block_id: blockId,
        kind: block.kind,
        ordinal,
        start_byte: firstLine.startByte,
        end_byte: lastLine.endByte,
        start_line: firstLine.number,
        end_line: lastLine.number,
        heading_ancestry: block.headingAncestry,
        canonical_text: canonicalText,
        normalized_text_hash: normalizedTextHash,
      }),
    );
  }

  const document = await buildKnowledgeDocumentRevision({
    schema_version: "knowledge-document-revision@1.0.0",
    scope: parsed.scope,
    knowledge_base_ref: parsed.knowledge_base_ref,
    document_id: documentId,
    revision: parsed.document_revision,
    source_file_ref: parsed.source_file_ref,
    parent_document_ref: parsed.parent_document_ref,
    parser_version: parsed.parser_version,
    policy_version: parsed.policy_version,
    canonical_markdown_hash: canonicalMarkdownHash,
    block_manifest_hash: await sha256ContentHash(blocks.map((block) => block.block_hash)),
    block_count: blocks.length,
    status: "READY",
    reason_code: null,
    created_by_principal_id: parsed.created_by_principal_id,
    created_at: parsed.created_at,
  });

  return Object.freeze({ document, blocks: Object.freeze(blocks) });
}
