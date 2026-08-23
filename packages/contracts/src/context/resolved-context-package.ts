import { z } from "zod";
import { artifactReferenceFor } from "../artifacts/envelope.js";
import {
  analysisCapabilitySchema,
  analysisCausalRoleSchema,
  grainSchema,
  missingPeriodPolicySchema,
  timeDomainSchema,
  unitSchema,
} from "../artifacts/semantic-governance.js";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  effectiveContextPolicySchema,
  effectiveEgressPolicySchema,
  effectiveRunConfigReferenceSchema,
  effectiveSchemaSnapshotSchema,
  effectiveSemanticReleaseSchema,
} from "../runs/effective-config.js";
import {
  canonicalImmutableIdSchema,
  versionedResourceReferenceSchema,
  workspaceDefaultsReferenceSchema,
} from "../workspaces/defaults.js";
import {
  buildSemanticLexicalEntry,
  canonicalSemanticLexicalEntriesSchema,
  semanticLexicalEntryKey,
  semanticLexicalEntrySchema,
  semanticLexicalMatchKindSchema,
  verifySemanticLexicalEntry,
} from "./semantic-lexical.js";

const positiveSafeIntegerSchema = z.number().int().positive().safe();
const RESOLVED_CONTEXT_CAPABILITY_CHAIN = [
  "METRIC",
  "ONTOLOGY_TEXT2SQL",
  "KNOWLEDGE",
  "GRAPH",
] as const;

const canonicalStringArray = (limit: number) =>
  z
    .array(z.string().trim().min(1).max(256))
    .max(limit)
    .superRefine((values, ctx) => {
      values.forEach((value, index) => {
        if (index > 0 && (values[index - 1] ?? "") >= value) {
          ctx.addIssue({
            code: "custom",
            message: "Values must be unique and canonically sorted.",
            path: [index],
          });
        }
      });
    });

export const resolvedContextConsumerSchema = z.enum(["PREVIEW", "RUN"]);
export const resolvedContextStateSchema = z.enum([
  "READY",
  "PARTIAL",
  "NEEDS_CLARIFICATION",
  "REJECTED",
  "STALE",
]);
export const resolvedContextRouteSchema = z.enum([
  "METRIC",
  "ONTOLOGY_TEXT2SQL",
  "KNOWLEDGE",
  "GRAPH",
  "NONE",
]);

const previewContextBasisSchema = z.strictObject({
  consumer: z.literal("PREVIEW"),
  defaults_ref: workspaceDefaultsReferenceSchema,
});

const runContextBasisSchema = z.strictObject({
  consumer: z.literal("RUN"),
  run_id: canonicalImmutableIdSchema,
  config_ref: effectiveRunConfigReferenceSchema,
  context_receipt_ref: z.strictObject({
    receipt_id: canonicalImmutableIdSchema,
    receipt_hash: contentHashSchema,
  }),
});

const resolvedContextRequestDraftSchema = z.union([
  z.strictObject({
    schema_version: z.literal("resolved-context-request@1.0.0"),
    request_id: canonicalImmutableIdSchema,
    scope: appScopeSchema,
    question: z.string().trim().min(1).max(4_000),
    basis: previewContextBasisSchema,
  }),
  z.strictObject({
    schema_version: z.literal("resolved-context-request@1.0.0"),
    request_id: canonicalImmutableIdSchema,
    scope: appScopeSchema,
    basis: runContextBasisSchema,
  }),
]);

export const resolvedContextRequestSchema = z.union([
  resolvedContextRequestDraftSchema.options[0].extend({ request_hash: contentHashSchema }),
  resolvedContextRequestDraftSchema.options[1].extend({ request_hash: contentHashSchema }),
]);

export async function computeResolvedContextRequestHash(input: unknown) {
  const fullRequest = resolvedContextRequestSchema.safeParse(input);
  const draft = fullRequest.success
    ? resolvedContextRequestDraftSchema.parse(
        Object.fromEntries(
          Object.entries(fullRequest.data).filter(([key]) => key !== "request_hash"),
        ),
      )
    : resolvedContextRequestDraftSchema.parse(input);
  return sha256ContentHash(draft);
}

export async function buildResolvedContextRequest(input: unknown) {
  const draft = resolvedContextRequestDraftSchema.parse(input);
  return deepFreeze(
    resolvedContextRequestSchema.parse({
      ...draft,
      request_hash: await computeResolvedContextRequestHash(draft),
    }),
  );
}

export async function verifyResolvedContextRequest(input: unknown) {
  const request = resolvedContextRequestSchema.parse(input);
  if ((await computeResolvedContextRequestHash(request)) !== request.request_hash) {
    throw new TypeError("RESOLVED_CONTEXT_REQUEST_HASH_MISMATCH");
  }
  return request;
}

export const publishedMetricContextSchema = z.strictObject({
  metric_id: versionIdentifierSchema,
  name: z.string().trim().min(1).max(256),
  aliases: canonicalStringArray(128),
  mapping_refs: canonicalStringArray(256).min(1),
  mapping_hash: contentHashSchema,
  formula_hash: contentHashSchema,
});

export const publishedOntologyContextSchema = z.strictObject({
  object_id: versionIdentifierSchema,
  object_kind: z.enum(["ENTITY", "EVENT", "TERM", "DIMENSION"]),
  name: z.string().trim().min(1).max(256),
  aliases: canonicalStringArray(128),
  queryable: z.boolean(),
  mapping_refs: canonicalStringArray(256),
  object_hash: contentHashSchema,
});

export const publishedRelationshipContextSchema = z.strictObject({
  relationship_id: versionIdentifierSchema,
  source_object_id: versionIdentifierSchema,
  target_object_id: versionIdentifierSchema,
  relationship_kind: z.string().trim().min(1).max(64),
  relationship_hash: contentHashSchema,
});

const canonicalVersionedResourceRefsSchema = z
  .array(versionedResourceReferenceSchema)
  .max(128)
  .superRefine((refs, ctx) => {
    refs.forEach((ref, index) => {
      const key = `${ref.resource_id}:${String(ref.resource_revision).padStart(16, "0")}:${ref.resource_hash}`;
      const previous = refs[index - 1];
      const previousKey = previous
        ? `${previous.resource_id}:${String(previous.resource_revision).padStart(16, "0")}:${previous.resource_hash}`
        : null;
      if (previousKey !== null && previousKey >= key) {
        ctx.addIssue({
          code: "custom",
          message: "Resource refs must be unique and canonically sorted.",
          path: [index],
        });
      }
    });
  });

const resolvedContextAuthoritySnapshotDraftSchema = z.strictObject({
  schema_version: z.literal("resolved-context-authority-snapshot@2.0.0"),
  scope: appScopeSchema,
  semantic_domain: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  question: z.string().trim().min(1).max(4_000),
  question_hash: contentHashSchema,
  defaults_ref: workspaceDefaultsReferenceSchema,
  semantic_release: effectiveSemanticReleaseSchema,
  schema_snapshot: effectiveSchemaSnapshotSchema,
  context_policy: effectiveContextPolicySchema,
  egress_policy: effectiveEgressPolicySchema,
  provider: z.string().trim().min(1).max(64),
  published_metrics: z.array(publishedMetricContextSchema).max(50_000),
  published_ontology: z.array(publishedOntologyContextSchema).max(100_000),
  published_relationships: z.array(publishedRelationshipContextSchema).max(250_000),
  published_lexicon: canonicalSemanticLexicalEntriesSchema,
  knowledge_refs: canonicalVersionedResourceRefsSchema,
  projection_hashes: canonicalStringArray(16).min(1),
});

function canonicalEntryArray<T extends { readonly [key: string]: unknown }>(key: keyof T) {
  return z.array(z.custom<T>()).superRefine((entries, ctx) => {
    entries.forEach((entry, index) => {
      const value = String(entry[key]);
      const previous = entries[index - 1];
      if (previous && String(previous[key]) >= value) {
        ctx.addIssue({
          code: "custom",
          message: "Authority entries must be unique and canonically sorted.",
          path: [index],
        });
      }
    });
  });
}

const resolvedContextAuthoritySnapshotCanonicalDraftSchema =
  resolvedContextAuthoritySnapshotDraftSchema
    .extend({
      published_metrics: canonicalEntryArray<z.infer<typeof publishedMetricContextSchema>>(
        "metric_id",
      ).pipe(z.array(publishedMetricContextSchema).max(50_000)),
      published_ontology: canonicalEntryArray<z.infer<typeof publishedOntologyContextSchema>>(
        "object_id",
      ).pipe(z.array(publishedOntologyContextSchema).max(100_000)),
      published_relationships: canonicalEntryArray<
        z.infer<typeof publishedRelationshipContextSchema>
      >("relationship_id").pipe(z.array(publishedRelationshipContextSchema).max(250_000)),
      published_lexicon: canonicalSemanticLexicalEntriesSchema,
    })
    .superRefine((snapshot, ctx) => {
      if (
        snapshot.semantic_release.datasource_id !== snapshot.schema_snapshot.datasource_id ||
        snapshot.semantic_release.resource_id !== snapshot.schema_snapshot.semantic_release_id ||
        snapshot.semantic_release.semantic_generation !==
          snapshot.schema_snapshot.semantic_generation
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Semantic release and schema snapshot authority must be exact.",
          path: ["schema_snapshot"],
        });
      }
      for (const [index, entry] of snapshot.published_lexicon.entries()) {
        if (
          entry.release_ref.resource_id !== snapshot.semantic_release.resource_id ||
          entry.release_ref.resource_revision !== snapshot.semantic_release.resource_revision ||
          entry.release_ref.resource_hash !== snapshot.semantic_release.resource_hash
        ) {
          ctx.addIssue({
            code: "custom",
            message: "Lexical evidence must bind the exact semantic release.",
            path: ["published_lexicon", index, "release_ref"],
          });
        }
        const targetExists =
          entry.target_kind === "METRIC"
            ? snapshot.published_metrics.some((metric) => metric.metric_id === entry.target_id)
            : snapshot.published_ontology.some((object) => object.object_id === entry.target_id);
        if (!targetExists) {
          ctx.addIssue({
            code: "custom",
            message: "Lexical evidence target must exist in the exact authority snapshot.",
            path: ["published_lexicon", index, "target_id"],
          });
        }
        if (
          entry.term_id !== null &&
          !snapshot.published_ontology.some(
            (object) => object.object_id === entry.term_id && object.object_kind === "TERM",
          )
        ) {
          ctx.addIssue({
            code: "custom",
            message: "Lexical term must exist in the exact authority snapshot.",
            path: ["published_lexicon", index, "term_id"],
          });
        }
      }
      if (
        !snapshot.egress_policy.allowed_providers.some((provider) => provider === snapshot.provider)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Selected provider must be allowed by the effective egress policy.",
          path: ["provider"],
        });
      }
    });

export const resolvedContextAuthoritySnapshotSchema =
  resolvedContextAuthoritySnapshotCanonicalDraftSchema.extend({ snapshot_hash: contentHashSchema });

const resolvedContextAuthoritySnapshotBuilderInputSchema =
  resolvedContextAuthoritySnapshotDraftSchema
    .omit({ question_hash: true, published_lexicon: true })
    .extend({ published_lexicon: canonicalSemanticLexicalEntriesSchema.optional() });

export async function computeResolvedContextAuthoritySnapshotHash(input: unknown) {
  return sha256ContentHash(resolvedContextAuthoritySnapshotCanonicalDraftSchema.parse(input));
}

export async function buildResolvedContextAuthoritySnapshot(input: unknown) {
  const builderInput = resolvedContextAuthoritySnapshotBuilderInputSchema.parse(input);
  const releaseRef = {
    resource_id: builderInput.semantic_release.resource_id,
    resource_revision: builderInput.semantic_release.resource_revision,
    resource_hash: builderInput.semantic_release.resource_hash,
  };
  const derivedLexicon = builderInput.published_lexicon
    ? await Promise.all(builderInput.published_lexicon.map(verifySemanticLexicalEntry))
    : await Promise.all([
        ...builderInput.published_metrics.flatMap((metric) => [
          buildSemanticLexicalEntry({
            schema_version: "semantic-lexical-entry@1.0.0",
            release_ref: releaseRef,
            target_kind: "METRIC",
            target_id: metric.metric_id,
            term_id: null,
            match_kind: "CANONICAL",
            phrase: metric.name,
          }),
          ...metric.aliases.map((alias) =>
            buildSemanticLexicalEntry({
              schema_version: "semantic-lexical-entry@1.0.0",
              release_ref: releaseRef,
              target_kind: "METRIC",
              target_id: metric.metric_id,
              term_id: null,
              match_kind: "ALIAS",
              phrase: alias,
            }),
          ),
        ]),
        ...builderInput.published_ontology
          .filter((object) => object.object_kind !== "TERM")
          .flatMap((object) => [
            buildSemanticLexicalEntry({
              schema_version: "semantic-lexical-entry@1.0.0",
              release_ref: releaseRef,
              target_kind: "ONTOLOGY",
              target_id: object.object_id,
              term_id: null,
              match_kind: "CANONICAL",
              phrase: object.name,
            }),
            ...object.aliases.map((alias) =>
              buildSemanticLexicalEntry({
                schema_version: "semantic-lexical-entry@1.0.0",
                release_ref: releaseRef,
                target_kind: "ONTOLOGY",
                target_id: object.object_id,
                term_id: null,
                match_kind: "ALIAS",
                phrase: alias,
              }),
            ),
          ]),
      ]);
  const draft = resolvedContextAuthoritySnapshotCanonicalDraftSchema.parse({
    ...builderInput,
    published_lexicon: [...derivedLexicon].sort((left, right) => {
      const leftKey = semanticLexicalEntryKey(left);
      const rightKey = semanticLexicalEntryKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
    question_hash: await sha256ContentHash(builderInput.question),
  });
  return deepFreeze(
    resolvedContextAuthoritySnapshotSchema.parse({
      ...draft,
      snapshot_hash: await computeResolvedContextAuthoritySnapshotHash(draft),
    }),
  );
}

export async function verifyResolvedContextAuthoritySnapshot(input: unknown) {
  const snapshot = resolvedContextAuthoritySnapshotSchema.parse(input);
  await Promise.all(snapshot.published_lexicon.map(verifySemanticLexicalEntry));
  const { snapshot_hash: _snapshotHash, ...draft } = snapshot;
  if (
    (await sha256ContentHash(snapshot.question)) !== snapshot.question_hash ||
    (await computeResolvedContextAuthoritySnapshotHash(draft)) !== snapshot.snapshot_hash
  ) {
    throw new TypeError("RESOLVED_CONTEXT_SNAPSHOT_HASH_MISMATCH");
  }
  return snapshot;
}

export const resolvedContextClarificationSchema = z.strictObject({
  candidate_id: versionIdentifierSchema,
  candidate_kind: z.enum(["METRIC", "ONTOLOGY"]),
  label: z.string().trim().min(1).max(256),
  candidate_hash: contentHashSchema,
  match_kind: semanticLexicalMatchKindSchema,
  matched_phrase: z.string().trim().min(1).max(256),
  lexical_evidence_hash: contentHashSchema,
});

export const resolvedContextRouteDecisionSchema = z
  .strictObject({
    schema_version: z.literal("resolved-context-route-decision@2.0.0"),
    state: resolvedContextStateSchema,
    route: resolvedContextRouteSchema,
    selected_metric_id: versionIdentifierSchema.nullable(),
    selected_ontology_ids: canonicalStringArray(256),
    clarification_candidates: z.array(resolvedContextClarificationSchema).max(128),
    lexical_evidence: canonicalSemanticLexicalEntriesSchema.pipe(
      z.array(semanticLexicalEntrySchema).max(128),
    ),
    capability_chain: z.tuple([
      z.literal(RESOLVED_CONTEXT_CAPABILITY_CHAIN[0]),
      z.literal(RESOLVED_CONTEXT_CAPABILITY_CHAIN[1]),
      z.literal(RESOLVED_CONTEXT_CAPABILITY_CHAIN[2]),
      z.literal(RESOLVED_CONTEXT_CAPABILITY_CHAIN[3]),
    ]),
    reason_codes: canonicalStringArray(32),
  })
  .superRefine((decision, ctx) => {
    const clarification = decision.state === "NEEDS_CLARIFICATION";
    if (clarification !== decision.clarification_candidates.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "Clarification state is inconsistent.",
        path: ["state"],
      });
    }
    if ((decision.route === "METRIC") !== (decision.selected_metric_id !== null || clarification)) {
      ctx.addIssue({
        code: "custom",
        message: "Metric selection is inconsistent.",
        path: ["route"],
      });
    }
    if (decision.route === "NONE" && decision.state !== "REJECTED") {
      ctx.addIssue({ code: "custom", message: "NONE route must be rejected.", path: ["state"] });
    }
    for (const [index, candidate] of decision.clarification_candidates.entries()) {
      const evidence = decision.lexical_evidence.find(
        (entry) => entry.evidence_hash === candidate.lexical_evidence_hash,
      );
      if (
        !evidence ||
        evidence.target_id !== candidate.candidate_id ||
        evidence.target_kind !== candidate.candidate_kind ||
        evidence.match_kind !== candidate.match_kind ||
        evidence.phrase !== candidate.matched_phrase
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Clarification candidate must close over exact lexical evidence.",
          path: ["clarification_candidates", index, "lexical_evidence_hash"],
        });
      }
    }
  });

export const contextCapacityItemSchema = z.strictObject({
  item_kind: z.enum([
    "AUTHORITY",
    "POLICY",
    "LEXICAL",
    "MAPPING",
    "METRIC",
    "ONTOLOGY",
    "KNOWLEDGE",
    "GRAPH",
  ]),
  item_id: z.string().trim().min(1).max(512),
  item_hash: contentHashSchema,
  byte_size: positiveSafeIntegerSchema,
  priority: z.number().int().min(0).max(10_000),
  mandatory: z.boolean(),
  disposition: z.enum(["MANDATORY", "INCLUDED", "CROPPED", "OMITTED", "ON_DEMAND"]),
  reason_code: z.enum([
    "AUTHORITY_REQUIRED",
    "ROUTE_SELECTED",
    "WITHIN_CAPACITY",
    "CAPACITY_EXCEEDED",
    "ROUTE_NOT_SELECTED",
    "DEFERRED_RETRIEVAL",
  ]),
});

export const contextCapacityPlanSchema = z
  .strictObject({
    schema_version: z.literal("context-capacity-plan@1.0.0"),
    policy_version: z.literal("utf8-byte-upper-bound@1.0.0"),
    max_context_tokens: positiveSafeIntegerSchema,
    max_context_bytes: positiveSafeIntegerSchema,
    mandatory_bytes: z.number().int().nonnegative().safe(),
    included_bytes: z.number().int().nonnegative().safe(),
    cropped_bytes: z.number().int().nonnegative().safe(),
    items: z.array(contextCapacityItemSchema).max(2_048),
  })
  .superRefine((plan, ctx) => {
    const mandatoryBytes = plan.items
      .filter((item) => item.mandatory)
      .reduce((total, item) => total + item.byte_size, 0);
    const includedBytes = plan.items
      .filter((item) => ["MANDATORY", "INCLUDED"].includes(item.disposition))
      .reduce((total, item) => total + item.byte_size, 0);
    const croppedBytes = plan.items
      .filter((item) => item.disposition === "CROPPED")
      .reduce((total, item) => total + item.byte_size, 0);
    if (
      plan.max_context_bytes !== plan.max_context_tokens ||
      plan.mandatory_bytes !== mandatoryBytes ||
      plan.included_bytes !== includedBytes ||
      plan.cropped_bytes !== croppedBytes
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Capacity totals are inconsistent.",
        path: ["items"],
      });
    }
  });

export const resolvedContextEvidenceSummarySchema = z.strictObject({
  evidence_kind: z.enum(["LEXICAL", "METRIC", "ONTOLOGY", "MAPPING", "KNOWLEDGE", "GRAPH"]),
  evidence_id: z.string().trim().min(1).max(512),
  evidence_hash: contentHashSchema,
  summary: z.string().trim().min(1).max(2_048),
  source_ref: versionedResourceReferenceSchema.nullable(),
});

const resolvedContextPackageMaterialSchema = z
  .strictObject({
    schema_version: z.literal("resolved-context-package@2.0.0"),
    scope: appScopeSchema,
    semantic_domain: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
    question_hash: contentHashSchema,
    defaults_ref: workspaceDefaultsReferenceSchema,
    semantic_release: effectiveSemanticReleaseSchema,
    schema_snapshot: effectiveSchemaSnapshotSchema,
    context_policy: effectiveContextPolicySchema,
    egress_policy: effectiveEgressPolicySchema,
    provider: z.string().trim().min(1).max(64),
    authority_snapshot_hash: contentHashSchema,
    route_decision: resolvedContextRouteDecisionSchema,
    capacity: contextCapacityPlanSchema,
    evidence: z.array(resolvedContextEvidenceSummarySchema).max(2_048),
    knowledge_refs: canonicalVersionedResourceRefsSchema,
  })
  .superRefine((packageDocument, ctx) => {
    for (const [index, entry] of packageDocument.route_decision.lexical_evidence.entries()) {
      if (
        entry.release_ref.resource_id !== packageDocument.semantic_release.resource_id ||
        entry.release_ref.resource_revision !==
          packageDocument.semantic_release.resource_revision ||
        entry.release_ref.resource_hash !== packageDocument.semantic_release.resource_hash
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Route lexical evidence must bind the package semantic release.",
          path: ["route_decision", "lexical_evidence", index, "release_ref"],
        });
      }
    }
  });

const resolvedContextPackageDraftSchema = resolvedContextPackageMaterialSchema.safeExtend({
  package_id: canonicalImmutableIdSchema,
  package_key_hash: contentHashSchema,
});

export const resolvedContextPackageSchema = resolvedContextPackageDraftSchema.safeExtend({
  package_hash: contentHashSchema,
});

export const analysisMetricReferenceSchema = z.strictObject({
  container_ref: artifactReferenceFor("SemanticRelease"),
  node_id: versionIdentifierSchema,
});

export const analysisDimensionContextSchema = z.strictObject({
  dimension_id: versionIdentifierSchema,
  grain: grainSchema,
  data_type: versionIdentifierSchema,
  sensitivity: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SECRET"]),
  groupable: z.boolean(),
  pivotable: z.boolean(),
  causal_role: analysisCausalRoleSchema.nullable(),
});

export const analysisMetricContextSchema = z.strictObject({
  metric_ref: analysisMetricReferenceSchema,
  formula_hash: contentHashSchema,
  unit: unitSchema.nullable(),
  grain: grainSchema,
  time_domain: timeDomainSchema.nullable(),
  time_dimension_ref: versionIdentifierSchema.nullable(),
  additivity: z.enum(["additive", "semi-additive", "non-additive"]),
  null_policy: z.enum(["preserve", "coalesce-zero", "exclude", "propagate"]),
  missing_period_policy: missingPeriodPolicySchema,
  seasonality: z
    .strictObject({
      kind: z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"]),
      period_count: z.number().int().positive().max(10_000),
      minimum_history_points: z.number().int().positive().max(50_000),
    })
    .nullable(),
  priority: z.number().int().min(0).max(10_000),
  causal_role: analysisCausalRoleSchema.nullable(),
  allowed_dimensions: z.array(analysisDimensionContextSchema).max(256),
  analysis_capabilities: z.array(analysisCapabilitySchema).max(32),
});

export const analysisRelationshipContextSchema = z.strictObject({
  relationship_id: versionIdentifierSchema,
  left_table_id: versionIdentifierSchema,
  right_table_id: versionIdentifierSchema,
  cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]),
  fanout_closed: z.boolean(),
  ontology_path: z.array(versionIdentifierSchema).min(1).max(64),
});

export const analysisCausalContextSchema = z.strictObject({
  policy_refs: z.array(artifactReferenceFor("PolicyReceipt")).min(1).max(32),
  intervention_semantics_refs: z.array(versionIdentifierSchema).min(1).max(64),
  adjustment_set_object_ids: z.array(versionIdentifierSchema).max(64),
  excluded_mediator_ids: z.array(versionIdentifierSchema).max(64),
  excluded_collider_ids: z.array(versionIdentifierSchema).max(64),
  directed_edges: z
    .array(
      z.strictObject({
        source_object_id: versionIdentifierSchema,
        target_object_id: versionIdentifierSchema,
        mechanism_ref: versionIdentifierSchema,
        ontology_path: z.array(versionIdentifierSchema).min(1).max(64),
      }),
    )
    .min(1)
    .max(512),
});

const analysisContextMaterialSchema = z
  .strictObject({
    schema_version: z.literal("analysis-context@1.0.0"),
    scope: appScopeSchema,
    resolved_context_binding: z.strictObject({
      package_id: canonicalImmutableIdSchema,
      package_hash: contentHashSchema,
      receipt_id: canonicalImmutableIdSchema,
      receipt_hash: contentHashSchema,
    }),
    semantic_release_ref: artifactReferenceFor("SemanticRelease"),
    schema_snapshot_ref: artifactReferenceFor("SchemaSnapshot"),
    policy_receipt_ref: artifactReferenceFor("PolicyReceipt"),
    semantic_source_bundle_ref: artifactReferenceFor("SemanticSourceBundle"),
    ontology_analysis_binding_hash: contentHashSchema,
    metrics: z.array(analysisMetricContextSchema).min(1).max(128),
    relationships: z.array(analysisRelationshipContextSchema).max(512),
    causal_policy: analysisCausalContextSchema.nullable(),
  })
  .superRefine((context, ctx) => {
    const scopeRefs = [
      context.semantic_release_ref,
      context.schema_snapshot_ref,
      context.policy_receipt_ref,
      context.semantic_source_bundle_ref,
      ...(context.causal_policy?.policy_refs ?? []),
    ];
    for (const [index, reference] of scopeRefs.entries()) {
      if (
        reference.app_id !== context.scope.app_id ||
        reference.tenant_id !== context.scope.tenant_id ||
        reference.environment !== context.scope.environment
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Analysis Context Reference 必须绑定同一 Scope。",
          path: ["references", index],
        });
      }
    }
    const metricIds = context.metrics.map(({ metric_ref }) => metric_ref.node_id);
    if (new Set(metricIds).size !== metricIds.length) {
      ctx.addIssue({ code: "custom", message: "Analysis Metric 必须唯一。", path: ["metrics"] });
    }
  });

export const analysisContextSchema = analysisContextMaterialSchema.extend({
  context_hash: contentHashSchema,
});

export async function computeAnalysisContextHash(input: unknown) {
  const full = analysisContextSchema.safeParse(input);
  const material = full.success
    ? analysisContextMaterialSchema.parse(
        Object.fromEntries(Object.entries(full.data).filter(([key]) => key !== "context_hash")),
      )
    : analysisContextMaterialSchema.parse(input);
  return sha256ContentHash(material);
}

export async function buildAnalysisContext(input: unknown) {
  const material = analysisContextMaterialSchema.parse(input);
  return deepFreeze(
    analysisContextSchema.parse({
      ...material,
      context_hash: await computeAnalysisContextHash(material),
    }),
  );
}

export async function verifyAnalysisContext(input: unknown) {
  const context = analysisContextSchema.parse(input);
  if ((await computeAnalysisContextHash(context)) !== context.context_hash) {
    throw new TypeError("ANALYSIS_CONTEXT_HASH_MISMATCH");
  }
  return context;
}

function uuidV8FromHash(hash: string): string {
  const digits = hash.slice("sha256:".length, "sha256:".length + 32).split("");
  digits[12] = "8";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export async function computeResolvedContextPackageKeyHash(input: unknown) {
  const fullPackage = resolvedContextPackageSchema.safeParse(input);
  const material = fullPackage.success
    ? resolvedContextPackageMaterialSchema.parse(
        Object.fromEntries(
          Object.entries(fullPackage.data).filter(
            ([key]) => !["package_id", "package_key_hash", "package_hash"].includes(key),
          ),
        ),
      )
    : resolvedContextPackageMaterialSchema.parse(input);
  return sha256ContentHash({
    scope: material.scope,
    question_hash: material.question_hash,
    defaults_ref: material.defaults_ref,
    semantic_release: material.semantic_release,
    schema_snapshot: material.schema_snapshot,
    context_policy: material.context_policy,
    egress_policy: material.egress_policy,
    provider: material.provider,
    authority_snapshot_hash: material.authority_snapshot_hash,
  });
}

export async function computeResolvedContextPackageHash(input: unknown) {
  const fullPackage = resolvedContextPackageSchema.safeParse(input);
  const draft = fullPackage.success
    ? resolvedContextPackageDraftSchema.parse(
        Object.fromEntries(
          Object.entries(fullPackage.data).filter(([key]) => key !== "package_hash"),
        ),
      )
    : resolvedContextPackageDraftSchema.parse(input);
  return sha256ContentHash(draft);
}

export async function buildResolvedContextPackage(input: unknown) {
  const material = resolvedContextPackageMaterialSchema.parse(input);
  const packageKeyHash = await computeResolvedContextPackageKeyHash(material);
  const draft = resolvedContextPackageDraftSchema.parse({
    ...material,
    package_id: uuidV8FromHash(packageKeyHash),
    package_key_hash: packageKeyHash,
  });
  return deepFreeze(
    resolvedContextPackageSchema.parse({
      ...draft,
      package_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyResolvedContextPackage(input: unknown) {
  const packageDocument = resolvedContextPackageSchema.parse(input);
  const { package_hash: _packageHash, ...draft } = packageDocument;
  const expectedKeyHash = await computeResolvedContextPackageKeyHash(packageDocument);
  if (
    packageDocument.package_key_hash !== expectedKeyHash ||
    packageDocument.package_id !== uuidV8FromHash(expectedKeyHash) ||
    (await sha256ContentHash(draft)) !== packageDocument.package_hash
  ) {
    throw new TypeError("RESOLVED_CONTEXT_PACKAGE_HASH_MISMATCH");
  }
  return packageDocument;
}

export const resolvedContextPreviewResultSchema = z.strictObject({
  schema_version: z.literal("resolved-context-preview-result@1.0.0"),
  package: resolvedContextPackageSchema,
});

export async function verifyResolvedContextPreviewResult(input: unknown) {
  const result = resolvedContextPreviewResultSchema.parse(input);
  return deepFreeze({
    ...result,
    package: await verifyResolvedContextPackage(result.package),
  });
}

export const resolvedContextPackageReferenceSchema = z.strictObject({
  package_id: canonicalImmutableIdSchema,
  package_revision: z.literal(1),
  package_hash: contentHashSchema,
});

const resolvedContextReceiptDraftSchema = z.strictObject({
  schema_version: z.literal("resolved-context-receipt@1.0.0"),
  receipt_id: canonicalImmutableIdSchema,
  scope: appScopeSchema,
  consumer: resolvedContextConsumerSchema,
  request_id: canonicalImmutableIdSchema,
  request_hash: contentHashSchema,
  run_id: canonicalImmutableIdSchema.nullable(),
  package_ref: resolvedContextPackageReferenceSchema,
  state: resolvedContextStateSchema,
  route: resolvedContextRouteSchema,
  authority_snapshot_hash: contentHashSchema,
  resolved_at: timestampSchema,
});

export const resolvedContextReceiptSchema = resolvedContextReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

export async function buildResolvedContextReceipt(input: unknown) {
  const draft = resolvedContextReceiptDraftSchema.parse(input);
  return deepFreeze(
    resolvedContextReceiptSchema.parse({
      ...draft,
      receipt_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyResolvedContextReceipt(input: unknown) {
  const receipt = resolvedContextReceiptSchema.parse(input);
  const { receipt_hash: _receiptHash, ...draft } = receipt;
  if ((await sha256ContentHash(draft)) !== receipt.receipt_hash) {
    throw new TypeError("RESOLVED_CONTEXT_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

export const resolvedContextCommitCommandSchema = z.strictObject({
  schema_version: z.literal("resolved-context-commit@1.0.0"),
  request: resolvedContextRequestSchema,
  authority_snapshot_hash: contentHashSchema,
  package: resolvedContextPackageSchema,
  receipt: resolvedContextReceiptSchema,
});

export async function verifyResolvedContextCommitCommand(input: unknown) {
  const command = resolvedContextCommitCommandSchema.parse(input);
  const [request, packageDocument, receipt] = await Promise.all([
    verifyResolvedContextRequest(command.request),
    verifyResolvedContextPackage(command.package),
    verifyResolvedContextReceipt(command.receipt),
  ]);
  const runId = request.basis.consumer === "RUN" ? request.basis.run_id : null;
  if (
    packageDocument.scope.app_id !== request.scope.app_id ||
    packageDocument.scope.tenant_id !== request.scope.tenant_id ||
    packageDocument.scope.environment !== request.scope.environment ||
    packageDocument.authority_snapshot_hash !== command.authority_snapshot_hash ||
    receipt.scope.app_id !== request.scope.app_id ||
    receipt.scope.tenant_id !== request.scope.tenant_id ||
    receipt.scope.environment !== request.scope.environment ||
    receipt.consumer !== request.basis.consumer ||
    receipt.request_id !== request.request_id ||
    receipt.request_hash !== request.request_hash ||
    receipt.run_id !== runId ||
    receipt.package_ref.package_id !== packageDocument.package_id ||
    receipt.package_ref.package_hash !== packageDocument.package_hash ||
    receipt.state !== packageDocument.route_decision.state ||
    receipt.route !== packageDocument.route_decision.route ||
    receipt.authority_snapshot_hash !== command.authority_snapshot_hash
  ) {
    throw new TypeError("RESOLVED_CONTEXT_COMMIT_CLOSURE_MISMATCH");
  }
  return deepFreeze({ ...command, request, package: packageDocument, receipt });
}

export const resolvedContextCommitResultSchema = z.strictObject({
  schema_version: z.literal("resolved-context-commit-result@1.0.0"),
  disposition: z.enum(["CREATED", "REPLAYED"]),
  package: resolvedContextPackageSchema,
  receipt: resolvedContextReceiptSchema,
});

export async function verifyResolvedContextCommitResult(input: unknown) {
  const result = resolvedContextCommitResultSchema.parse(input);
  const [packageDocument, receipt] = await Promise.all([
    verifyResolvedContextPackage(result.package),
    verifyResolvedContextReceipt(result.receipt),
  ]);
  if (
    receipt.package_ref.package_id !== packageDocument.package_id ||
    receipt.package_ref.package_hash !== packageDocument.package_hash ||
    receipt.authority_snapshot_hash !== packageDocument.authority_snapshot_hash ||
    receipt.state !== packageDocument.route_decision.state ||
    receipt.route !== packageDocument.route_decision.route
  ) {
    throw new TypeError("RESOLVED_CONTEXT_RESULT_CLOSURE_MISMATCH");
  }
  return deepFreeze({ ...result, package: packageDocument, receipt });
}

export type ResolvedContextRequest = z.infer<typeof resolvedContextRequestSchema>;
export type ResolvedContextState = z.infer<typeof resolvedContextStateSchema>;
export type ResolvedContextAuthoritySnapshot = z.infer<
  typeof resolvedContextAuthoritySnapshotSchema
>;
export type PublishedMetricContext = z.infer<typeof publishedMetricContextSchema>;
export type ResolvedContextClarification = z.infer<typeof resolvedContextClarificationSchema>;
export type ResolvedContextRouteDecision = z.infer<typeof resolvedContextRouteDecisionSchema>;
export type ContextCapacityItem = z.infer<typeof contextCapacityItemSchema>;
export type ContextCapacityPlan = z.infer<typeof contextCapacityPlanSchema>;
export type ResolvedContextEvidenceSummary = z.infer<typeof resolvedContextEvidenceSummarySchema>;
export type ResolvedContextPackage = z.infer<typeof resolvedContextPackageSchema>;
export type ResolvedContextPreviewResult = z.infer<typeof resolvedContextPreviewResultSchema>;
export type AnalysisMetricReference = z.infer<typeof analysisMetricReferenceSchema>;
export type AnalysisDimensionContext = z.infer<typeof analysisDimensionContextSchema>;
export type AnalysisMetricContext = z.infer<typeof analysisMetricContextSchema>;
export type AnalysisRelationshipContext = z.infer<typeof analysisRelationshipContextSchema>;
export type AnalysisCausalContext = z.infer<typeof analysisCausalContextSchema>;
export type AnalysisContext = z.infer<typeof analysisContextSchema>;
export type ResolvedContextReceipt = z.infer<typeof resolvedContextReceiptSchema>;
export type ResolvedContextCommitCommand = z.infer<typeof resolvedContextCommitCommandSchema>;
export type ResolvedContextCommitResult = z.infer<typeof resolvedContextCommitResultSchema>;
