import { describe, expect, it } from "vitest";
import {
  buildSemanticLexicalEntry,
  semanticLexicalEntrySchema,
  verifySemanticLexicalEntry,
} from "../src/context/semantic-retrieval.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

const releaseRef = {
  resource_id: id(1),
  resource_revision: 3,
  resource_hash: hash("1"),
};

describe("published semantic lexicon contracts", () => {
  it("builds deterministic exact-release lexical evidence", async () => {
    const input = {
      schema_version: "semantic-lexical-entry@1.0.0",
      release_ref: releaseRef,
      target_kind: "METRIC",
      target_id: "gross_revenue",
      term_id: "term_gmv",
      match_kind: "SYNONYM",
      phrase: " 交易额 ",
    } as const;
    const first = await buildSemanticLexicalEntry(input);
    const second = await buildSemanticLexicalEntry(input);
    expect(first).toEqual(second);
    expect(first.phrase).toBe("交易额");
    await expect(verifySemanticLexicalEntry(first)).resolves.toEqual(first);
  });

  it("rejects evidence tampering and untyped RELATED links", async () => {
    const entry = await buildSemanticLexicalEntry({
      schema_version: "semantic-lexical-entry@1.0.0",
      release_ref: releaseRef,
      target_kind: "ONTOLOGY",
      target_id: "customer",
      term_id: null,
      match_kind: "ALIAS",
      phrase: "Buyer",
    });
    await expect(verifySemanticLexicalEntry({ ...entry, phrase: "Purchaser" })).rejects.toThrow(
      "SEMANTIC_LEXICAL_EVIDENCE_HASH_MISMATCH",
    );
    expect(semanticLexicalEntrySchema.safeParse({ ...entry, match_kind: "RELATED" }).success).toBe(
      false,
    );
  });

  it("requires an exact glossary term id for typed glossary matches", async () => {
    await expect(
      buildSemanticLexicalEntry({
        schema_version: "semantic-lexical-entry@1.0.0",
        release_ref: releaseRef,
        target_kind: "METRIC",
        target_id: "gross_revenue",
        term_id: null,
        match_kind: "ABBREVIATION",
        phrase: "GMV",
      }),
    ).rejects.toThrow("Glossary match kinds must bind an exact term id");
  });
});
