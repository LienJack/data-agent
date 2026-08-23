import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import { effectiveSemanticReleaseSchema } from "../runs/effective-config.js";

export const semanticLexicalMatchKindSchema = z.enum([
  "CANONICAL",
  "PREFERRED",
  "ALIAS",
  "SYNONYM",
  "ABBREVIATION",
]);

export const semanticLexicalTargetKindSchema = z.enum(["METRIC", "ONTOLOGY"]);

export const semanticLexicalReleaseReferenceSchema = effectiveSemanticReleaseSchema.pick({
  resource_id: true,
  resource_revision: true,
  resource_hash: true,
});

export function normalizeSemanticLexicalPhrase(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

const semanticLexicalEntryMaterialSchema = z
  .strictObject({
    schema_version: z.literal("semantic-lexical-entry@1.0.0"),
    release_ref: semanticLexicalReleaseReferenceSchema,
    target_kind: semanticLexicalTargetKindSchema,
    target_id: versionIdentifierSchema,
    term_id: versionIdentifierSchema.nullable(),
    match_kind: semanticLexicalMatchKindSchema,
    phrase: z.string().trim().min(1).max(256),
  })
  .superRefine((entry, ctx) => {
    const termMatch = ["PREFERRED", "SYNONYM", "ABBREVIATION"].includes(entry.match_kind);
    if (termMatch !== (entry.term_id !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "Glossary match kinds must bind an exact term id.",
        path: ["term_id"],
      });
    }
    if (normalizeSemanticLexicalPhrase(entry.phrase).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Lexical phrase must contain a letter or number.",
        path: ["phrase"],
      });
    }
  });

export const semanticLexicalEntrySchema = semanticLexicalEntryMaterialSchema.extend({
  evidence_hash: contentHashSchema,
});

export const semanticLexicalMatchRank = {
  CANONICAL: 0,
  PREFERRED: 1,
  ALIAS: 2,
  SYNONYM: 2,
  ABBREVIATION: 3,
} as const satisfies Record<z.infer<typeof semanticLexicalMatchKindSchema>, number>;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function semanticLexicalEntryKey(entry: z.infer<typeof semanticLexicalEntrySchema>): string {
  return [
    String(semanticLexicalMatchRank[entry.match_kind]).padStart(2, "0"),
    entry.evidence_hash,
  ].join("\0");
}

export const canonicalSemanticLexicalEntriesSchema = z
  .array(semanticLexicalEntrySchema)
  .max(200_000)
  .superRefine((entries, ctx) => {
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (
        previous &&
        current &&
        compareCodeUnits(semanticLexicalEntryKey(previous), semanticLexicalEntryKey(current)) >= 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Lexical entries must be unique and canonically sorted.",
          path: [index],
        });
      }
    }
  });

export async function computeSemanticLexicalEntryHash(input: unknown) {
  return sha256ContentHash(semanticLexicalEntryMaterialSchema.parse(input));
}

export async function buildSemanticLexicalEntry(input: unknown) {
  const candidate = z
    .strictObject({
      schema_version: z.literal("semantic-lexical-entry@1.0.0"),
      release_ref: semanticLexicalReleaseReferenceSchema,
      target_kind: semanticLexicalTargetKindSchema,
      target_id: versionIdentifierSchema,
      term_id: versionIdentifierSchema.nullable(),
      match_kind: semanticLexicalMatchKindSchema,
      phrase: z.string().trim().min(1).max(256),
    })
    .parse(input);
  const material = semanticLexicalEntryMaterialSchema.parse(candidate);
  return deepFreeze(
    semanticLexicalEntrySchema.parse({
      ...material,
      evidence_hash: await computeSemanticLexicalEntryHash(material),
    }),
  );
}

export async function verifySemanticLexicalEntry(input: unknown) {
  const entry = semanticLexicalEntrySchema.parse(input);
  const { evidence_hash: _evidenceHash, ...material } = entry;
  if ((await computeSemanticLexicalEntryHash(material)) !== entry.evidence_hash) {
    throw new TypeError("SEMANTIC_LEXICAL_EVIDENCE_HASH_MISMATCH");
  }
  return deepFreeze(entry);
}

export type SemanticLexicalEntry = z.infer<typeof semanticLexicalEntrySchema>;
export type SemanticLexicalMatchKind = z.infer<typeof semanticLexicalMatchKindSchema>;
export type SemanticLexicalTargetKind = z.infer<typeof semanticLexicalTargetKindSchema>;
