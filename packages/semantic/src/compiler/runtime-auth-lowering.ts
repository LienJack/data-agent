import {
  type RuntimeAuth,
  type RuntimeAuthPredicate,
  type RuntimeAuthTableRule,
  SemanticGovernanceError,
  type SemanticSourceBundle,
} from "@data-agent/contracts";
import { z } from "zod";

/**
 * Runtime Authorization 降级状态。
 */
export enum RuntimeAuthLoweringStatus {
  LOWERED = "LOWERED",
  NOT_EXPRESSIBLE_IN_U5 = "NOT_EXPRESSIBLE_IN_U5",
}

/**
 * Runtime Authorization 降级结果。
 */
export interface RuntimeAuthLoweringResult {
  readonly status: RuntimeAuthLoweringStatus;
  readonly loweredRules: readonly LoweredAuthRule[];
  readonly notExpressibleReasons: readonly string[];
}

/**
 * 降级后的 Authorization 规则。
 */
export interface LoweredAuthRule {
  readonly tableId: string;
  readonly action: "DENY" | "RESTRICT";
  readonly columnIds: readonly string[];
  readonly predicates: readonly LoweredAuthPredicate[];
  readonly canonicalOrdering: readonly string[];
}

/**
 * 降级后的 Authorization Predicate。
 */
export interface LoweredAuthPredicate {
  readonly tableId: string;
  readonly columnId: string;
  readonly operator: string;
  readonly parameterKey: string;
}

/**
 * U5 可表达的 operator 集合。
 */
const U5_EXPRESSIBLE_OPERATORS = new Set([
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "between",
  "is_null",
  "is_not_null",
]);

/**
 * U5 可表达的 action 集合。
 */
const U5_EXPRESSIBLE_ACTIONS = new Set(["DENY", "RESTRICT"]);

/**
 * 将 Runtime Auth 降级为 U5 可执行的投影。
 *
 * 只保留 U5 可逐字表达的规则：
 * - table/column DENY/RESTRICT
 * - comparison/null predicate
 * 过滤掉：
 * - purpose/masking/复杂 ABAC
 * - 任意 grant
 * - 无法逐字表达的 predicate
 */
export function lowerRuntimeAuthorization(auth: RuntimeAuth): RuntimeAuthLoweringResult {
  const loweredRules: LoweredAuthRule[] = [];
  const notExpressibleReasons: string[] = [];

  for (const rule of auth.table_rules) {
    if (!U5_EXPRESSIBLE_ACTIONS.has(rule.action)) {
      notExpressibleReasons.push(
        `ACTION_NOT_EXPRESSIBLE_IN_U5: ${rule.action} on table ${rule.table_id}`,
      );
      continue;
    }

    const loweredPredicates: LoweredAuthPredicate[] = [];
    let hasNonExpressiblePredicate = false;

    for (const predicate of rule.predicates) {
      if (!U5_EXPRESSIBLE_OPERATORS.has(predicate.operator)) {
        notExpressibleReasons.push(
          `OPERATOR_NOT_EXPRESSIBLE_IN_U5: ${predicate.operator} on ${predicate.table_id}.${predicate.column_id}`,
        );
        hasNonExpressiblePredicate = true;
        continue;
      }

      loweredPredicates.push({
        tableId: predicate.table_id,
        columnId: predicate.column_id,
        operator: predicate.operator,
        parameterKey: predicate.parameter_key,
      });
    }

    if (hasNonExpressiblePredicate) {
      notExpressibleReasons.push(`TABLE_HAS_NON_EXPRESSIBLE_PREDICATE: ${rule.table_id}`);
    }

    // 稳定排序 canonical ordering
    const canonicalOrdering = [...rule.column_ids].sort();

    loweredRules.push({
      tableId: rule.table_id,
      action: rule.action as "DENY" | "RESTRICT",
      columnIds: [...rule.column_ids].sort(),
      predicates: loweredPredicates.sort((a, b) =>
        `${a.tableId}.${a.columnId}.${a.operator}`.localeCompare(
          `${b.tableId}.${b.columnId}.${b.operator}`,
        ),
      ),
      canonicalOrdering,
    });
  }

  // 按 tableId 排序输出
  loweredRules.sort((a, b) => a.tableId.localeCompare(b.tableId));

  return {
    status:
      notExpressibleReasons.length === 0
        ? RuntimeAuthLoweringStatus.LOWERED
        : RuntimeAuthLoweringStatus.NOT_EXPRESSIBLE_IN_U5,
    loweredRules,
    notExpressibleReasons,
  };
}

/**
 * 检查 Runtime Auth 降级结果是否与指定 U5 restriction 集合兼容。
 */
export function checkRestrictionCompatibility(
  lowered: RuntimeAuthLoweringResult,
  u5RestrictionProjectionDigest: string,
  currentRestrictionDigest: string,
): boolean {
  if (lowered.status !== RuntimeAuthLoweringStatus.LOWERED) {
    return false;
  }
  return u5RestrictionProjectionDigest === currentRestrictionDigest;
}

/**
 * 从 U5 可表达的规则计算 Canonical Digest。
 */
export function computeRestrictionProjectionDigest(rules: readonly LoweredAuthRule[]): string {
  const canonical = JSON.stringify({
    rules: rules.map((r) => ({
      tableId: r.tableId,
      action: r.action,
      columnIds: r.canonicalOrdering,
      predicates: r.predicates.map((p) => ({
        tableId: p.tableId,
        columnId: p.columnId,
        operator: p.operator,
        parameterKey: p.parameterKey,
      })),
    })),
  });
  // 使用简单 hash 模拟（实际应使用 sha256）
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    const char = canonical.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `restriction-digest-${Math.abs(hash).toString(16)}`;
}
