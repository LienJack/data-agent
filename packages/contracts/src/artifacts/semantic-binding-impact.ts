import { z } from "zod";
import {
  schemaDriftDatasourceIdSchema,
  schemaDriftEventSchema,
  schemaDriftOperationSchema,
} from "../catalog/index.js";
import {
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  ontologyConstraintSchema,
  ontologyMetricBindingSchema,
  ontologyPhysicalMappingSchema,
  ontologySemanticRoleSchema,
} from "./ontology-package.js";
import {
  semanticBaseReleaseIdentitySchema,
  semanticCandidateOperationSchema,
} from "./semantic-candidate-generation.js";
import { semanticScopeSchema } from "./semantic-control-plane.js";
import { semanticRiskLevelSchema } from "./semantic-governance-requests.js";
import { semanticGraphEdgeSchema } from "./semantic-graph-v2.js";

export const SEMANTIC_BINDING_IMPACT_AUTHORITY_VERSION =
  "semantic-binding-impact-authority@1.0.0" as const;
export const SEMANTIC_BINDING_IMPACT_PLAN_VERSION = "semantic-binding-impact-plan@1.0.0" as const;
export const SEMANTIC_BINDING_IMPACT_RECEIPT_VERSION =
  "semantic-binding-impact-receipt@1.0.0" as const;
export const SEMANTIC_BINDING_IMPACT_SAFE_PROJECTION_VERSION =
  "semantic-binding-impact-safe-projection@1.0.0" as const;

export const semanticBindingImpactAnalyzeRequestSchema = z.strictObject({
  schema_version: z.literal("semantic-binding-impact-analyze@1.0.0"),
  semantic_domain: semanticScopeSchema.shape.semantic_domain,
  datasource_id: schemaDriftDatasourceIdSchema,
  drift_event_id: immutableIdSchema,
});

function canonicalStrings(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || (values[index - 1] ?? "") < value)
  );
}

function canonicalBy<T>(values: readonly T[], identity: (value: T) => string): boolean {
  return canonicalStrings(values.map(identity));
}

export function uuidV8FromContentHash(hash: string): string {
  contentHashSchema.parse(hash);
  const digits = hash.slice("sha256:".length, "sha256:".length + 32).split("");
  if (digits.length !== 32) throw new TypeError("SEMANTIC_BINDING_IMPACT_HASH_INVALID");
  digits[12] = "8";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export const semanticBindingImpactReleaseObjectSchema = z.strictObject({
  object_id: immutableIdSchema,
  graph_entry_kind: z.enum(["NODE", "EDGE", "AUXILIARY"]),
  graph_entry_id: versionIdentifierSchema,
  semantic_role: ontologySemanticRoleSchema,
  resolution: z.enum(["RESOLVED", "UNRESOLVED"]),
  object_hash: contentHashSchema,
});

export const semanticBindingImpactPackageProjectionSchema = z
  .strictObject({
    namespace_id: immutableIdSchema,
    package_id: immutableIdSchema,
    package_version: z.number().int().positive().safe(),
    package_hash: contentHashSchema,
    objects: z.array(semanticBindingImpactReleaseObjectSchema).max(100_000),
    physical_mappings: z.array(ontologyPhysicalMappingSchema).max(100_000),
    metric_bindings: z.array(ontologyMetricBindingSchema).max(100_000),
    constraints: z.array(ontologyConstraintSchema).max(100_000),
    graph_edges: z.array(semanticGraphEdgeSchema).max(250_000),
  })
  .superRefine((projection, context) => {
    const checks = [
      [canonicalBy(projection.objects, (value) => value.object_id), "objects"],
      [canonicalBy(projection.physical_mappings, (value) => value.mapping_id), "physical_mappings"],
      [
        canonicalBy(projection.metric_bindings, (value) => value.metric_object_id),
        "metric_bindings",
      ],
      [canonicalBy(projection.constraints, (value) => value.constraint_id), "constraints"],
      [canonicalBy(projection.graph_edges, (value) => value.edge_id), "graph_edges"],
    ] as const;
    for (const [canonical, path] of checks) {
      if (!canonical) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} 必须唯一且使用 canonical order。`,
        });
      }
    }
  });

const semanticBindingImpactAuthorityMaterialSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_BINDING_IMPACT_AUTHORITY_VERSION),
    scope: semanticScopeSchema,
    datasource_id: schemaDriftDatasourceIdSchema,
    drift: z.strictObject({
      event: schemaDriftEventSchema,
      event_storage_digest: contentHashSchema,
    }),
    release: semanticBaseReleaseIdentitySchema,
    packages: z.array(semanticBindingImpactPackageProjectionSchema).min(1).max(1_000),
  })
  .superRefine((bundle, context) => {
    if (bundle.drift.event.datasource_id !== bundle.datasource_id) {
      context.addIssue({
        code: "custom",
        path: ["drift", "event", "datasource_id"],
        message: "Schema drift datasource 必须与 Binding Impact datasource 一致。",
      });
    }
    if (
      !canonicalBy(
        bundle.packages,
        (entry) => `${entry.package_id}\u0000${String(entry.package_version).padStart(16, "0")}`,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["packages"],
        message: "Published packages 必须唯一且使用 canonical order。",
      });
    }
    const objectIds = new Set<string>();
    const mappingIds = new Set<string>();
    for (const [packageIndex, packageProjection] of bundle.packages.entries()) {
      for (const [objectIndex, object] of packageProjection.objects.entries()) {
        if (objectIds.has(object.object_id)) {
          context.addIssue({
            code: "custom",
            path: ["packages", packageIndex, "objects", objectIndex, "object_id"],
            message: "Published release 中的 object_id 必须全局唯一。",
          });
        }
        objectIds.add(object.object_id);
      }
      for (const [mappingIndex, mapping] of packageProjection.physical_mappings.entries()) {
        if (mappingIds.has(mapping.mapping_id)) {
          context.addIssue({
            code: "custom",
            path: ["packages", packageIndex, "physical_mappings", mappingIndex, "mapping_id"],
            message: "Published release 中的 mapping_id 必须全局唯一。",
          });
        }
        mappingIds.add(mapping.mapping_id);
        if (
          mapping.datasource_id !== bundle.datasource_id ||
          mapping.snapshot_content_hash !== bundle.drift.event.base_snapshot_content_hash
        ) {
          context.addIssue({
            code: "custom",
            path: ["packages", packageIndex, "physical_mappings", mappingIndex],
            message: "Published mapping 必须绑定 drift 的 datasource 与 base snapshot。",
          });
        }
      }
    }
  });

export const semanticBindingImpactAuthorityBundleSchema =
  semanticBindingImpactAuthorityMaterialSchema.extend({
    authority_input_hash: contentHashSchema,
  });

export async function computeSemanticBindingImpactAuthorityHash(input: unknown) {
  const parsed = semanticBindingImpactAuthorityBundleSchema.safeParse(input);
  const material = parsed.success
    ? semanticBindingImpactAuthorityMaterialSchema.parse(
        Object.fromEntries(
          Object.entries(parsed.data).filter(([key]) => key !== "authority_input_hash"),
        ),
      )
    : semanticBindingImpactAuthorityMaterialSchema.parse(input);
  return sha256ContentHash(material);
}

export async function buildSemanticBindingImpactAuthorityBundle(input: unknown) {
  const material = semanticBindingImpactAuthorityMaterialSchema.parse(input);
  return deepFreeze(
    semanticBindingImpactAuthorityBundleSchema.parse({
      ...material,
      authority_input_hash: await computeSemanticBindingImpactAuthorityHash(material),
    }),
  );
}

export async function verifySemanticBindingImpactAuthorityBundle(input: unknown) {
  const bundle = semanticBindingImpactAuthorityBundleSchema.parse(input);
  if ((await computeSemanticBindingImpactAuthorityHash(bundle)) !== bundle.authority_input_hash) {
    throw new TypeError("SEMANTIC_BINDING_IMPACT_AUTHORITY_HASH_MISMATCH");
  }
  return deepFreeze(bundle);
}

export const semanticBindingImpactStatusSchema = z.enum([
  "NO_SEMANTIC_ACTION",
  "REVIEW_REQUIRED",
  "MANUAL_INVESTIGATION",
]);

export const semanticBindingImpactActionSchema = z.enum([
  "REVIEW_MAPPING",
  "REMAP_COLUMN",
  "REVALIDATE_FORMULA",
  "REVALIDATE_JOIN",
  "NO_SEMANTIC_ACTION",
  "MANUAL_INVESTIGATION",
]);

export const semanticBindingImpactReasonSchema = z.enum([
  "AMBIGUOUS_PHYSICAL_MAPPING",
  "UNKNOWN_DEPENDENCY_LINEAGE",
  "UNSUPPORTED_DRIFT_OPERATION",
  "CANDIDATE_OPERATION_LIMIT_EXCEEDED",
  "DANGLING_RELEASE_REFERENCE",
]);

export const semanticBindingImpactObjectKindSchema = z.enum([
  "PHYSICAL_MAPPING",
  "ENTITY",
  "DIMENSION",
  "METRIC",
  "RELATIONSHIP",
  "FORMULA",
  "CONSTRAINT",
  "OTHER",
]);

export const semanticBindingImpactDirectImpactSchema = z.strictObject({
  operation_hash: contentHashSchema,
  operation: schemaDriftOperationSchema,
  mapping_id: immutableIdSchema,
  logical_object_id: immutableIdSchema,
  mapping_hash: contentHashSchema,
  risk_level: semanticRiskLevelSchema,
  suggested_action: semanticBindingImpactActionSchema,
});

export const semanticBindingImpactTransitiveImpactSchema = z.strictObject({
  object_id: immutableIdSchema,
  object_kind: semanticBindingImpactObjectKindSchema,
  object_hash: contentHashSchema,
  source_object_ids: z.array(immutableIdSchema).min(1).max(1_000),
  risk_level: semanticRiskLevelSchema,
  suggested_action: semanticBindingImpactActionSchema,
});

const semanticBindingImpactPlanMaterialSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_BINDING_IMPACT_PLAN_VERSION),
    impact_id: immutableIdSchema,
    scope: semanticScopeSchema,
    datasource_id: schemaDriftDatasourceIdSchema,
    authority_input_hash: contentHashSchema,
    drift_ref: z.strictObject({
      drift_event_id: immutableIdSchema,
      event_storage_digest: contentHashSchema,
      base_snapshot_content_hash: contentHashSchema,
      current_snapshot_content_hash: contentHashSchema,
    }),
    release_ref: semanticBaseReleaseIdentitySchema,
    status: semanticBindingImpactStatusSchema,
    risk_level: semanticRiskLevelSchema,
    direct_impacts: z.array(semanticBindingImpactDirectImpactSchema).max(100_000),
    transitive_impacts: z.array(semanticBindingImpactTransitiveImpactSchema).max(100_000),
    unchanged_object_hashes: z
      .array(z.strictObject({ object_id: immutableIdSchema, object_hash: contentHashSchema }))
      .max(100_000),
    suggested_actions: z.array(semanticBindingImpactActionSchema).max(6),
    manual_reason_codes: z.array(semanticBindingImpactReasonSchema).max(5),
    candidate_operations: z.array(semanticCandidateOperationSchema).max(256),
  })
  .superRefine((plan, context) => {
    const checks = [
      [
        canonicalBy(
          plan.direct_impacts,
          (value) => `${value.operation_hash}\u0000${value.mapping_id}`,
        ),
        "direct_impacts",
      ],
      [canonicalBy(plan.transitive_impacts, (value) => value.object_id), "transitive_impacts"],
      [
        canonicalBy(plan.unchanged_object_hashes, (value) => value.object_id),
        "unchanged_object_hashes",
      ],
      [
        canonicalBy(plan.candidate_operations, (value) => value.operation_id),
        "candidate_operations",
      ],
    ] as const;
    for (const [canonical, path] of checks) {
      if (!canonical) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} 必须唯一且使用 canonical order。`,
        });
      }
    }
    if (!canonicalStrings(plan.suggested_actions) || !canonicalStrings(plan.manual_reason_codes)) {
      context.addIssue({
        code: "custom",
        path: ["suggested_actions"],
        message: "Action 与 manual reason 必须唯一且使用 canonical order。",
      });
    }
    for (const [index, impact] of plan.transitive_impacts.entries()) {
      if (!canonicalStrings(impact.source_object_ids)) {
        context.addIssue({
          code: "custom",
          path: ["transitive_impacts", index, "source_object_ids"],
          message: "Transitive source IDs 必须唯一且使用 canonical order。",
        });
      }
    }
    if (
      plan.status === "NO_SEMANTIC_ACTION" &&
      (plan.direct_impacts.length > 0 ||
        plan.transitive_impacts.length > 0 ||
        plan.candidate_operations.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "NO_SEMANTIC_ACTION 不能携带影响或 Candidate 操作。",
      });
    }
    if (plan.status === "REVIEW_REQUIRED" && plan.candidate_operations.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["candidate_operations"],
        message: "REVIEW_REQUIRED 必须携带至少一个安全 Candidate 操作。",
      });
    }
    if (plan.status === "MANUAL_INVESTIGATION" && plan.manual_reason_codes.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["manual_reason_codes"],
        message: "MANUAL_INVESTIGATION 必须携带显式 reason code。",
      });
    }
  });

export const semanticBindingImpactPlanSchema = semanticBindingImpactPlanMaterialSchema.extend({
  plan_hash: contentHashSchema,
});

export async function computeSemanticBindingImpactPlanHash(input: unknown) {
  const parsed = semanticBindingImpactPlanSchema.safeParse(input);
  const material = parsed.success
    ? semanticBindingImpactPlanMaterialSchema.parse(
        Object.fromEntries(Object.entries(parsed.data).filter(([key]) => key !== "plan_hash")),
      )
    : semanticBindingImpactPlanMaterialSchema.parse(input);
  return sha256ContentHash(material);
}

export async function buildSemanticBindingImpactPlan(input: unknown) {
  const material = semanticBindingImpactPlanMaterialSchema.parse(input);
  const expectedImpactId = uuidV8FromContentHash(material.authority_input_hash);
  if (material.impact_id !== expectedImpactId) {
    throw new TypeError("SEMANTIC_BINDING_IMPACT_ID_MISMATCH");
  }
  for (const impact of material.direct_impacts) {
    if ((await sha256ContentHash(impact.operation)) !== impact.operation_hash) {
      throw new TypeError("SEMANTIC_BINDING_IMPACT_OPERATION_HASH_MISMATCH");
    }
  }
  return deepFreeze(
    semanticBindingImpactPlanSchema.parse({
      ...material,
      plan_hash: await computeSemanticBindingImpactPlanHash(material),
    }),
  );
}

export async function verifySemanticBindingImpactPlan(input: unknown, authorityInput?: unknown) {
  const plan = semanticBindingImpactPlanSchema.parse(input);
  if (plan.impact_id !== uuidV8FromContentHash(plan.authority_input_hash)) {
    throw new TypeError("SEMANTIC_BINDING_IMPACT_ID_MISMATCH");
  }
  if ((await computeSemanticBindingImpactPlanHash(plan)) !== plan.plan_hash) {
    throw new TypeError("SEMANTIC_BINDING_IMPACT_PLAN_HASH_MISMATCH");
  }
  for (const impact of plan.direct_impacts) {
    if ((await sha256ContentHash(impact.operation)) !== impact.operation_hash) {
      throw new TypeError("SEMANTIC_BINDING_IMPACT_OPERATION_HASH_MISMATCH");
    }
  }
  if (authorityInput !== undefined) {
    const authority = await verifySemanticBindingImpactAuthorityBundle(authorityInput);
    if (
      plan.authority_input_hash !== authority.authority_input_hash ||
      canonicalizeJson(plan.scope) !== canonicalizeJson(authority.scope) ||
      plan.datasource_id !== authority.datasource_id ||
      plan.drift_ref.drift_event_id !== authority.drift.event.drift_event_id ||
      plan.drift_ref.event_storage_digest !== authority.drift.event_storage_digest ||
      plan.drift_ref.base_snapshot_content_hash !==
        authority.drift.event.base_snapshot_content_hash ||
      plan.drift_ref.current_snapshot_content_hash !==
        authority.drift.event.current_snapshot_content_hash ||
      canonicalizeJson(plan.release_ref) !== canonicalizeJson(authority.release)
    ) {
      throw new TypeError("SEMANTIC_BINDING_IMPACT_AUTHORITY_MISMATCH");
    }
  }
  return deepFreeze(plan);
}

export const semanticBindingImpactCandidateRefSchema = z.strictObject({
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
  source_revision_id: immutableIdSchema,
  source_digest: contentHashSchema,
  revision_digest: contentHashSchema,
});

const semanticBindingImpactReceiptMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_BINDING_IMPACT_RECEIPT_VERSION),
  authority: z.literal("POSTGRESQL"),
  impact_id: immutableIdSchema,
  scope: semanticScopeSchema,
  datasource_id: schemaDriftDatasourceIdSchema,
  authority_input_hash: contentHashSchema,
  plan_hash: contentHashSchema,
  drift_event_id: immutableIdSchema,
  release: semanticBaseReleaseIdentitySchema,
  status: semanticBindingImpactStatusSchema,
  risk_level: semanticRiskLevelSchema,
  direct_impact_count: z.number().int().nonnegative().safe(),
  transitive_impact_count: z.number().int().nonnegative().safe(),
  suggested_actions: z.array(semanticBindingImpactActionSchema).max(6),
  manual_reason_codes: z.array(semanticBindingImpactReasonSchema).max(5),
  candidate_ref: semanticBindingImpactCandidateRefSchema.nullable(),
  committed_at: timestampSchema,
});

export const semanticBindingImpactCommitReceiptSchema =
  semanticBindingImpactReceiptMaterialSchema.extend({
    receipt_hash: contentHashSchema,
    created: z.boolean(),
  });

export async function computeSemanticBindingImpactReceiptHash(input: unknown) {
  const parsed = semanticBindingImpactCommitReceiptSchema.safeParse(input);
  const material = parsed.success
    ? semanticBindingImpactReceiptMaterialSchema.parse(
        Object.fromEntries(
          Object.entries(parsed.data).filter(
            ([key]) => key !== "receipt_hash" && key !== "created",
          ),
        ),
      )
    : semanticBindingImpactReceiptMaterialSchema.parse(input);
  return sha256ContentHash(material);
}

export async function verifySemanticBindingImpactCommitReceipt(input: unknown) {
  const receipt = semanticBindingImpactCommitReceiptSchema.parse(input);
  if ((await computeSemanticBindingImpactReceiptHash(receipt)) !== receipt.receipt_hash) {
    throw new TypeError("SEMANTIC_BINDING_IMPACT_RECEIPT_HASH_MISMATCH");
  }
  if (
    (receipt.status === "REVIEW_REQUIRED") !== (receipt.candidate_ref !== null) ||
    !canonicalStrings(receipt.suggested_actions) ||
    !canonicalStrings(receipt.manual_reason_codes)
  ) {
    throw new TypeError("SEMANTIC_BINDING_IMPACT_RECEIPT_CLOSURE_MISMATCH");
  }
  return deepFreeze(receipt);
}

export const semanticBindingImpactSafeProjectionSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_BINDING_IMPACT_SAFE_PROJECTION_VERSION),
  impact_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
  plan_hash: contentHashSchema,
  drift_event_id: immutableIdSchema,
  release: semanticBaseReleaseIdentitySchema,
  status: semanticBindingImpactStatusSchema,
  risk_level: semanticRiskLevelSchema,
  direct_impact_count: z.number().int().nonnegative().safe(),
  transitive_impact_count: z.number().int().nonnegative().safe(),
  suggested_actions: z.array(semanticBindingImpactActionSchema).max(6),
  manual_reason_codes: z.array(semanticBindingImpactReasonSchema).max(5),
  candidate_ref: semanticBindingImpactCandidateRefSchema.nullable(),
  committed_at: timestampSchema,
});

export type SemanticBindingImpactAuthorityBundle = z.infer<
  typeof semanticBindingImpactAuthorityBundleSchema
>;
export type SemanticBindingImpactAnalyzeRequest = z.infer<
  typeof semanticBindingImpactAnalyzeRequestSchema
>;
export type SemanticBindingImpactPackageProjection = z.infer<
  typeof semanticBindingImpactPackageProjectionSchema
>;
export type SemanticBindingImpactPlan = z.infer<typeof semanticBindingImpactPlanSchema>;
export type SemanticBindingImpactAction = z.infer<typeof semanticBindingImpactActionSchema>;
export type SemanticBindingImpactReason = z.infer<typeof semanticBindingImpactReasonSchema>;
export type SemanticBindingImpactObjectKind = z.infer<typeof semanticBindingImpactObjectKindSchema>;
export type SemanticBindingImpactCommitReceipt = z.infer<
  typeof semanticBindingImpactCommitReceiptSchema
>;
export type SemanticBindingImpactSafeProjection = z.infer<
  typeof semanticBindingImpactSafeProjectionSchema
>;
