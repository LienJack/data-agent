import { z } from "zod";
import {
  type ArtifactReference,
  type ArtifactReferenceVerifier,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import { ANALYSIS_SKILL_IDS } from "../artifacts/research/analysis.js";
import { knownArtifactTypeSchema } from "../artifacts/types.js";
import {
  contentHashSchema,
  deepFreeze,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

const releaseManifestReferenceSchema = artifactReferenceFor("ReleaseManifest");

export const SYNTHETIC_METAMORPHIC_ARTIFACT_TYPES = [
  "FixtureMutationRecord",
  "MetamorphicFixtureReceipt",
  "MetamorphicOracleReceipt",
] as const;

const productionReleaseEvidenceArtifactTypeSchema = knownArtifactTypeSchema.exclude(
  SYNTHETIC_METAMORPHIC_ARTIFACT_TYPES,
);

export const productionReleaseEvidenceReferenceSchema = artifactReferenceSchema.extend({
  artifact_type: productionReleaseEvidenceArtifactTypeSchema,
});

export const DETERMINISTIC_ANALYSIS_CAPABILITY_IDS = [
  ...ANALYSIS_SKILL_IDS,
  "certified-causal-estimate@1",
] as const;

export const deterministicAnalysisCapabilityIdSchema = z.enum(
  DETERMINISTIC_ANALYSIS_CAPABILITY_IDS,
);
export const deterministicAnalysisRegistrationStateSchema = z.enum([
  "FIXTURE_ONLY",
  "SHADOW",
  "INTERNAL",
  "GENERAL_AVAILABILITY",
  "HOLD",
  "NOT_REGISTERED",
]);

const deterministicAnalysisStageSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const deterministicAnalysisCapabilityRolloutSchema = z
  .strictObject({
    capability_id: deterministicAnalysisCapabilityIdSchema,
    stage: deterministicAnalysisStageSchema,
    registration_state: deterministicAnalysisRegistrationStateSchema,
    execution_enabled: z.boolean(),
    user_visible: z.boolean(),
    generated_programs_allowed: z.boolean(),
    kill_switch: z.strictObject({
      engaged: z.boolean(),
      reason_code: z.string().min(1).max(128).nullable(),
    }),
    evidence_refs: z.array(productionReleaseEvidenceReferenceSchema).max(32),
    promotion_blockers: z.array(z.string().min(1).max(128)).max(32),
    shadow_metrics: z.strictObject({
      oracle_score: z.number().min(0).max(100).nullable(),
      replay_match_rate: z.number().min(0).max(1).nullable(),
      safety_rejection_rate: z.number().min(0).max(1).nullable(),
      p95_elapsed_ms: z.number().nonnegative().finite().nullable(),
    }),
  })
  .superRefine((capability, ctx) => {
    const expectedState = {
      0: "FIXTURE_ONLY",
      1: "SHADOW",
      2: "SHADOW",
      3: "INTERNAL",
      4: "GENERAL_AVAILABILITY",
    } as const;
    if (
      capability.registration_state !== "HOLD" &&
      capability.registration_state !== "NOT_REGISTERED" &&
      capability.registration_state !== expectedState[capability.stage]
    ) {
      ctx.addIssue({
        code: "custom",
        message: "分析能力注册态必须与 rollout stage 一致。",
        path: ["registration_state"],
      });
    }
    if (
      capability.kill_switch.engaged &&
      (capability.execution_enabled || capability.kill_switch.reason_code === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Kill switch 启用时必须关闭执行并记录 reason code。",
        path: ["kill_switch"],
      });
    }
    if (
      ["FIXTURE_ONLY", "HOLD", "NOT_REGISTERED"].includes(capability.registration_state) &&
      capability.execution_enabled
    ) {
      ctx.addIssue({
        code: "custom",
        message: "未注册、HOLD 或仅 Fixture 的能力不可执行。",
        path: ["execution_enabled"],
      });
    }
    if (capability.registration_state === "SHADOW" && capability.user_visible) {
      ctx.addIssue({
        code: "custom",
        message: "Shadow 能力不可对用户可见。",
        path: ["user_visible"],
      });
    }
    if (
      capability.registration_state === "GENERAL_AVAILABILITY" &&
      (!capability.execution_enabled ||
        !capability.user_visible ||
        capability.kill_switch.engaged ||
        capability.evidence_refs.length === 0 ||
        capability.promotion_blockers.length > 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "GA 能力必须可执行、可见、未熔断且证据和 promotion gate 完整。",
        path: ["registration_state"],
      });
    }
    if (
      capability.capability_id !== "open-python-analysis@1" &&
      capability.generated_programs_allowed
    ) {
      ctx.addIssue({
        code: "custom",
        message: "只有 open-python-analysis 能启用 Generated Program。",
        path: ["generated_programs_allowed"],
      });
    }
  });

export const deterministicAnalysisRolloutSchema = z
  .strictObject({
    schema_version: z.literal("deterministic-analysis-rollout@1.0.0"),
    suite_version: versionIdentifierSchema,
    suite_hash: contentHashSchema,
    supply_chain: z.strictObject({
      attestation_hash: contentHashSchema,
      sbom_hash: contentHashSchema,
      cve_scan_status: z.enum(["PASS", "HOLD"]),
      license_scan_status: z.enum(["PASS", "REVIEW_REQUIRED", "HOLD"]),
      evidence_refs: z.array(productionReleaseEvidenceReferenceSchema).min(1).max(16),
    }),
    f9: z.strictObject({
      registration_status: z.enum(["REGISTERED", "NOT_REGISTERED", "HOLD"]),
      evidence_refs: z.array(productionReleaseEvidenceReferenceSchema).max(16),
    }),
    l5_gate: z.strictObject({
      decision: z.enum(["GO", "HOLD"]),
      expires_at: timestampSchema.nullable(),
      evidence_refs: z.array(productionReleaseEvidenceReferenceSchema).max(32),
    }),
    text2sql_isolation: z.strictObject({
      independent_path_verified: z.literal(true),
      verification_hash: contentHashSchema,
    }),
    capabilities: z
      .array(deterministicAnalysisCapabilityRolloutSchema)
      .length(DETERMINISTIC_ANALYSIS_CAPABILITY_IDS.length),
    rollout_hash: contentHashSchema,
  })
  .superRefine((rollout, ctx) => {
    const ids = rollout.capabilities.map(({ capability_id }) => capability_id);
    if (
      new Set(ids).size !== DETERMINISTIC_ANALYSIS_CAPABILITY_IDS.length ||
      DETERMINISTIC_ANALYSIS_CAPABILITY_IDS.some((id) => !ids.includes(id))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Rollout 必须精确覆盖每项确定性分析能力一次。",
        path: ["capabilities"],
      });
    }
    const causal = rollout.capabilities.find(
      ({ capability_id }) => capability_id === "certified-causal-estimate@1",
    );
    if (
      rollout.capabilities.some(
        ({ registration_state }) => registration_state === "GENERAL_AVAILABILITY",
      ) &&
      (rollout.supply_chain.cve_scan_status !== "PASS" ||
        rollout.supply_chain.license_scan_status !== "PASS")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "任一 GA 能力都要求 CVE 与许可证供应链门 PASS。",
        path: ["supply_chain"],
      });
    }
    if (rollout.f9.registration_status === "REGISTERED" && rollout.f9.evidence_refs.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "F9 注册必须绑定已提交 Evidence。",
        path: ["f9", "evidence_refs"],
      });
    }
    if (
      rollout.l5_gate.decision === "GO" &&
      (rollout.l5_gate.expires_at === null || rollout.l5_gate.evidence_refs.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "L5 GO 必须绑定 Evidence 和有效期。",
        path: ["l5_gate"],
      });
    }
    if (
      causal?.execution_enabled &&
      (rollout.f9.registration_status !== "REGISTERED" ||
        rollout.l5_gate.decision !== "GO" ||
        rollout.l5_gate.expires_at === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Certified Causal 只有在 F9 注册且独立 L5 Gate 有效时才可执行。",
        path: ["capabilities"],
      });
    }
  });

export type DeterministicAnalysisCapabilityRollout = z.infer<
  typeof deterministicAnalysisCapabilityRolloutSchema
>;
export type DeterministicAnalysisRollout = z.infer<typeof deterministicAnalysisRolloutSchema>;

export async function computeDeterministicAnalysisRolloutHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const rollout = deterministicAnalysisRolloutSchema.parse(input);
  const { rollout_hash: _rolloutHash, ...facts } = rollout;
  return sha256ContentHash(facts);
}

export function isDeterministicAnalysisCapabilityExecutable(
  rollout: DeterministicAnalysisRollout,
  capabilityId: (typeof DETERMINISTIC_ANALYSIS_CAPABILITY_IDS)[number],
  at: Date = new Date(),
): boolean {
  const capability = rollout.capabilities.find(
    ({ capability_id }) => capability_id === capabilityId,
  );
  if (!capability?.execution_enabled || capability.kill_switch.engaged) return false;
  if (capabilityId !== "certified-causal-estimate@1") return true;
  return Boolean(
    rollout.f9.registration_status === "REGISTERED" &&
      rollout.l5_gate.decision === "GO" &&
      rollout.l5_gate.expires_at &&
      Date.parse(rollout.l5_gate.expires_at) > at.getTime(),
  );
}

export const releaseManifestSchema = z
  .strictObject({
    schema_version: versionIdentifierSchema,
    manifest_ref: releaseManifestReferenceSchema,
    release_policy_version: versionIdentifierSchema,
    source_commit: z.string().regex(/^[a-f0-9]{7,64}$/),
    contract_version: versionIdentifierSchema,
    component_versions: z.record(versionIdentifierSchema, versionIdentifierSchema),
    workflow_version: versionIdentifierSchema,
    eval_run_refs: z.array(artifactReferenceFor("EvalRun")).min(1),
    tenancy_evidence_refs: z.array(artifactReferenceSchema).min(1),
    deployment_evidence: z.strictObject({
      hosted_refs: z.array(productionReleaseEvidenceReferenceSchema).min(1),
      docker_refs: z.array(productionReleaseEvidenceReferenceSchema).min(1),
    }),
    signed_outcome_refs: z.array(productionReleaseEvidenceReferenceSchema).min(1),
    deterministic_analysis_rollout: deterministicAnalysisRolloutSchema.optional(),
    verdict: z.literal("PASS"),
    created_at: timestampSchema,
    manifest_hash: contentHashSchema,
  })
  .superRefine((manifest, ctx) => {
    if (manifest.manifest_ref.content_hash !== manifest.manifest_hash) {
      ctx.addIssue({
        code: "custom",
        message: "ReleaseManifest Reference 必须绑定 Manifest 内容哈希。",
        path: ["manifest_ref", "content_hash"],
      });
    }

    const references = [
      ...manifest.eval_run_refs,
      ...manifest.tenancy_evidence_refs,
      ...manifest.deployment_evidence.hosted_refs,
      ...manifest.deployment_evidence.docker_refs,
      ...manifest.signed_outcome_refs,
      ...(manifest.deterministic_analysis_rollout?.supply_chain.evidence_refs ?? []),
      ...(manifest.deterministic_analysis_rollout?.f9.evidence_refs ?? []),
      ...(manifest.deterministic_analysis_rollout?.l5_gate.evidence_refs ?? []),
      ...(manifest.deterministic_analysis_rollout?.capabilities.flatMap(
        ({ evidence_refs }) => evidence_refs,
      ) ?? []),
    ];
    if (
      references.some(
        (reference) =>
          reference.app_id !== manifest.manifest_ref.app_id ||
          reference.tenant_id !== manifest.manifest_ref.tenant_id ||
          reference.environment !== manifest.manifest_ref.environment ||
          reference.run_id !== manifest.manifest_ref.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ReleaseManifest 的全部 Evidence 必须属于同一 App/Tenant/Environment/Run。",
        path: ["deployment_evidence"],
      });
    }

    const identities = references.map(artifactReferenceIdentity);
    if (new Set(identities).size !== identities.length) {
      ctx.addIssue({
        code: "custom",
        message: "ReleaseManifest 不能重复计算同一 Evidence。",
        path: ["signed_outcome_refs"],
      });
    }
  });

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export async function computeReleaseManifestHash(input: unknown): Promise<`sha256:${string}`> {
  const manifest = releaseManifestSchema.parse(input);
  const {
    manifest_hash: _manifestHash,
    manifest_ref: { content_hash: _contentHash, ...manifestIdentity },
    ...facts
  } = manifest;
  return sha256ContentHash({
    ...facts,
    manifest_ref: manifestIdentity,
  });
}

export interface ReleaseManifestAuthorityContext {
  resolveCommitted(
    reference: z.infer<typeof releaseManifestReferenceSchema>,
  ): Promise<unknown | null>;
  verifyCommitted: ArtifactReferenceVerifier;
}

export class ReleaseManifestAuthorityError extends Error {
  override readonly name = "ReleaseManifestAuthorityError";
  readonly code = "RELEASE_MANIFEST_NOT_AUTHORITATIVE";
}

declare const authoritativeReleaseManifest: unique symbol;
const authorizedReleaseManifests = new WeakSet<object>();

export type AuthoritativeReleaseManifest = ReleaseManifest & {
  readonly [authoritativeReleaseManifest]: true;
};

export async function authorizeReleaseManifest(
  referenceInput: unknown,
  authority: ReleaseManifestAuthorityContext,
): Promise<AuthoritativeReleaseManifest> {
  const reference = releaseManifestReferenceSchema.parse(referenceInput);
  const manifest = releaseManifestSchema.parse(await authority.resolveCommitted(reference));
  if (artifactReferenceIdentity(manifest.manifest_ref) !== artifactReferenceIdentity(reference)) {
    throw new ReleaseManifestAuthorityError(
      "ReleaseManifest Resolver 返回了不匹配的 Content-Addressed Revision。",
    );
  }
  if ((await computeReleaseManifestHash(manifest)) !== manifest.manifest_hash) {
    throw new ReleaseManifestAuthorityError("ReleaseManifest Hash 与规范化内容不匹配。");
  }
  if (
    manifest.deterministic_analysis_rollout &&
    (await computeDeterministicAnalysisRolloutHash(manifest.deterministic_analysis_rollout)) !==
      manifest.deterministic_analysis_rollout.rollout_hash
  ) {
    throw new ReleaseManifestAuthorityError("Deterministic Analysis Rollout Hash 不匹配。");
  }

  const evidenceReferences: ArtifactReference[] = [
    manifest.manifest_ref,
    ...manifest.eval_run_refs,
    ...manifest.tenancy_evidence_refs,
    ...manifest.deployment_evidence.hosted_refs,
    ...manifest.deployment_evidence.docker_refs,
    ...manifest.signed_outcome_refs,
    ...(manifest.deterministic_analysis_rollout?.supply_chain.evidence_refs ?? []),
    ...(manifest.deterministic_analysis_rollout?.f9.evidence_refs ?? []),
    ...(manifest.deterministic_analysis_rollout?.l5_gate.evidence_refs ?? []),
    ...(manifest.deterministic_analysis_rollout?.capabilities.flatMap(
      ({ evidence_refs }) => evidence_refs,
    ) ?? []),
  ];
  const verdicts = await Promise.all(evidenceReferences.map(authority.verifyCommitted));
  if (verdicts.some((verdict) => !verdict)) {
    throw new ReleaseManifestAuthorityError(
      "ReleaseManifest 或其 Hosted/Docker/Outcome Evidence 尚未提交。",
    );
  }

  authorizedReleaseManifests.add(manifest);
  return deepFreeze(manifest) as AuthoritativeReleaseManifest;
}

export function isAuthoritativeReleaseManifest(
  value: unknown,
): value is AuthoritativeReleaseManifest {
  return typeof value === "object" && value !== null && authorizedReleaseManifests.has(value);
}
