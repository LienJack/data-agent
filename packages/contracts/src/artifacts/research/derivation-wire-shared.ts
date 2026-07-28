import { z } from "zod";
import { appScopeSchema, type ContentHash, canonicalizeJson } from "../../common/index.js";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
} from "../envelope.js";
import {
  coverageCountsSchema,
  deriveCoverageCounts,
  obligationCoverageSchema,
} from "./coverage.js";
import {
  computeResearchKernelHashV2,
  orderedDistinctReferencesV2,
  projectResearchHashJson,
} from "./derivation-primitives.js";
import {
  researchBudgetBalanceSchema,
  researchBudgetLimitSchema,
  researchBudgetUsageSchema,
  versionFrontierSchema,
} from "./planning.js";
import {
  contentHashSchema,
  idempotencyKeySchema,
  identifierSchema,
  immutableIdSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  RESEARCH_RUNTIME_LIMITS,
  timestampSchema,
  U6_WIRE_LIMITS,
  uniqueIdentifierArraySchema,
  uniqueReasonCodeArraySchema,
  versionIdentifierSchema,
} from "./primitives.js";
import {
  atomicClaimRefSchema,
  coverageStateRefSchema,
  embeddedNodeReferenceIdentity,
  evidencePlanRefSchema,
  evidenceRelationRefSchema,
  hypothesisAssessmentRefSchema,
  obligationExecutionDecisionRefSchema,
  proofObligationRefSchema,
  queryContractRefSchema,
  queryEvidenceRefSchema,
  researchBriefRefSchema,
  researchStopDecisionRefSchema,
  supportDecisionRefSchema,
} from "./references.js";
import { candidateQueryAssessmentSchema, supportedSubsetBindingSchema } from "./stop.js";

type AnyArtifactReferenceSchema = z.ZodType<ArtifactReference>;

const databaseUtcTimestampSchema = timestampSchema.regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
  "数据库时间戳必须是 UTC RFC3339 且固定六位小数。",
);

function parseInertWireInput<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  return schema.parse(projectResearchHashJson(input));
}

// Wire Registry imports this module, while platform.ts imports the Registry.
// Keep the exact five-field command base local to avoid a runtime module cycle.
const strictResearchCommandBaseSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  idempotency_key: idempotencyKeySchema,
});

function addCanonicalArtifactReferenceIssues(
  values: readonly ArtifactReference[],
  ctx: z.RefinementCtx,
  path: PropertyKey[] = [],
): void {
  let ordered: ArtifactReference[];
  try {
    ordered = orderedDistinctReferencesV2(values);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Artifact Reference v2 数组不接受 duplicate identity。",
      path,
    });
    return;
  }

  for (const [index, reference] of values.entries()) {
    if (
      artifactReferenceIdentity(reference) !==
      artifactReferenceIdentity(ordered[index] as ArtifactReference)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Artifact Reference v2 数组必须按完整 Identity 升序。",
        path: [...path, index],
      });
      return;
    }
  }
}

function addDistinctArtifactReferenceIssues(
  values: readonly ArtifactReference[],
  ctx: z.RefinementCtx,
  path: PropertyKey[] = [],
): void {
  const identities = values.map(artifactReferenceIdentity);
  if (new Set(identities).size !== identities.length) {
    ctx.addIssue({
      code: "custom",
      message: "Artifact Reference v2 数组不接受 duplicate identity。",
      path,
    });
  }
}

function orderedArtifactReferenceArraySchema<TSchema extends AnyArtifactReferenceSchema>(
  schema: TSchema,
  min: number,
  max: number,
) {
  return z
    .array(schema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addCanonicalArtifactReferenceIssues(values, ctx);
    });
}

function addCanonicalEmbeddedReferenceIssues(
  values: readonly z.infer<typeof proofObligationRefSchema>[],
  ctx: z.RefinementCtx,
  path: PropertyKey[] = [],
): void {
  const identities = values.map(embeddedNodeReferenceIdentity);
  const ordered = [...identities].sort();
  if (new Set(identities).size !== identities.length) {
    ctx.addIssue({
      code: "custom",
      message: "Embedded Reference v2 数组不接受 duplicate identity。",
      path,
    });
    return;
  }
  for (const [index, identity] of identities.entries()) {
    if (identity !== ordered[index]) {
      ctx.addIssue({
        code: "custom",
        message: "Embedded Reference v2 数组必须按 container identity、node_id 升序。",
        path: [...path, index],
      });
      return;
    }
  }
}

function orderedProofObligationReferenceArraySchema(min: number, max: number) {
  return z
    .array(proofObligationRefSchema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addCanonicalEmbeddedReferenceIssues(values, ctx);
    });
}

function sequentialContentHashArraySchema(min: number, max: number) {
  return z
    .array(contentHashSchema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      if (new Set(values).size !== values.length) {
        ctx.addIssue({
          code: "custom",
          message: "顺序 Hash 链不接受 duplicate。",
        });
      }
    });
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function referenceMatchesScope(
  reference: ArtifactReference,
  scope: z.infer<typeof appScopeSchema>,
  runId: string,
): boolean {
  return (
    reference.app_id === scope.app_id &&
    reference.tenant_id === scope.tenant_id &&
    reference.environment === scope.environment &&
    reference.run_id === runId
  );
}

function systemReferenceMatchesScope(
  reference: {
    readonly scope: z.infer<typeof appScopeSchema>;
    readonly run_id: string;
  },
  scope: z.infer<typeof appScopeSchema>,
  runId: string,
): boolean {
  return sameJson(reference.scope, scope) && reference.run_id === runId;
}

function addScopedReferenceIssues(
  references: readonly ArtifactReference[],
  scope: z.infer<typeof appScopeSchema>,
  runId: string,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
): void {
  for (const [index, reference] of references.entries()) {
    if (!referenceMatchesScope(reference, scope, runId)) {
      ctx.addIssue({
        code: "custom",
        message: "Reference 必须与对象属于同一 Scope/Run。",
        path: [...path, index],
      });
    }
  }
}

/**
 * ArtifactReference wire 不携带 schema/protocol version。该 alias 只表达
 * CoverageState v2 的语义位置；exact `2.0.0/coverage-state@2.0.0` 必须由
 * Registry/DB resolution 验证。
 */
export const coverageStateV2RefSchema = coverageStateRefSchema;

/**
 * ArtifactReference wire 不携带 schema/protocol version。该 alias 只表达
 * ResearchStopDecision v2 的语义位置；exact `2.0.0/research-stop@2.0.0`
 * 必须由 Registry/DB resolution 验证。
 */
export const researchStopDecisionV2RefSchema = researchStopDecisionRefSchema;

/**
 * 同上，ReportReadyCertificate `3.0.0/report-ready@3.0.0` 由 Registry/DB
 * resolution 验证，不向 ArtifactReference 偷加 version 字段。
 */
export const reportReadyCertificateV3RefSchema = artifactReferenceFor("ReportReadyCertificate");

export const receiptBindingSchema = z.strictObject({
  receipt_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
});

export type { ArtifactReference, ContentHash };
export {
  addCanonicalArtifactReferenceIssues,
  addCanonicalEmbeddedReferenceIssues,
  addDistinctArtifactReferenceIssues,
  addScopedReferenceIssues,
  appScopeSchema,
  artifactReferenceFor,
  artifactReferenceIdentity,
  atomicClaimRefSchema,
  candidateQueryAssessmentSchema,
  canonicalizeJson,
  computeResearchKernelHashV2,
  contentHashSchema,
  coverageCountsSchema,
  coverageStateRefSchema,
  databaseUtcTimestampSchema,
  deriveCoverageCounts,
  embeddedNodeReferenceIdentity,
  evidencePlanRefSchema,
  evidenceRelationRefSchema,
  hypothesisAssessmentRefSchema,
  idempotencyKeySchema,
  identifierSchema,
  immutableIdSchema,
  nonNegativeIntSchema,
  obligationCoverageSchema,
  obligationExecutionDecisionRefSchema,
  orderedArtifactReferenceArraySchema,
  orderedDistinctReferencesV2,
  orderedProofObligationReferenceArraySchema,
  parseInertWireInput,
  positiveIntSchema,
  projectResearchHashJson,
  proofObligationRefSchema,
  queryContractRefSchema,
  queryEvidenceRefSchema,
  RESEARCH_RUNTIME_LIMITS,
  referenceMatchesScope,
  researchBriefRefSchema,
  researchBudgetBalanceSchema,
  researchBudgetLimitSchema,
  researchBudgetUsageSchema,
  researchStopDecisionRefSchema,
  sameJson,
  sameStringSet,
  sequentialContentHashArraySchema,
  strictResearchCommandBaseSchema,
  supportDecisionRefSchema,
  supportedSubsetBindingSchema,
  systemReferenceMatchesScope,
  timestampSchema,
  U6_WIRE_LIMITS,
  uniqueIdentifierArraySchema,
  uniqueReasonCodeArraySchema,
  versionFrontierSchema,
  versionIdentifierSchema,
  z,
};

export type CoverageStateV2Ref = z.infer<typeof coverageStateV2RefSchema>;
export type ResearchStopDecisionV2Ref = z.infer<typeof researchStopDecisionV2RefSchema>;
export type ReportReadyCertificateV3Ref = z.infer<typeof reportReadyCertificateV3RefSchema>;
export type ReceiptBinding = z.infer<typeof receiptBindingSchema>;
