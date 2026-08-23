import {
  contentHashSchema,
  semanticDimensionSchema,
  semanticExplorerSidecarSchema,
  semanticMetricSchema,
} from "@data-agent/contracts";
import { z } from "zod";

const lowerabilityProofSchema = z.strictObject({
  formulaId: z.string().min(1).max(256),
  status: z.enum(["LOWERABLE_TO_U5", "NOT_LOWERABLE"]),
  reasonCode: z.string().max(4096).nullable(),
  unreachableFormulaIds: z.array(z.string().min(1).max(256)),
  unreachableDimensionIds: z.array(z.string().min(1).max(256)),
  unreachableRelationshipIds: z.array(z.string().min(1).max(256)),
});

const lowerabilityResultSchema = z.strictObject({
  proofs: z.array(lowerabilityProofSchema),
  overallLowerable: z.boolean(),
  unlowerableFormulaIds: z.array(z.string().min(1).max(256)),
});

export const explorerExecutablePayloadSchema = z.strictObject({
  metrics: z.array(semanticMetricSchema),
  dimensions: z.array(semanticDimensionSchema),
  formulas: z.array(z.string().min(1).max(256)),
  sourceDigest: contentHashSchema,
  lowerabilityResult: lowerabilityResultSchema,
  explorer_sidecar: semanticExplorerSidecarSchema.optional(),
});

export const explorerExecutableRelationshipEdgeSchema = z.strictObject({
  relationshipId: z.string().min(1).max(256),
  analyticalId: z.string().min(1).max(256),
  physicalId: z.string().min(1).max(512),
  leftTableId: z.string().min(1).max(256),
  leftColumnIds: z.array(z.string().min(1).max(256)).min(1),
  rightTableId: z.string().min(1).max(256),
  rightColumnIds: z.array(z.string().min(1).max(256)).min(1),
  direction: z.enum(["left-to-right", "right-to-left", "bidirectional"]),
  rowPreservation: z.enum(["inner", "left", "right", "full"]),
  cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]),
  fanoutGrainProof: z.string().max(1024).nullable(),
  catalogFence: z.string().min(1).max(512),
  proofKind: z.enum(["DDL_ENFORCED", "SNAPSHOT_CERTIFIED", "DECLARED_ONLY"]),
  proofDetail: z.string().max(1024).nullable(),
});

export const explorerRelationshipPayloadSchema = z.strictObject({
  edges: z.array(explorerExecutableRelationshipEdgeSchema),
  sourceDigest: contentHashSchema,
});

const loweredAuthPredicateSchema = z.strictObject({
  tableId: z.string().min(1).max(256),
  columnId: z.string().min(1).max(256),
  operator: z.string().min(1).max(64),
  parameterKey: z.string().min(1).max(128),
});

export const explorerLoweredAuthRuleSchema = z.strictObject({
  tableId: z.string().min(1).max(256),
  action: z.enum(["DENY", "RESTRICT"]),
  columnIds: z.array(z.string().min(1).max(256)),
  predicates: z.array(loweredAuthPredicateSchema),
  canonicalOrdering: z.array(z.string().min(1).max(256)),
});

export const explorerRestrictionPayloadSchema = z.strictObject({
  lowered: z.strictObject({
    status: z.enum(["LOWERED", "NOT_EXPRESSIBLE_IN_U5"]),
    loweredRules: z.array(explorerLoweredAuthRuleSchema),
    notExpressibleReasons: z.array(z.string().min(1).max(2048)),
  }),
  sourceDigest: contentHashSchema,
  restrictionDigest: z.string().min(1).max(4096),
});

export type ExplorerExecutablePayload = z.infer<typeof explorerExecutablePayloadSchema>;
export type ExplorerRelationshipPayload = z.infer<typeof explorerRelationshipPayloadSchema>;
export type ExplorerRestrictionPayload = z.infer<typeof explorerRestrictionPayloadSchema>;
export type ExplorerLoweredAuthRule = z.infer<typeof explorerLoweredAuthRuleSchema>;
