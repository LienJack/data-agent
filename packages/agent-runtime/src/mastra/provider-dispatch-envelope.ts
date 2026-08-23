import {
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { dataAgentProfileIdSchema } from "../teams/agent-profiles.js";

const teamProviderDispatchEnvelopeDraftSchema = z
  .strictObject({
    schema_version: z.literal("team-provider-dispatch-envelope@2.0.0"),
    task_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    worker_fence: z.number().int().positive(),
    profile_id: dataAgentProfileIdSchema,
    profile_revision: z.number().int().positive(),
    profile_hash: contentHashSchema,
    model_config_version: z.number().int().positive(),
    context_epoch_id: immutableIdSchema,
    context_build_signature: contentHashSchema,
    projection_receipt_hash: contentHashSchema,
    final_messages_hash: contentHashSchema,
    tool_schemas_hash: contentHashSchema,
    attachments_hash: contentHashSchema,
    effective_input_ceiling: z.number().int().positive(),
    effective_output_ceiling: z.number().int().positive(),
    trusted_input_token_upper_bound: z.number().int().nonnegative(),
    token_bound_policy_version: versionIdentifierSchema,
  })
  .superRefine((envelope, ctx) => {
    if (envelope.trusted_input_token_upper_bound > envelope.effective_input_ceiling) {
      ctx.addIssue({
        code: "custom",
        message: "Trusted input token bound exceeds the effective input ceiling.",
        path: ["trusted_input_token_upper_bound"],
      });
    }
  });

export const teamProviderDispatchEnvelopeSchema = teamProviderDispatchEnvelopeDraftSchema.extend({
  dispatch_hash: contentHashSchema,
});

export type TeamProviderDispatchEnvelope = z.infer<typeof teamProviderDispatchEnvelopeSchema>;

export async function buildTeamProviderDispatchEnvelope(
  input: unknown,
): Promise<TeamProviderDispatchEnvelope> {
  const draft = teamProviderDispatchEnvelopeDraftSchema.parse(input);
  return deepFreeze(
    teamProviderDispatchEnvelopeSchema.parse({
      ...draft,
      dispatch_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyTeamProviderDispatchEnvelope(
  envelopeInput: unknown,
  expectedInput: unknown,
): Promise<TeamProviderDispatchEnvelope> {
  const envelope = teamProviderDispatchEnvelopeSchema.parse(envelopeInput);
  const expected = await buildTeamProviderDispatchEnvelope(expectedInput);
  if (canonicalizeJson(envelope) !== canonicalizeJson(expected)) {
    throw new Error("TEAM_PROVIDER_DISPATCH_MISMATCH");
  }
  return deepFreeze(envelope);
}
