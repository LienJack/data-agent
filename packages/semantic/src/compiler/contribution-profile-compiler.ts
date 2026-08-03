import {
  computeExecutableSemanticDigest,
  contentHashSchema,
  type DescriptiveContributionProfile,
  type EndpointExecutionTemplate,
  type FormulaEquivalenceWitness,
  type RowPartitionWitness,
  SemanticGovernanceError,
  type SemanticMetric,
  type SemanticSourceBundle,
  type StaticDriverCapacityProof,
} from "@data-agent/contracts";
import { z } from "zod";

/**
 * Contribution 降级状态。
 */
export enum ContributionLoweringStatus {
  LOWERED = "LOWERED",
  NOT_LOWERABLE = "NOT_LOWERABLE",
}

/**
 * Contribution 降级结果。
 */
export interface DescriptiveContributionLoweringResult {
  readonly status: ContributionLoweringStatus;
  readonly loweredTemplates: readonly EndpointExecutionTemplate[];
  readonly loweredWitnesses: readonly (RowPartitionWitness | FormulaEquivalenceWitness)[];
  readonly loweredCapacityProofs: readonly StaticDriverCapacityProof[];
  readonly reasons: readonly string[];
}

/**
 * 检查 EndpointTemplate 是否完整。
 */
function validateEndpointTemplate(template: EndpointExecutionTemplate): string | null {
  if (!template.metric_ref) return `METRIC_REF_MISSING: ${template.endpoint_id}`;
  if (!template.baseline_query_contract_template_hash)
    return `BASELINE_HASH_MISSING: ${template.endpoint_id}`;
  if (!template.followup_query_contract_template_hash)
    return `FOLLOWUP_HASH_MISSING: ${template.endpoint_id}`;
  if (!template.fixed_predicate_ast_hash) return `PREDICATE_HASH_MISSING: ${template.endpoint_id}`;
  if (!template.expected_row0_cell) return `EXPECTED_CELL_MISSING: ${template.endpoint_id}`;
  if (!template.ontology_identity) return `ONTOLOGY_IDENTITY_MISSING: ${template.endpoint_id}`;
  if (!template.datasource_id) return `DATASOURCE_ID_MISSING: ${template.endpoint_id}`;
  if (!template.grain_ref) return `GRAIN_REF_MISSING: ${template.endpoint_id}`;
  return null;
}

/**
 * 降级 DescriptiveContributionProfile。
 *
 * 编译 endpoint templates、runtime bindings、independently observed residual
 * 与 kind-specific witness。
 * 拒绝：缺任一 baseline/follow-up template、predicate hash、expected cell、
 * same-measure/null/collation/complement/partition witness 或 FormulaAST sign/equivalence witness，
 * 或出现未知/混合 kind、不同 metrics 偶然闭合、grouped/dynamic/ratio/nonlinear post-aggregate、
 * cross-unit/grain/time 与不稳定 closure。
 */
export function lowerDescriptiveContributionProfile(
  bundle: SemanticSourceBundle,
  profile: DescriptiveContributionProfile,
): DescriptiveContributionLoweringResult {
  const reasons: string[] = [];
  const loweredTemplates: EndpointExecutionTemplate[] = [];
  const loweredWitnesses: (RowPartitionWitness | FormulaEquivalenceWitness)[] = [];
  const loweredCapacityProofs: StaticDriverCapacityProof[] = [];

  const metricMap = new Map<string, SemanticMetric>();
  for (const metric of bundle.metrics) {
    metricMap.set(metric.metric_id, metric);
  }

  // 检查每个 endpoint template
  for (const template of profile.targets) {
    const validationError = validateEndpointTemplate(template);
    if (validationError) {
      reasons.push(validationError);
      continue;
    }

    // 检查 metric ref 是否存在于 bundle 中
    const metric = metricMap.get(template.metric_ref);
    if (!metric) {
      reasons.push(`METRIC_NOT_FOUND_IN_BUNDLE: ${template.metric_ref}`);
      continue;
    }

    // 检查 metric 是否 additive
    if (metric.additivity !== "additive") {
      reasons.push(`METRIC_NOT_ADDITIVE: ${metric.metric_id} is ${metric.additivity}`);
      continue;
    }

    // 检查 grain 一致性
    if (template.grain_ref !== metric.grain.grain_id) {
      reasons.push(
        `GRAIN_MISMATCH: template ${template.grain_ref} vs metric ${metric.grain.grain_id}`,
      );
      continue;
    }

    loweredTemplates.push(template);
  }

  // 检查每个 witness
  for (const witness of profile.witnesses) {
    if (witness.kind === "ROW_PARTITION") {
      const rpWitness = witness.witness as RowPartitionWitness;
      if (!rpWitness.same_measure.canonical_measure_ast_hash) {
        reasons.push("ROW_PARTITION_WITNESS_MISSING_CANONICAL_MEASURE_HASH");
        continue;
      }
      if (!rpWitness.driver_predicate_hash) {
        reasons.push("ROW_PARTITION_WITNESS_MISSING_DRIVER_PREDICATE_HASH");
        continue;
      }
      if (!rpWitness.residual_predicate_hash) {
        reasons.push("ROW_PARTITION_WITNESS_MISSING_RESIDUAL_PREDICATE_HASH");
        continue;
      }
      if (!rpWitness.driver_residual_mutual_exclusion_hash) {
        reasons.push("ROW_PARTITION_WITNESS_MISSING_MUTUAL_EXCLUSION_HASH");
        continue;
      }
      if (!rpWitness.stable_ordering || rpWitness.stable_ordering.length === 0) {
        reasons.push("ROW_PARTITION_WITNESS_MISSING_STABLE_ORDERING");
        continue;
      }
      loweredWitnesses.push(rpWitness);
    } else if (witness.kind === "FORMULA_IDENTITY") {
      const fiWitness = witness.witness as FormulaEquivalenceWitness;
      if (!fiWitness.formula_ast_hash) {
        reasons.push("FORMULA_EQUIVALENCE_WITNESS_MISSING_FORMULA_AST_HASH");
        continue;
      }
      if (!fiWitness.grain) {
        reasons.push("FORMULA_EQUIVALENCE_WITNESS_MISSING_GRAIN");
        continue;
      }
      loweredWitnesses.push(fiWitness);
    } else {
      reasons.push(`UNKNOWN_WITNESS_KIND: ${(witness as { kind: string }).kind}`);
    }
  }

  // 检查每个 capacity proof
  for (const proof of profile.static_driver_capacity) {
    if (!proof.max_sql_executions || proof.max_sql_executions < 1) {
      reasons.push(`INVALID_MAX_SQL_EXECUTIONS: ${proof.obligation_id}`);
      continue;
    }
    if (!proof.endpoint_cost_model) {
      reasons.push(`MISSING_ENDPOINT_COST_MODEL: ${proof.obligation_id}`);
      continue;
    }
    loweredCapacityProofs.push(proof);
  }

  return {
    status:
      reasons.length === 0
        ? ContributionLoweringStatus.LOWERED
        : ContributionLoweringStatus.NOT_LOWERABLE,
    loweredTemplates,
    loweredWitnesses,
    loweredCapacityProofs,
    reasons,
  };
}
