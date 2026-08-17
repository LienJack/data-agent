import {
  buildResolvedContextPackage,
  type ResolvedContextAuthoritySnapshot,
  type ResolvedContextEvidenceSummary,
  type ResolvedContextPackage,
} from "@data-agent/contracts";
import { applyContextCapacity, type ContextCapacityCandidate } from "./context-capacity-policy.js";
import { routeResolvedContext } from "./context-router.js";

export async function resolveContextPackage(
  snapshot: ResolvedContextAuthoritySnapshot,
): Promise<ResolvedContextPackage> {
  const routeDecision = await routeResolvedContext(snapshot);
  const candidates: ContextCapacityCandidate[] = [
    {
      item_kind: "AUTHORITY",
      item_id: snapshot.semantic_release.resource_id,
      item_hash: snapshot.snapshot_hash,
      priority: 10_000,
      mandatory: true,
      evidence: null,
    },
    {
      item_kind: "POLICY",
      item_id: snapshot.context_policy.resource_id,
      item_hash: snapshot.context_policy.resource_hash,
      priority: 9_900,
      mandatory: true,
      evidence: null,
    },
  ];

  if (routeDecision.selected_metric_id) {
    const metric = snapshot.published_metrics.find(
      ({ metric_id }) => metric_id === routeDecision.selected_metric_id,
    );
    if (metric) {
      const evidence: ResolvedContextEvidenceSummary = {
        evidence_kind: "METRIC",
        evidence_id: metric.metric_id,
        evidence_hash: metric.mapping_hash,
        summary: `${metric.name}: ${metric.mapping_refs.join(", ")}`,
        source_ref: null,
      };
      candidates.push({
        item_kind: "METRIC",
        item_id: metric.metric_id,
        item_hash: metric.mapping_hash,
        priority: 9_000,
        mandatory: true,
        evidence,
      });
    }
  }
  for (const objectId of routeDecision.selected_ontology_ids) {
    const object = snapshot.published_ontology.find(({ object_id }) => object_id === objectId);
    if (!object) continue;
    candidates.push({
      item_kind: object.queryable ? "MAPPING" : "ONTOLOGY",
      item_id: object.object_id,
      item_hash: object.object_hash,
      priority: object.queryable ? 8_000 : 7_000,
      mandatory: routeDecision.route === "ONTOLOGY_TEXT2SQL",
      evidence: {
        evidence_kind: object.queryable ? "MAPPING" : "ONTOLOGY",
        evidence_id: object.object_id,
        evidence_hash: object.object_hash,
        summary: `${object.object_kind}: ${object.name}`,
        source_ref: null,
      },
    });
  }
  for (const ref of snapshot.knowledge_refs) {
    candidates.push({
      item_kind: "KNOWLEDGE",
      item_id: ref.resource_id,
      item_hash: ref.resource_hash,
      priority: 3_000,
      mandatory: false,
      on_demand: true,
      evidence: {
        evidence_kind: "KNOWLEDGE",
        evidence_id: ref.resource_id,
        evidence_hash: ref.resource_hash,
        summary: "Governed knowledge retrieval available on demand.",
        source_ref: ref,
      },
    });
  }
  if (routeDecision.route === "GRAPH") {
    for (const relationship of snapshot.published_relationships.slice(0, 128)) {
      candidates.push({
        item_kind: "GRAPH",
        item_id: relationship.relationship_id,
        item_hash: relationship.relationship_hash,
        priority: 2_000,
        mandatory: false,
        evidence: {
          evidence_kind: "GRAPH",
          evidence_id: relationship.relationship_id,
          evidence_hash: relationship.relationship_hash,
          summary: `${relationship.source_object_id} ${relationship.relationship_kind} ${relationship.target_object_id}`,
          source_ref: null,
        },
      });
    }
  }

  const capacity = applyContextCapacity({
    max_context_tokens: snapshot.context_policy.max_context_tokens,
    candidates,
  });
  const routeDecisionWithCapacity = capacity.mandatory_exceeded
    ? {
        ...routeDecision,
        state: "REJECTED" as const,
        reason_codes: [
          ...new Set([...routeDecision.reason_codes, "CONTEXT_CAPACITY_MANDATORY_EXCEEDED"]),
        ].sort(),
      }
    : capacity.plan.cropped_bytes > 0 && routeDecision.state === "READY"
      ? {
          ...routeDecision,
          state: "PARTIAL" as const,
          reason_codes: [
            ...new Set([...routeDecision.reason_codes, "CONTEXT_CAPACITY_CROPPED"]),
          ].sort(),
        }
      : routeDecision;

  return buildResolvedContextPackage({
    schema_version: "resolved-context-package@1.0.0",
    scope: snapshot.scope,
    semantic_domain: snapshot.semantic_domain,
    question_hash: snapshot.question_hash,
    defaults_ref: snapshot.defaults_ref,
    semantic_release: snapshot.semantic_release,
    schema_snapshot: snapshot.schema_snapshot,
    context_policy: snapshot.context_policy,
    egress_policy: snapshot.egress_policy,
    provider: snapshot.provider,
    authority_snapshot_hash: snapshot.snapshot_hash,
    route_decision: routeDecisionWithCapacity,
    capacity: capacity.plan,
    evidence: [...capacity.included_evidence].sort((left, right) =>
      `${left.evidence_kind}:${left.evidence_id}`.localeCompare(
        `${right.evidence_kind}:${right.evidence_id}`,
      ),
    ),
    knowledge_refs: snapshot.knowledge_refs,
  });
}
