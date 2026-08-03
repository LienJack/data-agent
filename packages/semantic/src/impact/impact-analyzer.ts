import type {
  SemanticDimension,
  SemanticMetric,
  SemanticRelationship,
  SemanticSourceBundle,
} from "@data-agent/contracts";

/**
 * 影响类型。
 */
export enum ImpactKind {
  METRIC_ADDED = "METRIC_ADDED",
  METRIC_REMOVED = "METRIC_REMOVED",
  METRIC_MODIFIED = "METRIC_MODIFIED",
  DIMENSION_ADDED = "DIMENSION_ADDED",
  DIMENSION_REMOVED = "DIMENSION_REMOVED",
  DIMENSION_MODIFIED = "DIMENSION_MODIFIED",
  RELATIONSHIP_ADDED = "RELATIONSHIP_ADDED",
  RELATIONSHIP_REMOVED = "RELATIONSHIP_REMOVED",
  RELATIONSHIP_MODIFIED = "RELATIONSHIP_MODIFIED",
  FORMULA_ADDED = "FORMULA_ADDED",
  FORMULA_REMOVED = "FORMULA_REMOVED",
}

/**
 * 影响条目。
 */
export interface ImpactEntry {
  readonly kind: ImpactKind;
  readonly id: string;
  readonly description: string;
}

/**
 * 影响分析结果。
 */
export interface ImpactResult {
  readonly entries: readonly ImpactEntry[];
  readonly backwardCompatible: boolean;
}

/**
 * 计算 SourceBundle 变化的影响。
 *
 * 比较两个 SemanticSourceBundle 版本，列出所有变化。
 * 如果 base 为 null，则视为新 bundle。
 */
export function computeBundleImpact(
  current: SemanticSourceBundle,
  base: SemanticSourceBundle | null,
): ImpactResult {
  const entries: ImpactEntry[] = [];
  let backwardCompatible = true;

  if (base === null) {
    // 新 bundle
    for (const metric of current.metrics) {
      entries.push({
        kind: ImpactKind.METRIC_ADDED,
        id: metric.metric_id,
        description: `新增 Metric: ${metric.name} (${metric.metric_id})`,
      });
    }
    for (const dimension of current.dimensions) {
      entries.push({
        kind: ImpactKind.DIMENSION_ADDED,
        id: dimension.dimension_id,
        description: `新增 Dimension: ${dimension.name} (${dimension.dimension_id})`,
      });
    }
    for (const relationship of current.relationships) {
      entries.push({
        kind: ImpactKind.RELATIONSHIP_ADDED,
        id: relationship.relationship_id,
        description: `新增 Relationship: ${relationship.name} (${relationship.relationship_id})`,
      });
    }
    for (const formula of current.formulas) {
      entries.push({
        kind: ImpactKind.FORMULA_ADDED,
        id: formula.formula_id,
        description: `新增 Formula: ${formula.formula_id}`,
      });
    }
    return { entries, backwardCompatible: true };
  }

  // 比较 metrics
  const baseMetrics = new Map(base.metrics.map((m) => [m.metric_id, m]));
  const currentMetrics = new Map(current.metrics.map((m) => [m.metric_id, m]));

  for (const metric of current.metrics) {
    const baseMetric = baseMetrics.get(metric.metric_id);
    if (!baseMetric) {
      entries.push({
        kind: ImpactKind.METRIC_ADDED,
        id: metric.metric_id,
        description: `新增 Metric: ${metric.name} (${metric.metric_id})`,
      });
      backwardCompatible = false;
    } else if (JSON.stringify(metric) !== JSON.stringify(baseMetric)) {
      entries.push({
        kind: ImpactKind.METRIC_MODIFIED,
        id: metric.metric_id,
        description: `修改 Metric: ${metric.name} (${metric.metric_id})`,
      });
      backwardCompatible = false;
    }
  }

  for (const [metricId, metric] of baseMetrics) {
    if (!currentMetrics.has(metricId)) {
      entries.push({
        kind: ImpactKind.METRIC_REMOVED,
        id: metricId,
        description: `移除 Metric: ${metric.name} (${metricId})`,
      });
      backwardCompatible = false;
    }
  }

  // 比较 dimensions
  const baseDimensions = new Map(base.dimensions.map((d) => [d.dimension_id, d]));
  const currentDimensions = new Map(current.dimensions.map((d) => [d.dimension_id, d]));

  for (const dimension of current.dimensions) {
    const baseDim = baseDimensions.get(dimension.dimension_id);
    if (!baseDim) {
      entries.push({
        kind: ImpactKind.DIMENSION_ADDED,
        id: dimension.dimension_id,
        description: `新增 Dimension: ${dimension.name} (${dimension.dimension_id})`,
      });
    } else if (JSON.stringify(dimension) !== JSON.stringify(baseDim)) {
      entries.push({
        kind: ImpactKind.DIMENSION_MODIFIED,
        id: dimension.dimension_id,
        description: `修改 Dimension: ${dimension.name} (${dimension.dimension_id})`,
      });
    }
  }

  for (const [dimId, dim] of baseDimensions) {
    if (!currentDimensions.has(dimId)) {
      entries.push({
        kind: ImpactKind.DIMENSION_REMOVED,
        id: dimId,
        description: `移除 Dimension: ${dim.name} (${dimId})`,
      });
      backwardCompatible = false;
    }
  }

  // 比较 relationships
  const baseRelationships = new Map(base.relationships.map((r) => [r.relationship_id, r]));
  const currentRelationships = new Map(current.relationships.map((r) => [r.relationship_id, r]));

  for (const relationship of current.relationships) {
    const baseRel = baseRelationships.get(relationship.relationship_id);
    if (!baseRel) {
      entries.push({
        kind: ImpactKind.RELATIONSHIP_ADDED,
        id: relationship.relationship_id,
        description: `新增 Relationship: ${relationship.name} (${relationship.relationship_id})`,
      });
    } else if (JSON.stringify(relationship) !== JSON.stringify(baseRel)) {
      entries.push({
        kind: ImpactKind.RELATIONSHIP_MODIFIED,
        id: relationship.relationship_id,
        description: `修改 Relationship: ${relationship.name} (${relationship.relationship_id})`,
      });
    }
  }

  for (const [relId, rel] of baseRelationships) {
    if (!currentRelationships.has(relId)) {
      entries.push({
        kind: ImpactKind.RELATIONSHIP_REMOVED,
        id: relId,
        description: `移除 Relationship: ${rel.name} (${relId})`,
      });
      backwardCompatible = false;
    }
  }

  // 比较 formulas
  const baseFormulaIds = new Set(base.formulas.map((f) => f.formula_id));
  const currentFormulaIds = new Set(current.formulas.map((f) => f.formula_id));

  for (const formulaId of currentFormulaIds) {
    if (!baseFormulaIds.has(formulaId)) {
      entries.push({
        kind: ImpactKind.FORMULA_ADDED,
        id: formulaId,
        description: `新增 Formula: ${formulaId}`,
      });
    }
  }

  for (const formulaId of baseFormulaIds) {
    if (!currentFormulaIds.has(formulaId)) {
      entries.push({
        kind: ImpactKind.FORMULA_REMOVED,
        id: formulaId,
        description: `移除 Formula: ${formulaId}`,
      });
      backwardCompatible = false;
    }
  }

  return { entries, backwardCompatible };
}
