import {
  assertSemanticSourceBundleInvariants,
  computeExecutableSemanticDigest,
  computeSemanticSourceBundleHash,
  type DescriptiveContributionProfile,
  type RuntimeAuth,
  type SemanticDimension,
  SemanticGovernanceError,
  type SemanticMetric,
  type SemanticRelationship,
  type SemanticSourceBundle,
  semanticSourceBundleSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  ContributionLoweringStatus,
  type DescriptiveContributionLoweringResult,
  lowerDescriptiveContributionProfile,
} from "./contribution-profile-compiler.js";
import {
  computeLowerabilityProof,
  type LowerabilityResult,
  LowerabilityStatus,
} from "./lowerability-proof.js";
import {
  assertNoRelationshipIdCollision,
  type ExecutableRelationshipEdge,
  lowerAllRelationships,
} from "./relationship-lowering.js";
import {
  lowerRuntimeAuthorization,
  type RuntimeAuthLoweringResult,
  RuntimeAuthLoweringStatus,
} from "./runtime-auth-lowering.js";

// ─── Error codes ──────────────────────────────────────────────────────────────

export enum CompilationErrorCode {
  INVALID_BUNDLE = "INVALID_BUNDLE",
  NOT_LOWERABLE = "NOT_LOWERABLE",
  RELATIONSHIP_COLLISION = "RELATIONSHIP_COLLISION",
  RUNTIME_AUTH_NOT_LOWERABLE = "RUNTIME_AUTH_NOT_LOWERABLE",
  CONTRIBUTION_NOT_LOWERABLE = "CONTRIBUTION_NOT_LOWERABLE",
  METRIC_NOT_LOWERABLE = "METRIC_NOT_LOWERABLE",
  DIMENSION_NOT_LOWERABLE = "DIMENSION_NOT_LOWERABLE",
}

export interface CompilationError {
  readonly code: CompilationErrorCode;
  readonly message: string;
  readonly details: readonly string[];
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface U5SemanticProjection {
  readonly metrics: readonly SemanticMetric[];
  readonly dimensions: readonly SemanticDimension[];
  readonly formulas: readonly string[];
  readonly sourceDigest: string;
  readonly lowerabilityResult: LowerabilityResult;
}

export interface U5RelationshipProjection {
  readonly edges: readonly ExecutableRelationshipEdge[];
  readonly sourceDigest: string;
}

export interface U5RuntimeRestrictionProjection {
  readonly lowered: RuntimeAuthLoweringResult;
  readonly sourceDigest: string;
  readonly restrictionDigest: string;
}

export interface U5Projection {
  readonly semantic: U5SemanticProjection;
  readonly relationship: U5RelationshipProjection;
  readonly restriction: U5RuntimeRestrictionProjection;
  readonly bundleHash: string;
  readonly executableDigest: string;
  readonly errors: readonly CompilationError[];
}

export type LowerabilityVerdict = "LOWERABLE_TO_U5" | "NOT_LOWERABLE" | "PARTIALLY_LOWERABLE";

// ─── Main compiler ────────────────────────────────────────────────────────────

/**
 * 编译 SemanticSourceBundle 为 U5 兼容的三投影（semantic、relationship、runtime-restriction）。
 *
 * 编译流程：
 * 1. 校验 SourceBundle 不变量
 * 2. 计算 LowerabilityProof
 * 3. 降级 Relationship
 * 4. 降级 Runtime Authorization
 * 5. 降级 Contribution Profile（如果存在）
 * 6. 计算 Content Digest
 * 7. 返回 U5Projection
 */
export async function compileU5Projection(
  bundle: SemanticSourceBundle,
  catalogFence: string = "default-catalog-fence",
): Promise<U5Projection> {
  const errors: CompilationError[] = [];

  // Step 1: 校验 Bundle
  try {
    assertSemanticSourceBundleInvariants(bundle);
  } catch (error) {
    errors.push({
      code: CompilationErrorCode.INVALID_BUNDLE,
      message: error instanceof Error ? error.message : "Bundle 校验失败。",
      details: [],
    });
    return {
      semantic: {
        metrics: [],
        dimensions: [],
        formulas: [],
        sourceDigest: "",
        lowerabilityResult: { proofs: [], overallLowerable: false, unlowerableFormulaIds: [] },
      },
      relationship: { edges: [], sourceDigest: "" },
      restriction: {
        lowered: {
          status: RuntimeAuthLoweringStatus.NOT_EXPRESSIBLE_IN_U5,
          loweredRules: [],
          notExpressibleReasons: ["Bundle 校验失败"],
        },
        sourceDigest: "",
        restrictionDigest: "",
      },
      bundleHash: "",
      executableDigest: "",
      errors,
    };
  }

  // Step 2: 计算 LowerabilityProof
  const lowerabilityResult = computeLowerabilityProof(bundle);
  if (!lowerabilityResult.overallLowerable) {
    errors.push({
      code: CompilationErrorCode.NOT_LOWERABLE,
      message: `部分 Formula/metric 不可降级到 U5。`,
      details: lowerabilityResult.unlowerableFormulaIds.map((id) => `NOT_LOWERABLE: ${id}`),
    });
  }

  // Step 3: 降级 Relationship
  let edges: readonly ExecutableRelationshipEdge[] = [];
  try {
    edges = lowerAllRelationships(bundle, catalogFence);
    assertNoRelationshipIdCollision(edges);
  } catch (error) {
    errors.push({
      code: CompilationErrorCode.RELATIONSHIP_COLLISION,
      message: error instanceof Error ? error.message : "Relationship 降级失败。",
      details: [],
    });
  }

  // Step 4: 降级 Runtime Authorization
  let restrictionResult: RuntimeAuthLoweringResult = {
    status: RuntimeAuthLoweringStatus.LOWERED,
    loweredRules: [],
    notExpressibleReasons: [],
  };
  if (bundle.runtime_authorization) {
    restrictionResult = lowerRuntimeAuthorization(bundle.runtime_authorization);
    if (restrictionResult.status === RuntimeAuthLoweringStatus.NOT_EXPRESSIBLE_IN_U5) {
      errors.push({
        code: CompilationErrorCode.RUNTIME_AUTH_NOT_LOWERABLE,
        message: "Runtime Authorization 包含无法在 U5 中表达的规则。",
        details: restrictionResult.notExpressibleReasons,
      });
    }
  }

  // Step 5: 降级 Contribution Profile（如果存在）
  if (bundle.contribution_profile) {
    const contribResult = lowerDescriptiveContributionProfile(bundle, bundle.contribution_profile);
    if (contribResult.status === ContributionLoweringStatus.NOT_LOWERABLE) {
      errors.push({
        code: CompilationErrorCode.CONTRIBUTION_NOT_LOWERABLE,
        message: "Contribution Profile 包含无法降级的项。",
        details: contribResult.reasons,
      });
    }
  }

  // Step 6: 计算 Content Digest
  const bundleHash = await computeSemanticSourceBundleHash(bundle);
  const executableDigest = await computeExecutableSemanticDigest(bundle);

  // Step 7: 构建结果
  const semantic: U5SemanticProjection = {
    metrics: bundle.metrics.map((m) => ({
      ...m,
      tags: [...m.tags],
    })),
    dimensions: bundle.dimensions.map((d) => ({
      ...d,
      tags: [...d.tags],
    })),
    formulas: bundle.formulas.map((f) => f.formula_id),
    sourceDigest: bundleHash,
    lowerabilityResult,
  };

  const relationship: U5RelationshipProjection = {
    edges,
    sourceDigest: bundleHash,
  };

  const restrictionDigest =
    restrictionResult.loweredRules.length > 0
      ? JSON.stringify(
          restrictionResult.loweredRules.map((r) => ({
            tableId: r.tableId,
            action: r.action,
            columnIds: [...r.columnIds].sort(),
          })),
        )
      : "no-restrictions";

  const restriction: U5RuntimeRestrictionProjection = {
    lowered: restrictionResult,
    sourceDigest: bundleHash,
    restrictionDigest,
  };

  return {
    semantic,
    relationship,
    restriction,
    bundleHash,
    executableDigest,
    errors,
  };
}

/**
 * 获取 U5 编译的总体 verdict。
 */
export function getLowerabilityVerdict(projection: U5Projection): LowerabilityVerdict {
  if (projection.errors.length === 0 && projection.semantic.lowerabilityResult.overallLowerable) {
    return "LOWERABLE_TO_U5";
  }
  if (projection.errors.length === 0) {
    return "NOT_LOWERABLE";
  }
  return "PARTIALLY_LOWERABLE";
}
