import {
  type SemanticRelationship,
  type SemanticSourceBundle,
  SemanticGovernanceError,
} from "@data-agent/contracts";

/**
 * Relationship 证明类型。
 */
export enum RelationshipProofKind {
  DDL_ENFORCED = "DDL_ENFORCED",
  SNAPSHOT_CERTIFIED = "SNAPSHOT_CERTIFIED",
  DECLARED_ONLY = "DECLARED_ONLY",
}

/**
 * 可执行 Relationship 边。
 */
export interface ExecutableRelationshipEdge {
  readonly relationshipId: string;
  readonly analyticalId: string;
  readonly physicalId: string;
  readonly leftTableId: string;
  readonly leftColumnIds: readonly string[];
  readonly rightTableId: string;
  readonly rightColumnIds: readonly string[];
  readonly direction: "left-to-right" | "right-to-left" | "bidirectional";
  readonly rowPreservation: "inner" | "left" | "right" | "full";
  readonly cardinality: string;
  readonly fanoutGrainProof: string | null;
  readonly catalogFence: string;
  readonly proofKind: RelationshipProofKind;
  readonly proofDetail: string | null;
}

/**
 * Relationship 证明包装。
 */
export interface RelationshipProof {
  readonly edge: ExecutableRelationshipEdge;
  readonly proofKind: RelationshipProofKind;
  readonly proofDetail: string | null;
}

/**
 * 将语义 Relationship 降级为可执行边。
 *
 * 转换规则：
 * - `left_row_preservation=required` + `right_row_preservation=required` → `inner`
 * - `left_row_preservation=required` + `right_row_preservation=optional` → `left`
 * - `left_row_preservation=optional` + `right_row_preservation=required` → `right`
 * - `left_row_preservation=optional` + `right_row_preservation=optional` → `full`
 * - `cardinality=one-to-one` → `bidirectional`
 * - `cardinality=one-to-many` → `left-to-right`
 * - `cardinality=many-to-one` → `right-to-left`
 */
function resolveRowPreservation(
  leftRowMatch: string,
  rightRowMatch: string,
): "inner" | "left" | "right" | "full" {
  if (leftRowMatch === "required" && rightRowMatch === "required") return "inner";
  if (leftRowMatch === "required" && rightRowMatch === "optional") return "left";
  if (leftRowMatch === "optional" && rightRowMatch === "required") return "right";
  return "full";
}

function resolveDirection(cardinality: string): "left-to-right" | "right-to-left" | "bidirectional" {
  if (cardinality === "one-to-one") return "bidirectional";
  if (cardinality === "one-to-many") return "left-to-right";
  if (cardinality === "many-to-one") return "right-to-left";
  return "bidirectional";
}

function resolveFanoutGrainProof(
  relationship: SemanticRelationship,
): string | null {
  if (relationship.cardinality === "one-to-many" || relationship.cardinality === "many-to-many") {
    return `FANOUT_WARNING: ${relationship.left_table_id} -> ${relationship.right_table_id}`;
  }
  return null;
}

/**
 * 降级单个 Relationship 为可执行边。
 */
export function lowerRelationship(
  relationship: SemanticRelationship,
  catalogFence: string,
): ExecutableRelationshipEdge {
  const rowPreservation = resolveRowPreservation(
    relationship.left_row_preservation,
    relationship.right_row_preservation,
  );
  const direction = resolveDirection(relationship.cardinality);
  const fanoutGrainProof = resolveFanoutGrainProof(relationship);

  return {
    relationshipId: relationship.relationship_id,
    analyticalId: relationship.relationship_id,
    physicalId: `${relationship.left_table_id}__${relationship.right_table_id}`,
    leftTableId: relationship.left_table_id,
    leftColumnIds: [...relationship.left_column_ids],
    rightTableId: relationship.right_table_id,
    rightColumnIds: [...relationship.right_column_ids],
    direction,
    rowPreservation,
    cardinality: relationship.cardinality,
    fanoutGrainProof,
    catalogFence,
    proofKind: relationship.proof_kind as RelationshipProofKind,
    proofDetail: relationship.proof_detail,
  };
}

/**
 * 降级 Bundle 中所有 Relationship 为可执行边集合。
 */
export function lowerAllRelationships(
  bundle: SemanticSourceBundle,
  catalogFence: string,
): readonly ExecutableRelationshipEdge[] {
  return bundle.relationships.map((rel) => lowerRelationship(rel, catalogFence));
}

/**
 * 验证 Relationship 降级后无冲突 ID。
 */
export function assertNoRelationshipIdCollision(
  edges: readonly ExecutableRelationshipEdge[],
): void {
  const seen = new Set<string>();
  for (const edge of edges) {
    if (seen.has(edge.relationshipId)) {
      throw new SemanticGovernanceError(
        `Relationship ID 冲突: ${edge.relationshipId}。`,
      );
    }
    seen.add(edge.relationshipId);
  }
}
