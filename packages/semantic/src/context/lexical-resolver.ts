import {
  normalizeSemanticLexicalPhrase,
  type ResolvedContextAuthoritySnapshot,
  type ResolvedContextClarification,
  type SemanticLexicalEntry,
  semanticLexicalEntryKey,
  semanticLexicalMatchRank,
  sha256ContentHash,
} from "@data-agent/contracts";

function phraseOccurs(normalizedQuestion: string, normalizedPhrase: string): boolean {
  if ([...normalizedPhrase].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) {
    return normalizedQuestion.includes(normalizedPhrase);
  }
  let offset = normalizedQuestion.indexOf(normalizedPhrase);
  while (offset >= 0) {
    const before = normalizedQuestion[offset - 1] ?? "";
    const after = normalizedQuestion[offset + normalizedPhrase.length] ?? "";
    if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) return true;
    offset = normalizedQuestion.indexOf(normalizedPhrase, offset + 1);
  }
  return false;
}

function compareEntries(left: SemanticLexicalEntry, right: SemanticLexicalEntry): number {
  const leftKey = semanticLexicalEntryKey(left);
  const rightKey = semanticLexicalEntryKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export interface SemanticLexicalResolution {
  readonly matches: readonly SemanticLexicalEntry[];
  readonly clarifications: readonly ResolvedContextClarification[];
}

export async function resolvePublishedLexicon(
  snapshot: ResolvedContextAuthoritySnapshot,
): Promise<SemanticLexicalResolution> {
  const normalizedQuestion = normalizeSemanticLexicalPhrase(snapshot.question);
  const matching = snapshot.published_lexicon.filter((entry) =>
    phraseOccurs(normalizedQuestion, normalizeSemanticLexicalPhrase(entry.phrase)),
  );
  const topRank = matching.reduce(
    (rank, entry) => Math.min(rank, semanticLexicalMatchRank[entry.match_kind]),
    Number.POSITIVE_INFINITY,
  );
  const strongest = matching
    .filter((entry) => semanticLexicalMatchRank[entry.match_kind] === topRank)
    .sort(compareEntries);
  const targets = new Map<string, SemanticLexicalEntry>();
  for (const entry of strongest) {
    const targetKey = `${entry.target_kind}\0${entry.target_id}`;
    if (!targets.has(targetKey)) targets.set(targetKey, entry);
  }
  const matches = [...targets.values()].sort(compareEntries);
  const clarifications = await Promise.all(
    matches.map(async (entry) => {
      const target =
        entry.target_kind === "METRIC"
          ? snapshot.published_metrics.find((metric) => metric.metric_id === entry.target_id)
          : snapshot.published_ontology.find((object) => object.object_id === entry.target_id);
      if (!target) throw new TypeError("SEMANTIC_LEXICAL_TARGET_NOT_FOUND");
      return {
        candidate_id: entry.target_id,
        candidate_kind: entry.target_kind,
        label: target.name,
        candidate_hash: await sha256ContentHash(target),
        match_kind: entry.match_kind,
        matched_phrase: entry.phrase,
        lexical_evidence_hash: entry.evidence_hash,
      } satisfies ResolvedContextClarification;
    }),
  );
  return Object.freeze({
    matches: Object.freeze(matches),
    clarifications: Object.freeze(clarifications),
  });
}
