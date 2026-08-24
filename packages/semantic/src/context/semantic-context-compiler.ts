import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildSemanticContextPackage,
  buildSemanticInferenceReceipt,
  buildSemanticRetrievalReceipt,
  type SemanticContextAuthoritySnapshot,
  type SemanticContextPackage,
  type SemanticRetrievalHit,
} from "@data-agent/contracts/context";
import { compileSemanticContextCore } from "./semantic-context-core.js";
import {
  compileSemanticInference,
  relationshipRequiresClosure,
} from "./semantic-inference-engine.js";

const RRF_K = 60 as const;
const MAX_HOPS = 3;
const MAX_NODES = 80;
const MAX_EDGES = 160;
const MAX_OPTIONAL_NODES = 12;

type SearchDocument = Readonly<{
  object_id: string;
  object_kind: "METRIC" | "ONTOLOGY" | "RELATIONSHIP" | "KNOWLEDGE";
  object_hash: string;
  name: string;
  aliases: readonly string[];
}>;

export interface SemanticVectorSearchPort {
  search(
    input: Readonly<{
      question: string;
      question_hash: string;
      release_hash: string;
      allowed_object_ids: readonly string[];
      limit: number;
    }>,
  ): Promise<readonly { readonly object_id: string; readonly score: number }[]>;
}

export interface HybridSemanticContextOptions {
  readonly vector?: SemanticVectorSearchPort;
  readonly max_nodes?: number;
  readonly max_edges?: number;
  readonly max_optional_nodes?: number;
  readonly excluded_objects?: readonly Readonly<{
    object_id: string;
    reason_code:
      | "RBAC_DENIED"
      | "NOT_PUBLISHED"
      | "OUTSIDE_VALID_TIME"
      | "SENSITIVITY_DENIED"
      | "UNRESOLVED_CONFLICT";
  }>[];
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

function fuzzyVector(value: string): ReadonlyMap<string, number> {
  const normalized = normalize(value);
  const compact = normalized.replace(/\s+/g, "");
  const features = new Map<string, number>();
  const add = (feature: string) => features.set(feature, (features.get(feature) ?? 0) + 1);
  for (const token of tokens(normalized)) add(`token:${token}`);
  const characters = [...compact];
  for (const width of [2, 3]) {
    for (let index = 0; index + width <= characters.length; index += 1) {
      add(`char${width}:${characters.slice(index, index + width).join("")}`);
    }
  }
  return features;
}

function cosineScore(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const [feature, value] of right) {
    rightNorm += value * value;
    dot += (left.get(feature) ?? 0) * value;
  }
  return leftNorm > 0 && rightNorm > 0 ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function documents(snapshot: SemanticContextAuthoritySnapshot): readonly SearchDocument[] {
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
  return [
    ...metricDocuments,
    ...ontologyDocuments,
    ...relationshipDocuments,
    ...knowledgeDocuments,
  ].sort((left, right) => left.object_id.localeCompare(right.object_id));
}

/**
 * A release-bound fuzzy vector index for aliases and governed object labels. It is intentionally
 * deterministic so retrieval stays available when an external embedding service is absent.
 */
export function createDeterministicSemanticVectorSearch(
  snapshot: SemanticContextAuthoritySnapshot,
): SemanticVectorSearchPort {
  const releaseHash = snapshot.semantic_release.resource_hash;
  const indexed = documents(snapshot).map((document) => ({
    object_id: document.object_id,
    vector: fuzzyVector([document.name, ...document.aliases].join(" ")),
  }));
  return Object.freeze({
    async search(input: Parameters<SemanticVectorSearchPort["search"]>[0]) {
      if (input.release_hash !== releaseHash) {
        throw new TypeError("SEMANTIC_VECTOR_RELEASE_MISMATCH");
      }
      const allowed = new Set(input.allowed_object_ids);
      const query = fuzzyVector(input.question);
      return indexed
        .filter(({ object_id }) => allowed.has(object_id))
        .map(({ object_id, vector }) => ({ object_id, score: cosineScore(query, vector) }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || left.object_id.localeCompare(right.object_id),
        )
        .slice(0, input.limit);
    },
  });
}

function rankedRoute(
  route: "LEXICON" | "SPARSE" | "VECTOR",
  ranked: readonly { readonly document: SearchDocument; readonly score: number }[],
): readonly SemanticRetrievalHit[] {
  return [...ranked]
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.document.object_id.localeCompare(right.document.object_id),
    )
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

export async function compileSemanticContextPackage(
  snapshot: SemanticContextAuthoritySnapshot,
  options: HybridSemanticContextOptions = {},
): Promise<SemanticContextPackage> {
  const excludedById = new Map(
    (options.excluded_objects ?? []).map((entry) => [entry.object_id, entry.reason_code]),
  );
  const allowed = (objectId: string) => !excludedById.has(objectId);
  const filteredSnapshot: SemanticContextAuthoritySnapshot = {
    ...snapshot,
    published_metrics: snapshot.published_metrics.filter(({ metric_id }) => allowed(metric_id)),
    published_ontology: snapshot.published_ontology.filter(({ object_id }) => allowed(object_id)),
    published_relationships: snapshot.published_relationships.filter(
      ({ relationship_id, source_object_id, target_object_id }) =>
        allowed(relationship_id) && allowed(source_object_id) && allowed(target_object_id),
    ),
    published_lexicon: snapshot.published_lexicon.filter(({ target_id }) => allowed(target_id)),
    knowledge_refs: snapshot.knowledge_refs.filter(({ resource_id }) => allowed(resource_id)),
  };
  const core = await compileSemanticContextCore(filteredSnapshot);
  const corpus = documents(filteredSnapshot);
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
  for (const hit of allHits)
    fused.set(hit.object_id, (fused.get(hit.object_id) ?? 0) + hit.rrf_score);
  const rankedObjectIds = [...fused.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([objectId]) => objectId);
  for (const objectId of [
    ...(core.route_decision.selected_metric_id ? [core.route_decision.selected_metric_id] : []),
    ...core.route_decision.selected_ontology_ids,
  ]) {
    if (!rankedObjectIds.includes(objectId)) rankedObjectIds.unshift(objectId);
  }

  const adjacency = new Map<string, typeof filteredSnapshot.published_relationships>();
  for (const relationship of filteredSnapshot.published_relationships) {
    for (const endpoint of [relationship.source_object_id, relationship.target_object_id]) {
      adjacency.set(endpoint, [...(adjacency.get(endpoint) ?? []), relationship]);
    }
  }
  const routedSeeds = [
    ...(core.route_decision.selected_metric_id ? [core.route_decision.selected_metric_id] : []),
    ...core.route_decision.selected_ontology_ids,
  ].filter((objectId, index, values) => values.indexOf(objectId) === index);
  const seeds = routedSeeds.length > 0 ? routedSeeds : rankedObjectIds.slice(0, 4);
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
    const current = queue.shift();
    if (!current) continue;
    const hop = visited.get(current) ?? 0;
    if (hop >= MAX_HOPS) continue;
    for (const relationship of [...(adjacency.get(current) ?? [])].sort((left, right) =>
      left.relationship_id.localeCompare(right.relationship_id),
    )) {
      const mandatory = relationshipRequiresClosure(relationship.relationship_kind);
      if (mandatory && relationship.source_object_id !== current) continue;
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
          mandatory,
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

  const objectHashes = new Map(
    corpus.map(({ object_id, object_hash }) => [object_id, object_hash]),
  );
  const preliminaryInference = await compileSemanticInference({
    expansions,
    seed_object_ids: seeds,
    object_hashes: objectHashes,
    release_hash: snapshot.semantic_release.resource_hash,
    authority_snapshot_hash: snapshot.snapshot_hash,
  });
  const mandatoryEdges = expansions.filter(({ relationship_id }) =>
    preliminaryInference.mandatory_relationship_ids.includes(relationship_id),
  );
  const mandatoryObjects = new Set<string>(preliminaryInference.mandatory_object_ids);
  const maxNodes = Math.min(options.max_nodes ?? MAX_NODES, MAX_NODES);
  const maxEdges = Math.min(options.max_edges ?? MAX_EDGES, MAX_EDGES);
  if (mandatoryObjects.size > maxNodes || mandatoryEdges.length > maxEdges) {
    throw new TypeError("SEMANTIC_MANDATORY_CLOSURE_CAPACITY_EXCEEDED");
  }
  const selectedObjects = new Set([...mandatoryObjects]);
  const optionalLimit = Math.min(
    options.max_optional_nodes ?? MAX_OPTIONAL_NODES,
    maxNodes - mandatoryObjects.size,
  );
  let optionalCount = 0;
  for (const objectId of [...rankedObjectIds, ...visited.keys()]) {
    if (selectedObjects.has(objectId)) continue;
    if (optionalCount >= optionalLimit) break;
    selectedObjects.add(objectId);
    optionalCount += 1;
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
  const prunedObjectIds = corpus
    .map(({ object_id }) => object_id)
    .filter((objectId) => !selectedObjects.has(objectId))
    .sort();

  const retrievalReceipt = await buildSemanticRetrievalReceipt({
    schema_version: "semantic-retrieval-receipt@1.0.0",
    authority_snapshot_hash: snapshot.snapshot_hash,
    release_hash: snapshot.semantic_release.resource_hash,
    query_hash: snapshot.question_hash,
    rrf_k: RRF_K,
    hard_filter: {
      scope_hash: await sha256ContentHash(snapshot.scope),
      publication_status: "PUBLISHED",
      authority_mode: "POSTGRES_FILTERED_SNAPSHOT",
      included_object_ids: corpus.map(({ object_id }) => object_id).sort(),
      excluded_objects: [...excludedById.entries()]
        .map(([object_id, reason_code]) => ({ object_id, reason_code }))
        .sort((left, right) => left.object_id.localeCompare(right.object_id)),
    },
    route_states: {
      LEXICON: "READY",
      SPARSE: "READY",
      VECTOR: vectorState,
      GRAPH: filteredSnapshot.published_relationships.length > 0 ? "READY" : "UNAVAILABLE",
    },
    hits: allHits.sort(
      (left, right) =>
        left.route.localeCompare(right.route) ||
        left.rank - right.rank ||
        left.object_id.localeCompare(right.object_id),
    ),
    expansions: selectedExpansions,
    selected_object_ids: selectedObjectIds,
    pruned_object_ids: prunedObjectIds,
    fallback_reason_codes: [...fallbackReasonCodes].sort(),
  });
  const inference = await compileSemanticInference({
    expansions: selectedExpansions,
    seed_object_ids: seeds,
    object_hashes: objectHashes,
    release_hash: snapshot.semantic_release.resource_hash,
    authority_snapshot_hash: snapshot.snapshot_hash,
  });
  const inferenceReceipt = await buildSemanticInferenceReceipt({
    schema_version: "semantic-inference-receipt@1.0.0",
    retrieval_receipt_hash: retrievalReceipt.receipt_hash,
    ruleset_id: inference.ruleset_id,
    ruleset_hash: inference.ruleset_hash,
    steps: inference.steps,
    mandatory_object_ids: inference.mandatory_object_ids,
    mandatory_relationship_ids: inference.mandatory_relationship_ids,
    closure_complete: true,
    reason_codes: [],
  });
  const closureHash = await sha256ContentHash({
    object_ids: inferenceReceipt.mandatory_object_ids,
    relationship_ids: inferenceReceipt.mandatory_relationship_ids,
  });
  const analysisCapabilities =
    snapshot.published_metrics.length > 0
      ? ([
          "TREND_CHANGE",
          "CONTRIBUTION",
          "CONCENTRATION",
          "ROBUST_ANOMALY",
          "ASSOCIATION",
          "FORECAST",
        ] as const)
      : [];
  return buildSemanticContextPackage({
    schema_version: "semantic-context-package@1.0.0",
    ...core,
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
