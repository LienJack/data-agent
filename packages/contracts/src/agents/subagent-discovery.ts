import { z } from "zod";
import { knownArtifactTypeSchema } from "../artifacts/types.js";

export const agentProfileIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
    "Agent Profile ID must be a stable lowercase kebab-case identifier.",
  );

const PUBLIC_DISCOVERY_TEXT_MAX_LENGTH = 600;
const forbiddenDiscoveryText =
  /(?:api[-_ ]?key|authorization|bearer\s+|password|private[-_ ]?key|secret[-_ ]?ref|system\s+prompt|-----BEGIN)/i;

export const subagentPublicDiscoveryTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(PUBLIC_DISCOVERY_TEXT_MAX_LENGTH)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      }),
    {
      message: "Subagent discovery text cannot contain control characters.",
    },
  )
  .refine((value) => !forbiddenDiscoveryText.test(value), {
    message: "Subagent discovery text cannot contain prompts, credentials, or secret references.",
  });

function addDuplicateIssues(
  values: readonly string[],
  ctx: z.RefinementCtx,
  path: readonly PropertyKey[],
  message: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({ code: "custom", message, path: [...path, index] });
    }
    seen.add(value);
  });
}

function isCanonicallySorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? ""));
}

const subagentDiscoveryExampleSchema = z.strictObject({
  request: subagentPublicDiscoveryTextSchema.max(240),
  expected_use: subagentPublicDiscoveryTextSchema.max(240),
});

export const subagentDiscoveryDescriptorSchema = z
  .strictObject({
    schema_version: z.literal("subagent-discovery-descriptor@1.0.0"),
    display_name: subagentPublicDiscoveryTextSchema.max(80),
    description: subagentPublicDiscoveryTextSchema,
    when_to_use: z.array(subagentPublicDiscoveryTextSchema.max(240)).min(1).max(12),
    when_not_to_use: z.array(subagentPublicDiscoveryTextSchema.max(240)).max(12),
    examples: z.array(subagentDiscoveryExampleSchema).max(12),
    accepted_input_artifact_types: z.array(knownArtifactTypeSchema).max(16),
    produced_artifact_types: z.array(knownArtifactTypeSchema).min(1).max(16),
    access_mode: z.enum(["READ_ONLY", "CONTROLLED_WRITE"]),
  })
  .superRefine((descriptor, ctx) => {
    addDuplicateIssues(
      descriptor.when_to_use,
      ctx,
      ["when_to_use"],
      "when_to_use cannot contain duplicate entries.",
    );
    addDuplicateIssues(
      descriptor.when_not_to_use,
      ctx,
      ["when_not_to_use"],
      "when_not_to_use cannot contain duplicate entries.",
    );
    for (const [field, values] of [
      ["accepted_input_artifact_types", descriptor.accepted_input_artifact_types],
      ["produced_artifact_types", descriptor.produced_artifact_types],
    ] as const) {
      if (!isCanonicallySorted(values)) {
        ctx.addIssue({
          code: "custom",
          message: `${field} must be unique and canonically sorted.`,
          path: [field],
        });
      }
    }
  });

export type AgentProfileId = z.infer<typeof agentProfileIdSchema>;
export type SubagentDiscoveryDescriptor = z.infer<typeof subagentDiscoveryDescriptorSchema>;
