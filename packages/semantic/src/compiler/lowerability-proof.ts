import {
  type FormulaSignature,
  type SemanticMetric,
  type SemanticSourceBundle,
  type SemanticRelationship,
  SemanticGovernanceError,
} from "@data-agent/contracts";

/**
 * Lowerability 状态判别。
 *
 * - `LOWERABLE_TO_U5`：当前 Formula/metric/relation 可逐字降级为当前 U5 可执行 IR。
 * - `NOT_LOWERABLE`：当前 Formula/metric/relation 不可降级，含原因码。
 */
export enum LowerabilityStatus {
  LOWERABLE_TO_U5 = "LOWERABLE_TO_U5",
  NOT_LOWERABLE = "NOT_LOWERABLE",
}

/**
 * 单个 Formula 的降级证明。
 */
export interface LowerabilityProof {
  readonly formulaId: string;
  readonly status: LowerabilityStatus;
  readonly reasonCode: string | null;
  readonly unreachableFormulaIds: readonly string[];
  readonly unreachableDimensionIds: readonly string[];
  readonly unreachableRelationshipIds: readonly string[];
}

/**
 * 整个 Bundle 的降级结果。
 */
export interface LowerabilityResult {
  readonly proofs: readonly LowerabilityProof[];
  readonly overallLowerable: boolean;
  readonly unlowerableFormulaIds: readonly string[];
}

/**
 * 检查公式类型是否可降级到 U5。
 *
 * U5 只支持 additive_aggregate 和 semi_additive_aggregate 类型。
 * ratio、compound、window 和 other 类型不可降级。
 */
function isFormulaTypeU5Lowerable(formulaType: string): boolean {
  return formulaType === "additive_aggregate" || formulaType === "semi_additive_aggregate";
}

/**
 * 检查聚合类型是否可降级到 U5。
 *
 * U5 只支持 sum、count、count_distinct、avg、min、max。
 */
function isAggregationU5Lowerable(aggregation: string): boolean {
  return ["sum", "count", "count_distinct", "avg", "min", "max"].includes(aggregation);
}

/**
 * 检查 additivity 是否可降级到 U5。
 */
function isAdditivityU5Lowerable(additivity: string): boolean {
  return additivity === "additive" || additivity === "semi-additive";
}

/**
 * 检查 null_policy 是否可降级到 U5。
 */
function isNullPolicyU5Lowerable(nullPolicy: string): boolean {
  return nullPolicy === "preserve" || nullPolicy === "coalesce-zero" || nullPolicy === "exclude";
}

/**
 * 检查 cardinality 是否可降级到 U5。
 */
function isCardinalityU5Lowerable(cardinality: string): boolean {
  return cardinality === "scalar" || cardinality === "vector";
}

/**
 * 检查 fanout_policy 是否可降级到 U5。
 */
function isFanoutPolicyU5Lowerable(fanoutPolicy: string): boolean {
  return fanoutPolicy === "preaggregate" || fanoutPolicy === "reject";
}

/**
 * 检查 grain 是否可降级到 U5。
 *
 * U5 只支持 atomic、day、month、year 粒度。
 */
function isGrainU5Lowerable(granularity: string): boolean {
  return ["atomic", "day", "month", "year"].includes(granularity);
}

/**
 * 检查 unit dimension 是否可降级到 U5。
 */
function isUnitDimensionU5Lowerable(dimension: string): boolean {
  return ["count", "currency", "ratio", "percentage", "rate", "duration"].includes(dimension);
}

/**
 * 检查 relationship 是否可降级到 U5。
 *
 * U5 只支持 DDL_ENFORCED 和 SNAPSHOT_CERTIFIED 证明类型。
 * DECLARED_ONLY 不提供执行安全保证，阻断降级。
 */
function isRelationshipProofU5Lowerable(proofKind: string): boolean {
  return proofKind === "DDL_ENFORCED" || proofKind === "SNAPSHOT_CERTIFIED";
}

/**
 * 检查 relationship cardinality 是否可降级到 U5。
 *
 * U5 只支持 one-to-one、one-to-many、many-to-one。
 * many-to-many 在此版本中阻断降级。
 */
function isRelationshipCardinalityU5Lowerable(cardinality: string): boolean {
  return ["one-to-one", "one-to-many", "many-to-one"].includes(cardinality);
}

/**
 * 计算整个 Bundle 的降级证明。
 *
 * 遍历所有可达 Formula 和 Relationship，生成每项的降级证明。
 * 整体 `overallLowerable` 只在所有项都降级时为 true。
 */
export function computeLowerabilityProof(
  bundle: SemanticSourceBundle,
): LowerabilityResult {
  const proofs: LowerabilityProof[] = [];
  const unlowerableFormulaIds: string[] = [];

  // 构建 formula ID -> formula 映射
  const formulaMap = new Map<string, FormulaSignature>();
  for (const formula of bundle.formulas) {
    formulaMap.set(formula.formula_id, formula);
  }

  // 构建 metric 映射
  const metricMap = new Map<string, SemanticMetric>();
  for (const metric of bundle.metrics) {
    metricMap.set(metric.metric_id, metric);
  }

  // 检查每个 formula
  for (const formula of bundle.formulas) {
    const reasons: string[] = [];
    const unreachableFormulaIds: string[] = [];
    const unreachableDimensionIds: string[] = [];
    const unreachableRelationshipIds: string[] = [];

    if (!isFormulaTypeU5Lowerable(formula.formula_type)) {
      reasons.push(`FORMULA_TYPE_NOT_U5_LOWERABLE: ${formula.formula_type}`);
    }

    if (!isAdditivityU5Lowerable(formula.additivity)) {
      reasons.push(`ADDITIVITY_NOT_U5_LOWERABLE: ${formula.additivity}`);
    }

    if (!isCardinalityU5Lowerable(formula.cardinality)) {
      reasons.push(`CARDINALITY_NOT_U5_LOWERABLE: ${formula.cardinality}`);
    }

    if (!isNullPolicyU5Lowerable(formula.null_policy)) {
      reasons.push(`NULL_POLICY_NOT_U5_LOWERABLE: ${formula.null_policy}`);
    }

    if (!isGrainU5Lowerable(formula.grain.granularity)) {
      reasons.push(`GRAIN_NOT_U5_LOWERABLE: ${formula.grain.granularity}`);
    }

    if (formula.unit && !isUnitDimensionU5Lowerable(formula.unit.dimension)) {
      reasons.push(`UNIT_DIMENSION_NOT_U5_LOWERABLE: ${formula.unit.dimension}`);
    }

    // 递归检查依赖公式
    for (const depFormulaId of formula.dependency_formula_ids) {
      const depFormula = formulaMap.get(depFormulaId);
      if (!depFormula) {
        reasons.push(`DEPENDENCY_FORMULA_NOT_FOUND: ${depFormulaId}`);
        unreachableFormulaIds.push(depFormulaId);
      } else if (!isFormulaTypeU5Lowerable(depFormula.formula_type)) {
        reasons.push(`DEPENDENCY_FORMULA_NOT_LOWERABLE: ${depFormulaId}`);
        unreachableFormulaIds.push(depFormulaId);
      }
    }

    proofs.push({
      formulaId: formula.formula_id,
      status: reasons.length === 0
        ? LowerabilityStatus.LOWERABLE_TO_U5
        : LowerabilityStatus.NOT_LOWERABLE,
      reasonCode: reasons.length > 0 ? reasons.join("; ") : null,
      unreachableFormulaIds,
      unreachableDimensionIds,
      unreachableRelationshipIds,
    });

    if (reasons.length > 0) {
      unlowerableFormulaIds.push(formula.formula_id);
    }
  }

  // 检查每个 metric 的基础属性
  for (const metric of bundle.metrics) {
    const reasons: string[] = [];

    if (!isAggregationU5Lowerable(metric.aggregation)) {
      reasons.push(`AGGREGATION_NOT_U5_LOWERABLE: ${metric.aggregation}`);
    }

    if (!isAdditivityU5Lowerable(metric.additivity)) {
      reasons.push(`ADDITIVITY_NOT_U5_LOWERABLE: ${metric.additivity}`);
    }

    if (!isNullPolicyU5Lowerable(metric.null_policy)) {
      reasons.push(`NULL_POLICY_NOT_U5_LOWERABLE: ${metric.null_policy}`);
    }

    if (!isFanoutPolicyU5Lowerable(metric.fanout_policy)) {
      reasons.push(`FANOUT_POLICY_NOT_U5_LOWERABLE: ${metric.fanout_policy}`);
    }

    if (!isGrainU5Lowerable(metric.grain.granularity)) {
      reasons.push(`GRAIN_NOT_U5_LOWERABLE: ${metric.grain.granularity}`);
    }

    if (metric.formula) {
      const formulaProof = proofs.find((p) => p.formulaId === metric.formula!.formula_id);
      if (formulaProof && formulaProof.status === LowerabilityStatus.NOT_LOWERABLE) {
        reasons.push(`FORMULA_NOT_LOWERABLE: ${metric.formula.formula_id}`);
      }
    }

    proofs.push({
      formulaId: metric.metric_id,
      status: reasons.length === 0
        ? LowerabilityStatus.LOWERABLE_TO_U5
        : LowerabilityStatus.NOT_LOWERABLE,
      reasonCode: reasons.length > 0 ? reasons.join("; ") : null,
      unreachableFormulaIds: [],
      unreachableDimensionIds: [],
      unreachableRelationshipIds: [],
    });

    if (reasons.length > 0) {
      unlowerableFormulaIds.push(metric.metric_id);
    }
  }

  // 检查每个 relationship
  for (const relationship of bundle.relationships) {
    const reasons: string[] = [];

    if (!isRelationshipProofU5Lowerable(relationship.proof_kind)) {
      reasons.push(`PROOF_KIND_NOT_U5_LOWERABLE: ${relationship.proof_kind}`);
    }

    if (!isRelationshipCardinalityU5Lowerable(relationship.cardinality)) {
      reasons.push(`CARDINALITY_NOT_U5_LOWERABLE: ${relationship.cardinality}`);
    }
  }

  return {
    proofs,
    overallLowerable: unlowerableFormulaIds.length === 0,
    unlowerableFormulaIds,
  };
}
