import { createHash } from "node:crypto";
import {
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  knownArtifactTypeSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";

export const DATA_AGENT_PROFILE_IDS = [
  "data-agent-orchestrator",
  "governed-analysis-agent",
  "semantic-management-agent",
  "governed-text2sql-agent",
  "report-writing-agent",
] as const;

export const DATA_AGENT_SPECIALIST_PROFILE_IDS = [
  "governed-analysis-agent",
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

export const dataAgentProfileIdSchema = z.enum(DATA_AGENT_PROFILE_IDS);
export type DataAgentProfileId = z.infer<typeof dataAgentProfileIdSchema>;
export const dataAgentSpecialistProfileIdSchema = z.enum(DATA_AGENT_SPECIALIST_PROFILE_IDS);
export type DataAgentSpecialistProfileId = z.infer<typeof dataAgentSpecialistProfileIdSchema>;

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

const verifierContractSchema = z.strictObject({
  verifier_id: versionIdentifierSchema,
  required_dimensions: z
    .array(
      z.enum([
        "schema_valid",
        "scope_valid",
        "policy_valid",
        "provenance_valid",
        "execution_valid",
        "intent_grounded",
        "oracle_verified",
      ]),
    )
    .min(1),
  semantic_fallback: z.enum(["SEMANTICALLY_UNVERIFIED", "NEEDS_CLARIFICATION"]),
});

const agentProfileRevisionDraftSchema = z.strictObject({
  schema_version: z.literal("agent-profile-revision@2.0.0"),
  profile_id: dataAgentProfileIdSchema,
  revision: z.number().int().positive(),
  direct_tool_allowlist: z.array(versionIdentifierSchema).max(32),
  delegation_ceiling: z.array(dataAgentProfileIdSchema).max(4),
  mandatory_context: z.array(contextKindSchema).min(1).max(8),
  workflow: z.strictObject({
    workflow_id: versionIdentifierSchema,
    workflow_revision: z.number().int().positive(),
  }),
  expected_output_artifact_types: z.array(knownArtifactTypeSchema).min(1).max(8),
  verifier: verifierContractSchema,
});

function hashProfile(input: z.infer<typeof agentProfileRevisionDraftSchema>): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalizeJson(input)).digest("hex")}`;
}

function duplicateOrUnsorted(values: readonly string[]): boolean {
  return values.some((value, index) => index > 0 && value <= (values[index - 1] ?? ""));
}

export const agentProfileRevisionSchema = agentProfileRevisionDraftSchema
  .extend({ profile_hash: contentHashSchema })
  .superRefine((profile, ctx) => {
    for (const [field, values] of [
      ["direct_tool_allowlist", profile.direct_tool_allowlist],
      ["delegation_ceiling", profile.delegation_ceiling],
      ["mandatory_context", profile.mandatory_context],
      ["expected_output_artifact_types", profile.expected_output_artifact_types],
      ["required_dimensions", profile.verifier.required_dimensions],
    ] as const) {
      if (duplicateOrUnsorted(values)) {
        ctx.addIssue({
          code: "custom",
          message: `${field} must be canonical, unique and sorted.`,
          path: field === "required_dimensions" ? ["verifier", field] : [field],
        });
      }
    }
    const { profile_hash: actual, ...draft } = profile;
    if (hashProfile(agentProfileRevisionDraftSchema.parse(draft)) !== actual) {
      ctx.addIssue({ code: "custom", message: "Profile hash mismatch.", path: ["profile_hash"] });
    }
    if (profile.profile_id === "data-agent-orchestrator") {
      const expectedDelegationCount = profile.revision === 1 ? 3 : 4;
      if (
        profile.direct_tool_allowlist.length !== 0 ||
        profile.delegation_ceiling.length !== expectedDelegationCount
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Orchestrator revision ${profile.revision} has no direct domain tools and delegates to exactly ${expectedDelegationCount} profiles.`,
          path: ["profile_id"],
        });
      }
    } else if (profile.delegation_ceiling.length !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "Specialist profiles cannot recursively delegate.",
        path: ["delegation_ceiling"],
      });
    }
  });

export type AgentProfileRevision = z.infer<typeof agentProfileRevisionSchema>;

function profile(input: z.infer<typeof agentProfileRevisionDraftSchema>): AgentProfileRevision {
  return deepFreeze(
    agentProfileRevisionSchema.parse({ ...input, profile_hash: hashProfile(input) }),
  );
}

const dimensions = [
  "execution_valid",
  "intent_grounded",
  "oracle_verified",
  "policy_valid",
  "provenance_valid",
  "schema_valid",
  "scope_valid",
] as const;

export const AGENT_PROFILE_REVISIONS = deepFreeze([
  profile({
    schema_version: "agent-profile-revision@2.0.0",
    profile_id: "data-agent-orchestrator",
    revision: 1,
    direct_tool_allowlist: [],
    delegation_ceiling: [
      "governed-text2sql-agent",
      "report-writing-agent",
      "semantic-management-agent",
    ],
    mandatory_context: ["GOAL", "OPEN_OBLIGATIONS", "POLICY", "QUESTION"],
    workflow: { workflow_id: "team.orchestrator.v2", workflow_revision: 1 },
    expected_output_artifact_types: ["ReportManifest"],
    verifier: {
      verifier_id: "team.orchestrator-verifier.v2",
      required_dimensions: [...dimensions],
      semantic_fallback: "NEEDS_CLARIFICATION",
    },
  }),
  profile({
    schema_version: "agent-profile-revision@2.0.0",
    profile_id: "data-agent-orchestrator",
    revision: 2,
    direct_tool_allowlist: [],
    delegation_ceiling: [
      "governed-analysis-agent",
      "governed-text2sql-agent",
      "report-writing-agent",
      "semantic-management-agent",
    ],
    mandatory_context: ["GOAL", "OPEN_OBLIGATIONS", "POLICY", "QUESTION"],
    workflow: { workflow_id: "team.orchestrator.v3", workflow_revision: 1 },
    expected_output_artifact_types: ["ReportManifest"],
    verifier: {
      verifier_id: "team.orchestrator-verifier.v3",
      required_dimensions: [...dimensions],
      semantic_fallback: "NEEDS_CLARIFICATION",
    },
  }),
  profile({
    schema_version: "agent-profile-revision@2.0.0",
    profile_id: "governed-analysis-agent",
    revision: 2,
    direct_tool_allowlist: ["analysis.program.execute"],
    delegation_ceiling: [],
    mandatory_context: [
      "GOAL",
      "POLICY",
      "QUERY_EVIDENCE",
      "QUESTION",
      "SCHEMA_MAPPING",
      "SEMANTIC_RELEASE",
    ],
    workflow: { workflow_id: "team.governed-analysis.v2", workflow_revision: 1 },
    expected_output_artifact_types: ["AnalysisReport"],
    verifier: {
      verifier_id: "team.governed-analysis-verifier.v2",
      required_dimensions: [...dimensions],
      semantic_fallback: "NEEDS_CLARIFICATION",
    },
  }),
  profile({
    schema_version: "agent-profile-revision@2.0.0",
    profile_id: "semantic-management-agent",
    revision: 1,
    direct_tool_allowlist: ["semantic.candidate.write", "semantic.catalog.read"],
    delegation_ceiling: [],
    mandatory_context: ["GOAL", "POLICY", "QUESTION", "SCHEMA_MAPPING"],
    workflow: { workflow_id: "team.semantic-candidate.v2", workflow_revision: 1 },
    expected_output_artifact_types: ["SemanticGraphCandidate"],
    verifier: {
      verifier_id: "team.semantic-candidate-verifier.v2",
      required_dimensions: [...dimensions],
      semantic_fallback: "SEMANTICALLY_UNVERIFIED",
    },
  }),
  profile({
    schema_version: "agent-profile-revision@2.0.0",
    profile_id: "semantic-management-agent",
    revision: 2,
    direct_tool_allowlist: ["semantic.candidate.write", "semantic.catalog.read"],
    delegation_ceiling: [],
    mandatory_context: ["GOAL", "POLICY", "QUESTION", "SCHEMA_MAPPING"],
    workflow: { workflow_id: "team.semantic-read.v2", workflow_revision: 1 },
    expected_output_artifact_types: ["AnalysisReport", "SemanticGraphCandidate"],
    verifier: {
      verifier_id: "team.semantic-read-verifier.v2",
      required_dimensions: [...dimensions],
      semantic_fallback: "SEMANTICALLY_UNVERIFIED",
    },
  }),
  profile({
    schema_version: "agent-profile-revision@2.0.0",
    profile_id: "semantic-management-agent",
    revision: 3,
    direct_tool_allowlist: ["semantic.catalog.read"],
    delegation_ceiling: [],
    mandatory_context: ["GOAL", "POLICY", "QUESTION", "SCHEMA_MAPPING", "SEMANTIC_RELEASE"],
    workflow: { workflow_id: "team.semantic-read.v3", workflow_revision: 1 },
    expected_output_artifact_types: ["AnalysisReport"],
    verifier: {
      verifier_id: "team.semantic-read-verifier.v3",
      required_dimensions: [...dimensions],
      semantic_fallback: "SEMANTICALLY_UNVERIFIED",
    },
  }),
  profile({
    schema_version: "agent-profile-revision@2.0.0",
    profile_id: "governed-text2sql-agent",
    revision: 1,
    direct_tool_allowlist: ["semantic.release.read", "sql.compiler.compile", "sql.sandbox.execute"],
    delegation_ceiling: [],
    mandatory_context: ["GOAL", "POLICY", "QUESTION", "SCHEMA_MAPPING", "SEMANTIC_RELEASE"],
    workflow: { workflow_id: "team.governed-text2sql.v2", workflow_revision: 1 },
    expected_output_artifact_types: ["QueryEvidence"],
    verifier: {
      verifier_id: "team.query-evidence-verifier.v2",
      required_dimensions: [...dimensions],
      semantic_fallback: "NEEDS_CLARIFICATION",
    },
  }),
  profile({
    schema_version: "agent-profile-revision@2.0.0",
    profile_id: "report-writing-agent",
    revision: 1,
    direct_tool_allowlist: ["evidence.read", "report.project"],
    delegation_ceiling: [],
    mandatory_context: ["CLAIM_EVIDENCE", "GOAL", "POLICY", "QUERY_EVIDENCE"],
    workflow: { workflow_id: "team.report-writing.v2", workflow_revision: 1 },
    expected_output_artifact_types: ["AnalysisReport"],
    verifier: {
      verifier_id: "team.report-verifier.v2",
      required_dimensions: [...dimensions],
      semantic_fallback: "SEMANTICALLY_UNVERIFIED",
    },
  }),
] as const);

const profilesByIdentity = new Map(
  AGENT_PROFILE_REVISIONS.map((entry) => [
    `${entry.profile_id}:${entry.revision}:${entry.profile_hash}`,
    entry,
  ]),
);
const profilesById = new Map(AGENT_PROFILE_REVISIONS.map((entry) => [entry.profile_id, entry]));

export function getAgentProfileRevision(profileId: DataAgentProfileId): AgentProfileRevision {
  const result = profilesById.get(profileId);
  if (!result) throw new Error("TEAM_PROFILE_NOT_FOUND");
  return result;
}

export function getAgentProfileRevisionExact(
  profileId: DataAgentProfileId,
  revision: number,
  profileHash: string,
): AgentProfileRevision {
  const result = profilesByIdentity.get(`${profileId}:${revision}:${profileHash}`);
  if (!result) throw new Error("TEAM_PROFILE_REVISION_NOT_FOUND");
  return result;
}

export function assertDirectToolAllowed(profileId: DataAgentProfileId, toolId: string): void {
  if (!getAgentProfileRevision(profileId).direct_tool_allowlist.includes(toolId)) {
    throw new Error("TEAM_DIRECT_TOOL_DENIED");
  }
}

export function assertDelegationAllowed(
  fromProfileId: DataAgentProfileId,
  toProfileId: DataAgentProfileId,
): void {
  if (fromProfileId !== "data-agent-orchestrator") {
    throw new Error("TEAM_RECURSIVE_DELEGATION_DENIED");
  }
  if (!getAgentProfileRevision(fromProfileId).delegation_ceiling.includes(toProfileId)) {
    throw new Error("TEAM_DELEGATION_NOT_ALLOWED");
  }
}
