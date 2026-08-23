import { z } from "zod";
import {
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { semanticScopeSchema } from "./semantic-control-plane.js";
import {
  semanticCandidateCreateResultSchema,
  semanticCandidateDraftSchema,
} from "./semantic-governance-requests.js";

const positiveSafeIntegerSchema = z.number().int().positive().safe();

function canonicalStrings(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || (values[index - 1] ?? "") < value)
  );
}

function canonicalBy<T>(values: readonly T[], identity: (value: T) => string): boolean {
  const identities = values.map(identity);
  return canonicalStrings(identities);
}

export const semanticInductionKindSchema = z.enum([
  "SCHEMA_INDUCTION",
  "DOCUMENT_INDUCTION",
  "FOUNDATIONAL_GROUNDING",
  "DRIFT_REPAIR",
  "METRIC_IMPORT",
]);

export const semanticInductionSourceKindSchema = z.enum([
  "PHYSICAL_SCHEMA",
  "KNOWLEDGE_DOCUMENT",
  "METRIC_EXCHANGE",
  "FOUNDATIONAL_ONTOLOGY",
]);

export const semanticInductionSourceReferenceSchema = z.strictObject({
  resource_kind: z.enum([
    "SCHEMA_SNAPSHOT",
    "KNOWLEDGE_REVISION",
    "METRIC_EXCHANGE_PACKAGE",
    "FOUNDATIONAL_ONTOLOGY_RELEASE",
  ]),
  resource_id: immutableIdSchema,
  resource_revision: positiveSafeIntegerSchema,
  resource_hash: contentHashSchema,
});

export const semanticInductionTaintSchema = z.strictObject({
  contains_holdout_or_test: z.literal(false),
  contains_gold_or_expected_output: z.literal(false),
  contains_oracle_feedback: z.literal(false),
  sealed_benchmark: z.literal(false),
});

export const semanticInductionSourceSchema = z
  .strictObject({
    schema_version: z.literal("semantic-induction-source@1.0.0"),
    source_kind: semanticInductionSourceKindSchema,
    source_ref: semanticInductionSourceReferenceSchema,
    corpus_class: z.literal("SEMANTIC_BOOTSTRAP_CORPUS"),
    taint: semanticInductionTaintSchema,
  })
  .superRefine((source, context) => {
    const expected = {
      PHYSICAL_SCHEMA: "SCHEMA_SNAPSHOT",
      KNOWLEDGE_DOCUMENT: "KNOWLEDGE_REVISION",
      METRIC_EXCHANGE: "METRIC_EXCHANGE_PACKAGE",
      FOUNDATIONAL_ONTOLOGY: "FOUNDATIONAL_ONTOLOGY_RELEASE",
    }[source.source_kind];
    if (source.source_ref.resource_kind !== expected) {
      context.addIssue({
        code: "custom",
        message: "Semantic Induction source kind and resource kind must match.",
        path: ["source_ref", "resource_kind"],
      });
    }
  });

export const semanticInductionBaseReleaseReferenceSchema = z.strictObject({
  release_id: immutableIdSchema,
  generation: positiveSafeIntegerSchema,
  release_hash: contentHashSchema,
});

export const semanticInductionRequestSchema = z
  .strictObject({
    schema_version: z.literal("semantic-induction-request@1.0.0"),
    scope: appScopeSchema,
    semantic_domain: semanticScopeSchema.shape.semantic_domain,
    induction_id: immutableIdSchema,
    induction_kind: semanticInductionKindSchema,
    base_release_ref: semanticInductionBaseReleaseReferenceSchema.nullable(),
    sources: z.array(semanticInductionSourceSchema).min(1).max(64),
    idempotency_key: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
  })
  .superRefine((request, context) => {
    const identities = request.sources.map((source) =>
      [
        source.source_kind,
        source.source_ref.resource_id,
        source.source_ref.resource_revision,
        source.source_ref.resource_hash,
      ].join(":"),
    );
    if (!canonicalStrings(identities)) {
      context.addIssue({
        code: "custom",
        message: "Semantic Induction sources must be unique and canonically sorted.",
        path: ["sources"],
      });
    }
    if (
      request.induction_kind === "SCHEMA_INDUCTION" &&
      request.sources.some((source) => source.source_kind !== "PHYSICAL_SCHEMA")
    ) {
      context.addIssue({
        code: "custom",
        message: "Schema induction only accepts schema sources.",
        path: ["sources"],
      });
    }
    if (
      request.induction_kind === "DOCUMENT_INDUCTION" &&
      request.sources.some((source) => source.source_kind !== "KNOWLEDGE_DOCUMENT")
    ) {
      context.addIssue({
        code: "custom",
        message: "Document induction only accepts governed documents.",
        path: ["sources"],
      });
    }
    if (
      request.induction_kind === "METRIC_IMPORT" &&
      (request.sources.length !== 1 ||
        request.sources.some((source) => source.source_kind !== "METRIC_EXCHANGE"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Metric import only accepts metric exchange packages.",
        path: ["sources"],
      });
    }
    if (
      request.induction_kind === "FOUNDATIONAL_GROUNDING" &&
      request.sources.some((source) => source.source_kind !== "FOUNDATIONAL_ONTOLOGY")
    ) {
      context.addIssue({
        code: "custom",
        message: "Foundational grounding only accepts foundational ontology releases.",
        path: ["sources"],
      });
    }
  });

export const semanticStableObjectRoleSchema = z.enum([
  "ENTITY",
  "DIMENSION",
  "METRIC",
  "RELATIONSHIP",
  "FORMULA",
  "TERM",
  "RULE",
  "PHYSICAL_BINDING",
  "ONTOLOGY_ALIGNMENT",
]);

export const semanticStableObjectIdentityMaterialSchema = z
  .strictObject({
    schema_version: z.literal("semantic-stable-object-identity-material@1.0.0"),
    namespace: versionIdentifierSchema,
    object_role: semanticStableObjectRoleSchema,
    normalized_name: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*$/u),
    mapping_identities: z.array(z.string().min(1).max(512)).min(1).max(256),
    evidence_identities: z.array(z.string().min(1).max(512)).min(1).max(256),
  })
  .superRefine((material, context) => {
    if (!canonicalStrings(material.mapping_identities)) {
      context.addIssue({
        code: "custom",
        message: "Mapping identities must be canonical.",
        path: ["mapping_identities"],
      });
    }
    if (!canonicalStrings(material.evidence_identities)) {
      context.addIssue({
        code: "custom",
        message: "Evidence identities must be canonical.",
        path: ["evidence_identities"],
      });
    }
  });

export const semanticStableObjectIdentitySchema = z
  .strictObject({
    schema_version: z.literal("semantic-stable-object-identity@1.0.0"),
    object_id: immutableIdSchema,
    identity_hash: contentHashSchema,
    material: semanticStableObjectIdentityMaterialSchema,
    aliases: z.array(z.string().min(1).max(256)).max(64),
  })
  .superRefine((identity, context) => {
    if (!canonicalStrings(identity.aliases)) {
      context.addIssue({
        code: "custom",
        message: "Stable object aliases must be canonical.",
        path: ["aliases"],
      });
    }
  });

export function semanticStableObjectIdFromIdentityHash(identityHash: string): string {
  const parsed = contentHashSchema.parse(identityHash);
  const digits = parsed.slice("sha256:".length, "sha256:".length + 32).split("");
  digits[12] = "8";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return immutableIdSchema.parse(
    `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`,
  );
}

export async function verifySemanticStableObjectIdentity(input: unknown) {
  const parsed = semanticStableObjectIdentitySchema.parse(input);
  const identityHash = await sha256ContentHash(parsed.material);
  if (
    parsed.identity_hash !== identityHash ||
    parsed.object_id !== semanticStableObjectIdFromIdentityHash(identityHash)
  ) {
    throw new TypeError("SEMANTIC_STABLE_OBJECT_IDENTITY_MISMATCH");
  }
  return deepFreeze(parsed);
}

export const semanticCandidateTierSchema = z.enum([
  "MANDATORY_PHYSICAL_CORE",
  "MANDATORY_SIGNED_ENHANCEMENT",
  "OPTIONAL_UNRESOLVED_ENHANCEMENT",
]);

export const semanticInductionEvidenceSchema = z.strictObject({
  evidence_id: versionIdentifierSchema,
  source_ref: semanticInductionSourceReferenceSchema,
  locator: z.string().min(1).max(1_024),
  observation_hash: contentHashSchema,
  signed_business_assertion: z.boolean(),
});

export const semanticInductionProposalEnvelopeSchema = z
  .strictObject({
    schema_version: z.literal("semantic-induction-proposal-envelope@1.0.0"),
    scope: appScopeSchema,
    semantic_domain: semanticScopeSchema.shape.semantic_domain,
    induction_id: immutableIdSchema,
    base_release_ref: semanticInductionBaseReleaseReferenceSchema.nullable(),
    stable_objects: z.array(semanticStableObjectIdentitySchema).max(10_000),
    evidence: z.array(semanticInductionEvidenceSchema).min(1).max(100_000),
    candidates: z
      .array(
        z.strictObject({
          operation_id: immutableIdSchema,
          object_id: immutableIdSchema,
          tier: semanticCandidateTierSchema,
          operation_hash: contentHashSchema,
        }),
      )
      .min(1)
      .max(10_000),
    proposal_hash: contentHashSchema,
  })
  .superRefine((proposal, context) => {
    if (!canonicalBy(proposal.stable_objects, (value) => value.object_id)) {
      context.addIssue({
        code: "custom",
        message: "Stable objects must be canonical.",
        path: ["stable_objects"],
      });
    }
    if (!canonicalBy(proposal.evidence, (value) => value.evidence_id)) {
      context.addIssue({
        code: "custom",
        message: "Evidence must be canonical.",
        path: ["evidence"],
      });
    }
    if (!canonicalBy(proposal.candidates, (value) => value.operation_id)) {
      context.addIssue({
        code: "custom",
        message: "Candidates must be canonical.",
        path: ["candidates"],
      });
    }
  });

export async function computeSemanticInductionProposalHash(
  input: z.input<typeof semanticInductionProposalEnvelopeSchema>,
) {
  const parsed = semanticInductionProposalEnvelopeSchema.parse(input);
  const { proposal_hash: _hash, ...draft } = parsed;
  return sha256ContentHash(draft);
}

export async function verifySemanticInductionProposalEnvelope(input: unknown) {
  const parsed = semanticInductionProposalEnvelopeSchema.parse(input);
  if ((await computeSemanticInductionProposalHash(parsed)) !== parsed.proposal_hash) {
    throw new TypeError("SEMANTIC_INDUCTION_PROPOSAL_HASH_MISMATCH");
  }
  for (const identity of parsed.stable_objects) {
    await verifySemanticStableObjectIdentity(identity);
  }
  const stableObjectIds = parsed.stable_objects.map(({ object_id }) => object_id).sort();
  const candidateObjectIds = parsed.candidates.map(({ object_id }) => object_id).sort();
  if (canonicalizeJson(stableObjectIds) !== canonicalizeJson(candidateObjectIds)) {
    throw new TypeError("SEMANTIC_INDUCTION_PROPOSAL_OBJECT_CLOSURE_MISMATCH");
  }
  const expectedEvidence = [
    ...new Set(parsed.stable_objects.flatMap(({ material }) => material.evidence_identities)),
  ].sort();
  if (
    canonicalizeJson(expectedEvidence) !==
    canonicalizeJson(parsed.evidence.map(({ evidence_id }) => evidence_id).sort())
  ) {
    throw new TypeError("SEMANTIC_INDUCTION_PROPOSAL_EVIDENCE_CLOSURE_MISMATCH");
  }
  return deepFreeze(parsed);
}

export const semanticImpactObjectKindSchema = z.enum([
  "ENTITY",
  "DIMENSION",
  "METRIC",
  "RELATIONSHIP",
  "FORMULA",
  "QUERY",
  "AGENT",
  "RELEASE",
]);

const semanticImpactPlanDraftSchema = z
  .strictObject({
    schema_version: z.literal("semantic-impact-plan@1.0.0"),
    scope: appScopeSchema,
    semantic_domain: semanticScopeSchema.shape.semantic_domain,
    induction_id: immutableIdSchema,
    changed_object_ids: z.array(immutableIdSchema).min(1).max(10_000),
    affected_objects: z
      .array(
        z.strictObject({
          object_id: immutableIdSchema,
          object_kind: semanticImpactObjectKindSchema,
          previous_hash: contentHashSchema,
          next_hash: contentHashSchema,
        }),
      )
      .min(1)
      .max(100_000),
    unchanged_object_hashes: z
      .array(z.strictObject({ object_id: immutableIdSchema, object_hash: contentHashSchema }))
      .max(100_000),
  })
  .superRefine((plan, context) => {
    if (!canonicalStrings(plan.changed_object_ids))
      context.addIssue({
        code: "custom",
        message: "Changed IDs must be canonical.",
        path: ["changed_object_ids"],
      });
    if (!canonicalBy(plan.affected_objects, (value) => value.object_id))
      context.addIssue({
        code: "custom",
        message: "Affected objects must be canonical.",
        path: ["affected_objects"],
      });
    if (!canonicalBy(plan.unchanged_object_hashes, (value) => value.object_id))
      context.addIssue({
        code: "custom",
        message: "Unchanged hashes must be canonical.",
        path: ["unchanged_object_hashes"],
      });
    const affected = new Set(plan.affected_objects.map(({ object_id }) => object_id));
    if (plan.changed_object_ids.some((objectId) => !affected.has(objectId)))
      context.addIssue({
        code: "custom",
        message: "Changed objects must be affected.",
        path: ["changed_object_ids"],
      });
    if (plan.unchanged_object_hashes.some(({ object_id }) => affected.has(object_id)))
      context.addIssue({
        code: "custom",
        message: "Affected and unchanged objects cannot overlap.",
        path: ["unchanged_object_hashes"],
      });
  });

export const semanticImpactPlanSchema = semanticImpactPlanDraftSchema.extend({
  plan_hash: contentHashSchema,
});

export async function buildSemanticImpactPlan(
  input: z.input<typeof semanticImpactPlanDraftSchema>,
) {
  const draft = semanticImpactPlanDraftSchema.parse(input);
  return deepFreeze(
    semanticImpactPlanSchema.parse({ ...draft, plan_hash: await sha256ContentHash(draft) }),
  );
}

export async function verifySemanticImpactPlan(input: unknown) {
  const parsed = semanticImpactPlanSchema.parse(input);
  const { plan_hash: _hash, ...draft } = parsed;
  if ((await sha256ContentHash(semanticImpactPlanDraftSchema.parse(draft))) !== parsed.plan_hash) {
    throw new TypeError("SEMANTIC_IMPACT_PLAN_HASH_MISMATCH");
  }
  return deepFreeze(parsed);
}

export const semanticMetricExchangeEntrySchema = z.strictObject({
  external_id: versionIdentifierSchema,
  name: z.string().min(1).max(256),
  expression: z.string().min(1).max(8_192),
  unit: z.string().min(1).max(64),
});

export const semanticMetricExchangeFormatSchema = z.enum([
  "OSI_METRIC_EXCHANGE",
  "OSSIE_METRIC_EXCHANGE",
]);

const semanticMetricDryRunReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("semantic-metric-dry-run-receipt@1.0.0"),
    scope: appScopeSchema,
    semantic_domain: semanticScopeSchema.shape.semantic_domain,
    import_id: immutableIdSchema,
    source_hash: contentHashSchema,
    status: z.enum(["VALID", "INVALID", "CONFLICT"]),
    entries: z
      .array(
        z.strictObject({
          external_id: versionIdentifierSchema,
          disposition: z.enum(["CREATE", "UPDATE", "UNCHANGED", "INVALID", "CONFLICT"]),
          stable_object_id: immutableIdSchema.nullable(),
          issues: z.array(z.string().min(1).max(1_024)).max(64),
        }),
      )
      .min(1)
      .max(10_000),
    candidate_patch_hash: contentHashSchema.nullable(),
  })
  .superRefine((receipt, context) => {
    if (!canonicalBy(receipt.entries, (value) => value.external_id))
      context.addIssue({
        code: "custom",
        message: "Metric entries must be canonical.",
        path: ["entries"],
      });
    if ((receipt.status === "VALID") !== (receipt.candidate_patch_hash !== null))
      context.addIssue({
        code: "custom",
        message: "Only a valid dry-run can carry a candidate patch hash.",
        path: ["candidate_patch_hash"],
      });
  });

export const semanticMetricDryRunReceiptSchema = semanticMetricDryRunReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

export async function buildSemanticMetricDryRunReceipt(
  input: z.input<typeof semanticMetricDryRunReceiptDraftSchema>,
) {
  const draft = semanticMetricDryRunReceiptDraftSchema.parse(input);
  return deepFreeze(
    semanticMetricDryRunReceiptSchema.parse({
      ...draft,
      receipt_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySemanticMetricDryRunReceipt(input: unknown) {
  const parsed = semanticMetricDryRunReceiptSchema.parse(input);
  const { receipt_hash: _hash, ...draft } = parsed;
  if (
    (await sha256ContentHash(semanticMetricDryRunReceiptDraftSchema.parse(draft))) !==
    parsed.receipt_hash
  )
    throw new TypeError("SEMANTIC_METRIC_DRY_RUN_HASH_MISMATCH");
  return deepFreeze(parsed);
}

export const semanticInductionDomainReferenceSchema = z.strictObject({
  resource_id: immutableIdSchema,
  resource_revision: positiveSafeIntegerSchema,
  resource_hash: contentHashSchema,
});

export const semanticInductionFactSchema = z.strictObject({
  namespace: versionIdentifierSchema,
  object_role: semanticStableObjectRoleSchema,
  name: z.string().min(1).max(256),
  aliases: z.array(z.string().min(1).max(256)).max(64),
  mapping_identities: z.array(z.string().min(1).max(512)).min(1).max(256),
  evidence_identities: z.array(z.string().min(1).max(512)).min(1).max(256),
  payload: z.record(z.string().min(1).max(128), z.json()),
});

export const semanticInductionSourceContentSchema = z
  .strictObject({
    source_ref: semanticInductionSourceReferenceSchema,
    content_hash: contentHashSchema,
    metric_format: semanticMetricExchangeFormatSchema.nullable(),
    facts: z.array(semanticInductionFactSchema).max(10_000),
    metrics: z.array(semanticMetricExchangeEntrySchema).max(10_000),
    document_chunks: z
      .array(
        z.strictObject({
          chunk_id: immutableIdSchema,
          ordinal: z.number().int().nonnegative().safe(),
          text_hash: contentHashSchema,
          normalized_text: z.string().min(1).max(32_768),
        }),
      )
      .max(10_000),
  })
  .superRefine((source, context) => {
    if (
      (source.source_ref.resource_kind === "METRIC_EXCHANGE_PACKAGE") !==
      (source.metric_format !== null)
    ) {
      context.addIssue({ code: "custom", message: "Metric format must match the source kind." });
    }
    if (source.source_ref.resource_kind === "METRIC_EXCHANGE_PACKAGE") {
      if (
        source.facts.length > 0 ||
        source.metrics.length === 0 ||
        source.document_chunks.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Metric exchange sources may contain only metric entries.",
        });
      }
    }
    if (source.source_ref.resource_kind === "FOUNDATIONAL_ONTOLOGY_RELEASE") {
      if (
        source.facts.length === 0 ||
        source.metrics.length > 0 ||
        source.document_chunks.length > 0 ||
        source.facts.some((fact) => fact.object_role !== "ONTOLOGY_ALIGNMENT")
      ) {
        context.addIssue({
          code: "custom",
          message: "Foundational sources may contain only ontology alignment facts.",
        });
      }
    }
  });

export const semanticInductionTargetSchema = z.strictObject({
  request: semanticInductionRequestSchema,
  sources: z.array(semanticInductionSourceContentSchema).min(1).max(64),
  previous_objects: z
    .array(
      z.strictObject({
        object_id: immutableIdSchema,
        object_kind: semanticImpactObjectKindSchema,
        object_hash: contentHashSchema,
      }),
    )
    .max(100_000),
  dependencies: z
    .array(
      z.strictObject({
        source_object_id: immutableIdSchema,
        dependent_object_id: immutableIdSchema,
      }),
    )
    .max(250_000),
});

const semanticInductionSourcePackageContentSchema = z.strictObject({
  metric_format: semanticMetricExchangeFormatSchema.nullable(),
  facts: z.array(semanticInductionFactSchema).max(10_000),
  metrics: z.array(semanticMetricExchangeEntrySchema).max(10_000),
  dependencies: z
    .array(
      z.strictObject({
        source_object_id: immutableIdSchema,
        dependent_object_id: immutableIdSchema,
      }),
    )
    .max(250_000),
});

const semanticInductionSourceRegistrationDraftSchema = z
  .strictObject({
    schema_version: z.literal("semantic-induction-source-register@1.0.0"),
    scope: appScopeSchema,
    semantic_domain: semanticScopeSchema.shape.semantic_domain,
    source_kind: z.enum(["METRIC_EXCHANGE", "FOUNDATIONAL_ONTOLOGY"]),
    resource_id: immutableIdSchema,
    resource_revision: positiveSafeIntegerSchema,
    content: semanticInductionSourcePackageContentSchema,
  })
  .superRefine((command, context) => {
    if ((command.source_kind === "METRIC_EXCHANGE") !== (command.content.metric_format !== null)) {
      context.addIssue({
        code: "custom",
        message: "Metric source registration requires its format.",
      });
    }
    if (
      command.source_kind === "METRIC_EXCHANGE" &&
      (command.content.facts.length > 0 || command.content.metrics.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Metric source registration may contain only metric entries.",
      });
    }
    if (
      command.source_kind === "FOUNDATIONAL_ONTOLOGY" &&
      (command.content.facts.length === 0 ||
        command.content.metrics.length > 0 ||
        command.content.facts.some((fact) => fact.object_role !== "ONTOLOGY_ALIGNMENT"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Foundational source registration may contain only ontology alignment facts.",
      });
    }
  });

export const semanticInductionSourceRegistrationCommandSchema =
  semanticInductionSourceRegistrationDraftSchema.extend({
    source: semanticInductionSourceSchema,
    request_hash: contentHashSchema,
  });

export async function buildSemanticInductionSourceRegistrationCommand(
  input: z.input<typeof semanticInductionSourceRegistrationDraftSchema>,
) {
  const draft = semanticInductionSourceRegistrationDraftSchema.parse(input);
  const resourceHash = await sha256ContentHash(draft.content);
  const source = semanticInductionSourceSchema.parse({
    schema_version: "semantic-induction-source@1.0.0",
    source_kind: draft.source_kind,
    source_ref: {
      resource_kind:
        draft.source_kind === "METRIC_EXCHANGE"
          ? "METRIC_EXCHANGE_PACKAGE"
          : "FOUNDATIONAL_ONTOLOGY_RELEASE",
      resource_id: draft.resource_id,
      resource_revision: draft.resource_revision,
      resource_hash: resourceHash,
    },
    corpus_class: "SEMANTIC_BOOTSTRAP_CORPUS",
    taint: {
      contains_holdout_or_test: false,
      contains_gold_or_expected_output: false,
      contains_oracle_feedback: false,
      sealed_benchmark: false,
    },
  });
  return deepFreeze(
    semanticInductionSourceRegistrationCommandSchema.parse({
      ...draft,
      source,
      request_hash: await sha256ContentHash({ ...draft, source }),
    }),
  );
}

export async function verifySemanticInductionSourceRegistrationCommand(input: unknown) {
  const parsed = semanticInductionSourceRegistrationCommandSchema.parse(input);
  const rebuilt = await buildSemanticInductionSourceRegistrationCommand({
    schema_version: parsed.schema_version,
    scope: parsed.scope,
    semantic_domain: parsed.semantic_domain,
    source_kind: parsed.source_kind,
    resource_id: parsed.resource_id,
    resource_revision: parsed.resource_revision,
    content: parsed.content,
  });
  if (canonicalizeJson(rebuilt) !== canonicalizeJson(parsed)) {
    throw new TypeError("SEMANTIC_INDUCTION_SOURCE_REGISTRATION_HASH_MISMATCH");
  }
  return deepFreeze(parsed);
}

export const semanticInductionCommitCommandSchema = z.strictObject({
  schema_version: z.literal("semantic-induction-commit-command@1.0.0"),
  request: semanticInductionRequestSchema,
  proposal: semanticInductionProposalEnvelopeSchema,
  impact_plan: semanticImpactPlanSchema,
  metric_dry_run: semanticMetricDryRunReceiptSchema.nullable(),
  candidate_draft: semanticCandidateDraftSchema,
});

export async function verifySemanticInductionCommitCommand(input: unknown) {
  const parsed = semanticInductionCommitCommandSchema.parse(input);
  await verifySemanticInductionProposalEnvelope(parsed.proposal);
  await verifySemanticImpactPlan(parsed.impact_plan);
  if (parsed.metric_dry_run) await verifySemanticMetricDryRunReceipt(parsed.metric_dry_run);
  const requestSourceRefs = new Set(
    parsed.request.sources.map(({ source_ref }) => canonicalizeJson(source_ref)),
  );
  const candidateObjectIds = new Set(parsed.proposal.candidates.map(({ object_id }) => object_id));
  if (
    canonicalizeJson(parsed.proposal.scope) !== canonicalizeJson(parsed.request.scope) ||
    parsed.proposal.semantic_domain !== parsed.request.semantic_domain ||
    parsed.proposal.induction_id !== parsed.request.induction_id ||
    canonicalizeJson(parsed.proposal.base_release_ref) !==
      canonicalizeJson(parsed.request.base_release_ref) ||
    canonicalizeJson(parsed.impact_plan.scope) !== canonicalizeJson(parsed.request.scope) ||
    parsed.impact_plan.semantic_domain !== parsed.request.semantic_domain ||
    parsed.impact_plan.induction_id !== parsed.request.induction_id ||
    parsed.proposal.evidence.some(
      ({ source_ref }) => !requestSourceRefs.has(canonicalizeJson(source_ref)),
    ) ||
    parsed.impact_plan.changed_object_ids.some((objectId) => !candidateObjectIds.has(objectId)) ||
    parsed.candidate_draft.semantic_domain !== parsed.request.semantic_domain ||
    parsed.candidate_draft.idempotency_key !== parsed.request.induction_id ||
    parsed.candidate_draft.source_payload.content.proposal_hash !== parsed.proposal.proposal_hash ||
    parsed.candidate_draft.source_payload.content.review_only !== true ||
    (parsed.metric_dry_run !== null &&
      (canonicalizeJson(parsed.metric_dry_run.scope) !== canonicalizeJson(parsed.request.scope) ||
        parsed.metric_dry_run.semantic_domain !== parsed.request.semantic_domain ||
        parsed.metric_dry_run.import_id !== parsed.request.induction_id ||
        parsed.request.induction_kind !== "METRIC_IMPORT"))
  ) {
    throw new TypeError("SEMANTIC_INDUCTION_COMMIT_CLOSURE_MISMATCH");
  }
  return deepFreeze(parsed);
}

export const semanticInductionRejectCommandSchema = z
  .strictObject({
    schema_version: z.literal("semantic-induction-reject-command@1.0.0"),
    request: semanticInductionRequestSchema,
    terminal: z.enum(["DRY_RUN_REJECTED", "CONFLICT"]),
    metric_dry_run: semanticMetricDryRunReceiptSchema.nullable(),
  })
  .superRefine((command, context) => {
    if (
      command.terminal === "DRY_RUN_REJECTED" &&
      (command.metric_dry_run === null || command.metric_dry_run.status === "VALID")
    ) {
      context.addIssue({
        code: "custom",
        message: "Dry-run rejection requires a rejected receipt.",
      });
    }
    if (
      command.metric_dry_run !== null &&
      (canonicalizeJson(command.metric_dry_run.scope) !== canonicalizeJson(command.request.scope) ||
        command.metric_dry_run.semantic_domain !== command.request.semantic_domain ||
        command.metric_dry_run.import_id !== command.request.induction_id)
    ) {
      context.addIssue({
        code: "custom",
        message: "Rejected metric receipt must match the request.",
      });
    }
  });

const semanticInductionReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("semantic-induction-receipt@1.0.0"),
    scope: appScopeSchema,
    semantic_domain: semanticScopeSchema.shape.semantic_domain,
    induction_id: immutableIdSchema,
    request_hash: contentHashSchema,
    proposal_hash: contentHashSchema.nullable(),
    impact_plan_ref: semanticInductionDomainReferenceSchema.nullable(),
    metric_dry_run_ref: semanticInductionDomainReferenceSchema.nullable(),
    candidate_ref: semanticInductionDomainReferenceSchema.nullable(),
    terminal: z.enum(["CANDIDATE_CREATED", "DRY_RUN_REJECTED", "EVIDENCE_REJECTED", "CONFLICT"]),
    created_at: timestampSchema,
  })
  .superRefine((receipt, context) => {
    if ((receipt.terminal === "CANDIDATE_CREATED") !== (receipt.candidate_ref !== null))
      context.addIssue({
        code: "custom",
        message: "Only a created Candidate can carry a Candidate reference.",
        path: ["candidate_ref"],
      });
    if (
      receipt.terminal === "CANDIDATE_CREATED" &&
      (receipt.proposal_hash === null || receipt.impact_plan_ref === null)
    )
      context.addIssue({
        code: "custom",
        message: "Created Candidates require proposal and impact authority.",
        path: ["terminal"],
      });
  });

export const semanticInductionReceiptSchema = semanticInductionReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

export const semanticInductionRejectResultSchema = z.strictObject({
  schema_version: z.literal("semantic-induction-reject-result@1.0.0"),
  receipt: semanticInductionReceiptSchema,
});

export const semanticInductionCommitResultSchema = z.strictObject({
  schema_version: z.literal("semantic-induction-commit-result@1.0.0"),
  receipt: semanticInductionReceiptSchema,
  candidate: semanticCandidateCreateResultSchema,
});

export async function buildSemanticInductionReceipt(
  input: z.input<typeof semanticInductionReceiptDraftSchema>,
) {
  const draft = semanticInductionReceiptDraftSchema.parse(input);
  return deepFreeze(
    semanticInductionReceiptSchema.parse({
      ...draft,
      receipt_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySemanticInductionReceipt(input: unknown) {
  const parsed = semanticInductionReceiptSchema.parse(input);
  const { receipt_hash: _hash, ...draft } = parsed;
  if (
    (await sha256ContentHash(semanticInductionReceiptDraftSchema.parse(draft))) !==
    parsed.receipt_hash
  )
    throw new TypeError("SEMANTIC_INDUCTION_RECEIPT_HASH_MISMATCH");
  return deepFreeze(parsed);
}

export type SemanticInductionRequest = z.infer<typeof semanticInductionRequestSchema>;
export type SemanticInductionSource = z.infer<typeof semanticInductionSourceSchema>;
export type SemanticInductionSourceReference = z.infer<
  typeof semanticInductionSourceReferenceSchema
>;
export type SemanticStableObjectIdentityMaterial = z.infer<
  typeof semanticStableObjectIdentityMaterialSchema
>;
export type SemanticStableObjectIdentity = z.infer<typeof semanticStableObjectIdentitySchema>;
export type SemanticImpactPlan = z.infer<typeof semanticImpactPlanSchema>;
export type SemanticMetricDryRunReceipt = z.infer<typeof semanticMetricDryRunReceiptSchema>;
export type SemanticInductionReceipt = z.infer<typeof semanticInductionReceiptSchema>;
export type SemanticInductionFact = z.infer<typeof semanticInductionFactSchema>;
export type SemanticInductionSourceContent = z.infer<typeof semanticInductionSourceContentSchema>;
export type SemanticInductionTarget = z.infer<typeof semanticInductionTargetSchema>;
export type SemanticInductionCommitCommand = z.infer<typeof semanticInductionCommitCommandSchema>;
export type SemanticInductionCommitResult = z.infer<typeof semanticInductionCommitResultSchema>;
export type SemanticInductionRejectCommand = z.infer<typeof semanticInductionRejectCommandSchema>;
export type SemanticInductionRejectResult = z.infer<typeof semanticInductionRejectResultSchema>;
export type SemanticInductionSourceRegistrationCommand = z.infer<
  typeof semanticInductionSourceRegistrationCommandSchema
>;
