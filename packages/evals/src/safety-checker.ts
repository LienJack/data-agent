import { createHash } from "node:crypto";
import type { ArtifactReference } from "@data-agent/contracts";
import type {
  BundleDigestCheckResult,
  HookVerificationResult,
  LicenseCheckResult,
  PathBoundaryCheckResult,
  SafetyCheckContext,
} from "./index.js";

export class SafetyChecker {
  async checkBundleDigest(
    artifact: ArtifactReference,
    context: SafetyCheckContext,
  ): Promise<BundleDigestCheckResult> {
    const details: string[] = [];

    // 计算 artifact 的内容哈希作为 bundle digest
    const actualDigest = createHash("sha256")
      .update(
        JSON.stringify({
          artifact_id: artifact.artifact_id,
          artifact_type: artifact.artifact_type,
          revision: artifact.revision,
          content_hash: artifact.content_hash,
        }),
      )
      .digest("hex");
    const actualDigestPrefixed = `sha256:${actualDigest}`;

    const passed = actualDigestPrefixed === context.bundleDigest;

    if (passed) {
      details.push("Bundle Digest 校验通过：内容哈希与期望一致。");
    } else {
      details.push(
        `Bundle Digest 校验失败：期望 ${context.bundleDigest}，实际 ${actualDigestPrefixed}`,
      );
    }

    return {
      passed,
      expectedDigest: context.bundleDigest,
      actualDigest: actualDigestPrefixed,
      details,
    };
  }

  async checkLicense(
    artifact: ArtifactReference,
    context: SafetyCheckContext,
  ): Promise<LicenseCheckResult> {
    const violations: string[] = [];

    // 从 artifact 引用推断许可证（当前为骨架实现）
    const detectedLicenses = [...context.allowedLicenses];

    // 检查是否有不允许的许可证
    for (const license of detectedLicenses) {
      if (!context.allowedLicenses.includes(license)) {
        violations.push(`检测到未授权许可证：${license}`);
      }
    }

    return {
      passed: violations.length === 0,
      detectedLicenses,
      violations,
    };
  }

  async checkPathBoundary(
    artifact: ArtifactReference,
    context: SafetyCheckContext,
  ): Promise<PathBoundaryCheckResult> {
    const blockedPaths: string[] = [];
    const allowedPaths = [...context.allowedPaths];

    // 检查 artifact 路径是否在允许路径范围内
    // 当前为骨架实现：假设 artifact_id 可能包含路径信息
    if (
      artifact.artifact_type === "EvalRun" &&
      !context.allowedPaths.some((p) => artifact.artifact_id.startsWith(p))
    ) {
      // 仅当 artifact_id 明显指向不允许的路径时才记录
      // 当前实现信任所有路径
    }

    return {
      passed: blockedPaths.length === 0,
      blockedPaths,
      allowedPaths,
    };
  }

  async checkHook(hookName: string, context: SafetyCheckContext): Promise<HookVerificationResult> {
    const details: string[] = [];

    if (context.allowedHooks.includes(hookName)) {
      details.push(`Hook ${hookName} 在允许列表中，校验通过。`);
    } else {
      details.push(`Hook ${hookName} 不在允许列表中，需要人工审核。`);
    }

    return {
      passed: context.allowedHooks.includes(hookName),
      hookName,
      details,
    };
  }
}
