import {
  buildResolvedContextPackageV3,
  buildSemanticInferenceReceipt,
  buildSemanticRetrievalReceipt,
  sha256ContentHash,
  type ResolvedContextAuthoritySnapshot,
  type ResolvedContextPackageV3,
  type SemanticRetrievalHit,
} from "@data-agent/contracts";
import { resolveContextPackage } from "./resolver.js";

const RRF_K = 60 as const;
const MAX_HOPS = 3;
const MAX_NODES = 80;
const MAX_EDGES = 160;

type SearchDocument = Readonly<{
  object_id: string;
  object_kind: "METRIC" | "ONTOLOGY" | "RELATIONSHIP" | "KNOWLEDGE";
  object_hash: string;
  name: string;
  aliases: readonly string[];
}>;

export interface SemanticVectorSearchPort {
  search(input: Readonly<{
    question: string;
    question_hash: string;
    release_hash: string;
    allowed_object_ids: readonly string[];
    limit: number;
  }>): Promise<readonly { readonly object_id: string; readonly score: number }[]>;
}

export interface HybridResolvedContextOptions {
  readonly vector?: SemanticVectorSearchPort;
  readonly max_nodes?: number;
  readonly max_edges?: number;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/g, " ").trim();
}

function tokens(value: string): ReadonlySet<string> {
  const normalized = normalize(value);
  const result = new Set(normalized.match(/[\p{L}\p{N}_]+/gu) ?? []);
  const cjk = [...normalized].filter((character) => /\p{Script=Han}/u.test(character));
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    result.add(`${cjk[index]}${cjk[index + 1]}`);
  }
  return result;
}

function overlapScore(question: ReadonlySet<string>, document: ReadonlySet<string>): number {
  if (question.size === 0 || document.size === 0) return 0;
  let overlap = 0;
  for (const token of question) if (document.has(token)) overlap += 1;
  return overlap / Math.sqrt(question.size * document.size);
}

function documents(snapshot: ResolvedContextAuthoritySnapshot): readonly SearchDocument[] {
  const metricDocuments = snapshot.published_metrics.map((metric) => ({
    object_id: metric.metric_id,
    object_kind: "METRIC" as const,
    object_hash: metric.mapping_hash,
    name: metric.name,
    aliases: metric.aliases,
  }));
  const ontologyDocuments = snapshot.published_ontology.map((object) => ({
    object_id: object.object_id,
    object_kind: "ONTOLOGY" as const,
    object_hash: object.object_hash,
    name: object.name,
    aliases: object.aliases,
  }));
  const relationshipDocuments = snapshot.published_relationships.map((relationship) => ({
    object_id: relationship.relationship_id,
    object_kind: "RELATIONSHIP" as const,
    object_hash: relationship.relationship_hash,
    name: relationship.relationship_kind,
    aliases: [relationship.source_object_id, relationship.target_object_id],
  }));
  const knowledgeDocuments = snapshot.knowledge_refs.map((reference) => ({
    object_id: reference.resource_id,
    object_kind: "KNOWLEDGE" as const,
    object_hash: reference.resource_hash,
    name: reference.resource_id,
    aliases: [] as readonly string[],
  }));
  return [...metricDocuments, ...ontologyDocuments, ...relationshipDocuments, ...knowledgeDocuments]
    .sort((left, right) => left.object_id.localeCompare(right.object_id));
}

function rankedRoute(
  route: "LEXICON" | "SPARSE" | "VECTOR",
  ranked: readonly { readonly document: SearchDocument; readonly score: number }[],
): readonly SemanticRetrievalHit[] {
  return [...ranked]
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.document.object_id.localeCompare(right.document.object_id))
    .slice(0, 128)
    .map(({ document, score }, index) => ({
      object_id: document.object_id,
      object_kind: document.object_kind,
      object_hash: document.object_hash,
      route,
      rank: index + 1,
      route_score: Math.min(1, Math.max(0, score)),
      rrf_score: 1 / (RRF_K + index + 1),
      matched_text: document.name,
    }));
}

function isMandatoryRelationship(kind: string): boolean {
  return /(FORMULA|DEPEND|JOIN|LINEAGE|TIME|POLICY|QUALITY|BIND|MAP)/iu.test(kind);
}

export async function resolveHybridContextPackage(
  snapshot: ResolvedContextAuthoritySnapshot,
  options: HybridResolvedContextOptions = {},
): Promise<ResolvedContextPackageV3> {
  const basePackage = await resolveContextPackage(snapshot);
  const corpus = documents(snapshot);
  const corpusById = new Map(corpus.map((document) => [document.object_id, document]));
  const normalizedQuestion = normalize(snapshot.question);
  const questionTokens = tokens(snapshot.question);

  const lexicalHits = rankedRoute(
    "LEXICON",
    corpus.flatMap((document) => {
      const phrases = [document.name, ...document.aliases].map(normalize).filter(Boolean);
      const exact = phrases.some(
        (phrase) => normalizedQuestion.includes(phrase) || phrase.includes(normalizedQuestion),
      );
      return exact ? [{ document, score: 1 }] : [];
    }),
  );
  const sparseHits = rankedRoute(
    "SPARSE",
    corpus.map((document) => ({
      document,
      score: overlapScore(questionTokens, tokens([document.name, ...document.aliases].join(" "))),
    })),
  );

  const fallbackReasonCodes = new Set<string>();
  let vectorHits: readonly SemanticRetrievalHit[] = [];
  let vectorState: "READY" | "DEGRADED" | "UNAVAILABLE" = "UNAVAILABLE";
  if (options.vector) {
    try {
      const vector = await options.vector.search({
        question: snapshot.question,
        question_hash: snapshot.question_hash,
        release_hash: snapshot.semantic_release.resource_hash,
        allowed_object_ids: corpus.map(({ object_id }) => object_id),
        limit: 128,
      });
      vectorHits = rankedRoute(
        "VECTOR",
        vector.flatMap(({ object_id, score }) => {
          const document = corpusById.get(object_id);
          return document && Number.isFinite(score) && score > 0 ? [{ document, score }] : [];
        }),
      );
      vectorState = "READY";
    } catch {
      vectorState = "DEGRADED";
      fallbackReasonCodes.add("VECTOR_ROUTE_POSTGRES_FALLBACK");
    }
  } else {
    fallbackReasonCodes.add("VECTOR_ROUTE_NOT_CONFIGURED");
  }

  const allHits = [...lexicalHits, ...sparseHits, ...vectorHits];
  const fused = new Map<string, number>();
  for (const hit of allHits) fused.set(hit.object_id, (fused.get(hit.object_id) ?? 0) + hit.rrf_score);
  const rankedObjectIds = [...fused.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([objectId]) => objectId);
  for (const objectId of [
    ...(basePackage.route_decision.selected_metric_id
      ? [basePackage.route_decision.selected_metric_id]
      : []),
    ...basePackage.route_decision.selected_ontology_ids,
  ]) {
    if (!rankedObjectIds.includes(objectId)) rankedObjectIds.unshift(objectId);
  }

  const adjacency = new Map<string, typeof snapshot.published_relationships>();
  for (const relationship of snapshot.published_relationships) {
    for (const endpoint of [relationship.source_object_id, relationship.target_object_id]) {
      adjacency.set(endpoint, [...(adjacency.get(endpoint) ?? []), relationship]);
    }
  }
  const seeds = rankedObjectIds.slice(0, 16);
  const visited = new Map(seeds.map((seed) => [seed, 0]));
  const expansions: Array<{
    relationship_id: string;
    relationship_hash: string;
    relationship_kind: string;
    source_object_id: string;
    target_object_id: string;
    direction: "OUTBOUND" | "INBOUND";
    hop: number;
    mandatory: boolean;
  }> = [];
  const seenEdges = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const hop = visited.get(current) ?? 0;
    if (hop >= MAX_HOPS) continue;
    for (const relationship of [...(adjacency.get(current) ?? [])].sort((left, right) =>
      left.relationship_id.localeCompare(right.relationship_id),
    )) {
      if (!seenEdges.has(relationship.relationship_id)) {
        seenEdges.add(relationship.relationship_id);
        expansions.push({
          relationship_id: relationship.relationship_id,
          relationship_hash: relationship.relationship_hash,
          relationship_kind: relationship.relationship_kind,
          source_object_id: relationship.source_object_id,
          target_object_id: relationship.target_object_id,
          direction: relationship.source_object_id === current ? "OUTBOUND" : "INBOUND",
          hop: hop + 1,
          mandatory: isMandatoryRelationship(relationship.relationship_kind),
        });
      }
      const next =
        relationship.source_object_id === current
          ? relationship.target_object_id
          : relationship.source_object_id;
      if (!visited.has(next)) {
        visited.set(next, hop + 1);
        queue.push(next);
      }
    }
  }

  const mandatoryEdges = expansions.filter(({ mandatory }) => mandatory);
  const mandatoryObjects = new Set<string>(seeds);
  for (const edge of mandatoryEdges) {
    mandatoryObjects.add(edge.source_object_id);
    mandatoryObjects.add(edge.target_object_id);
  }
  const maxNodes = Math.min(options.max_nodes ?? MAX_NODES, MAX_NODES);
  const maxEdges = Math.min(options.max_edges ?? MAX_EDGES, MAX_EDGES);
  if (mandatoryObjects.size > maxNodes || mandatoryEdges.length > maxEdges) {
    throw new TypeError("SEMANTIC_MANDATORY_CLOSURE_CAPACITY_EXCEEDED");
  }
  const selectedObjects = new Set([...mandatoryObjects]);
  for (const objectId of [...rankedObjectIds, ...visited.keys()]) {
    if (selectedObjects.size >= maxNodes) break;
    selectedObjects.add(objectId);
  }
  const selectedExpansions = [
    ...mandatoryEdges,
    ...expansions.filter(({ mandatory }) => !mandatory),
  ]
    .filter(
      (edge) =>
        selectedObjects.has(edge.source_object_id) && selectedObjects.has(edge.target_object_id),
    )
    .slice(0, maxEdges)
    .sort((left, right) => left.relationship_id.localeCompare(right.relationship_id));
  const selectedObjectIds = [...selectedObjects].sort();
  const prunedObjectIds = [...visited.keys()]
    .filter((objectId) => !selectedObjects.has(objectId))
    .sort();

  const retrievalReceipt = await buildSemanticRetrievalReceipt({
    schema_version: "semantic-retrieval-receipt@1.0.0",
    authority_snapshot_hash: snapshot.snapshot_hash,
    release_hash: snapshot.semantic_release.resource_hash,
    query_hash: snapshot.question_hash,
    rrf_k: RRF_K,
    route_states: {
      LEXICON: "READY",
      SPARSE: "READY",
      VECTOR: vectorState,
      GRAPH: snapshot.published_relationships.length > 0 ? "READY" : "UNAVAILABLE",
    },
    hits: allHits.sort(
      (left, right) =>
        left.route.localeCompare(right.route) || left.rank - right.rank || left.object_id.localeCompare(right.object_id),
    ),
    expansions: selectedExpansions,
    selected_object_ids: selectedObjectIds,
    pruned_object_ids: prunedObjectIds,
    fallback_reason_codes: [...fallbackReasonCodes].sort(),
  });
  const mandatoryRelationshipIds = mandatoryEdges
    .map(({ relationship_id }) => relationship_id)
    .filter((relationshipId) => selectedExpansions.some(({ relationship_id }) => relationship_id === relationshipId))
    .sort();
  const rulesetHash = await sha256ContentHash({
    ruleset_id: "semantic-mandatory-closure@1",
    mandatory_patterns: ["FORMULA", "DEPEND", "JOIN", "LINEAGE", "TIME", "POLICY", "QUALITY", "BIND", "MAP"],
    max_hops: MAX_HOPS,
  });
  const inferenceReceipt = await buildSemanticInferenceReceipt({
    schema_version: "semantic-inference-receipt@1.0.0",
    retrieval_receipt_hash: retrievalReceipt.receipt_hash,
    ruleset_id: "semantic-mandatory-closure@1",
    ruleset_hash: rulesetHash,
    steps: mandatoryEdges
      .filter(({ relationship_id }) => mandatoryRelationshipIds.includes(relationship_id))
      .map((edge) => ({
        inference_id: `closure:${edge.relationship_id}`,
        rule_id: "typed-relationship-closure@1",
        premise_object_ids: [edge.source_object_id].sort(),
        conclusion_object_ids: [edge.target_object_id].sort(),
        relationship_path_ids: [edge.relationship_id],
        mandatory: true,
        explanation: `${edge.relationship_kind} requires both relationship endpoints in context.`,
      })),
    mandatory_object_ids: [...mandatoryObjects].sort(),
    mandatory_relationship_ids: mandatoryRelationshipIds,
    closure_complete: true,
    reason_codes: [],
  });
  const closureHash = await sha256ContentHash({
    object_ids: inferenceReceipt.mandatory_object_ids,
    relationship_ids: inferenceReceipt.mandatory_relationship_ids,
  });
  const analysisCapabilities = snapshot.published_metrics.length > 0
    ? [
        "TREND_CHANGE",
        "CONTRIBUTION",
        "CONCENTRATION",
        "ROBUST_ANOMALY",
        "ASSOCIATION",
        "FORECAST",
      ] as const
    : [];
  return buildResolvedContextPackageV3({
    schema_version: "resolved-context-package@3.0.0",
    base_package: basePackage,
    retrieval_receipt: retrievalReceipt,
    inference_receipt: inferenceReceipt,
    mandatory_closure: {
      object_ids: inferenceReceipt.mandatory_object_ids,
      relationship_ids: inferenceReceipt.mandatory_relationship_ids,
      closure_hash: closureHash,
    },
    analysis_capabilities: analysisCapabilities,
  });
}
