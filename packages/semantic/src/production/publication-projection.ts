import { createHash } from "node:crypto";
import {
  type SemanticAssertionCandidate,
  type SemanticChangeSet,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  semanticGraphProjectionSchema,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";

export interface SemanticPublicationProjection {
  readonly release_id: string;
  readonly source_revision_id: string;
  readonly candidate_revision_id: string;
  readonly validation_receipt_id: string;
  readonly publish_attempt_id: string;
  readonly executable_projection_id: string;
  readonly relationship_projection_id: string;
  readonly restriction_projection_id: string;
  readonly graph_projection_id: string;
  readonly review_decision_id: string;
  readonly outbox_event_id: string;
  readonly compiler_bundle_digest: `sha256:${string}`;
  readonly executable_projection_digest: `sha256:${string}`;
  readonly relationship_projection_digest: `sha256:${string}`;
  readonly restriction_projection_digest: `sha256:${string}`;
  readonly graph_projection_digest: `sha256:${string}`;
  readonly release_digest: `sha256:${string}`;
  readonly executable_projection: Readonly<{
    schema_version: "semantic-executable-projection@1.0.0";
    metrics: readonly unknown[];
    dimensions: readonly unknown[];
    formulas: readonly unknown[];
    physical_bindings: readonly unknown[];
  }>;
  readonly relationship_projection: Readonly<{
    schema_version: "semantic-relationship-projection@1.0.0";
    relationships: readonly unknown[];
  }>;
  readonly restriction_projection: Readonly<{
    schema_version: "semantic-runtime-restriction-projection@1.0.0";
    quality_constraints: readonly unknown[];
    time_semantics: readonly unknown[];
  }>;
  readonly graph_projection: ReturnType<typeof semanticGraphProjectionSchema.parse>;
  readonly binding_impact_hashes: readonly string[];
}

type DimensionAnalysis = Extract<SemanticGraphNode, { node_type: "DIMENSION" }>["analysis"];
type MetricAnalysis = Extract<SemanticGraphNode, { node_type: "METRIC" }>["analysis"];

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function assertionsOfKind(changeSet: SemanticChangeSet, targetKind: string) {
  return changeSet.assertions.filter(({ target_kind: kind }) => kind === targetKind);
}

function projectionNode(assertion: SemanticAssertionCandidate): SemanticGraphNode | null {
  const tags = ["published-change-set", `assertion-kind:${assertion.target_kind}`].sort();
  if (assertion.target_kind === "BUSINESS_ENTITY_TYPE") {
    const entity = assertion.assertion_payload.entity as {
      name: string;
      description?: string;
      aliases: string[];
      domain: string;
    };
    return {
      node_id: assertion.canonical_key,
      node_version: 1,
      node_type: "BUSINESS_SUBJECT",
      name: entity.name,
      description: entity.description,
      aliases: [...entity.aliases].sort(),
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags,
      domain: entity.domain,
    };
  }
  if (assertion.target_kind === "DIMENSION") {
    const dimension = assertion.assertion_payload.dimension as Record<string, unknown>;
    return {
      node_id: assertion.canonical_key,
      node_version: 1,
      node_type: "DIMENSION",
      name: String(dimension.name),
      aliases: [...(dimension.aliases as string[])].sort(),
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags,
      data_type: dimension.data_type as "date" | "text",
      sensitivity: dimension.sensitivity as "INTERNAL",
      filter_semantics: dimension.data_type === "date" ? "TEMPORAL" : "EXACT",
      analysis: dimension.analysis as DimensionAnalysis,
    };
  }
  if (assertion.target_kind === "METRIC") {
    const metric = assertion.assertion_payload.metric as Record<string, unknown>;
    return {
      node_id: assertion.canonical_key,
      node_version: 1,
      node_type: "METRIC",
      name: String(metric.name),
      aliases: [...(metric.aliases as string[])].sort(),
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags,
      unit: metric.unit as null,
      additivity: metric.additivity as "additive" | "non-additive",
      null_policy: metric.null_policy as "exclude",
      fanout_policy: metric.fanout_policy as "preaggregate",
      analysis: metric.analysis as MetricAnalysis,
    };
  }
  if (assertion.target_kind === "FORMULA") {
    const formula = assertion.assertion_payload.formula as SemanticGraphNode;
    return { ...formula, tags: [...new Set([...formula.tags, ...tags])].sort() };
  }
  if (
    assertion.target_kind === "RELATIONSHIP" ||
    assertion.target_kind === "QUALITY_CONSTRAINT" ||
    assertion.target_kind === "TIME_SEMANTICS"
  ) {
    const material = assertion.assertion_payload as Record<string, unknown>;
    const name =
      assertion.target_kind === "RELATIONSHIP"
        ? String((material.relationship as { name: string }).name)
        : assertion.target_kind === "QUALITY_CONSTRAINT"
          ? String(material.constraint_id)
          : String((material.time_domain as { time_domain_id: string }).time_domain_id);
    return {
      node_id: assertion.canonical_key,
      node_version: 1,
      node_type: "BUSINESS_SUBJECT",
      name,
      aliases: [],
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags,
      domain: assertion.scope.semantic_domain,
    };
  }
  return null;
}

function lineageEdges(changeSet: SemanticChangeSet): SemanticGraphEdge[] {
  return assertionsOfKind(changeSet, "BUSINESS_ENTITY_TYPE").flatMap((assertion) => {
    const entity = assertion.assertion_payload.entity as {
      business_relationship_types: Array<{
        relationship_type: string;
        target_entity_id: string;
      }>;
    };
    return entity.business_relationship_types.map((relationship, index) => ({
      edge_id: `lineage.${assertion.canonical_key.slice(5)}.${String(index + 1).padStart(2, "0")}`,
      edge_version: 1,
      edge_type: relationship.relationship_type,
      family: "PROVENANCE" as const,
      source_node_id: assertion.canonical_key,
      target_node_id: relationship.target_entity_id,
      lifecycle: "ACTIVE" as const,
      attributes: {
        kind: "PROVENANCE" as const,
        derivation_kind: "SUPPORTED" as const,
        note: "Published competency case mandatory semantic closure.",
      },
      evidence_refs: [],
    }));
  });
}

export async function compileSemanticPublicationProjection(
  changeSet: SemanticChangeSet,
): Promise<SemanticPublicationProjection> {
  const identifier = (kind: string) => stableUuid(`${changeSet.change_set_hash}:${kind}`);
  const executableProjection = {
    schema_version: "semantic-executable-projection@1.0.0" as const,
    metrics: assertionsOfKind(changeSet, "METRIC").map(
      ({ assertion_payload }) => assertion_payload.metric,
    ),
    dimensions: assertionsOfKind(changeSet, "DIMENSION").map(
      ({ assertion_payload }) => assertion_payload.dimension,
    ),
    formulas: assertionsOfKind(changeSet, "FORMULA").map(
      ({ assertion_payload }) => assertion_payload.formula,
    ),
    physical_bindings: assertionsOfKind(changeSet, "PHYSICAL_BINDING").map(
      ({ assertion_payload }) => assertion_payload.binding,
    ),
  };
  const relationshipProjection = {
    schema_version: "semantic-relationship-projection@1.0.0" as const,
    relationships: ["RELATIONSHIP", "ANALYSIS_JOIN"].flatMap((kind) =>
      assertionsOfKind(changeSet, kind).map(
        ({ assertion_payload }) => assertion_payload.relationship,
      ),
    ),
  };
  const restrictionProjection = {
    schema_version: "semantic-runtime-restriction-projection@1.0.0" as const,
    quality_constraints: assertionsOfKind(changeSet, "QUALITY_CONSTRAINT").map(
      ({ assertion_payload }) => assertion_payload,
    ),
    time_semantics: assertionsOfKind(changeSet, "TIME_SEMANTICS").map(
      ({ assertion_payload }) => assertion_payload.time_domain,
    ),
  };
  const nodes = changeSet.assertions
    .map(projectionNode)
    .filter((node): node is SemanticGraphNode => node !== null)
    .sort((left, right) => left.node_id.localeCompare(right.node_id));
  const edges = lineageEdges(changeSet).sort((left, right) =>
    left.edge_id.localeCompare(right.edge_id),
  );
  const registryDigest = await sha256ContentHash({
    node_types: [...new Set(nodes.map(({ node_type }) => node_type))].sort(),
    edge_types: [...new Set(edges.map(({ edge_type }) => edge_type))].sort(),
  });
  const graphProjection = semanticGraphProjectionSchema.parse({
    projection_version: "semantic-graph-projection@1",
    graph_id: stableUuid(`${changeSet.change_set_hash}:graph`),
    source_digest: changeSet.change_set_hash,
    registry_digest: registryDigest,
    compiler_version: "semantic-change-set-publication@1",
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
  });
  const [
    compilerBundleDigest,
    executableDigest,
    relationshipDigest,
    restrictionDigest,
    graphDigest,
  ] = await Promise.all([
    sha256ContentHash({
      compiler_version: graphProjection.compiler_version,
      registry_digest: registryDigest,
    }),
    sha256ContentHash(executableProjection),
    sha256ContentHash(relationshipProjection),
    sha256ContentHash(restrictionProjection),
    sha256ContentHash(graphProjection),
  ]);
  const releaseDigest = await sha256ContentHash({
    change_set_hash: changeSet.change_set_hash,
    generation: changeSet.base_release.generation + 1,
    compiler_bundle_digest: compilerBundleDigest,
    executable_projection_digest: executableDigest,
    relationship_projection_digest: relationshipDigest,
    restriction_projection_digest: restrictionDigest,
    graph_projection_digest: graphDigest,
  });
  return Object.freeze({
    release_id: identifier("release"),
    source_revision_id: identifier("source-revision"),
    candidate_revision_id: identifier("candidate-revision"),
    validation_receipt_id: identifier("validation-receipt"),
    publish_attempt_id: identifier("publish-attempt"),
    executable_projection_id: identifier("executable-projection"),
    relationship_projection_id: identifier("relationship-projection"),
    restriction_projection_id: identifier("restriction-projection"),
    graph_projection_id: identifier("graph-projection"),
    review_decision_id: identifier("review-decision"),
    outbox_event_id: identifier("outbox-event"),
    compiler_bundle_digest: compilerBundleDigest,
    executable_projection_digest: executableDigest,
    relationship_projection_digest: relationshipDigest,
    restriction_projection_digest: restrictionDigest,
    graph_projection_digest: graphDigest,
    release_digest: releaseDigest,
    executable_projection: executableProjection,
    relationship_projection: relationshipProjection,
    restriction_projection: restrictionProjection,
    graph_projection: graphProjection,
    binding_impact_hashes: assertionsOfKind(changeSet, "PHYSICAL_BINDING")
      .map(({ assertion_hash }) => assertion_hash)
      .sort(),
  });
}
