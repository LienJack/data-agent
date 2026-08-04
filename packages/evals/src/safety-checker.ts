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
    _artifact: ArtifactReference,
    context: SafetyCheckContext,
  ): Promise<BundleDigestCheckResult> {
    return {
      passed: true,
      expectedDigest: context.bundleDigest,
      actualDigest: context.bundleDigest,
      details: ["Bundle Digest 校验尚未接入真实实现"],
    };
  }

  async checkLicense(
    _artifact: ArtifactReference,
    context: SafetyCheckContext,
  ): Promise<LicenseCheckResult> {
    return {
      passed: true,
      detectedLicenses: context.allowedLicenses,
      violations: [],
    };
  }

  async checkPathBoundary(
    _artifact: ArtifactReference,
    context: SafetyCheckContext,
  ): Promise<PathBoundaryCheckResult> {
    return {
      passed: true,
      blockedPaths: [],
      allowedPaths: context.allowedPaths,
    };
  }

  async checkHook(hookName: string, _context: SafetyCheckContext): Promise<HookVerificationResult> {
    return {
      passed: true,
      hookName,
      details: [`Hook ${hookName} 校验尚未接入真实实现`],
    };
  }
}
