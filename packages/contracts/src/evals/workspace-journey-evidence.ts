import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

export const WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS = [
  "WORKSPACE_AUTHORIZATION",
  "GREENFIELD_GUIDANCE",
  "I18N_ZH_CN",
  "I18N_EN_US",
  "CONTEXT_PREVIEW",
  "AGENT_PUBLIC_SSE",
  "AGENT_TEAM_TRACE",
  "RECOVERY_MATRIX",
  "DESKTOP_VIEWPORT",
  "MOBILE_VIEWPORT",
  "KEYBOARD_NAVIGATION",
  "PRIVATE_DATA_REDACTION",
] as const;

export const workspaceJourneyCheckpointIdSchema = z.enum(WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS);

// biome-ignore lint/complexity/useRegexLiterals: the workspace architecture scanner stalls on this regex literal.
const workspaceJourneyRoutePattern = new RegExp(
  "^/w/[0-9a-f-]{36}(?:/[^\\s?#]*)?(?:\\?[^\\s#]*)?(?:#[^\\s]*)?$",
  "iu",
);

export const workspaceJourneyCheckSchema = z.strictObject({
  checkpoint_id: workspaceJourneyCheckpointIdSchema,
  status: z.literal("PASS"),
  actor_role: z.enum(["WORKSPACE_ADMIN", "ANALYST", "SEMANTIC_MAINTAINER", "SYSTEM"]),
  route: z.string().regex(workspaceJourneyRoutePattern),
  verification_method: z.enum(["AUTOMATED_TEST", "BROWSER"]),
  evidence_refs: z.array(contentHashSchema).min(1).max(32),
  summary: z.string().min(1).max(500),
});

export const workspaceJourneyViewportSchema = z.strictObject({
  name: z.enum(["DESKTOP", "MOBILE"]),
  width: z.number().int().min(320).max(7680),
  height: z.number().int().min(480).max(4320),
  screenshot_hash: contentHashSchema,
});

export const workspaceJourneyEvidenceArtifactSchema = z.strictObject({
  schema_version: z.literal("workspace-journey-evidence@1.0.0"),
  artifact_id: immutableIdSchema,
  scope: appScopeSchema,
  workspace_id: immutableIdSchema,
  goal_id: versionIdentifierSchema,
  result: z.literal("GO"),
  locales: z.tuple([z.literal("zh-CN"), z.literal("en-US")]),
  required_checkpoint_ids: z.tuple(
    WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS.map((checkpoint) => z.literal(checkpoint)) as [
      z.ZodLiteral<(typeof WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS)[0]>,
      ...z.ZodLiteral<(typeof WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS)[number]>[],
    ],
  ),
  checks: z
    .array(workspaceJourneyCheckSchema)
    .length(WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS.length),
  viewports: z.tuple([
    workspaceJourneyViewportSchema.extend({ name: z.literal("DESKTOP") }),
    workspaceJourneyViewportSchema.extend({ name: z.literal("MOBILE") }),
  ]),
  validated_at: timestampSchema,
  artifact_hash: contentHashSchema,
});

export type WorkspaceJourneyCheckpointId = z.infer<typeof workspaceJourneyCheckpointIdSchema>;
export type WorkspaceJourneyCheck = z.infer<typeof workspaceJourneyCheckSchema>;
export type WorkspaceJourneyViewport = z.infer<typeof workspaceJourneyViewportSchema>;
export type WorkspaceJourneyEvidenceArtifact = z.infer<
  typeof workspaceJourneyEvidenceArtifactSchema
>;

export interface BuildWorkspaceJourneyEvidenceInput {
  readonly artifact_id: string;
  readonly scope: z.input<typeof appScopeSchema>;
  readonly workspace_id: string;
  readonly goal_id: string;
  readonly checks: readonly z.input<typeof workspaceJourneyCheckSchema>[];
  readonly viewports: readonly z.input<typeof workspaceJourneyViewportSchema>[];
  readonly validated_at: string;
}

function closeChecks(
  input: readonly z.input<typeof workspaceJourneyCheckSchema>[],
): WorkspaceJourneyCheck[] {
  const parsed = input.map((check) => workspaceJourneyCheckSchema.parse(check));
  const byId = new Map(parsed.map((check) => [check.checkpoint_id, check]));
  if (byId.size !== parsed.length) {
    throw new Error("WORKSPACE_JOURNEY_DUPLICATE_CHECKPOINT");
  }
  return WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS.map((checkpoint) => {
    const check = byId.get(checkpoint);
    if (!check) throw new Error(`WORKSPACE_JOURNEY_MISSING_CHECKPOINT:${checkpoint}`);
    return {
      ...check,
      evidence_refs: [...check.evidence_refs].sort(),
    };
  });
}

function closeViewports(
  input: readonly z.input<typeof workspaceJourneyViewportSchema>[],
): WorkspaceJourneyEvidenceArtifact["viewports"] {
  const parsed = input.map((viewport) => workspaceJourneyViewportSchema.parse(viewport));
  const byName = new Map(parsed.map((viewport) => [viewport.name, viewport]));
  if (byName.size !== parsed.length) throw new Error("WORKSPACE_JOURNEY_DUPLICATE_VIEWPORT");
  const desktop = byName.get("DESKTOP");
  const mobile = byName.get("MOBILE");
  if (!desktop || !mobile) throw new Error("WORKSPACE_JOURNEY_VIEWPORT_CLOSURE_INCOMPLETE");
  return [
    { ...desktop, name: "DESKTOP" },
    { ...mobile, name: "MOBILE" },
  ];
}

export async function computeWorkspaceJourneyEvidenceHash(
  input: WorkspaceJourneyEvidenceArtifact,
): Promise<`sha256:${string}`> {
  const parsed = workspaceJourneyEvidenceArtifactSchema.parse(input);
  const { artifact_hash: _artifactHash, ...material } = parsed;
  return sha256ContentHash(material);
}

export async function buildWorkspaceJourneyEvidenceArtifact(
  input: BuildWorkspaceJourneyEvidenceInput,
): Promise<WorkspaceJourneyEvidenceArtifact> {
  const material = {
    schema_version: "workspace-journey-evidence@1.0.0" as const,
    artifact_id: input.artifact_id,
    scope: input.scope,
    workspace_id: input.workspace_id,
    goal_id: input.goal_id,
    result: "GO" as const,
    locales: ["zh-CN", "en-US"] as const,
    required_checkpoint_ids: [...WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS] as const,
    checks: closeChecks(input.checks),
    viewports: closeViewports(input.viewports),
    validated_at: input.validated_at,
  };
  const artifact_hash = await sha256ContentHash(material);
  return workspaceJourneyEvidenceArtifactSchema.parse({ ...material, artifact_hash });
}

export async function verifyWorkspaceJourneyEvidenceArtifact(
  input: unknown,
): Promise<WorkspaceJourneyEvidenceArtifact> {
  const artifact = workspaceJourneyEvidenceArtifactSchema.parse(input);
  const closedChecks = closeChecks(artifact.checks);
  if (
    closedChecks.some(
      (check, index) => check.checkpoint_id !== artifact.checks[index]?.checkpoint_id,
    )
  ) {
    throw new Error("WORKSPACE_JOURNEY_CHECKPOINT_ORDER_INVALID");
  }
  const expectedHash = await computeWorkspaceJourneyEvidenceHash(artifact);
  if (expectedHash !== artifact.artifact_hash) {
    throw new Error("WORKSPACE_JOURNEY_ARTIFACT_HASH_MISMATCH");
  }
  return artifact;
}
