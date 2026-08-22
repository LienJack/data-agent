import {
  type AuthoritativeModelProviderInvocation,
  type AvailableModelProfile,
  canonicalizeJson,
  computeModelProfileHash,
  computeSemanticChangeProposalDigest,
  createDirectModelProviderInvocation,
  type ModelProviderPort,
  type SchemaFeaturePacket,
  type SemanticAgentReceipt,
  type SemanticChangeProposal,
  type SemanticCompileTerminal,
  semanticAgentCandidateOutputSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { buildPhysicalSchemaEvidence } from "./features.js";
import { validateSemanticChangeProposal } from "./validation.js";

export const SEMANTIC_AGENT_CANDIDATE_OUTPUT_VERSION =
  "semantic-agent-candidate-output@1.0.0" as const;
export const SEMANTIC_SCHEMA_COMPILER_VERSION = "semantic-schema-candidate-compiler@1.0.0";
export const SEMANTIC_CANDIDATE_POLICY_VERSION = "semantic-candidate-policy@1.0.0";

export const SEMANTIC_CANDIDATE_SYSTEM_PROMPT = [
  "You propose review-only semantic graph changes from an authoritative physical schema feature packet.",
  "Return only the registered structured output schema.",
  "Use only evidence IDs in the supplied evidence catalog and cite evidence for every operation and material field.",
  "Never emit SQL, JSON Patch, delete, publish, approve, rollback, authorization, policy, or tool operations.",
  "An FK proves only a physical relationship; it does not prove analytical fanout or row-preservation safety.",
  "Represent removal or drift invalidation as MARK_STALE. State assumptions and open questions explicitly.",
  "These are unpublished candidates for human review, not active semantics.",
].join("\n");

const TOOL_POLICY = Object.freeze({ tool_allowlist: [] as readonly string[], max_tool_calls: 0 });

export interface SemanticCandidateAgentBudget {
  readonly timeout_ms: number;
  readonly max_input_tokens: number;
  readonly max_output_tokens: number;
}

export interface RunSemanticCandidateAgentInput {
  readonly profile: AvailableModelProfile;
  readonly model_provider: ModelProviderPort;
  readonly packet: SchemaFeaturePacket;
  readonly compile_run_id: string;
  readonly source_revision_id: string;
  readonly request_id: string;
  readonly attempt_id: string;
  readonly budget: SemanticCandidateAgentBudget;
  readonly known_target_keys?: ReadonlySet<string>;
}

export type SemanticCandidateAgentResult =
  | {
      readonly terminal: "COMPILED";
      readonly proposal: SemanticChangeProposal;
      readonly agent_receipt: SemanticAgentReceipt;
      readonly failure_code: null;
    }
  | {
      readonly terminal: Exclude<SemanticCompileTerminal, "COMPILED">;
      readonly proposal: null;
      readonly agent_receipt: SemanticAgentReceipt;
      readonly failure_code: string;
    };

export async function buildSemanticAgentReceipt(
  profile: AvailableModelProfile,
): Promise<SemanticAgentReceipt> {
  const [
    modelProfileDigest,
    promptDigest,
    toolPolicyDigest,
    compilerDigest,
    candidatePolicyDigest,
  ] = await Promise.all([
    computeModelProfileHash(profile),
    sha256ContentHash({
      prompt_version: "semantic-candidate-prompt@1.0.0",
      system_prompt: SEMANTIC_CANDIDATE_SYSTEM_PROMPT,
    }),
    sha256ContentHash(TOOL_POLICY),
    sha256ContentHash({ compiler_version: SEMANTIC_SCHEMA_COMPILER_VERSION }),
    sha256ContentHash({
      policy_version: SEMANTIC_CANDIDATE_POLICY_VERSION,
      low_confidence_threshold: 0.8,
      physical_relationship_requires_fk: true,
      analytical_relationship_requires_snapshot_proof: true,
      deletion_mode: "MARK_STALE",
    }),
  ]);
  return {
    provider_id: profile.provider,
    model_id: profile.model_id,
    model_profile_digest: modelProfileDigest,
    prompt_digest: promptDigest,
    tool_policy_digest: toolPolicyDigest,
    compiler_digest: compilerDigest,
    candidate_policy_digest: candidatePolicyDigest,
  };
}

function failureTerminal(reasonCode: string): Exclude<SemanticCompileTerminal, "COMPILED"> {
  if (reasonCode.includes("TIMEOUT")) return "TIMEOUT";
  if (reasonCode.includes("TOOL") || reasonCode.includes("PROTOCOL")) return "INVALID_OUTPUT";
  return "AGENT_UNAVAILABLE";
}

export async function runSemanticCandidateAgent(
  input: RunSemanticCandidateAgentInput,
): Promise<SemanticCandidateAgentResult> {
  const agentReceipt = await buildSemanticAgentReceipt(input.profile);
  const evidence = buildPhysicalSchemaEvidence(input.packet);
  const userMessage = canonicalizeJson({
    feature_packet: input.packet,
    evidence_catalog: evidence,
    required_output_schema: SEMANTIC_AGENT_CANDIDATE_OUTPUT_VERSION,
  });

  let request: AuthoritativeModelProviderInvocation;
  try {
    request = createDirectModelProviderInvocation({
      schema_version: "semantic-model-request@1.0.0",
      request_id: input.request_id,
      attempt_id: input.attempt_id,
      scope: input.profile.scope,
      run_id: input.compile_run_id,
      provider: input.profile.provider,
      profile_id: input.profile.profile_id,
      profile_version: input.profile.profile_version,
      model_id: input.profile.model_id,
      task_ref: {
        artifact_id: input.packet.snapshot_id,
        artifact_type: "SchemaSnapshot",
        ...input.profile.scope,
        run_id: input.compile_run_id,
        revision: 1,
        content_hash: input.packet.snapshot_digest,
      },
      context_refs: [],
      messages: [
        { role: "system", content: SEMANTIC_CANDIDATE_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      tool_allowlist: [],
      response_schema_version: SEMANTIC_AGENT_CANDIDATE_OUTPUT_VERSION,
      budget: { ...input.budget, max_tool_calls: 0 },
    });
  } catch {
    return {
      terminal: "AGENT_UNAVAILABLE",
      proposal: null,
      agent_receipt: agentReceipt,
      failure_code: "DIRECT_MODEL_REQUEST_INVALID",
    };
  }

  let outputText: string | null = null;
  try {
    for await (const event of input.model_provider.stream(request)) {
      if (event.event_type === "TOOL_CALL_CANDIDATE") {
        return {
          terminal: "INVALID_OUTPUT",
          proposal: null,
          agent_receipt: agentReceipt,
          failure_code: "MODEL_TOOL_OUTPUT_FORBIDDEN",
        };
      }
      if (event.event_type === "FAILED") {
        return {
          terminal: failureTerminal(event.reason_code),
          proposal: null,
          agent_receipt: agentReceipt,
          failure_code: event.reason_code,
        };
      }
      if (event.event_type === "COMPLETED") outputText = event.output_text;
    }
  } catch {
    return {
      terminal: "AGENT_UNAVAILABLE",
      proposal: null,
      agent_receipt: agentReceipt,
      failure_code: "MODEL_PROVIDER_STREAM_FAILED",
    };
  }

  if (outputText === null) {
    return {
      terminal: "AGENT_UNAVAILABLE",
      proposal: null,
      agent_receipt: agentReceipt,
      failure_code: "MODEL_COMPLETION_MISSING",
    };
  }

  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(outputText);
  } catch {
    return {
      terminal: "INVALID_OUTPUT",
      proposal: null,
      agent_receipt: agentReceipt,
      failure_code: "MODEL_OUTPUT_NOT_JSON",
    };
  }
  const output = semanticAgentCandidateOutputSchema.safeParse(parsedOutput);
  if (!output.success) {
    return {
      terminal: "INVALID_OUTPUT",
      proposal: null,
      agent_receipt: agentReceipt,
      failure_code: "MODEL_OUTPUT_SCHEMA_INVALID",
    };
  }

  const proposalMaterial = {
    schema_version: "semantic-change-proposal@1.0.0" as const,
    compile_run_id: input.compile_run_id,
    source_revision_id: input.source_revision_id,
    feature_digest: input.packet.feature_digest,
    snapshot_id: input.packet.snapshot_id,
    snapshot_digest: input.packet.snapshot_digest,
    drift_event_id: input.packet.drift_event_id,
    drift_digest: input.packet.drift_digest,
    base_release: input.packet.base_release,
    agent_receipt: agentReceipt,
    evidence: [...evidence],
    operations: output.data.operations,
    summary: output.data.summary,
  };
  const proposal: SemanticChangeProposal = {
    ...proposalMaterial,
    proposal_digest: await computeSemanticChangeProposalDigest(proposalMaterial),
  };
  const validation = await validateSemanticChangeProposal(proposal, input.packet, {
    ...(input.known_target_keys ? { known_target_keys: input.known_target_keys } : {}),
  });
  if (!validation.valid) {
    return {
      terminal: "VALIDATION_FAILED",
      proposal: null,
      agent_receipt: agentReceipt,
      failure_code: validation.issues[0]?.code ?? "SEMANTIC_CANDIDATE_VALIDATION_FAILED",
    };
  }

  return { terminal: "COMPILED", proposal, agent_receipt: agentReceipt, failure_code: null };
}
