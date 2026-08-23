import type { KnowledgeUsageReference } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { knowledgeUsageIdentity } from "../src/components/knowledge/knowledge-workspace";

const digest = `sha256:${"a".repeat(64)}` as const;

function usage(blockId: string): KnowledgeUsageReference {
  return {
    usage_kind: "CANDIDATE_REVISION",
    semantic_domain: "ecommerce",
    subject_id: "7d120257-1363-4666-80d5-cffda7e12ecd",
    subject_revision: 1,
    subject_hash: digest,
    evidence_ref: {
      document_ref: {
        document_id: "00000000-0000-5000-8000-000000006707",
        revision: 1,
        canonical_markdown_hash: digest,
      },
      block_id: blockId,
      block_hash: digest,
    },
  };
}

describe("Knowledge usage row identity", () => {
  it("distinguishes the same Candidate revision when it uses different evidence blocks", () => {
    const identities = [
      knowledgeUsageIdentity(usage("00000000-0000-5000-8000-000000006708")),
      knowledgeUsageIdentity(usage("00000000-0000-5000-8000-000000006709")),
    ];

    expect(new Set(identities)).toHaveLength(2);
  });
});
