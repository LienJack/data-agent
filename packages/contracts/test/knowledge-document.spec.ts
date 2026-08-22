import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../src/common/index.js";
import {
  buildKnowledgeDocumentBlock,
  buildKnowledgeDocumentRevision,
  buildKnowledgeEvidenceSelection,
  verifyKnowledgeDocumentBlock,
  verifyKnowledgeDocumentCommitCommand,
  verifyKnowledgeDocumentRevision,
  verifyKnowledgeEvidenceSelection,
} from "../src/knowledge/knowledge-document.js";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const scope = {
  app_id: "00000000-0000-4000-8000-00000000a001",
  tenant_id: "00000000-0000-4000-8000-00000000b001",
  environment: "local",
};
const knowledgeBaseRef = {
  knowledge_base_id: "00000000-0000-4000-8000-00000000c001",
  revision: 2,
  revision_hash: hash("1"),
};
const sourceFileRef = {
  file_id: "00000000-0000-4000-8000-00000000f001",
  revision: 3,
  revision_hash: hash("2"),
};
const documentRef = {
  document_id: "00000000-0000-5000-8000-00000000d001",
  revision: 1,
  canonical_markdown_hash: hash("3"),
};

describe("knowledge document authority contracts", () => {
  it("builds and verifies an immutable document, selectable block and evidence selection", async () => {
    const block = await buildKnowledgeDocumentBlock({
      schema_version: "knowledge-document-block@1.0.0",
      scope,
      knowledge_base_ref: knowledgeBaseRef,
      document_ref: documentRef,
      source_file_ref: sourceFileRef,
      block_id: "00000000-0000-5000-8000-00000000e001",
      kind: "PARAGRAPH",
      ordinal: 0,
      start_byte: 8,
      end_byte: 20,
      start_line: 2,
      end_line: 2,
      heading_ancestry: ["指标定义"],
      canonical_text: "支付 GMV。",
      normalized_text_hash: await sha256ContentHash("支付 GMV。"),
    });
    await expect(verifyKnowledgeDocumentBlock(block)).resolves.toEqual(block);

    const revision = await buildKnowledgeDocumentRevision({
      schema_version: "knowledge-document-revision@1.0.0",
      scope,
      knowledge_base_ref: knowledgeBaseRef,
      document_id: documentRef.document_id,
      revision: documentRef.revision,
      source_file_ref: sourceFileRef,
      parent_document_ref: null,
      parser_version: "knowledge-markdown-parser@1.0.0",
      policy_version: "knowledge-document-policy@1.0.0",
      canonical_markdown_hash: documentRef.canonical_markdown_hash,
      block_manifest_hash: await sha256ContentHash([block.block_hash]),
      block_count: 1,
      status: "READY",
      reason_code: null,
      created_by_principal_id: "00000000-0000-4000-8000-00000000a101",
      created_at: "2026-08-21T00:00:00.000Z",
    });
    await expect(verifyKnowledgeDocumentRevision(revision)).resolves.toEqual(revision);
    await expect(
      verifyKnowledgeDocumentCommitCommand({
        schema_version: "knowledge-document-commit@1.0.0",
        document: revision,
        blocks: [block],
      }),
    ).resolves.toMatchObject({ document: { revision_hash: revision.revision_hash } });

    const selection = await buildKnowledgeEvidenceSelection({
      schema_version: "knowledge-evidence-selection@1.0.0",
      selection_id: "00000000-0000-4000-8000-00000000a201",
      scope,
      knowledge_base_ref: knowledgeBaseRef,
      intended_semantic_domain: "commerce.payment",
      block_refs: [
        {
          document_ref: documentRef,
          block_id: block.block_id,
          block_hash: block.block_hash,
        },
      ],
      selected_by_principal_id: "00000000-0000-4000-8000-00000000a101",
      selected_at: "2026-08-21T00:01:00.000Z",
    });
    await expect(verifyKnowledgeEvidenceSelection(selection)).resolves.toEqual(selection);
  });

  it("rejects mutable ranges, forged hashes and non-canonical selections", async () => {
    await expect(
      buildKnowledgeDocumentBlock({
        schema_version: "knowledge-document-block@1.0.0",
        scope,
        knowledge_base_ref: knowledgeBaseRef,
        document_ref: documentRef,
        source_file_ref: sourceFileRef,
        block_id: "00000000-0000-5000-8000-00000000e001",
        kind: "PARAGRAPH",
        ordinal: 0,
        start_byte: 20,
        end_byte: 8,
        start_line: 2,
        end_line: 2,
        heading_ancestry: [],
        canonical_text: "invalid",
        normalized_text_hash: await sha256ContentHash("invalid"),
      }),
    ).rejects.toThrow();

    const selectionInput = {
      schema_version: "knowledge-evidence-selection@1.0.0" as const,
      selection_id: "00000000-0000-4000-8000-00000000a201",
      scope,
      knowledge_base_ref: knowledgeBaseRef,
      intended_semantic_domain: "commerce.payment",
      block_refs: [
        {
          document_ref: documentRef,
          block_id: "00000000-0000-5000-8000-00000000e002",
          block_hash: hash("5"),
        },
        {
          document_ref: documentRef,
          block_id: "00000000-0000-5000-8000-00000000e001",
          block_hash: hash("4"),
        },
      ],
      selected_by_principal_id: "00000000-0000-4000-8000-00000000a101",
      selected_at: "2026-08-21T00:01:00.000Z",
    };
    await expect(buildKnowledgeEvidenceSelection(selectionInput)).rejects.toThrow();

    const valid = await buildKnowledgeEvidenceSelection({
      ...selectionInput,
      block_refs: [selectionInput.block_refs[1]],
    });
    await expect(
      verifyKnowledgeEvidenceSelection({ ...valid, selection_hash: hash("9") }),
    ).rejects.toThrow("KNOWLEDGE_EVIDENCE_SELECTION_HASH_MISMATCH");
  });
});
