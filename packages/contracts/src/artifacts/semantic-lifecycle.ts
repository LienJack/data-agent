import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import { semanticScopeSchema } from "./semantic-control-plane.js";

export const SEMANTIC_ASSERTION_CANDIDATE_VERSION =
  "semantic-assertion-candidate@1.0.0" as const;
export const SEMANTIC_CHANGE_SET_VERSION = "semantic-change-set@1.0.0" as const;

export const semanticAssertionSourceKindSchema = z.enum([
  "SELECTED_KNOWLEDGE_EVIDENCE",
  "SCHEMA_FACT",
  "CURRENT_SEMANTIC_FACT",
  "AGENT_INFERENCE",
]);

export const semanticAssertionTargetKindSchema = z.enum([
  "BUSINESS_ENTITY_TYPE",
  "DIMENSION",
  "METRIC",
  "RELATIONSHIP",
  "PHYSICAL_BINDING",
  "TERM",
  "FORMULA",
  "TIME_SEMANTICS",
  "QUALITY_CONSTRAINT",
  "ANALYSIS_JOIN",
]);

export const semanticAssertionEvidenceSchema = z.strictObject({
  evidence_id: versionIdentifierSchema,
  source_kind: semanticAssertionSourceKindSchema,
  source_ref: z.strictObject({
    resource_id: versionIdentifierSchema,
    resource_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    resource_hash: contentHashSchema,
  }),
  locator: z.strictObject({
    locator_kind: z.enum([
      "DOCUMENT_SPAN",
      "SCHEMA_OBJECT",
      "SEMANTIC_OBJECT",
      "INFERENCE_RULE",
    ]),
    locator_value: z.string().trim().min(1).max(2_048),
  }),
  observation: z.string().trim().min(1).max(4_096),
});

const canonicalVersionIdentifiersSchema = z
  .array(versionIdentifierSchema)
  .max(256)
  .superRefine((values, context) => {
    for (let index = 1; index < values.length; index += 1) {
      if (values[index - 1]! >= values[index]!) {
        context.addIssue({
          code: "custom",
          message: "Identifiers must be unique and canonically sorted.",
          path: [index],
        });
      }
    }
  });

const semanticAssertionCandidateMaterialSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_ASSERTION_CANDIDATE_VERSION),
    assertion_id: immutableIdSchema,
    scope: semanticScopeSchema,
    target_kind: semanticAssertionTargetKindSchema,
    canonical_key: z.string().trim().min(1).max(512),
    applicability_scope: z.record(z.string().min(1).max(128), z.string().max(1_024)),
    assertion_payload: z.record(z.string().min(1).max(256), z.unknown()),
    source_kind: semanticAssertionSourceKindSchema,
    evidence: z.array(semanticAssertionEvidenceSchema).min(1).max(256),
    premise_assertion_ids: canonicalVersionIdentifiersSchema,
    inference_rule_id: versionIdentifierSchema.nullable(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((assertion, context) => {
    const ownSourceEvidence = assertion.evidence.some(
      (evidence) => evidence.source_kind === assertion.source_kind,
    );
    if (!ownSourceEvidence) {
      context.addIssue({
        code: "custom",
        message: "Assertion source kind must be backed by matching evidence.",
        path: ["evidence"],
      });
    }
    if (assertion.source_kind === "AGENT_INFERENCE") {
      if (assertion.premise_assertion_ids.length === 0 || assertion.inference_rule_id === null) {
        context.addIssue({
          code: "custom",
          message: "Agent inference requires explicit premises and a registered rule.",
          path: ["premise_assertion_ids"],
        });
      }
      if (assertion.confidence === 1) {
        context.addIssue({
          code: "custom",
          message: "Agent inference cannot claim absolute confidence.",
          path: ["confidence"],
        });
      }
    } else if (
      assertion.premise_assertion_ids.length > 0 ||
      assertion.inference_rule_id !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Only Agent inference may declare premises or inference rules.",
        path: ["inference_rule_id"],
      });
    }
  });

export const semanticAssertionCandidateSchema = semanticAssertionCandidateMaterialSchema.extend({
  identity_hash: contentHashSchema,
  assertion_hash: contentHashSchema,
});

export const semanticAssertionConflictSchema = z.strictObject({
  identity_hash: contentHashSchema,
  assertion_ids: canonicalVersionIdentifiersSchema.min(2),
  assertion_hashes: z
    .array(contentHashSchema)
    .min(2)
    .superRefine((values, context) => {
      for (let index = 1; index < values.length; index += 1) {
        if (values[index - 1]! >= values[index]!) {
          context.addIssue({
            code: "custom",
            message: "Assertion hashes must be unique and canonically sorted.",
            path: [index],
          });
        }
      }
    }),
  reason_code: z.literal("SEMANTIC_ASSERTION_CONFLICT"),
});

export const semanticChangeSetValidationSchema = z.strictObject({
  outcome: z.enum(["PASS", "FAIL"]),
  reason_codes: z.array(z.string().trim().min(1).max(128)).max(256),
  formula_cycle_free: z.boolean(),
  evidence_closed: z.boolean(),
  identity_conflict_free: z.boolean(),
});

const semanticChangeSetMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_CHANGE_SET_VERSION),
  change_set_id: immutableIdSchema,
  scope: semanticScopeSchema,
  base_release: z.strictObject({
    release_id: immutableIdSchema,
    generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    release_hash: contentHashSchema,
  }),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  assertions: z.array(semanticAssertionCandidateSchema).min(1).max(10_000),
  conflicts: z.array(semanticAssertionConflictSchema).max(10_000),
  validation: semanticChangeSetValidationSchema,
  lifecycle_state: z.enum(["DRAFT", "VALIDATED", "BLOCKED", "REVIEW_FROZEN"]),
});

export const semanticChangeSetSchema = semanticChangeSetMaterialSchema
  .extend({ change_set_hash: contentHashSchema })
  .superRefine((changeSet, context) => {
    const keys = changeSet.assertions.map(
      (assertion) => `${assertion.identity_hash}\u0000${assertion.assertion_hash}`,
    );
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({
          code: "custom",
          message: "Assertions must be unique and canonically sorted.",
          path: ["assertions", index],
        });
      }
    }
    const blocked = changeSet.validation.outcome === "FAIL" || changeSet.conflicts.length > 0;
    if (blocked !== (changeSet.lifecycle_state === "BLOCKED")) {
      context.addIssue({
        code: "custom",
        message: "Blocked lifecycle state must match validation and conflict outcome.",
        path: ["lifecycle_state"],
      });
    }
  });

function assertionMaterial(input: unknown) {
  const full = semanticAssertionCandidateSchema.safeParse(input);
  if (!full.success) return semanticAssertionCandidateMaterialSchema.parse(input);
  const { identity_hash: _identityHash, assertion_hash: _assertionHash, ...material } = full.data;
  return semanticAssertionCandidateMaterialSchema.parse(material);
}

export async function computeSemanticAssertionIdentityHash(input: unknown) {
  const assertion = assertionMaterial(input);
  return sha256ContentHash({
    scope: assertion.scope,
    target_kind: assertion.target_kind,
    canonical_key: assertion.canonical_key,
    applicability_scope: assertion.applicability_scope,
  });
}

export async function computeSemanticAssertionHash(input: unknown) {
  return sha256ContentHash(assertionMaterial(input));
}

export async function buildSemanticAssertionCandidate(input: unknown) {
  const material = assertionMaterial(input);
  return semanticAssertionCandidateSchema.parse({
    ...material,
    identity_hash: await computeSemanticAssertionIdentityHash(material),
    assertion_hash: await computeSemanticAssertionHash(material),
  });
}

function changeSetMaterial(input: unknown) {
  const full = semanticChangeSetSchema.safeParse(input);
  if (!full.success) return semanticChangeSetMaterialSchema.parse(input);
  const { change_set_hash: _changeSetHash, ...material } = full.data;
  return semanticChangeSetMaterialSchema.parse(material);
}

export async function computeSemanticChangeSetHash(input: unknown) {
  return sha256ContentHash(changeSetMaterial(input));
}

export async function buildSemanticChangeSet(input: unknown) {
  const material = changeSetMaterial(input);
  return semanticChangeSetSchema.parse({
    ...material,
    change_set_hash: await computeSemanticChangeSetHash(material),
  });
}

export async function verifySemanticChangeSet(input: unknown) {
  const changeSet = semanticChangeSetSchema.parse(input);
  if ((await computeSemanticChangeSetHash(changeSet)) !== changeSet.change_set_hash) {
    throw new TypeError("SEMANTIC_CHANGE_SET_HASH_MISMATCH");
  }
  for (const assertion of changeSet.assertions) {
    if (
      (await computeSemanticAssertionIdentityHash(assertion)) !== assertion.identity_hash ||
      (await computeSemanticAssertionHash(assertion)) !== assertion.assertion_hash
    ) {
      throw new TypeError("SEMANTIC_ASSERTION_HASH_MISMATCH");
    }
  }
  return changeSet;
}

export type SemanticAssertionSourceKind = z.infer<typeof semanticAssertionSourceKindSchema>;
export type SemanticAssertionTargetKind = z.infer<typeof semanticAssertionTargetKindSchema>;
export type SemanticAssertionEvidence = z.infer<typeof semanticAssertionEvidenceSchema>;
export type SemanticAssertionCandidate = z.infer<typeof semanticAssertionCandidateSchema>;
export type SemanticAssertionConflict = z.infer<typeof semanticAssertionConflictSchema>;
export type SemanticChangeSetValidation = z.infer<typeof semanticChangeSetValidationSchema>;
export type SemanticChangeSet = z.infer<typeof semanticChangeSetSchema>;
