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
import {
  semanticInferenceReceiptSchema,
  semanticRetrievalReceiptSchema,
} from "./semantic-retrieval.js";

const positiveSafeIntegerSchema = z.number().int().positive().safe();
const SEMANTIC_CONTEXT_CAPABILITY_CHAIN = [
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

export const semanticContextConsumerSchema = z.enum(["PREVIEW", "RUN"]);
export const semanticContextStateSchema = z.enum([
  "READY",
  "PARTIAL",
  "NEEDS_CLARIFICATION",
  "REJECTED",
  "STALE",
]);
export const semanticContextRouteSchema = z.enum([
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
  provider_task_ref: artifactReferenceFor("ProviderTaskArtifact").optional(),
});

const semanticContextRequestDraftSchema = z.union([
  z.strictObject({
    schema_version: z.literal("semantic-context-request@1.0.0"),
    request_id: canonicalImmutableIdSchema,
    scope: appScopeSchema,
    question: z.string().trim().min(1).max(4_000),
    basis: previewContextBasisSchema,
  }),
  z.strictObject({
    schema_version: z.literal("semantic-context-request@1.0.0"),
    request_id: canonicalImmutableIdSchema,
    scope: appScopeSchema,
    basis: runContextBasisSchema,
  }),
]);

export const semanticContextRequestSchema = z.union([
  semanticContextRequestDraftSchema.options[0].extend({ request_hash: contentHashSchema }),
  semanticContextRequestDraftSchema.options[1].extend({ request_hash: contentHashSchema }),
]);

export async function computeSemanticContextRequestHash(input: unknown) {
  const fullRequest = semanticContextRequestSchema.safeParse(input);
  const draft = fullRequest.success
    ? semanticContextRequestDraftSchema.parse(
        Object.fromEntries(
          Object.entries(fullRequest.data).filter(([key]) => key !== "request_hash"),
        ),
      )
    : semanticContextRequestDraftSchema.parse(input);
  const task = draft.basis.consumer === "RUN" ? draft.basis.provider_task_ref : undefined;
  if (
    task &&
    (draft.basis.consumer !== "RUN" ||
      task.run_id !== draft.basis.run_id ||
      task.app_id !== draft.scope.app_id ||
      task.tenant_id !== draft.scope.tenant_id ||
      task.environment !== draft.scope.environment)
  ) {
    throw new TypeError("SEMANTIC_CONTEXT_TASK_REFERENCE_MISMATCH");
  }
  return sha256ContentHash(draft);
}

export async function buildSemanticContextRequest(input: unknown) {
  const draft = semanticContextRequestDraftSchema.parse(input);
  return deepFreeze(
    semanticContextRequestSchema.parse({
      ...draft,
      request_hash: await computeSemanticContextRequestHash(draft),
    }),
  );
}

export async function verifySemanticContextRequest(input: unknown) {
  const request = semanticContextRequestSchema.parse(input);
  if ((await computeSemanticContextRequestHash(request)) !== request.request_hash) {
    throw new TypeError("SEMANTIC_CONTEXT_REQUEST_HASH_MISMATCH");
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
  object_kind: z.enum([
    "ENTITY",
    "EVENT",
    "TERM",
    "DIMENSION",
    "FORMULA",
    "RELATIONSHIP",
    "QUALITY",
    "TIME",
  ]),
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

const semanticConversationIntentSchema = z.strictObject({
  task_ref: artifactReferenceFor("ProviderTaskArtifact"),
  context_selection_hash: contentHashSchema,
  prior_user_questions: z
    .array(
      z.strictObject({
        message_id: canonicalImmutableIdSchema,
        content: z.string().trim().min(1).max(4_000),
      }),
    )
    .max(8)
    .superRefine((messages, ctx) => {
      if (new Set(messages.map(({ message_id }) => message_id)).size !== messages.length) {
        ctx.addIssue({ code: "custom", message: "Prior user intent message IDs must be unique." });
      }
    }),
});

const semanticContextAuthoritySnapshotDraftSchema = z.strictObject({
  schema_version: z.literal("semantic-context-authority-snapshot@1.0.0"),
  scope: appScopeSchema,
  semantic_domain: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  question: z.string().trim().min(1).max(4_000),
  question_hash: contentHashSchema,
  conversation_intent: semanticConversationIntentSchema.optional(),
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

const semanticContextAuthoritySnapshotCanonicalDraftSchema =
  semanticContextAuthoritySnapshotDraftSchema
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
      const task = snapshot.conversation_intent?.task_ref;
      if (
        task &&
        (task.app_id !== snapshot.scope.app_id ||
          task.tenant_id !== snapshot.scope.tenant_id ||
          task.environment !== snapshot.scope.environment)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Conversation intent must bind the same scope.",
          path: ["conversation_intent", "task_ref"],
        });
      }
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

export const semanticContextAuthoritySnapshotSchema =
  semanticContextAuthoritySnapshotCanonicalDraftSchema.extend({ snapshot_hash: contentHashSchema });

const semanticContextAuthoritySnapshotBuilderInputSchema =
  semanticContextAuthoritySnapshotDraftSchema
    .omit({ question_hash: true, published_lexicon: true })
    .extend({ published_lexicon: canonicalSemanticLexicalEntriesSchema.optional() });

export async function computeSemanticContextAuthoritySnapshotHash(input: unknown) {
  return sha256ContentHash(semanticContextAuthoritySnapshotCanonicalDraftSchema.parse(input));
}

export async function buildSemanticContextAuthoritySnapshot(input: unknown) {
  const builderInput = semanticContextAuthoritySnapshotBuilderInputSchema.parse(input);
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
  const draft = semanticContextAuthoritySnapshotCanonicalDraftSchema.parse({
    ...builderInput,
    published_lexicon: [...derivedLexicon].sort((left, right) => {
      const leftKey = semanticLexicalEntryKey(left);
      const rightKey = semanticLexicalEntryKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
    question_hash: await sha256ContentHash(builderInput.question),
  });
  return deepFreeze(
    semanticContextAuthoritySnapshotSchema.parse({
      ...draft,
      snapshot_hash: await computeSemanticContextAuthoritySnapshotHash(draft),
    }),
  );
}

export async function verifySemanticContextAuthoritySnapshot(input: unknown) {
  const snapshot = semanticContextAuthoritySnapshotSchema.parse(input);
  await Promise.all(snapshot.published_lexicon.map(verifySemanticLexicalEntry));
  const { snapshot_hash: _snapshotHash, ...draft } = snapshot;
  if (
    (await sha256ContentHash(snapshot.question)) !== snapshot.question_hash ||
    (await computeSemanticContextAuthoritySnapshotHash(draft)) !== snapshot.snapshot_hash
  ) {
    throw new TypeError("SEMANTIC_CONTEXT_SNAPSHOT_HASH_MISMATCH");
  }
  return snapshot;
}

export const semanticContextClarificationSchema = z.strictObject({
  candidate_id: versionIdentifierSchema,
  candidate_kind: z.enum(["METRIC", "ONTOLOGY"]),
  label: z.string().trim().min(1).max(256),
  candidate_hash: contentHashSchema,
  match_kind: semanticLexicalMatchKindSchema,
  matched_phrase: z.string().trim().min(1).max(256),
  lexical_evidence_hash: contentHashSchema,
});

export const semanticContextRouteDecisionSchema = z
  .strictObject({
    schema_version: z.literal("semantic-context-route-decision@1.0.0"),
    state: semanticContextStateSchema,
    route: semanticContextRouteSchema,
    selected_metric_id: versionIdentifierSchema.nullable(),
    selected_ontology_ids: canonicalStringArray(256),
    clarification_candidates: z.array(semanticContextClarificationSchema).max(128),
    lexical_evidence: canonicalSemanticLexicalEntriesSchema.pipe(
      z.array(semanticLexicalEntrySchema).max(128),
    ),
    capability_chain: z.tuple([
      z.literal(SEMANTIC_CONTEXT_CAPABILITY_CHAIN[0]),
      z.literal(SEMANTIC_CONTEXT_CAPABILITY_CHAIN[1]),
      z.literal(SEMANTIC_CONTEXT_CAPABILITY_CHAIN[2]),
      z.literal(SEMANTIC_CONTEXT_CAPABILITY_CHAIN[3]),
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

export const semanticContextEvidenceSummarySchema = z.strictObject({
  evidence_kind: z.enum(["LEXICAL", "METRIC", "ONTOLOGY", "MAPPING", "KNOWLEDGE", "GRAPH"]),
  evidence_id: z.string().trim().min(1).max(512),
  evidence_hash: contentHashSchema,
  summary: z.string().trim().min(1).max(2_048),
  source_ref: versionedResourceReferenceSchema.nullable(),
});

const semanticContextPackageMaterialSchema = z
  .strictObject({
    schema_version: z.literal("semantic-context-package@1.0.0"),
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
    route_decision: semanticContextRouteDecisionSchema,
    capacity: contextCapacityPlanSchema,
    evidence: z.array(semanticContextEvidenceSummarySchema).max(2_048),
    knowledge_refs: canonicalVersionedResourceRefsSchema,
    retrieval_receipt: semanticRetrievalReceiptSchema,
    inference_receipt: semanticInferenceReceiptSchema,
    mandatory_closure: z.strictObject({
      object_ids: z.array(versionIdentifierSchema).max(80),
      relationship_ids: z.array(versionIdentifierSchema).max(160),
      closure_hash: contentHashSchema,
    }),
    analysis_capabilities: z.array(analysisCapabilitySchema).max(32),
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
    if (
      packageDocument.authority_snapshot_hash !==
        packageDocument.retrieval_receipt.authority_snapshot_hash ||
      packageDocument.semantic_release.resource_hash !==
        packageDocument.retrieval_receipt.release_hash ||
      packageDocument.question_hash !== packageDocument.retrieval_receipt.query_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Retrieval receipt must bind the exact semantic authority snapshot.",
        path: ["retrieval_receipt"],
      });
    }
    if (
      packageDocument.inference_receipt.retrieval_receipt_hash !==
      packageDocument.retrieval_receipt.receipt_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Inference receipt must bind the exact retrieval receipt.",
        path: ["inference_receipt", "retrieval_receipt_hash"],
      });
    }
    if (!packageDocument.inference_receipt.closure_complete) {
      ctx.addIssue({
        code: "custom",
        message: "Semantic Context Package cannot carry an incomplete mandatory closure.",
        path: ["inference_receipt", "closure_complete"],
      });
    }
    const closureObjects = [...packageDocument.mandatory_closure.object_ids].sort();
    const inferredObjects = [...packageDocument.inference_receipt.mandatory_object_ids].sort();
    const closureRelationships = [...packageDocument.mandatory_closure.relationship_ids].sort();
    const inferredRelationships = [
      ...packageDocument.inference_receipt.mandatory_relationship_ids,
    ].sort();
    if (
      JSON.stringify(closureObjects) !== JSON.stringify(inferredObjects) ||
      JSON.stringify(closureRelationships) !== JSON.stringify(inferredRelationships)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Mandatory closure must equal the inference receipt closure.",
        path: ["mandatory_closure"],
      });
    }
    const selectedObjects = new Set(packageDocument.retrieval_receipt.selected_object_ids);
    if (closureObjects.some((objectId) => !selectedObjects.has(objectId))) {
      ctx.addIssue({
        code: "custom",
        message: "Mandatory closure objects cannot be pruned from retrieval.",
        path: ["retrieval_receipt", "selected_object_ids"],
      });
    }
  });

const semanticContextPackageDraftSchema = semanticContextPackageMaterialSchema.safeExtend({
  package_id: canonicalImmutableIdSchema,
  package_key_hash: contentHashSchema,
});

const PHYSICAL_COLUMN_OBJECT_PREFIX = "column.";
const PHYSICAL_COLUMN_CONTAINMENT_PREFIX = "contains.column.";

/**
 * A retrieved containment node proves selection of the corresponding published
 * physical-column object. It does not create a binding: downstream consumers
 * must still resolve the returned id through the frozen release catalog.
 */
export function selectedSemanticObjectPhysicalColumnId(objectId: string): string | null {
  if (objectId.startsWith(PHYSICAL_COLUMN_OBJECT_PREFIX)) return objectId;
  if (!objectId.startsWith(PHYSICAL_COLUMN_CONTAINMENT_PREFIX)) return null;
  const suffix = objectId.slice(PHYSICAL_COLUMN_CONTAINMENT_PREFIX.length);
  return suffix.length > 0 ? `${PHYSICAL_COLUMN_OBJECT_PREFIX}${suffix}` : null;
}

export const semanticContextPackageSchema = semanticContextPackageDraftSchema.safeExtend({
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
    schema_version: z.literal("analysis-context@2.0.0"),
    scope: appScopeSchema,
    semantic_context_binding: z.strictObject({
      package_id: canonicalImmutableIdSchema,
      package_hash: contentHashSchema,
      receipt_id: canonicalImmutableIdSchema,
      receipt_hash: contentHashSchema,
    }),
    semantic_release_ref: artifactReferenceFor("SemanticRelease"),
    schema_snapshot_ref: artifactReferenceFor("SchemaSnapshot"),
    policy_receipt_ref: artifactReferenceFor("PolicyReceipt"),
    semantic_retrieval_receipt_hash: contentHashSchema,
    semantic_inference_receipt_hash: contentHashSchema,
    metrics: z.array(analysisMetricContextSchema).min(1).max(128),
    relationships: z.array(analysisRelationshipContextSchema).max(512),
    causal_policy: analysisCausalContextSchema.nullable(),
  })
  .superRefine((context, ctx) => {
    const scopeRefs = [
      context.semantic_release_ref,
      context.schema_snapshot_ref,
      context.policy_receipt_ref,
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

export async function computeSemanticContextPackageKeyHash(input: unknown) {
  const fullPackage = semanticContextPackageSchema.safeParse(input);
  const material = fullPackage.success
    ? semanticContextPackageMaterialSchema.parse(
        Object.fromEntries(
          Object.entries(fullPackage.data).filter(
            ([key]) => !["package_id", "package_key_hash", "package_hash"].includes(key),
          ),
        ),
      )
    : semanticContextPackageMaterialSchema.parse(input);
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

export async function computeSemanticContextPackageHash(input: unknown) {
  const fullPackage = semanticContextPackageSchema.safeParse(input);
  const draft = fullPackage.success
    ? semanticContextPackageDraftSchema.parse(
        Object.fromEntries(
          Object.entries(fullPackage.data).filter(([key]) => key !== "package_hash"),
        ),
      )
    : semanticContextPackageDraftSchema.parse(input);
  return sha256ContentHash(draft);
}

export async function buildSemanticContextPackage(input: unknown) {
  const material = semanticContextPackageMaterialSchema.parse(input);
  const packageKeyHash = await computeSemanticContextPackageKeyHash(material);
  const draft = semanticContextPackageDraftSchema.parse({
    ...material,
    package_id: uuidV8FromHash(packageKeyHash),
    package_key_hash: packageKeyHash,
  });
  return deepFreeze(
    semanticContextPackageSchema.parse({
      ...draft,
      package_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySemanticContextPackage(input: unknown) {
  const packageDocument = semanticContextPackageSchema.parse(input);
  const { package_hash: _packageHash, ...draft } = packageDocument;
  const expectedKeyHash = await computeSemanticContextPackageKeyHash(packageDocument);
  if (
    packageDocument.package_key_hash !== expectedKeyHash ||
    packageDocument.package_id !== uuidV8FromHash(expectedKeyHash) ||
    (await sha256ContentHash(draft)) !== packageDocument.package_hash
  ) {
    throw new TypeError("SEMANTIC_CONTEXT_PACKAGE_HASH_MISMATCH");
  }
  return packageDocument;
}

export const semanticContextPreviewResultSchema = z.strictObject({
  schema_version: z.literal("semantic-context-preview-result@1.0.0"),
  package: semanticContextPackageSchema,
});

export async function verifySemanticContextPreviewResult(input: unknown) {
  const result = semanticContextPreviewResultSchema.parse(input);
  return deepFreeze({
    ...result,
    package: await verifySemanticContextPackage(result.package),
  });
}

export const semanticContextPackageReferenceSchema = z.strictObject({
  package_id: canonicalImmutableIdSchema,
  package_revision: z.literal(1),
  package_hash: contentHashSchema,
});

const semanticContextReceiptDraftSchema = z.strictObject({
  schema_version: z.literal("semantic-context-receipt@1.0.0"),
  receipt_id: canonicalImmutableIdSchema,
  scope: appScopeSchema,
  consumer: semanticContextConsumerSchema,
  request_id: canonicalImmutableIdSchema,
  request_hash: contentHashSchema,
  run_id: canonicalImmutableIdSchema.nullable(),
  package_ref: semanticContextPackageReferenceSchema,
  state: semanticContextStateSchema,
  route: semanticContextRouteSchema,
  authority_snapshot_hash: contentHashSchema,
  resolved_at: timestampSchema,
});

export const semanticContextReceiptSchema = semanticContextReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

export async function buildSemanticContextReceipt(input: unknown) {
  const draft = semanticContextReceiptDraftSchema.parse(input);
  return deepFreeze(
    semanticContextReceiptSchema.parse({
      ...draft,
      receipt_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySemanticContextReceipt(input: unknown) {
  const receipt = semanticContextReceiptSchema.parse(input);
  const { receipt_hash: _receiptHash, ...draft } = receipt;
  if ((await sha256ContentHash(draft)) !== receipt.receipt_hash) {
    throw new TypeError("SEMANTIC_CONTEXT_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

export const semanticContextCommitCommandSchema = z.strictObject({
  schema_version: z.literal("semantic-context-commit@1.0.0"),
  request: semanticContextRequestSchema,
  authority_snapshot_hash: contentHashSchema,
  package: semanticContextPackageSchema,
  receipt: semanticContextReceiptSchema,
});

export async function verifySemanticContextCommitCommand(input: unknown) {
  const command = semanticContextCommitCommandSchema.parse(input);
  const [request, packageDocument, receipt] = await Promise.all([
    verifySemanticContextRequest(command.request),
    verifySemanticContextPackage(command.package),
    verifySemanticContextReceipt(command.receipt),
  ]);
  const runId = request.basis.consumer === "RUN" ? request.basis.run_id : null;
  const hasIntent =
    request.basis.consumer === "RUN" && request.basis.provider_task_ref !== undefined;
  if (
    (packageDocument.retrieval_receipt.intent_context_hash !== undefined) !== hasIntent ||
    (packageDocument.retrieval_receipt.retrieval_query_hash !== undefined) !== hasIntent ||
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
    throw new TypeError("SEMANTIC_CONTEXT_COMMIT_CLOSURE_MISMATCH");
  }
  return deepFreeze({ ...command, request, package: packageDocument, receipt });
}

export const semanticContextCommitResultSchema = z.strictObject({
  schema_version: z.literal("semantic-context-commit-result@1.0.0"),
  disposition: z.enum(["CREATED", "REPLAYED"]),
  package: semanticContextPackageSchema,
  receipt: semanticContextReceiptSchema,
});

export async function verifySemanticContextCommitResult(input: unknown) {
  const result = semanticContextCommitResultSchema.parse(input);
  const [packageDocument, receipt] = await Promise.all([
    verifySemanticContextPackage(result.package),
    verifySemanticContextReceipt(result.receipt),
  ]);
  if (
    receipt.package_ref.package_id !== packageDocument.package_id ||
    receipt.package_ref.package_hash !== packageDocument.package_hash ||
    receipt.authority_snapshot_hash !== packageDocument.authority_snapshot_hash ||
    receipt.state !== packageDocument.route_decision.state ||
    receipt.route !== packageDocument.route_decision.route
  ) {
    throw new TypeError("SEMANTIC_CONTEXT_RESULT_CLOSURE_MISMATCH");
  }
  return deepFreeze({ ...result, package: packageDocument, receipt });
}

export type SemanticContextRequest = z.infer<typeof semanticContextRequestSchema>;
export type SemanticContextState = z.infer<typeof semanticContextStateSchema>;
export type SemanticContextAuthoritySnapshot = z.infer<
  typeof semanticContextAuthoritySnapshotSchema
>;
export type PublishedMetricContext = z.infer<typeof publishedMetricContextSchema>;
export type SemanticContextClarification = z.infer<typeof semanticContextClarificationSchema>;
export type SemanticContextRouteDecision = z.infer<typeof semanticContextRouteDecisionSchema>;
export type ContextCapacityItem = z.infer<typeof contextCapacityItemSchema>;
export type ContextCapacityPlan = z.infer<typeof contextCapacityPlanSchema>;
export type SemanticContextEvidenceSummary = z.infer<typeof semanticContextEvidenceSummarySchema>;
export type SemanticContextPackage = z.infer<typeof semanticContextPackageSchema>;
export type SemanticContextPreviewResult = z.infer<typeof semanticContextPreviewResultSchema>;
export type AnalysisMetricReference = z.infer<typeof analysisMetricReferenceSchema>;
export type AnalysisDimensionContext = z.infer<typeof analysisDimensionContextSchema>;
export type AnalysisMetricContext = z.infer<typeof analysisMetricContextSchema>;
export type AnalysisRelationshipContext = z.infer<typeof analysisRelationshipContextSchema>;
export type AnalysisCausalContext = z.infer<typeof analysisCausalContextSchema>;
export type AnalysisContext = z.infer<typeof analysisContextSchema>;
export type SemanticContextReceipt = z.infer<typeof semanticContextReceiptSchema>;
export type SemanticContextCommitCommand = z.infer<typeof semanticContextCommitCommandSchema>;
export type SemanticContextCommitResult = z.infer<typeof semanticContextCommitResultSchema>;
