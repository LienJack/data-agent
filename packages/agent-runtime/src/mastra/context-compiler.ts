import { Buffer } from "node:buffer";
import {
  type ArtifactReference,
  appScopeSchema,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import { agentProfileRevisionSchema, dataAgentProfileIdSchema } from "../teams/agent-profiles.js";

const contextKindSchema = z.enum([
  "GOAL",
  "QUESTION",
  "POLICY",
  "SEMANTIC_RELEASE",
  "SCHEMA_MAPPING",
  "QUERY_EVIDENCE",
  "CLAIM_EVIDENCE",
  "OPEN_OBLIGATIONS",
]);

const candidateSchema = z.strictObject({
  candidate_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/),
  context_kind: contextKindSchema,
  source_ref: artifactReferenceSchema,
  mandatory: z.boolean(),
  media_type: z.enum(["text/plain", "application/json"]),
  content: z.string().max(16_384),
  priority: z.number().int().min(0).max(1_000),
});

export const teamContextBuildInputSchema = z
  .strictObject({
    schema_version: z.literal("team-context-build@2.0.0"),
    epoch_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    task_id: immutableIdSchema,
    profile_revision: agentProfileRevisionSchema,
    goal_revision: z.number().int().positive(),
    task_revision: z.number().int().positive(),
    event_watermark: z.number().int().nonnegative(),
    policy_ref: artifactReferenceSchema,
    semantic_release_ref: artifactReferenceSchema.nullable(),
    max_context_bytes: z.number().int().positive().max(65_536),
    candidates: z.array(candidateSchema).max(128),
  })
  .superRefine((input, ctx) => {
    const ids = new Set<string>();
    input.candidates.forEach((candidate, index) => {
      if (ids.has(candidate.candidate_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Context candidate ids must be unique.",
          path: ["candidates", index, "candidate_id"],
        });
      }
      ids.add(candidate.candidate_id);
      if (!sameScopeAndRun(input.scope, input.run_id, candidate.source_ref)) {
        ctx.addIssue({
          code: "custom",
          message: "Context candidate ref must match task scope and run.",
          path: ["candidates", index, "source_ref"],
        });
      }
    });
    for (const [path, reference] of [
      ["policy_ref", input.policy_ref],
      ["semantic_release_ref", input.semantic_release_ref],
    ] as const) {
      if (reference && !sameScopeAndRun(input.scope, input.run_id, reference)) {
        ctx.addIssue({
          code: "custom",
          message: "Context authority ref must match task scope and run.",
          path: [path],
        });
      }
    }
    for (const requiredKind of input.profile_revision.mandatory_context) {
      if (
        !input.candidates.some(
          (candidate) => candidate.context_kind === requiredKind && candidate.mandatory,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Mandatory context kind ${requiredKind} is missing.`,
          path: ["candidates"],
        });
      }
    }
  });

function sameScopeAndRun(
  scope: z.infer<typeof appScopeSchema>,
  runId: string,
  reference: ArtifactReference,
): boolean {
  return (
    reference.app_id === scope.app_id &&
    reference.tenant_id === scope.tenant_id &&
    reference.environment === scope.environment &&
    reference.run_id === runId
  );
}

const viewItemSchema = candidateSchema
  .pick({
    candidate_id: true,
    context_kind: true,
    source_ref: true,
    media_type: true,
    content: true,
  })
  .extend({ trust: z.literal("UNTRUSTED_DATA"), usage: z.literal("DATA_ONLY") });

const teamContextViewSchema = z.strictObject({
  schema_version: z.literal("team-context-view@2.0.0"),
  epoch_id: immutableIdSchema,
  task_id: immutableIdSchema,
  profile_id: dataAgentProfileIdSchema,
  items: z.array(viewItemSchema).max(128),
  byte_count: z.number().int().nonnegative().max(65_536),
  view_hash: contentHashSchema,
});

const omissionSchema = z.strictObject({
  candidate_id: candidateSchema.shape.candidate_id,
  source_ref: artifactReferenceSchema,
  mandatory: z.boolean(),
  reason: z.enum(["CAPACITY_PRUNED", "DUPLICATE_OFFLOADED"]),
});

const coverageSchema = z.strictObject({
  schema_version: z.literal("projection-coverage-receipt@2.0.0"),
  candidate_ids: z.array(candidateSchema.shape.candidate_id),
  included_ids: z.array(candidateSchema.shape.candidate_id),
  omitted: z.array(omissionSchema),
  on_demand_refs: z.array(artifactReferenceSchema),
  acceptance_blocked: z.boolean(),
  coverage_hash: contentHashSchema,
});

const manifestSchema = z.strictObject({
  schema_version: z.literal("context-build-manifest@2.0.0"),
  epoch_id: immutableIdSchema,
  task_id: immutableIdSchema,
  profile_hash: contentHashSchema,
  goal_revision: z.number().int().positive(),
  task_revision: z.number().int().positive(),
  event_watermark: z.number().int().nonnegative(),
  policy_ref: artifactReferenceSchema,
  semantic_release_ref: artifactReferenceSchema.nullable(),
  candidate_ref_identities: z.array(z.string()),
  max_context_bytes: z.number().int().positive().max(65_536),
  view_hash: contentHashSchema,
  coverage_hash: contentHashSchema,
  build_signature: contentHashSchema,
});

export const compiledTeamContextSchema = z.strictObject({
  view: teamContextViewSchema,
  coverage: coverageSchema,
  omission_ledger: z.strictObject({
    schema_version: z.literal("context-omission-ledger@2.0.0"),
    epoch_id: immutableIdSchema,
    omissions: z.array(omissionSchema),
    ledger_hash: contentHashSchema,
  }),
  manifest: manifestSchema,
});

export type TeamContextBuildInput = z.infer<typeof teamContextBuildInputSchema>;
export type CompiledTeamContext = z.infer<typeof compiledTeamContextSchema>;

function viewByteCount(items: readonly z.infer<typeof viewItemSchema>[]): number {
  return Buffer.byteLength(canonicalizeJson(items), "utf8");
}

export async function compileTeamContext(input: unknown): Promise<CompiledTeamContext> {
  const parsed = teamContextBuildInputSchema.parse(input);
  const candidates = [...parsed.candidates].sort(
    (left, right) =>
      Number(right.mandatory) - Number(left.mandatory) ||
      right.priority - left.priority ||
      left.candidate_id.localeCompare(right.candidate_id),
  );
  const selected: z.infer<typeof viewItemSchema>[] = [];
  const omitted: z.infer<typeof omissionSchema>[] = [];
  for (const candidate of candidates) {
    const item = {
      candidate_id: candidate.candidate_id,
      context_kind: candidate.context_kind,
      source_ref: candidate.source_ref,
      media_type: candidate.media_type,
      content: candidate.content,
      trust: "UNTRUSTED_DATA" as const,
      usage: "DATA_ONLY" as const,
    };
    if (viewByteCount([...selected, item]) <= parsed.max_context_bytes) selected.push(item);
    else
      omitted.push({
        candidate_id: candidate.candidate_id,
        source_ref: candidate.source_ref,
        mandatory: candidate.mandatory,
        reason: "CAPACITY_PRUNED",
      });
  }
  selected.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
  omitted.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));

  const viewDraft = {
    schema_version: "team-context-view@2.0.0" as const,
    epoch_id: parsed.epoch_id,
    task_id: parsed.task_id,
    profile_id: parsed.profile_revision.profile_id,
    items: selected,
    byte_count: viewByteCount(selected),
  };
  const view = teamContextViewSchema.parse({
    ...viewDraft,
    view_hash: await sha256ContentHash(viewDraft),
  });
  const candidateIds = parsed.candidates.map((candidate) => candidate.candidate_id).sort();
  const coverageDraft = {
    schema_version: "projection-coverage-receipt@2.0.0" as const,
    candidate_ids: candidateIds,
    included_ids: selected.map((item) => item.candidate_id).sort(),
    omitted,
    on_demand_refs: [
      ...new Map(
        omitted.map((item) => [artifactReferenceIdentity(item.source_ref), item.source_ref]),
      ).values(),
    ].sort((left, right) =>
      artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
    ),
    acceptance_blocked: omitted.some((item) => item.mandatory),
  };
  const coverage = coverageSchema.parse({
    ...coverageDraft,
    coverage_hash: await sha256ContentHash(coverageDraft),
  });
  const omissionDraft = {
    schema_version: "context-omission-ledger@2.0.0" as const,
    epoch_id: parsed.epoch_id,
    omissions: omitted,
  };
  const omissionLedger = {
    ...omissionDraft,
    ledger_hash: await sha256ContentHash(omissionDraft),
  };
  const manifestDraft = {
    schema_version: "context-build-manifest@2.0.0" as const,
    epoch_id: parsed.epoch_id,
    task_id: parsed.task_id,
    profile_hash: parsed.profile_revision.profile_hash,
    goal_revision: parsed.goal_revision,
    task_revision: parsed.task_revision,
    event_watermark: parsed.event_watermark,
    policy_ref: parsed.policy_ref,
    semantic_release_ref: parsed.semantic_release_ref,
    candidate_ref_identities: parsed.candidates
      .map(
        (candidate) =>
          `${candidate.candidate_id}:${artifactReferenceIdentity(candidate.source_ref)}`,
      )
      .sort(),
    max_context_bytes: parsed.max_context_bytes,
    view_hash: view.view_hash,
    coverage_hash: coverage.coverage_hash,
  };
  const manifest = manifestSchema.parse({
    ...manifestDraft,
    build_signature: await sha256ContentHash(manifestDraft),
  });
  return deepFreeze(
    compiledTeamContextSchema.parse({
      view,
      coverage,
      omission_ledger: omissionLedger,
      manifest,
    }),
  );
}

export async function verifyCompiledTeamContext(
  compiledInput: unknown,
  truthInput: unknown,
): Promise<CompiledTeamContext> {
  const compiled = compiledTeamContextSchema.parse(compiledInput);
  const rebuilt = await compileTeamContext(truthInput);
  if (canonicalizeJson(compiled) !== canonicalizeJson(rebuilt)) {
    throw new Error("TEAM_CONTEXT_TRUTH_DRIFT");
  }
  return deepFreeze(compiled);
}
