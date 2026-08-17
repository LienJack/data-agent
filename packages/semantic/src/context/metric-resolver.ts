import {
  type PublishedMetricContext,
  type ResolvedContextClarification,
  sha256ContentHash,
} from "@data-agent/contracts";

function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function phraseOccurs(question: string, phrase: string): boolean {
  const normalizedQuestion = `_${normalizePhrase(question)}_`;
  const normalizedPhrase = normalizePhrase(phrase);
  return normalizedPhrase.length > 0 && normalizedQuestion.includes(`_${normalizedPhrase}_`);
}

function metricKey(metric: PublishedMetricContext): string {
  return `${metric.metric_id}\0${metric.mapping_hash}`;
}

export interface PublishedMetricResolution {
  readonly matches: readonly PublishedMetricContext[];
  readonly clarifications: readonly ResolvedContextClarification[];
}

export async function resolvePublishedMetric(
  question: string,
  metrics: readonly PublishedMetricContext[],
): Promise<PublishedMetricResolution> {
  const canonical = [...metrics].sort((left, right) =>
    metricKey(left).localeCompare(metricKey(right)),
  );
  const matches = canonical.filter((metric) =>
    [metric.name, ...metric.aliases].some((phrase) => phraseOccurs(question, phrase)),
  );
  const clarifications = await Promise.all(
    matches.map(async (metric) => ({
      candidate_id: metric.metric_id,
      candidate_kind: "METRIC" as const,
      label: metric.name,
      candidate_hash: await sha256ContentHash(metric),
    })),
  );
  return Object.freeze({
    matches: Object.freeze(matches),
    clarifications: Object.freeze(clarifications),
  });
}

export { normalizePhrase as normalizeContextPhrase, phraseOccurs as contextPhraseOccurs };
