import { z } from "zod";
import {
  type ArtifactReference,
  type ArtifactReferenceVerifier,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  deterministicAuthoritySchema,
} from "../artifacts/envelope.js";
import {
  type AuthoritativeL2ArtifactDocument,
  isAuthoritativeL2ArtifactDocument,
  type L2ArtifactAuthorityContext,
} from "../artifacts/l2.js";
import {
  deepFreeze,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  type AuthoritativeScoreCard,
  isAuthoritativeScoreCard,
  scoreCardReference,
} from "../evals/index.js";
import {
  type AuthoritativeBenchmarkAdapterReceipt,
  type AuthoritativeSandboxExecutionReceipt,
  isAuthoritativeBenchmarkAdapterReceipt,
  isAuthoritativeSandboxExecutionReceipt,
} from "../ports/index.js";
import {
  type AuthoritativeModelCertificationReceipt,
  isAuthoritativeModelCertificationReceipt,
} from "../providers/index.js";
import {
  type AuthoritativeReleaseManifest,
  isAuthoritativeReleaseManifest,
} from "./release-manifest.js";

export * from "./release-manifest.js";
export * from "./runtime.js";

export const RUN_TERMINAL_REASON_PAIRS = [
  ["READY", "RUN_READY"],
  ["PARTIAL", "EVIDENCE_PARTIAL"],
  ["NEEDS_CLARIFICATION", "SEMANTIC_CLARIFICATION_REQUIRED"],
  ["NEEDS_MORE_RESEARCH", "EVIDENCE_COVERAGE_INSUFFICIENT"],
  ["INCONCLUSIVE", "ANALYSIS_INCONCLUSIVE"],
  ["POLICY_BLOCKED", "POLICY_SCOPE_BLOCKED"],
  ["FAILED", "INTERNAL_EXECUTION_FAILED"],
  ["CANCELLED", "RUN_CANCELLED"],
  ["STALE", "RUN_STALE"],
  ["REPLAY_UNAVAILABLE", "REPLAY_SNAPSHOT_UNAVAILABLE"],
] as const;

const runTerminalNames = RUN_TERMINAL_REASON_PAIRS.map(([terminal]) => terminal);
const runReasonCodes = RUN_TERMINAL_REASON_PAIRS.map(([, reason]) => reason);
const terminalReasonMap = new Map(RUN_TERMINAL_REASON_PAIRS);

export const runTerminalSchema = z
  .strictObject({
    app_id: immutableIdSchema,
    tenant_id: immutableIdSchema,
    environment: environmentSchema,
    run_id: immutableIdSchema,
    terminal: z.enum(runTerminalNames),
    reason_code: z.enum(runReasonCodes),
    observed_at: timestampSchema,
    artifact_refs: z.array(artifactReferenceSchema).optional(),
    authority: deterministicAuthoritySchema,
  })
  .superRefine((terminal, ctx) => {
    if (terminalReasonMap.get(terminal.terminal) !== terminal.reason_code) {
      ctx.addIssue({
        code: "custom",
        message: "Run Terminal 与 Reason Code 不匹配。",
        path: ["reason_code"],
      });
    }
    if (
      terminal.terminal === "READY" &&
      !terminal.artifact_refs?.some(
        (reference) => reference.artifact_type === "ReportReadyCertificate",
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "READY 必须绑定 ReportReadyCertificate。",
        path: ["artifact_refs"],
      });
    }
    if (
      terminal.artifact_refs?.some(
        (reference) =>
          reference.app_id !== terminal.app_id ||
          reference.tenant_id !== terminal.tenant_id ||
          reference.environment !== terminal.environment ||
          reference.run_id !== terminal.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Run Terminal 的 Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["artifact_refs"],
      });
    }
  });

export const RELEASE_DECISION_REASON_PAIRS = [
  ["GO", "RELEASE_EVIDENCE_COMPLETE"],
  ["HOLD", "RELEASE_EVIDENCE_INCOMPLETE"],
  ["NO_GO", "RELEASE_SAFETY_GATE_FAILED"],
  ["ROLLBACK", "RELEASE_REGRESSION_DETECTED"],
] as const;

const releaseDecisionNames = RELEASE_DECISION_REASON_PAIRS.map(([decision]) => decision);
const releaseReasonCodes = RELEASE_DECISION_REASON_PAIRS.map(([, reason]) => reason);
const releaseReasonMap = new Map(RELEASE_DECISION_REASON_PAIRS);

export const REQUIRED_GO_EVIDENCE_TYPES = [
  "ReportReadyCertificate",
  "ScoreCard",
  "BenchmarkAdapterReceipt",
  "SandboxExecutionReceipt",
  "ModelCertificationReceipt",
] as const;

const releaseEvidenceReferenceSchema = z.union([
  artifactReferenceFor("ReportReadyCertificate"),
  artifactReferenceFor("ScoreCard"),
  artifactReferenceFor("BenchmarkAdapterReceipt"),
  artifactReferenceFor("SandboxExecutionReceipt"),
  artifactReferenceFor("ModelCertificationReceipt"),
  artifactReferenceFor("ExternalAgentAuditReceipt"),
]);

export const releaseDecisionSchema = z
  .strictObject({
    decision_id: immutableIdSchema,
    app_id: immutableIdSchema,
    tenant_id: immutableIdSchema,
    environment: environmentSchema,
    run_id: immutableIdSchema,
    decision: z.enum(releaseDecisionNames),
    reason_code: z.enum(releaseReasonCodes),
    evidence_refs: z.array(releaseEvidenceReferenceSchema),
    release_manifest_ref: artifactReferenceFor("ReleaseManifest").optional(),
    authority: deterministicAuthoritySchema,
    release_policy_version: versionIdentifierSchema,
    decided_at: timestampSchema,
  })
  .superRefine((decision, ctx) => {
    if (releaseReasonMap.get(decision.decision) !== decision.reason_code) {
      ctx.addIssue({
        code: "custom",
        message: "Release Decision 与 Reason Code 不匹配。",
        path: ["reason_code"],
      });
    }
    if (decision.decision === "GO" && decision.evidence_refs.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "没有 Evidence 不能签发 GO。",
        path: ["evidence_refs"],
      });
    }
    if (
      decision.decision === "GO" &&
      REQUIRED_GO_EVIDENCE_TYPES.some(
        (artifactType) =>
          !decision.evidence_refs.some((reference) => reference.artifact_type === artifactType),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "GO 必须覆盖 L2、Benchmark、Sandbox 与 Model Certification 的发布证据。",
        path: ["evidence_refs"],
      });
    }
    if (decision.decision === "GO" && !decision.release_manifest_ref) {
      ctx.addIssue({
        code: "custom",
        message: "GO 必须绑定版本化 ReleaseManifest。",
        path: ["release_manifest_ref"],
      });
    }
    if (decision.decision !== "GO" && decision.release_manifest_ref) {
      ctx.addIssue({
        code: "custom",
        message: "非 GO 决策不能携带成功 ReleaseManifest。",
        path: ["release_manifest_ref"],
      });
    }
    if (
      [
        ...decision.evidence_refs,
        ...(decision.release_manifest_ref ? [decision.release_manifest_ref] : []),
      ].some(
        (reference) =>
          reference.app_id !== decision.app_id ||
          reference.tenant_id !== decision.tenant_id ||
          reference.environment !== decision.environment ||
          reference.run_id !== decision.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Release Decision、Evidence 与 Manifest 必须属于同一 App/Tenant/Environment/Run。",
        path: ["evidence_refs"],
      });
    }
  });

export class AuthorityEvidenceError extends Error {
  override readonly name = "AuthorityEvidenceError";
  readonly code = "AUTHORITY_EVIDENCE_NOT_COMMITTED";
}

declare const authoritativeRunTerminal: unique symbol;
declare const authoritativeReleaseDecision: unique symbol;
const authorizedRunTerminals = new WeakSet<object>();
const authorizedReleaseDecisions = new WeakSet<object>();

export type AuthoritativeRunTerminal = z.infer<typeof runTerminalSchema> & {
  readonly [authoritativeRunTerminal]: true;
};
export type AuthoritativeReleaseDecision = z.infer<typeof releaseDecisionSchema> & {
  readonly [authoritativeReleaseDecision]: true;
};

async function verifyCommittedReferences(
  references: ArtifactReference[],
  verifier: ArtifactReferenceVerifier,
): Promise<void> {
  const verdicts = await Promise.all(references.map(verifier));
  if (verdicts.some((verdict) => !verdict)) {
    throw new AuthorityEvidenceError("成功状态引用了未提交或无法验证的权威 Artifact。");
  }
}

async function resolveReadyCertificate(
  reference: ArtifactReference,
  authority: L2ArtifactAuthorityContext,
): Promise<AuthoritativeL2ArtifactDocument> {
  const certificate = await authority.resolveL2(reference);
  if (
    !certificate ||
    !isAuthoritativeL2ArtifactDocument(certificate) ||
    certificate.payload.artifact_type !== "ReportReadyCertificate" ||
    artifactReferenceIdentity({
      artifact_id: certificate.envelope.artifact_id,
      artifact_type: certificate.envelope.artifact_type,
      app_id: certificate.envelope.app_id,
      tenant_id: certificate.envelope.tenant_id,
      environment: certificate.envelope.environment,
      run_id: certificate.envelope.run_id,
      revision: certificate.envelope.revision,
      content_hash: certificate.envelope.content_hash,
    }) !== artifactReferenceIdentity(reference)
  ) {
    throw new AuthorityEvidenceError(
      "READY/GO 引用了不存在、未授权或不匹配的 ReportReadyCertificate。",
    );
  }
  return certificate;
}

export async function authorizeRunTerminal(
  input: unknown,
  authority: L2ArtifactAuthorityContext,
): Promise<AuthoritativeRunTerminal> {
  const terminal = runTerminalSchema.parse(input);
  await verifyCommittedReferences(terminal.artifact_refs ?? [], authority.verifyCommitted);
  if (terminal.terminal === "READY") {
    const certificate = terminal.artifact_refs?.find(
      (reference) => reference.artifact_type === "ReportReadyCertificate",
    );
    if (!certificate) {
      throw new AuthorityEvidenceError("READY 缺少 ReportReadyCertificate。");
    }
    await resolveReadyCertificate(certificate, authority);
  }
  authorizedRunTerminals.add(terminal);
  return deepFreeze(terminal) as AuthoritativeRunTerminal;
}

export interface ReleaseAuthorityContext extends L2ArtifactAuthorityContext {
  resolveScoreCard(reference: ArtifactReference): Promise<AuthoritativeScoreCard | null>;
  resolveBenchmarkAdapterReceipt(
    reference: ArtifactReference,
  ): Promise<AuthoritativeBenchmarkAdapterReceipt | null>;
  resolveSandboxExecutionReceipt(
    reference: ArtifactReference,
  ): Promise<AuthoritativeSandboxExecutionReceipt | null>;
  resolveModelCertificationReceipt(
    reference: ArtifactReference,
  ): Promise<AuthoritativeModelCertificationReceipt | null>;
  resolveReleaseManifest(
    reference: ArtifactReference,
  ): Promise<AuthoritativeReleaseManifest | null>;
}

function requireMatchingReference(
  actual: ArtifactReference,
  expected: ArtifactReference,
  message: string,
): void {
  if (artifactReferenceIdentity(actual) !== artifactReferenceIdentity(expected)) {
    throw new AuthorityEvidenceError(message);
  }
}

async function resolveGoEvidence(
  decision: ReleaseDecision,
  authority: ReleaseAuthorityContext,
): Promise<void> {
  for (const reference of decision.evidence_refs) {
    switch (reference.artifact_type) {
      case "ReportReadyCertificate":
        await resolveReadyCertificate(reference, authority);
        break;
      case "ScoreCard": {
        const scoreCard = await authority.resolveScoreCard(reference);
        if (
          !scoreCard ||
          !isAuthoritativeScoreCard(scoreCard) ||
          scoreCard.deterministic_verdict !== "PASS" ||
          scoreCard.safety_counters.some(({ count }) => count !== 0)
        ) {
          throw new AuthorityEvidenceError(
            "GO 只能消费确定性 PASS、Safety Counter 全为零的权威 ScoreCard。",
          );
        }
        requireMatchingReference(
          scoreCardReference(scoreCard),
          reference,
          "GO 的 ScoreCard Resolver 返回了不匹配的 Content-Addressed Revision。",
        );
        break;
      }
      case "BenchmarkAdapterReceipt": {
        const receipt = await authority.resolveBenchmarkAdapterReceipt(reference);
        if (!receipt || !isAuthoritativeBenchmarkAdapterReceipt(receipt)) {
          throw new AuthorityEvidenceError("GO 只能消费成功终态的权威 BenchmarkAdapterReceipt。");
        }
        requireMatchingReference(
          receipt.receipt_ref,
          reference,
          "GO 的 Benchmark Receipt Resolver 返回了不匹配的 Revision。",
        );
        break;
      }
      case "SandboxExecutionReceipt": {
        const receipt = await authority.resolveSandboxExecutionReceipt(reference);
        if (!receipt || !isAuthoritativeSandboxExecutionReceipt(receipt)) {
          throw new AuthorityEvidenceError("GO 只能消费成功终态的权威 SandboxExecutionReceipt。");
        }
        requireMatchingReference(
          receipt.receipt_ref,
          reference,
          "GO 的 Sandbox Receipt Resolver 返回了不匹配的 Revision。",
        );
        break;
      }
      case "ModelCertificationReceipt": {
        const receipt = await authority.resolveModelCertificationReceipt(reference);
        if (!receipt || !isAuthoritativeModelCertificationReceipt(receipt)) {
          throw new AuthorityEvidenceError(
            "GO 只能消费经过 Capability Hash 与持久化校验的 ModelCertificationReceipt。",
          );
        }
        requireMatchingReference(
          receipt.receipt_ref,
          reference,
          "GO 的 Model Certification Resolver 返回了不匹配的 Revision。",
        );
        break;
      }
      case "ExternalAgentAuditReceipt":
        break;
    }
  }

  const manifestReference = decision.release_manifest_ref;
  if (!manifestReference) {
    throw new AuthorityEvidenceError("GO 缺少 ReleaseManifest。");
  }
  const manifest = await authority.resolveReleaseManifest(manifestReference);
  if (!manifest || !isAuthoritativeReleaseManifest(manifest)) {
    throw new AuthorityEvidenceError("GO 只能消费经过双部署与签名结果校验的 ReleaseManifest。");
  }
  requireMatchingReference(
    manifest.manifest_ref,
    manifestReference,
    "GO 的 ReleaseManifest Resolver 返回了不匹配的 Revision。",
  );
  if (manifest.release_policy_version !== decision.release_policy_version) {
    throw new AuthorityEvidenceError(
      "ReleaseManifest 与 ReleaseDecision 必须使用同一 Release Policy Version。",
    );
  }

  const manifestEvidence = new Set(
    [
      ...manifest.eval_run_refs,
      ...manifest.tenancy_evidence_refs,
      ...manifest.deployment_evidence.hosted_refs,
      ...manifest.deployment_evidence.docker_refs,
      ...manifest.signed_outcome_refs,
    ].map(artifactReferenceIdentity),
  );
  if (
    decision.evidence_refs.some(
      (reference) => !manifestEvidence.has(artifactReferenceIdentity(reference)),
    )
  ) {
    throw new AuthorityEvidenceError(
      "ReleaseManifest 必须汇总 ReleaseDecision 使用的全部领域 Evidence。",
    );
  }
}

export async function authorizeReleaseDecision(
  input: unknown,
  authority: ReleaseAuthorityContext,
): Promise<AuthoritativeReleaseDecision> {
  const decision = releaseDecisionSchema.parse(input);
  await verifyCommittedReferences(
    [
      ...decision.evidence_refs,
      ...(decision.release_manifest_ref ? [decision.release_manifest_ref] : []),
    ],
    authority.verifyCommitted,
  );
  if (decision.decision === "GO") {
    await resolveGoEvidence(decision, authority);
  }
  authorizedReleaseDecisions.add(decision);
  return deepFreeze(decision) as AuthoritativeReleaseDecision;
}

export function isAuthoritativeRunTerminal(value: unknown): value is AuthoritativeRunTerminal {
  return typeof value === "object" && value !== null && authorizedRunTerminals.has(value);
}

export function isAuthoritativeReleaseDecision(
  value: unknown,
): value is AuthoritativeReleaseDecision {
  return typeof value === "object" && value !== null && authorizedReleaseDecisions.has(value);
}

export type RunTerminal = z.infer<typeof runTerminalSchema>;
export type ReleaseDecision = z.infer<typeof releaseDecisionSchema>;
